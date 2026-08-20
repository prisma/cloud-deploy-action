import assert from "node:assert/strict";
import { test } from "node:test";
import { selectBuildCommand } from "../build.mjs";

test('the exact value "none" skips the build', () => {
  assert.equal(selectBuildCommand("none"), null);
});

test("an empty input falls back to the default build command", () => {
  assert.equal(selectBuildCommand(""), "npm run build");
});

test("any other command runs verbatim", () => {
  assert.equal(selectBuildCommand("bun run build"), "bun run build");
});

test('a near-miss like "None" runs verbatim instead of skipping', () => {
  assert.equal(selectBuildCommand("None"), "None");
});

test('a command containing "none" runs verbatim', () => {
  assert.equal(selectBuildCommand("npm run none"), "npm run none");
});
