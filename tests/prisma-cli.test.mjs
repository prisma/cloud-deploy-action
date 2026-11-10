import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { composerArguments } from "../cli.mjs";

// Runs the exact arguments the action builds against real `prisma` CLIs, so a
// renamed or removed flag fails here instead of in users' deploys. CI's
// prisma-cli job installs each CLI and lists its bin in PRISMA_CLI_BINS
// (comma-separated).
const bins = (process.env.PRISMA_CLI_BINS ?? "").split(",").filter(Boolean);
if (process.env.CI && process.env.GITHUB_JOB === "prisma-cli" && bins.length === 0) {
  throw new Error("PRISMA_CLI_BINS is empty in the prisma-cli job");
}
const REJECTED_ARGUMENTS = /CLI\.(INVALID_ARGUMENTS|COMMAND_MOVED|UNKNOWN_COMMAND)/;

function run(bin, args, cwd) {
  const env = { ...process.env };
  delete env.PRISMA_SERVICE_TOKEN;
  delete env.PRISMA_WORKSPACE_ID;
  const result = spawnSync(bin, args, { cwd, env, encoding: "utf8", timeout: 60_000 });
  return `${result.stdout}${result.stderr}`;
}

for (const bin of bins) {
  const version = run(bin, ["--version"]).trim().split("\n")[0];

  for (const environment of ["", "pr-7"]) {
    test(`prisma ${version} accepts the deploy arguments for ${environment || "production"}`, () => {
      const cwd = mkdtempSync(join(tmpdir(), "prisma-cli-"));
      const args = composerArguments("deploy", "module.ts", environment, version);
      const output = run(bin, args, cwd);
      assert.doesNotMatch(output, REJECTED_ARGUMENTS, `prisma ${args.join(" ")}\n${output}`);
      assert.match(output, /CLI\.CONFIG_SECTION_INVALID/, `prisma ${args.join(" ")}\n${output}`);
    });
  }

  test(`prisma ${version} accepts the destroy arguments`, (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "prisma-cli-"));
    const args = composerArguments("destroy", "module.ts", "pr-7", version);
    const output = run(bin, args, cwd);
    if (/CLI\.UNKNOWN_COMMAND/.test(output)) {
      t.skip(`prisma ${version} has no destroy command (README: Known limitations)`);
      return;
    }
    assert.doesNotMatch(output, REJECTED_ARGUMENTS, `prisma ${args.join(" ")}\n${output}`);
  });
}
