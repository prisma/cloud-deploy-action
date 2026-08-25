import assert from "node:assert/strict";
import { test } from "node:test";
import { isSupportedBunVersion, selectPrismaCliCommand } from "../cli.mjs";

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
