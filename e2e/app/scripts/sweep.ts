// Destroys e2e environments whose GitHub Actions run has finished: runs that
// could not destroy their own. CI names each environment
// e2e-<run id>-<attempt>-<matrix entry>, so a run that is still going keeps its
// environment. A leftover that will not go away fails the sweep only once it is
// a day old, so one stuck destroy does not fail every run straight away.
import { APP_NAME } from '../app-name.ts';
import { destroyEnvironment } from './environments.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const { GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_API_URL = 'https://api.github.com' } = process.env;
if (!GITHUB_REPOSITORY || !GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN must be set');

function environments(): string[] {
  const listed = Bun.spawnSync(['bun', 'run', '--bun', 'prisma', 'branch', 'list', '--project', APP_NAME, '--json']);
  let output;
  try {
    output = JSON.parse(listed.stdout.toString());
  } catch {
    throw new Error(`prisma branch list printed no JSON:\n${listed.stdout}${listed.stderr}`);
  }
  if (!output.envelope?.ok) throw new Error(`prisma branch list failed:\n${listed.stdout}${listed.stderr}`);
  return output.envelope.result.branches.map((branch: { name: string }) => branch.name);
}

async function finishedRun(runId: string): Promise<{ createdAt: number } | null> {
  const response = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${runId}`, {
    headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return { createdAt: 0 };
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    console.log(`GitHub API ${response.status} for run ${runId}; leaving its environment for the next sweep`);
    return null;
  }
  if (!response.ok) throw new Error(`GitHub API ${response.status} for run ${runId}`);
  const run = await response.json();
  return run.status === 'completed' ? { createdAt: Date.parse(run.created_at) } : null;
}

const undestroyedOld: string[] = [];
let destroyed = 0;
for (const name of environments()) {
  const runId = name.match(/^e2e-(\d+)-\d+-[a-z]+$/)?.[1];
  if (!runId) continue;
  const run = await finishedRun(runId);
  if (!run) continue;
  if (await destroyEnvironment(name)) {
    destroyed++;
  } else if (Date.now() - run.createdAt > DAY_MS) {
    undestroyedOld.push(name);
  }
}
// Another sweep may have removed an environment this one failed to destroy.
const remaining = undestroyedOld.length > 0 ? environments() : [];
const stuck = undestroyedOld.filter((name) => remaining.includes(name)).length;
console.log(`swept ${destroyed} leftover environment(s)`);
if (stuck > 0) {
  console.error(`::error::${stuck} leftover environment(s) older than a day could not be destroyed; see the README for removing one by hand`);
  process.exit(1);
}
