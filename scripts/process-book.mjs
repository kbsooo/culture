// scripts/process-book.mjs
// Parses a closed GitHub Issue (book form), fetches Open Library metadata, appends to data/books.json

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

function parseIssueForm(body) {
  const sections = {};
  const parts = body.split(/^### /m).filter(Boolean);
  for (const part of parts) {
    const lines = part.trim().split('\n');
    const key = lines[0].trim();
    const value = lines
      .slice(1)
      .join('\n')
      .trim()
      .replace(/^_No response_$/m, '');
    sections[key] = value.trim();
  }
  return sections;
}

async function fetchOpenLibraryData(title) {
  // Open Library search API - no auth required
  const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=1&fields=key,title,author_name,cover_i,first_publish_year,subject,number_of_pages_median,isbn`;

  const res = await fetch(searchUrl);
  const data = await res.json();

  if (!data.docs || data.docs.length === 0) {
    console.warn(`[OpenLibrary] No results for: "${title}"`);
    return null;
  }

  const book = data.docs[0];

  return {
    ol_key: book.key ?? null,
    title: book.title ?? null,
    authors: book.author_name ?? [],
    cover_id: book.cover_i ?? null,
    first_publish_year: book.first_publish_year ?? null,
    subjects: (book.subject ?? []).slice(0, 5),
    pages: book.number_of_pages_median ?? null,
    isbn: (book.isbn ?? [])[0] ?? null,
  };
}

async function main() {
  const body = process.env.ISSUE_BODY ?? '';
  const issueNumber = parseInt(process.env.ISSUE_NUMBER ?? '0', 10);
  const issueFallbackDate = (process.env.ISSUE_CREATED_AT ?? new Date().toISOString()).slice(0, 10);

  const parsed = parseIssueForm(body);
  console.log('[parse] Parsed sections:', JSON.stringify(parsed, null, 2));

  const userTitle  = parsed['제목']?.trim() ?? '';
  const userRating = parseInt(parsed['별점']?.trim() ?? '0', 10);
  const userReview = parsed['한줄 후기']?.trim() ?? '';
  // null when empty — intentional "날짜 미상" support (no fallback to today)
  const rawStart  = parsed['시작일']?.trim();
  const rawFinish = parsed['완독일']?.trim();
  const startDate  = (rawStart  && /^\d{4}-\d{2}-\d{2}$/.test(rawStart))  ? rawStart  : null;
  const finishDate = (rawFinish && /^\d{4}-\d{2}-\d{2}$/.test(rawFinish)) ? rawFinish : null;

  if (!userTitle) {
    throw new Error('제목(title) field is empty in the issue body');
  }

  console.log(`[info] Processing book: "${userTitle}", rating: ${userRating}, finish: ${finishDate}`);

  const ol = await fetchOpenLibraryData(userTitle);

  // Calculate reading duration in days
  let readingDays = null;
  if (startDate && finishDate) {
    const diffMs = new Date(finishDate) - new Date(startDate);
    readingDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  const record = {
    id: issueNumber,
    user_title: userTitle,
    rating: userRating,
    review: userReview,
    start_date: startDate,
    finish_date: finishDate,
    reading_days: readingDays,
    added_at: new Date().toISOString(),
    ol_key: ol?.ol_key ?? null,
    title_normalized: ol?.title ?? userTitle,
    authors: ol?.authors ?? [],
    cover_id: ol?.cover_id ?? null,
    first_publish_year: ol?.first_publish_year ?? null,
    subjects: ol?.subjects ?? [],
    pages: ol?.pages ?? null,
    isbn: ol?.isbn ?? null,
  };

  const dataPath = resolve(process.cwd(), 'data', 'books.json');
  let books = [];
  try {
    books = JSON.parse(readFileSync(dataPath, 'utf-8'));
  } catch {
    books = [];
  }

  if (books.some(b => b.id === issueNumber)) {
    console.log(`[skip] Issue #${issueNumber} already exists in books.json`);
    process.exit(0);
  }

  books.push(record);
  // Dated entries first (desc), undated at end
  books.sort((a, b) => {
    if (!a.finish_date && !b.finish_date) return 0;
    if (!a.finish_date) return 1;
    if (!b.finish_date) return -1;
    return b.finish_date.localeCompare(a.finish_date);
  });

  writeFileSync(dataPath, JSON.stringify(books, null, 2) + '\n');
  console.log(`[done] Added book "${record.title_normalized}" (issue #${issueNumber})`);
}

main().catch(err => {
  console.error('[error]', err);
  process.exit(1);
});
