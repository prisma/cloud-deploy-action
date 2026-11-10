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
// Without credentials or a config, the CLI stops at the first check after parsing its arguments.
const ARGUMENTS_PARSED = /CLI\.(CREDENTIALS_REQUIRED|CONFIG_SECTION_INVALID)/;

function spawnCli(bin, args, cwd) {
  const env = { ...process.env };
  delete env.PRISMA_SERVICE_TOKEN;
  delete env.PRISMA_WORKSPACE_ID;
  return spawnSync(bin, args, { cwd, env, encoding: "utf8", timeout: 60_000 });
}

function run(bin, args, cwd) {
  const result = spawnCli(bin, args, cwd);
  return `${result.stdout}${result.stderr}`;
}

for (const bin of bins) {
  const version = spawnCli(bin, ["--version"]).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/, `prisma --version printed "${version}"`);

  for (const environment of ["", "pr-7"]) {
    test(`prisma ${version} accepts the deploy arguments for ${environment || "production"}`, () => {
      const cwd = mkdtempSync(join(tmpdir(), "prisma-cli-"));
      const args = composerArguments("deploy", "module.ts", environment, version);
      const output = run(bin, args, cwd);
      assert.doesNotMatch(output, REJECTED_ARGUMENTS, `prisma ${args.join(" ")}\n${output}`);
      assert.match(output, ARGUMENTS_PARSED, `prisma ${args.join(" ")}\n${output}`);
    });
  }

  test(`prisma ${version} still rejects an unknown flag before its other checks`, () => {
    const output = run(bin, ["deploy", "--no-such-flag", "x"], mkdtempSync(join(tmpdir(), "prisma-cli-")));
    assert.match(output, /CLI\.INVALID_ARGUMENTS/, output);
  });

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
