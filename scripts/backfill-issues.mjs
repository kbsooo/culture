import { spawnSync } from 'child_process';

const token = process.env.GITHUB_TOKEN;
const repoEnv = process.env.GITHUB_REPOSITORY;

if (!token) {
  throw new Error('GITHUB_TOKEN is required');
}
if (!repoEnv || !repoEnv.includes('/')) {
  throw new Error('GITHUB_REPOSITORY must be set as "owner/repo"');
}

const [owner, repo] = repoEnv.split('/');

async function fetchClosedIssues() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
    url.searchParams.set('state', 'closed');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', 'created');
    url.searchParams.set('direction', 'asc');

    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const issues = await res.json();
    if (!Array.isArray(issues) || issues.length === 0) break;
    all.push(...issues);
    if (issues.length < 100) break;
  }
  return all;
}

function hasLabel(issue, labelName) {
  return (issue.labels ?? []).some(label => label?.name === labelName);
}

function runProcessor(scriptPath, issue) {
  const env = {
    ...process.env,
    ISSUE_TITLE: issue.title ?? '',
    ISSUE_BODY: issue.body ?? '',
    ISSUE_NUMBER: String(issue.number ?? ''),
    ISSUE_CREATED_AT: issue.created_at ?? '',
  };

  const result = spawnSync('node', [scriptPath], {
    env,
    stdio: 'inherit',
  });

  return result.status === 0;
}

async function main() {
  const closedIssues = await fetchClosedIssues();
  const targetIssues = closedIssues
    .filter(issue => !issue.pull_request)
    .filter(issue => hasLabel(issue, 'movie') || hasLabel(issue, 'book'));

  console.log(`[backfill] Closed issues: ${closedIssues.length}, target: ${targetIssues.length}`);

  let okCount = 0;
  let failCount = 0;

  for (const issue of targetIssues) {
    const isMovie = hasLabel(issue, 'movie');
    const isBook = hasLabel(issue, 'book');

    console.log(`[backfill] #${issue.number} ${issue.title}`);

    if (isMovie) {
      const ok = runProcessor('scripts/process-movie.mjs', issue);
      if (!ok) failCount++;
      else okCount++;
    }

    if (isBook) {
      const ok = runProcessor('scripts/process-book.mjs', issue);
      if (!ok) failCount++;
      else okCount++;
    }
  }

  console.log(`[backfill] done. success=${okCount} fail=${failCount}`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[backfill:error]', err);
  process.exit(1);
});
