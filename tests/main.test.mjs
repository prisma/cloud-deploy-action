import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Runs main.mjs with a stub `bun` that reports a supported version, in an
// empty workspace, so a run ends at the first check it fails.
// `setup` receives the workspace path to place files in it before the run.
function runMain(inputs, env = {}, setup = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "main-"));
  const bin = join(dir, "bin");
  const workspace = join(dir, "workspace");
  mkdirSync(bin);
  mkdirSync(workspace);
  writeFileSync(join(bin, "bun"), "#!/bin/sh\necho 1.3.13\n");
  chmodSync(join(bin, "bun"), 0o755);
  // A stub bunx, so a run that reaches the fallback fetches nothing.
  writeFileSync(join(bin, "bunx"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "bunx"), 0o755);
  setup(workspace);
  const output = join(dir, "output");
  const result = spawnSync(process.execPath, [new URL("../main.mjs", import.meta.url).pathname], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_REF_NAME: "feat-x",
      GITHUB_SHA: "095b237a1c0ffee",
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: output,
      GITHUB_STATE: join(dir, "state"),
      RUNNER_TEMP: dir,
      ...Object.fromEntries(Object.entries(inputs).map(([name, value]) => [`INPUT_${name.toUpperCase()}`, value])),
      ...env,
    },
    encoding: "utf8",
  });
  return { result, outputs: readFileSync(output, "utf8") };
}

function defaultBranchEvent() {
  const path = join(mkdtempSync(join(tmpdir(), "main-event-")), "event.json");
  writeFileSync(path, JSON.stringify({ repository: { default_branch: "main" } }));
  return { GITHUB_REF_NAME: "main", GITHUB_EVENT_PATH: path };
}

test("the default branch deploys to production", () => {
  const { result } = runMain({}, defaultBranchEvent());
  assert.match(result.stdout, /^deploy target: production \(default branch\)$/m);
});

test("destroy on the default branch refuses to run without an explicit environment", () => {
  const { result, outputs } = runMain({ mode: "destroy" }, defaultBranchEvent());
  assert.equal(result.status, 1);
  assert.match(outputs, /^outcome=failed$/m);
  assert.match(result.stdout, /::error::config failed: destroy refuses to run without a resolved environment/);
});

test("a non-default branch targets the environment named after it", () => {
  const { result } = runMain({});
  assert.match(result.stdout, /^deploy target: environment feat-x$/m);
});

test("the stage input still names the environment", () => {
  const { result } = runMain({ mode: "destroy", stage: "pr-7" });
  assert.match(result.stdout, /^destroy target: environment pr-7$/m);
});

test("the environment input names the environment", () => {
  const { result } = runMain({ environment: "pr-7" });
  assert.match(result.stdout, /^deploy target: environment pr-7$/m);
});

test("accepts environment and stage inputs that agree", () => {
  const { result } = runMain({ environment: "pr-7", stage: "pr-7" });
  assert.match(result.stdout, /^deploy target: environment pr-7$/m);
});

test("refuses environment and stage inputs that disagree", () => {
  const summary = join(mkdtempSync(join(tmpdir(), "main-summary-")), "summary.md");
  const { result, outputs } = runMain({ environment: "pr-7", stage: "pr-8" }, { GITHUB_STEP_SUMMARY: summary });
  assert.doesNotMatch(result.stdout, /could not write the job summary/);
  assert.match(readFileSync(summary, "utf8"), /disagree; set only environment/);
  assert.equal(result.status, 1);
  assert.match(outputs, /^outcome=failed$/m);
  assert.match(result.stdout, /::error::config failed: the environment input \("pr-7"\) and its older name, the stage input \("pr-8"\), disagree/);
});

test("refuses to deploy a repository without a prisma CLI when no prisma-version is set", () => {
  const { result, outputs } = runMain(
    { "install-command": "true", "build-command": "none", "api-url": "http://127.0.0.1:9" },
    { PRISMA_SERVICE_TOKEN: "token" },
  );
  assert.equal(result.status, 1);
  assert.match(outputs, /^outcome=failed$/m);
  assert.match(result.stdout, /::error::config failed: no prisma CLI in node_modules from .* up to the repository root: add prisma as a devDependency/);
});

// Installs a stand-in for the `prisma` package at `version` in the workspace.
function installPrisma(version) {
  return (workspace) => {
    mkdirSync(join(workspace, "node_modules", ".bin"), { recursive: true });
    mkdirSync(join(workspace, "node_modules", "prisma"));
    writeFileSync(join(workspace, "node_modules", ".bin", "prisma"), "");
    writeFileSync(join(workspace, "node_modules", "prisma", "package.json"), JSON.stringify({ version }));
  };
}
const deployInputs = { "install-command": "true", "build-command": "none", "api-url": "http://127.0.0.1:9" };

test("runs the prisma-version CLI when the installed prisma is older than 8", () => {
  const { result, outputs } = runMain(
    { ...deployInputs, "prisma-version": "8.0.0-rc.35" },
    { PRISMA_SERVICE_TOKEN: "token" },
    installPrisma("6.19.1"),
  );
  assert.match(
    result.stdout,
    /^the prisma CLI in node_modules is 6\.19\.1, which has no deploy command; running prisma@8\.0\.0-rc\.35 from the prisma-version input instead$/m,
  );
  assert.match(result.stdout, /^composer=prisma@8\.0\.0-rc\.35 \(bunx fallback\)$/m);
  // The arguments follow the CLI that runs, not the installed one.
  assert.match(result.stdout, /^\$ bunx --bun -p prisma@8\.0\.0-rc\.35 prisma deploy --entry module\.ts --environment feat-x$/m);
  assert.equal(result.status, 0);
  assert.match(outputs, /^outcome=succeeded$/m);
});

test("refuses an installed prisma older than 8 when no prisma-version is set, and names the version", () => {
  const { result, outputs } = runMain(deployInputs, { PRISMA_SERVICE_TOKEN: "token" }, installPrisma("6.19.1"));
  assert.equal(result.status, 1);
  assert.match(outputs, /^outcome=failed$/m);
  assert.match(
    result.stdout,
    /::error::config failed: the prisma CLI in node_modules is 6\.19\.1, which has no deploy command \(it arrived with prisma 8\): set the prisma-version input/,
  );
  assert.doesNotMatch(result.stdout, /::group::deploy/);
});

test("an installed prisma 8 still deploys with its own CLI, whatever prisma-version says", () => {
  const { result } = runMain(
    { ...deployInputs, "prisma-version": "8.0.0-rc.35" },
    { PRISMA_SERVICE_TOKEN: "token" },
    installPrisma("8.0.0-rc.33"),
  );
  assert.match(result.stdout, /^composer=local prisma CLI \(bun run --bun\)$/m);
  assert.match(result.stdout, /^\$ bun run --bun prisma deploy --entry module\.ts --environment feat-x$/m);
});

test("the config input reaches the CLI as --config", () => {
  const { result } = runMain(
    { ...deployInputs, config: "prisma.compute.config.ts" },
    { PRISMA_SERVICE_TOKEN: "token" },
    installPrisma("8.0.0-rc.33"),
  );
  assert.match(
    result.stdout,
    /^\$ bun run --bun prisma deploy --entry module\.ts --environment feat-x --config prisma\.compute\.config\.ts$/m,
  );
});
