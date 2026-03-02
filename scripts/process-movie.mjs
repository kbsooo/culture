// scripts/process-movie.mjs
// Parses a closed GitHub Issue (movie form), fetches TMDB metadata, appends to data/movies.json

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// GitHub Issue Forms render as:
// ### 제목
// 기생충
//
// ### 별점
// 9
//
// ### 한줄 후기
// 계단이 상징하는 것들
//
// ### 시청 날짜
// 2025-03-02

function parseIssueForm(body) {
  const sections = {};
  // Split on H3 headers that GitHub Issue Forms produce
  const parts = body.split(/^### /m).filter(Boolean);

  for (const part of parts) {
    const lines = part.trim().split('\n');
    const key = lines[0].trim();
    // Value is everything after the header, excluding empty leading lines and "_No response_" placeholders
    const value = lines
      .slice(1)
      .join('\n')
      .trim()
      .replace(/^_No response_$/m, '');
    sections[key] = value.trim();
  }
  return sections;
}

async function fetchTMDBData(title, apiKey) {
  // Search with Korean locale first for Korean titles
  const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(title)}&language=ko-KR`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();

  if (!searchData.results || searchData.results.length === 0) {
    console.warn(`[TMDB] No results found for: "${title}"`);
    return null;
  }

  const movie = searchData.results[0];

  // Fetch full details to get runtime, genres, etc.
  const detailUrl = `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${apiKey}&language=ko-KR`;
  const detailRes = await fetch(detailUrl);
  const detail = await detailRes.json();

  return {
    tmdb_id: detail.id,
    title_ko: detail.title,
    title_original: detail.original_title,
    poster_path: detail.poster_path ?? null,
    backdrop_path: detail.backdrop_path ?? null,
    release_date: detail.release_date ?? null,
    genres: (detail.genres ?? []).map(g => g.name),
    runtime: detail.runtime ?? null,
    overview: detail.overview ?? null,
    tmdb_rating: detail.vote_average ?? null,
  };
}

async function main() {
  const body = process.env.ISSUE_BODY ?? '';
  const issueNumber = parseInt(process.env.ISSUE_NUMBER ?? '0', 10);
  const issueFallbackDate = (process.env.ISSUE_CREATED_AT ?? new Date().toISOString()).slice(0, 10);
  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    throw new Error('TMDB_API_KEY secret is not set');
  }

  const parsed = parseIssueForm(body);
  console.log('[parse] Parsed sections:', JSON.stringify(parsed, null, 2));

  const userTitle   = parsed['제목']?.trim() ?? '';
  const userRating  = parseInt(parsed['별점']?.trim() ?? '0', 10);
  const userReview  = parsed['한줄 후기']?.trim() ?? '';
  // null when empty — intentional "날짜 미상" support (no fallback to today)
  const rawDate     = parsed['시청 날짜']?.trim();
  const watchedDate = (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) ? rawDate : null;

  if (!userTitle) {
    throw new Error('제목(title) field is empty in the issue body');
  }

  console.log(`[info] Processing movie: "${userTitle}", rating: ${userRating}, date: ${watchedDate}`);

  const tmdb = await fetchTMDBData(userTitle, apiKey);

  const record = {
    id: issueNumber,
    user_title: userTitle,
    rating: userRating,
    review: userReview,
    watched_date: watchedDate,
    added_at: new Date().toISOString(),
    tmdb_id: tmdb?.tmdb_id ?? null,
    title_ko: tmdb?.title_ko ?? userTitle,
    title_original: tmdb?.title_original ?? null,
    poster_path: tmdb?.poster_path ?? null,
    backdrop_path: tmdb?.backdrop_path ?? null,
    release_date: tmdb?.release_date ?? null,
    genres: tmdb?.genres ?? [],
    runtime: tmdb?.runtime ?? null,
    overview: tmdb?.overview ?? null,
    tmdb_rating: tmdb?.tmdb_rating ?? null,
  };

  const dataPath = resolve(process.cwd(), 'data', 'movies.json');
  let movies = [];
  try {
    movies = JSON.parse(readFileSync(dataPath, 'utf-8'));
  } catch {
    movies = [];
  }

  // Idempotency: skip if already exists
  if (movies.some(m => m.id === issueNumber)) {
    console.log(`[skip] Issue #${issueNumber} already exists in movies.json`);
    process.exit(0);
  }

  movies.push(record);
  // Dated entries first (desc), undated at end
  movies.sort((a, b) => {
    if (!a.watched_date && !b.watched_date) return 0;
    if (!a.watched_date) return 1;
    if (!b.watched_date) return -1;
    return b.watched_date.localeCompare(a.watched_date);
  });

  writeFileSync(dataPath, JSON.stringify(movies, null, 2) + '\n');
  console.log(`[done] Added movie "${record.title_ko}" (issue #${issueNumber})`);
}

main().catch(err => {
  console.error('[error]', err);
  process.exit(1);
});
