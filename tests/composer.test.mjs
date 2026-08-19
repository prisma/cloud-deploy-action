import assert from "node:assert/strict";
import { test } from "node:test";
import { selectComposerCommand } from "../composer.mjs";

test("runs the local bin with bun run --bun when it exists", () => {
  const [cmd, lead, label] = selectComposerCommand("0.9.0", true);
  assert.equal(cmd, "bun");
  assert.deepEqual(lead, ["run", "--bun", "prisma-composer"]);
  assert.equal(label, "composer=local bin (bun run --bun)");
});

test("falls back to bunx with --bun when the local bin is absent", () => {
  const [cmd, lead, label] = selectComposerCommand("0.9.0", false);
  assert.equal(cmd, "bunx");
  assert.deepEqual(lead, [
    "--bun",
    "-p",
    "@prisma/composer-cli@0.9.0",
    "prisma-composer",
  ]);
  assert.equal(label, "composer=0.9.0 (bunx fallback)");
});

test("bunx fallback log label includes the exact version", () => {
  const [, , label] = selectComposerCommand("0.7.5", false);
  assert.equal(label, "composer=0.7.5 (bunx fallback)");
});

test("local bin label is always the same string regardless of version", () => {
  const [, , label] = selectComposerCommand("0.7.5", true);
  assert.equal(label, "composer=local bin (bun run --bun)");
});
