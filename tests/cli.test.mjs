import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPrismaVersion, isSupportedBunVersion, isSupportedPrismaVersion, selectPrismaCliCommand } from "../cli.mjs";

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

test("deploy args pass through verbatim on the local CLI, stage included", () => {
  const [, args] = selectPrismaCliCommand("8.1.0", true, [
    "deploy",
    "app/module.ts",
    "--stage",
    "feat/x",
  ]);
  assert.deepEqual(args, [
    "run",
    "--bun",
    "prisma",

    "deploy",
    "app/module.ts",
    "--stage",
    "feat/x",
  ]);
});

test("destroy args pass through verbatim on the bunx fallback", () => {
  const [, args] = selectPrismaCliCommand("8.1.0", false, [
    "destroy",
    "module.ts",
    "--stage",
    "feat/x",
  ]);
  assert.deepEqual(args, [
    "--bun",
    "-p",
    "prisma@8.1.0",
    "prisma",

    "destroy",
    "module.ts",
    "--stage",
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

test("extracts the version from the JSON envelope of prisma --version", () => {
  const output = '{"kind":"result","envelope":{"ok":true,"commandId":"version","result":{"version":"8.0.0-rc.9"},"exitCode":0}}';
  assert.equal(extractPrismaVersion(output), "8.0.0-rc.9");
});

test("extracts the version from a human prisma --version line", () => {
  assert.equal(extractPrismaVersion("prisma 7.9.1\n"), "7.9.1");
});

test("extracts the rc version from a dev build suffix", () => {
  assert.equal(extractPrismaVersion("version 8.0.0-rc.9-dev.79"), "8.0.0-rc.9");
});

test("returns null when the output carries no version", () => {
  assert.equal(extractPrismaVersion("command not found"), null);
});

test("supports rc.8 and later 8.0.0 release candidates", () => {
  assert.equal(isSupportedPrismaVersion("8.0.0-rc.8"), true);
  assert.equal(isSupportedPrismaVersion("8.0.0-rc.9"), true);
  assert.equal(isSupportedPrismaVersion("8.0.0-rc.12"), true);
});

test("rejects rc.7 and older release candidates", () => {
  assert.equal(isSupportedPrismaVersion("8.0.0-rc.7"), false);
  assert.equal(isSupportedPrismaVersion("8.0.0-rc.1"), false);
});

test("supports stable 8.0.0 and every later version", () => {
  assert.equal(isSupportedPrismaVersion("8.0.0"), true);
  assert.equal(isSupportedPrismaVersion("8.0.1"), true);
  assert.equal(isSupportedPrismaVersion("8.1.0"), true);
  assert.equal(isSupportedPrismaVersion("9.0.0"), true);
});

test("rejects every pre-8 major", () => {
  assert.equal(isSupportedPrismaVersion("7.9.1"), false);
  assert.equal(isSupportedPrismaVersion("6.19.2"), false);
});
