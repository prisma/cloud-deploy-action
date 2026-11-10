import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composerArguments,
  findLocalPrismaCli,
  isSupportedBunVersion,
  selectPrismaCliCommand,
  takesEntryFlag,
  takesEnvironmentFlag,
} from "../cli.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("runs the local prisma CLI with bun run --bun when the bin exists", () => {
  const [cmd, args, label] = selectPrismaCliCommand("8.0.0-rc.7", true, ["deploy", "module.ts"]);
  assert.equal(cmd, "bun");
  assert.deepEqual(args, ["run", "--bun", "prisma", "deploy", "module.ts"]);
  assert.equal(label, "composer=local prisma CLI (bun run --bun)");
});

test("falls back to bunx with the input version when the bin is absent", () => {
  const [cmd, args, label] = selectPrismaCliCommand("8.0.0-rc.7", false, ["deploy", "module.ts"]);
  assert.equal(cmd, "bunx");
  assert.deepEqual(args, [
    "--bun",
    "-p",
    "prisma@8.0.0-rc.7",
    "prisma",

    "deploy",
    "module.ts",
  ]);
  assert.equal(label, "composer=prisma@8.0.0-rc.7 (bunx fallback)");
});

test("deploy args pass through verbatim on the local CLI, environment included", () => {
  const [, args] = selectPrismaCliCommand("8.1.0", true, [
    "deploy",
    "app/module.ts",
    "--environment",
    "feat/x",
  ]);
  assert.deepEqual(args, [
    "run",
    "--bun",
    "prisma",

    "deploy",
    "app/module.ts",
    "--environment",
    "feat/x",
  ]);
});

test("destroy args pass through verbatim on the bunx fallback", () => {
  const [, args] = selectPrismaCliCommand("8.1.0", false, [
    "destroy",
    "module.ts",
    "--environment",
    "feat/x",
  ]);
  assert.deepEqual(args, [
    "--bun",
    "-p",
    "prisma@8.1.0",
    "prisma",

    "destroy",
    "module.ts",
    "--environment",
    "feat/x",
  ]);
});

test("bunx fallback log label includes the exact version", () => {
  const [, , label] = selectPrismaCliCommand("8.2.0", false, ["deploy", "module.ts"]);
  assert.equal(label, "composer=prisma@8.2.0 (bunx fallback)");
});

test("local CLI label is always the same string regardless of version", () => {
  const [, , label] = selectPrismaCliCommand("8.2.0", true, ["deploy", "module.ts"]);
  assert.equal(label, "composer=local prisma CLI (bun run --bun)");
});

test("accepts bun 1.3.10 and every later version", () => {
  assert.equal(isSupportedBunVersion("1.3.10"), true);
  assert.equal(isSupportedBunVersion("1.3.11"), true);
  assert.equal(isSupportedBunVersion("1.4.0"), true);
  assert.equal(isSupportedBunVersion("2.0.0"), true);
});

test("rejects bun 1.3.9 and older, which omit Content-Length on uploads", () => {
  assert.equal(isSupportedBunVersion("1.3.9"), false);
  assert.equal(isSupportedBunVersion("1.3.0"), false);
  assert.equal(isSupportedBunVersion("1.2.20"), false);
  assert.equal(isSupportedBunVersion("0.8.1"), false);
});

test("rejects output that carries no version", () => {
  assert.equal(isSupportedBunVersion("command not found"), false);
});

test("names the module with --entry for a prisma CLI from 8.0.0-rc.28", () => {
  assert.deepEqual(composerArguments("deploy", "module.ts", "", "8.0.0-rc.28"), [
    "deploy",
    "--entry",
    "module.ts",
  ]);
  assert.deepEqual(composerArguments("deploy", "app/module.ts", "pr-7", "8.0.0-rc.29"), [
    "deploy",
    "--entry",
    "app/module.ts",
    "--stage",
    "pr-7",
  ]);
});

