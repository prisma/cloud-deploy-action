// Destroys environments that earlier runs of this matrix entry left behind.
// CI runs one job per matrix entry at a time, so none of them is in use.
import { destroyEnvironment } from './environments.ts';

const current = process.env.ENVIRONMENT ?? '';
if (!/^e2e-.+-[a-z]+$/.test(current)) throw new Error(`ENVIRONMENT must be this run's e2e environment, got "${current}"`);
const suffix = current.slice(current.lastIndexOf('-'));
const listed = Bun.spawnSync(['bun', 'run', '--bun', 'prisma', 'branch', 'list', '--project', 'cloud-deploy-action-e2e', '--json']);
const output = JSON.parse(listed.stdout.toString());
if (!output.envelope?.ok) throw new Error(`prisma branch list failed: ${listed.stdout}${listed.stderr}`);

const leftovers = output.envelope.result.branches
  .map((branch: { name: string }) => branch.name)
  .filter((name: string) => name.startsWith('e2e-') && name.endsWith(suffix) && name !== current);
let failed = false;
for (const environment of leftovers) {
  if (!(await destroyEnvironment(environment))) failed = true;
}
console.log(`swept ${leftovers.length} leftover environment(s)`);
if (failed) process.exit(1);
