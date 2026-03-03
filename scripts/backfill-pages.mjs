// scripts/backfill-pages.mjs
// 기존 books.json에서 pages가 null인 항목에 페이지 수를 채운다.
// 1차: Aladin ItemLookUp (ALADIN_TTB_KEY 환경변수 필요, OptResult=subInfo)
// 2차: Google Books API by ISBN (무료, 키 불필요)
// 3차: Open Library by ISBN (무료, 키 불필요)
//
// 사용법:
//   ALADIN_TTB_KEY=xxx node scripts/backfill-pages.mjs
//   node scripts/backfill-pages.mjs   # Aladin 없이 Google Books만

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

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

async function fetchPagesFromAladin(aladinItemId, ttbKey) {
  if (!aladinItemId || !ttbKey) return null;
  try {
    const url = new URL('https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx');
    url.searchParams.set('ttbkey', ttbKey);
    url.searchParams.set('itemIdType', 'ItemId');
    url.searchParams.set('ItemId', String(aladinItemId));
    url.searchParams.set('Cover', 'Big');
    url.searchParams.set('output', 'js');
    url.searchParams.set('Version', '20131101');
    url.searchParams.set('OptResult', 'subInfo');

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const detail = Array.isArray(data.item) ? data.item[0] : null;
    if (!detail) return null;
    const pages = pickPageCount(detail);
    if (pages) console.log(`  [Aladin] ${pages}p`);
    return pages;
  } catch {
    return null;
  }
}

async function fetchPagesFromGoogleBooks(isbn) {
  if (!isbn) return null;
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const vol = data?.items?.[0]?.volumeInfo;
    if (!vol) return null;
    const pages = parsePositiveInt(vol.pageCount);
    if (pages) console.log(`  [Google Books] ${pages}p`);
    return pages;
  } catch {
    return null;
  }
}

async function fetchPagesFromOpenLibrary(isbn) {
  if (!isbn) return null;
  try {
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&jscmd=data&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const key = `ISBN:${isbn}`;
    const pages = parsePositiveInt(data?.[key]?.number_of_pages);
    if (pages) console.log(`  [Open Library] ${pages}p`);
    return pages;
  } catch {
    return null;
  }
}

async function main() {
  const ttbKey = process.env.ALADIN_TTB_KEY ?? null;
  const dataPath = resolve(process.cwd(), 'data', 'books.json');
  const books = JSON.parse(readFileSync(dataPath, 'utf-8'));

  const targets = books.filter(b => !b.pages || b.pages === 0);
  console.log(`[backfill-pages] ${targets.length}권에 페이지 수가 없음. 채우기 시작...`);
  if (!ttbKey) {
    console.log('[backfill-pages] ALADIN_TTB_KEY 없음 → Google Books + Open Library만 사용');
  }

  let updated = 0;
  for (const book of books) {
    if (book.pages && book.pages > 0) continue;

    const title = book.user_title || book.title_normalized || '(제목 없음)';
    console.log(`\n처리 중: "${title}" (id=${book.id}, isbn=${book.isbn ?? '없음'})`);

    let pages = null;

    // 1차: Aladin (TTB Key 있을 때)
    if (ttbKey && book.aladin_item_id) {
      pages = await fetchPagesFromAladin(book.aladin_item_id, ttbKey);
    }

    // 2차: Google Books by ISBN
    if (!pages && book.isbn) {
      pages = await fetchPagesFromGoogleBooks(book.isbn);
    }

    // 3차: Open Library by ISBN
    if (!pages && book.isbn) {
      pages = await fetchPagesFromOpenLibrary(book.isbn);
    }

    if (pages) {
      book.pages = pages;
      updated++;
      console.log(`  → 업데이트: ${pages}p`);
    } else {
      console.log(`  → 페이지 수 없음 (수동 입력 필요)`);
    }

    // API 과부하 방지 딜레이
    await new Promise(r => setTimeout(r, 300));
  }

  writeFileSync(dataPath, JSON.stringify(books, null, 2) + '\n');
  console.log(`\n[backfill-pages] 완료: ${updated}/${targets.length}권 업데이트`);
}

main().catch(err => {
  console.error('[error]', err);
  process.exit(1);
});