test("names the target with --environment for a prisma CLI from 8.0.0-rc.30", () => {
  assert.deepEqual(composerArguments("deploy", "module.ts", "pr-7", "8.0.0-rc.33"), [
    "deploy",
    "--entry",
    "module.ts",
    "--environment",
    "pr-7",
  ]);
  assert.deepEqual(composerArguments("destroy", "module.ts", "pr-7", "8.1.0"), [
    "destroy",
    "--entry",
    "module.ts",
    "--environment",
    "pr-7",
  ]);
});

test("passes no target flag for production", () => {
  assert.deepEqual(composerArguments("deploy", "module.ts", "", "8.0.0-rc.33"), ["deploy", "--entry", "module.ts"]);
});

test("takes --environment from rc.30 onward and --stage before it", () => {
  assert.equal(takesEnvironmentFlag("8.0.0-rc.29"), false);
  assert.equal(takesEnvironmentFlag("8.0.0-rc.30"), true);
  assert.equal(takesEnvironmentFlag("8.0.0-rc.33"), true);
  assert.equal(takesEnvironmentFlag("8.0.0"), true);
  assert.equal(takesEnvironmentFlag("8.0.1-dev.3"), true);
  assert.equal(takesEnvironmentFlag(""), true);
});

test("passes the module positionally for a prisma CLI before 8.0.0-rc.28", () => {
  assert.deepEqual(composerArguments("deploy", "module.ts", "pr-7", "8.0.0-rc.27"), [
    "deploy",
    "module.ts",
    "--stage",
    "pr-7",
  ]);
  assert.deepEqual(composerArguments("destroy", "module.ts", "pr-7", "8.0.0-rc.9"), [
    "destroy",
    "module.ts",
    "--stage",
    "pr-7",
  ]);
});

test("takes --entry from rc.28 onward and positional before it", () => {
  assert.equal(takesEntryFlag("8.0.0-rc.27"), false);
  assert.equal(takesEntryFlag("8.0.0-rc.28"), true);
  assert.equal(takesEntryFlag("8.0.0-rc.100"), true);
  assert.equal(takesEntryFlag("8.0.0"), true);
  assert.equal(takesEntryFlag("8.0.1-dev.3"), true);
  assert.equal(takesEntryFlag("7.10.1"), false);
});

function installPrisma(dir, version) {
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "prisma"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".bin", "prisma"), "");
  writeFileSync(join(dir, "node_modules", "prisma", "package.json"), JSON.stringify({ name: "prisma", version }));
}

test("finds the prisma CLI installed in the working directory", () => {
  const root = mkdtempSync(join(tmpdir(), "cli-test-"));
  assert.equal(findLocalPrismaCli(root, root), null);
  installPrisma(root, "8.0.0-rc.33");
  assert.deepEqual(findLocalPrismaCli(root, root), { version: "8.0.0-rc.33" });
});

test("finds the prisma CLI hoisted to the repository root of a monorepo", () => {
  const root = mkdtempSync(join(tmpdir(), "cli-test-"));
  const workdir = join(root, "apps", "web");
  mkdirSync(workdir, { recursive: true });
  installPrisma(root, "8.0.0-rc.33");
  assert.deepEqual(findLocalPrismaCli(workdir, root), { version: "8.0.0-rc.33" });
});

test("prefers the prisma CLI nearest the working directory", () => {
  const root = mkdtempSync(join(tmpdir(), "cli-test-"));
  const workdir = join(root, "apps", "web");
  installPrisma(root, "8.0.0-rc.29");
  installPrisma(workdir, "8.0.0-rc.33");
  assert.deepEqual(findLocalPrismaCli(workdir, root), { version: "8.0.0-rc.33" });
});

test("does not look above the repository root for the prisma CLI", () => {
  const outside = mkdtempSync(join(tmpdir(), "cli-test-"));
  const root = join(outside, "repo");
  mkdirSync(root);
  installPrisma(outside, "8.0.0-rc.33");
  assert.equal(findLocalPrismaCli(root, root), null);
});

test("reports an empty version when the prisma package cannot be read", () => {
  const root = mkdtempSync(join(tmpdir(), "cli-test-"));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".bin", "prisma"), "");
  assert.deepEqual(findLocalPrismaCli(root, root), { version: "" });
});
