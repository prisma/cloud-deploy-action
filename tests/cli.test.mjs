import assert from "node:assert/strict";
import { test } from "node:test";
import { selectPrismaCliCommand } from "../cli.mjs";

test("runs the local prisma CLI with bun run --bun when the bin exists", () => {
  const [cmd, args, label] = selectPrismaCliCommand("8.0.0-rc.6", true, ["deploy", "module.ts"]);
  assert.equal(cmd, "bun");
  assert.deepEqual(args, ["run", "--bun", "prisma", "composer", "deploy", "module.ts"]);
  assert.equal(label, "composer=local prisma CLI (bun run --bun)");
});

test("falls back to bunx with the input version when the bin is absent", () => {
  const [cmd, args, label] = selectPrismaCliCommand("8.0.0-rc.6", false, ["deploy", "module.ts"]);
  assert.equal(cmd, "bunx");
  assert.deepEqual(args, [
    "--bun",
    "-p",
    "prisma@8.0.0-rc.6",
    "prisma",
    "composer",
    "deploy",
    "module.ts",
  ]);
  assert.equal(label, "composer=prisma@8.0.0-rc.6 (bunx fallback)");
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
    "composer",
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
    "composer",
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
