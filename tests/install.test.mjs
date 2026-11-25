import assert from "node:assert/strict";
import { test } from "node:test";
import { selectInstallCommand } from "../install.mjs";

const files = (...names) => (name) => names.includes(name);

test('the exact value "none" skips the install', () => {
  assert.equal(selectInstallCommand("none", files("package-lock.json")), null);
});

test('"none" skips the install even when no lockfile is present', () => {
  assert.equal(selectInstallCommand("none", files()), null);
});

test("an explicit command runs verbatim and wins over the lockfile", () => {
  assert.equal(selectInstallCommand("pnpm install --frozen-lockfile", files("package-lock.json")), "pnpm install --frozen-lockfile");
});

test("an empty input detects bun from either bun lockfile", () => {
  assert.equal(selectInstallCommand("", files("bun.lock")), "bun install --frozen-lockfile");
  assert.equal(selectInstallCommand("", files("bun.lockb")), "bun install --frozen-lockfile");
});

test("an empty input prefers the bun lockfile over package-lock.json", () => {
  assert.equal(selectInstallCommand("", files("bun.lock", "package-lock.json")), "bun install --frozen-lockfile");
});

test("an empty input detects npm ci from package-lock.json", () => {
  assert.equal(selectInstallCommand("", files("package-lock.json")), "npm ci");
});

test("an empty input with no lockfile detects nothing", () => {
  assert.equal(selectInstallCommand("", files()), undefined);
});

test('a near-miss like "None" runs verbatim instead of skipping', () => {
  assert.equal(selectInstallCommand("None", files()), "None");
});
