import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Runs main.mjs with a stub `bun` that reports a supported version, in a
// workspace that holds only a Composer module, so a run ends at the first
// check it fails. `files` replaces the workspace's files; `bins` adds stub
// commands to the PATH.
function runMain(inputs, env = {}, { files = { "module.ts": "" }, bins = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "main-"));
  const bin = join(dir, "bin");
  const workspace = join(dir, "workspace");
  mkdirSync(bin);
  mkdirSync(workspace);
  for (const [name, script] of Object.entries({ bun: "#!/bin/sh\necho 1.3.13\n", ...bins })) {
    writeFileSync(join(bin, name), script);
    chmodSync(join(bin, name), 0o755);
  }
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(workspace, name), content);
  }
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
  return { result, outputs: readFileSync(output, "utf8"), dir };
}

// A stub `npx` that records its arguments and prints what a single-app
// `prisma deploy` prints on success.
const NPX_DEPLOYS = `#!/bin/sh
printf '%s\\n' "$@" > "$RUNNER_TEMP/npx-args"
printf 'web\\tcompute-service\\tcps_1\\thttps://web1.fra.prisma.build\\n'
`;
const SINGLE_APP = { files: { "package.json": "{}" }, bins: { npx: NPX_DEPLOYS } };
const OFFLINE = { PRISMA_SERVICE_TOKEN: "token" };
const OFFLINE_INPUTS = { "api-url": "http://127.0.0.1:9" };

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

test("a repository with no module file deploys as a single app, with no install or build phase of its own", () => {
  const { result, outputs, dir } = runMain({ ...OFFLINE_INPUTS, project: "proj_1" }, OFFLINE, SINGLE_APP);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^prisma-deploy: mode=deploy single app \(no Composer module\)/m);
  assert.doesNotMatch(result.stdout, /::group::install|::group::build/);
  assert.deepEqual(readFileSync(join(dir, "npx-args"), "utf8").trim().split("\n"), [
    "--yes",
    "prisma@latest",
    "deploy",
    "--project",
    "proj_1",
    "--environment",
    "feat-x",
  ]);
  assert.match(outputs, /^outcome=succeeded$/m);
  assert.match(outputs, /^url=https:\/\/web1\.fra\.prisma\.build$/m);
  assert.match(outputs, /^urls=\{"web":"https:\/\/web1\.fra\.prisma\.build"\}$/m);
});

test("a single app on the default branch deploys to production, with no environment argument", () => {
  const { result, dir } = runMain(
    { ...OFFLINE_INPUTS, project: "proj_1" },
    { ...OFFLINE, ...defaultBranchEvent() },
    SINGLE_APP,
  );
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(readFileSync(join(dir, "npx-args"), "utf8").trim().split("\n"), [
    "--yes",
    "prisma@latest",
    "deploy",
    "--project",
    "proj_1",
  ]);
});

test("a single app uses the prisma-version input when it is set", () => {
  const { dir } = runMain(
    { ...OFFLINE_INPUTS, project: "proj_1", "prisma-version": "8.1.0" },
    OFFLINE,
    SINGLE_APP,
  );
  assert.match(readFileSync(join(dir, "npx-args"), "utf8"), /^prisma@8\.1\.0$/m);
});

test("a single app does not need bun on the runner", () => {
  const { result } = runMain({ ...OFFLINE_INPUTS, project: "proj_1" }, OFFLINE, {
    ...SINGLE_APP,
    bins: { ...SINGLE_APP.bins, bun: "#!/bin/sh\nexit 127\n" },
  });
  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /bun/);
});

test("a failed single-app deploy fails the run and sets no url", () => {
  const { result, outputs } = runMain({ ...OFFLINE_INPUTS, project: "proj_1" }, OFFLINE, {
    ...SINGLE_APP,
    bins: { npx: "#!/bin/sh\necho 'No start command.' >&2\nexit 1\n" },
  });
  assert.equal(result.status, 1);
  assert.match(outputs, /^outcome=failed$/m);
  assert.doesNotMatch(outputs, /^url=/m);
  assert.match(result.stdout, /::error::deploy failed: npx --yes prisma@latest deploy --project proj_1 --environment feat-x exited with status 1/);
});

test("a single app without the project input fails when the projects cannot be listed", () => {
  const { result, outputs } = runMain(OFFLINE_INPUTS, OFFLINE, SINGLE_APP);
  assert.equal(result.status, 1);
  assert.match(outputs, /^outcome=failed$/m);
  assert.match(result.stdout, /::error::config failed: could not list the projects this credential can read .*; set the project input/);
});

test("destroy refuses a repository without a Composer module", () => {
  const { result, outputs } = runMain({ mode: "destroy", environment: "pr-7" }, {}, SINGLE_APP);
  assert.equal(result.status, 1);
  assert.match(outputs, /^outcome=failed$/m);
  assert.match(result.stdout, /::error::config failed: destroy is not supported for a repository without a Composer module/);
});

test("a named module that does not exist stays a Composer deploy", () => {
  const { result } = runMain({ module: "app/module.ts" }, {}, SINGLE_APP);
  assert.match(result.stdout, /^prisma-deploy: mode=deploy module=app\/module\.ts /m);
});

test("the install-command input is reported as unused for a single app", () => {
  const { result } = runMain(
    { ...OFFLINE_INPUTS, project: "proj_1", "install-command": "pnpm install" },
    OFFLINE,
    SINGLE_APP,
  );
  assert.match(result.stdout, /::warning::the install-command input is not used for a single app/);
});
