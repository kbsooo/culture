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

function normalizeCoverUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed.replace(/^http:\/\//i, 'https://');
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function pickPageCount(book) {
  return (
    parsePositiveInt(book?.subInfo?.itemPage) ??
    parsePositiveInt(book?.itemPage) ??
    parsePositiveInt(book?.pageCount) ??
    null
  );
}

function normalizeYear(value) {
  const year = parseInt(String(value ?? '').slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function pickGoogleIsbn(identifiers) {
  if (!Array.isArray(identifiers)) return null;
  const isbn13 = identifiers.find(id => id?.type === 'ISBN_13')?.identifier;
  if (isbn13) return isbn13;
  return identifiers.find(id => id?.type === 'ISBN_10')?.identifier ?? null;
}

function openLibraryCoverFromIsbn(isbn) {
  if (!isbn) return null;
  return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg`;
}

async function fetchAladinItemDetail(itemId, ttbKey) {
  if (!itemId || !ttbKey) return null;
  try {
    const url = new URL('https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx');
    url.searchParams.set('ttbkey', ttbKey);
    url.searchParams.set('itemIdType', 'ItemId');
    url.searchParams.set('ItemId', String(itemId));
    url.searchParams.set('Cover', 'Big');
    url.searchParams.set('output', 'js');
    url.searchParams.set('Version', '20131101');
    url.searchParams.set('OptResult', 'subInfo');

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[Aladin] ItemLookUp error: ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    const detail = Array.isArray(data.item) ? data.item[0] : null;
    return detail ?? null;
  } catch (error) {
    console.warn(`[Aladin] ItemLookUp request failed: ${error?.message ?? error}`);
    return null;
  }
}

function buildQueryCandidates(title) {
  const base = (title ?? '').trim();
  if (!base) return [];

  const candidates = [base];
  const separators = [' - ', ' – ', ' — ', ' : ', ': '];
  for (const sep of separators) {
    const idx = base.indexOf(sep);
    if (idx > 0) {
      candidates.push(base.slice(0, idx).trim());
    }
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function fetchAladinBookData(title, ttbKey) {
  if (!ttbKey) {
    console.warn('[Aladin] ALADIN_TTB_KEY is not set. Continue without metadata.');
    return null;
  }

  let selectedBook = null;
  const queryCandidates = buildQueryCandidates(title);
  const queryTypes = ['Title', 'Keyword'];

  for (const query of queryCandidates) {
    for (const queryType of queryTypes) {
      try {
        const url = new URL('https://www.aladin.co.kr/ttb/api/ItemSearch.aspx');
        url.searchParams.set('ttbkey', ttbKey);
        url.searchParams.set('Query', query);
        url.searchParams.set('QueryType', queryType);
        url.searchParams.set('SearchTarget', 'Book');
        url.searchParams.set('MaxResults', '10');
        url.searchParams.set('start', '1');
        url.searchParams.set('Cover', 'Big');
        url.searchParams.set('output', 'js');
        url.searchParams.set('Version', '20131101');

        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`[Aladin] API error (${queryType}): ${res.status} ${res.statusText}`);
          continue;
        }

        const data = await res.json();
        if (!Array.isArray(data.item) || data.item.length === 0) continue;

        selectedBook = data.item.find(item => normalizeCoverUrl(item.cover)) ?? data.item[0];
        if (selectedBook) break;
      } catch (error) {
        console.warn(`[Aladin] Request failed (${queryType}) for "${query}": ${error?.message ?? error}`);
      }
    }
    if (selectedBook) break;
  }

  if (!selectedBook) {
    console.warn(`[Aladin] No results for: "${title}"`);
    return null;
  }

  const book = selectedBook;
  const detail = await fetchAladinItemDetail(book.itemId, ttbKey);
  const source = detail ?? book;
  const year = normalizeYear(source.pubDate);
  const categories = (book.categoryName ?? '')
    .split('>')
    .map(s => s.trim())
    .filter(Boolean);

  return {
    aladin_item_id: source.itemId ?? book.itemId ?? null,
    title: source.title ?? book.title ?? null,
    authors: parseAuthors(source.author ?? book.author),
    cover_url: normalizeCoverUrl(source.cover ?? book.cover),
    publisher: source.publisher ?? book.publisher ?? null,
    first_publish_year: year,
    subjects: categories.slice(0, 5),
    pages: pickPageCount(source),
    isbn: source.isbn13 ?? source.isbn ?? book.isbn13 ?? book.isbn ?? null,
  };
}

async function fetchGoogleBooksData(title) {
  const query = (title ?? '').trim();
  if (!query) return null;

  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', `intitle:${query}`);
  url.searchParams.set('maxResults', '10');
  url.searchParams.set('printType', 'books');

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[GoogleBooks] API error: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data.items) || data.items.length === 0) {
      console.warn(`[GoogleBooks] No results for: "${title}"`);
      return null;
    }

    const picked =
      data.items.find(item => normalizeCoverUrl(item?.volumeInfo?.imageLinks?.thumbnail)) ??
      data.items[0];

    const volume = picked?.volumeInfo ?? {};
    const isbn = pickGoogleIsbn(volume.industryIdentifiers);
    const googleCover = normalizeCoverUrl(
      volume.imageLinks?.thumbnail ??
      volume.imageLinks?.smallThumbnail ??
      volume.imageLinks?.medium
    );

    return {
      google_volume_id: picked?.id ?? null,
      title: volume.title ?? null,
      authors: Array.isArray(volume.authors) ? volume.authors : [],
      cover_url: googleCover ?? openLibraryCoverFromIsbn(isbn),
      publisher: volume.publisher ?? null,
      first_publish_year: normalizeYear(volume.publishedDate),
      subjects: Array.isArray(volume.categories) ? volume.categories.slice(0, 5) : [],
      pages: pickPageCount(volume),
      isbn,
    };
  } catch (error) {
    console.warn(`[GoogleBooks] Request failed: ${error?.message ?? error}`);
    return null;
  }
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
  const google = (!aladin || !aladin.cover_url || !aladin.pages)
    ? await fetchGoogleBooksData(userTitle)
    : null;

  const authors = (aladin?.authors?.length ? aladin.authors : (google?.authors ?? []));
  const subjects = (aladin?.subjects?.length ? aladin.subjects : (google?.subjects ?? []));

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
    google_volume_id: google?.google_volume_id ?? null,
    title_normalized: aladin?.title ?? google?.title ?? userTitle,
    authors,
    cover_url: aladin?.cover_url ?? google?.cover_url ?? null,
    // Keep for backward compatibility with existing component/data shape.
    cover_id: null,
    publisher: aladin?.publisher ?? google?.publisher ?? null,
    first_publish_year: aladin?.first_publish_year ?? google?.first_publish_year ?? null,
    subjects,
    pages: aladin?.pages ?? google?.pages ?? null,
    isbn: aladin?.isbn ?? google?.isbn ?? null,
  };

  const dataPath = resolve(process.cwd(), 'data', 'books.json');
  let books = [];
  try {
    books = JSON.parse(readFileSync(dataPath, 'utf-8'));
  } catch {
    books = [];
  }

  const existingIndex = books.findIndex(b => b.id === issueNumber);
  if (existingIndex >= 0) {
    const existing = books[existingIndex];
    books[existingIndex] = {
      ...existing,
      ...record,
      // Preserve legacy OpenLibrary keys if they exist in old records.
      ol_key: existing.ol_key ?? null,
      // Keep existing cover if current lookup fails.
      cover_url: record.cover_url ?? existing.cover_url ?? null,
      cover_id: record.cover_id ?? existing.cover_id ?? null,
      authors: (record.authors && record.authors.length > 0) ? record.authors : (existing.authors ?? []),
      subjects: (record.subjects && record.subjects.length > 0) ? record.subjects : (existing.subjects ?? []),
      pages: record.pages ?? existing.pages ?? null,
      publisher: record.publisher ?? existing.publisher ?? null,
      first_publish_year: record.first_publish_year ?? existing.first_publish_year ?? null,
      isbn: record.isbn ?? existing.isbn ?? null,
      aladin_item_id: record.aladin_item_id ?? existing.aladin_item_id ?? null,
      google_volume_id: record.google_volume_id ?? existing.google_volume_id ?? null,
    };
    console.log(`[update] Updated existing book entry for issue #${issueNumber}`);
  } else {
    books.push(record);
  }
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
