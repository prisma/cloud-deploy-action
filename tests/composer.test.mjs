import assert from "node:assert/strict";
import { test } from "node:test";
import { selectComposerCommand } from "../composer.mjs";

test("uses bun with the local bin when it exists", () => {
  const [cmd, lead, label] = selectComposerCommand(
    "/work/node_modules/.bin/prisma-composer",
    "0.9.0",
    true,
  );
  assert.equal(cmd, "bun");
  assert.deepEqual(lead, ["/work/node_modules/.bin/prisma-composer"]);
  assert.equal(label, "composer=local bin (bun)");
});

test("falls back to bunx with --bun when the local bin is absent", () => {
  const [cmd, lead, label] = selectComposerCommand(
    "/work/node_modules/.bin/prisma-composer",
    "0.9.0",
    false,
  );
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
  const [, , label] = selectComposerCommand("/any", "0.7.5", false);
  assert.equal(label, "composer=0.7.5 (bunx fallback)");
});

test("local bin label is always the same string regardless of version", () => {
  const [, , label] = selectComposerCommand("/any", "0.7.5", true);
  assert.equal(label, "composer=local bin (bun)");
});
