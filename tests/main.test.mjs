import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Runs main.mjs with a stub `bun` that reports a supported version, in an
// empty workspace, so a run ends at the first check it fails.
function runMain(inputs, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "main-"));
  const bin = join(dir, "bin");
  const workspace = join(dir, "workspace");
  mkdirSync(bin);
  mkdirSync(workspace);
  writeFileSync(join(bin, "bun"), "#!/bin/sh\necho 1.3.13\n");
  chmodSync(join(bin, "bun"), 0o755);
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
  const { result, outputs } = runMain({ environment: "pr-7", stage: "pr-8" });
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
