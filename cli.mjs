/**
 * Returns [cmd, args, logLabel] for running the Composer command family of
 * the unified `prisma` CLI under Bun. The bunx fallback covers repositories
 * without a `prisma` devDependency.
 *
 * The local bin runs as `bun run --bun prisma`, not `bun <path>`: `--bun`
 * puts a `node` → bun shim first on PATH, so the CLI and the converge child
 * it spawns (a `#!/usr/bin/env node` launcher) both run under Bun. `bun
 * <absolute path>` runs only the CLI under Bun and leaves the child to Node,
 * which cannot resolve the `./service.js` import to `service.ts`.
 *
 * Since 8.0.0-rc.8 the Composer commands are top-level (`prisma deploy`);
 * the former `prisma composer` prefix was removed. This requires a CLI at
 * rc.8 or later, both for the local bin and the bunx fallback.
 *
 * @param {string} prismaVersion - `prisma` package version to fetch via bunx when the local bin is absent.
 * @param {boolean} binExists - Whether node_modules/.bin/prisma exists in the working directory.
 * @param {string[]} composerArgs - Arguments after `prisma`, e.g. ["deploy", "module.ts", "--stage", "x"].
 * @returns {[string, string[], string]}
 */
// The oldest Bun the deploy runs on: Bun <= 1.3.9 omitted Content-Length on
// the CLI's presigned-URL artifact upload, failing every deploy with
// "Prisma artifact upload failed (HTTP 411)". Fixed in Bun 1.3.10.
export const MINIMUM_BUN_VERSION = "1.3.10";

/**
 * Whether the given Bun version can run the deploy — that is, whether it
 * carries the Content-Length fix (MINIMUM_BUN_VERSION or newer).
 *
 * @param {string} version - e.g. "1.3.11" from `bun --version`.
 * @returns {boolean}
 */
export function isSupportedBunVersion(version) {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  const [minMajor, minMinor, minPatch] = MINIMUM_BUN_VERSION.split(".").map(Number);
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

// The CLI range this action release speaks: 8.0.0-rc.8 made the deploy
// commands top-level and removed the `prisma composer` prefix. Stated in
// error messages and in the README's compatibility matrix.
export const SUPPORTED_PRISMA_RANGE = ">= 8.0.0-rc.8";

/**
 * Extracts the CLI version from `prisma --version` output. The current CLI
 * prints a JSON envelope with a version field; older ones printed a human
 * line. A lenient regex covers both, so an output-format change degrades to
 * "version unknown" (a warning) instead of a crash or a false rejection.
 *
 * @param {string} output - Combined stdout+stderr of `prisma --version`.
 * @returns {string|null} e.g. "8.0.0-rc.9", or null when no version is found.
 */
export function extractPrismaVersion(output) {
  const match = output.match(/\b(\d+\.\d+\.\d+(?:-rc\.\d+)?)/);
  return match ? match[1] : null;
}

/**
 * Whether this action release supports the given CLI version — that is,
 * whether the CLI speaks the top-level command shape introduced in
 * 8.0.0-rc.8 (SUPPORTED_PRISMA_RANGE).
 *
 * @param {string} version - e.g. "8.0.0-rc.9" from extractPrismaVersion.
 * @returns {boolean}
 */
export function isSupportedPrismaVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major !== 8) return major > 8;
  if (minor > 0 || patch > 0) return true;
  // 8.0.0: stable (no rc tag) and rc.8+ are supported; rc.7 and older speak
  // the removed `prisma composer` prefix.
  return match[4] === undefined || Number(match[4]) >= 8;
}

export function selectPrismaCliCommand(prismaVersion, binExists, composerArgs) {
  if (binExists) {
    return [
      "bun",
      ["run", "--bun", "prisma", ...composerArgs],
      "composer=local prisma CLI (bun run --bun)",
    ];
  }
  return [
    "bunx",
    ["--bun", "-p", `prisma@${prismaVersion}`, "prisma", ...composerArgs],
    `composer=prisma@${prismaVersion} (bunx fallback)`,
  ];
}
