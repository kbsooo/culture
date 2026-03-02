// scripts/process-book.mjs
// Parses a closed GitHub Issue (book form), fetches Aladin metadata, appends to data/books.json

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

function parseAuthors(rawAuthor) {
  if (!rawAuthor) return [];
  // Example: "홍길동 (지은이), 김철수 (옮긴이)"
  return rawAuthor
    .split(',')
    .map(s => s.replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean);
}

async function fetchAladinBookData(title, ttbKey) {
  if (!ttbKey) {
    console.warn('[Aladin] ALADIN_TTB_KEY is not set. Continue without metadata.');
    return null;
  }

  const url = new URL('https://www.aladin.co.kr/ttb/api/ItemSearch.aspx');
  url.searchParams.set('ttbkey', ttbKey);
  url.searchParams.set('Query', title);
  url.searchParams.set('QueryType', 'Keyword');
  url.searchParams.set('SearchTarget', 'Book');
  url.searchParams.set('MaxResults', '5');
  url.searchParams.set('start', '1');
  url.searchParams.set('output', 'js');
  url.searchParams.set('Version', '20131101');

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[Aladin] API error: ${res.status} ${res.statusText}`);
    return null;
  }

  const data = await res.json();
  if (!Array.isArray(data.item) || data.item.length === 0) {
    console.warn(`[Aladin] No results for: "${title}"`);
    return null;
  }

  const book = data.item[0];
  const year = parseInt((book.pubDate ?? '').slice(0, 4), 10);
  const categories = (book.categoryName ?? '')
    .split('>')
    .map(s => s.trim())
    .filter(Boolean);

  return {
    aladin_item_id: book.itemId ?? null,
    title: book.title ?? null,
    authors: parseAuthors(book.author),
    cover_url: book.cover ?? null,
    publisher: book.publisher ?? null,
    first_publish_year: Number.isFinite(year) ? year : null,
    subjects: categories.slice(0, 5),
    pages: book.subInfo?.itemPage ?? null,
    isbn: book.isbn13 ?? book.isbn ?? null,
  };
}

async function main() {
  const body = process.env.ISSUE_BODY ?? '';
  const issueNumber = parseInt(process.env.ISSUE_NUMBER ?? '0', 10);
  const ttbKey = process.env.ALADIN_TTB_KEY;

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

  const aladin = await fetchAladinBookData(userTitle, ttbKey);

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
    aladin_item_id: aladin?.aladin_item_id ?? null,
    title_normalized: aladin?.title ?? userTitle,
    authors: aladin?.authors ?? [],
    cover_url: aladin?.cover_url ?? null,
    // Keep for backward compatibility with existing component/data shape.
    cover_id: null,
    publisher: aladin?.publisher ?? null,
    first_publish_year: aladin?.first_publish_year ?? null,
    subjects: aladin?.subjects ?? [],
    pages: aladin?.pages ?? null,
    isbn: aladin?.isbn ?? null,
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
