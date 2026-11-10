import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

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
 * @param {string[]} composerArgs - Arguments after `prisma`, e.g. ["deploy", "--entry", "module.ts", "--environment", "x"].
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

/**
 * Whether `version` is 8.0.0-rc.`rc` or later. Unparseable versions count as
 * current, so a new CLI never gets an old flag.
 *
 * @param {string} version - e.g. "8.0.0-rc.28".
 * @param {number} rc
 * @returns {boolean}
 */
function isAtLeastRc(version, rc) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/);
  if (!match) return true;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (major !== 8 || minor !== 0 || patch !== 0) return major >= 8;
  return match[4] === undefined || Number(match[4]) >= rc;
}

/**
 * Whether this `prisma` CLI takes the module as `--entry <path>`. From
 * 8.0.0-rc.28 (Composer 0.35.0) `deploy` rejects a positional module.
 *
 * @param {string} version - e.g. "8.0.0-rc.28".
 * @returns {boolean}
 */
export function takesEntryFlag(version) {
  return isAtLeastRc(version, 28);
}

/**
 * Whether this `prisma` CLI names the target as `--environment <name>`. From
 * 8.0.0-rc.30 (Composer 0.36.0) `deploy` rejects `--stage`.
 *
 * @param {string} version - e.g. "8.0.0-rc.30".
 * @returns {boolean}
 */
export function takesEnvironmentFlag(version) {
  return isAtLeastRc(version, 30);
}

/**
 * The `prisma` CLI `bun run` finds from `workdir`: the nearest
 * node_modules/.bin/prisma in `workdir` or a parent, up to `root`, so a
 * monorepo package finds the CLI hoisted to the repository root. Null when
 * there is none. `version` is "" when the package version cannot be read.
 *
 * @param {string} workdir
 * @param {string} root - The repository root; the search does not go above it.
 * @returns {{ version: string } | null}
 */
export function findLocalPrismaCli(workdir, root) {
  for (let dir = workdir; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "node_modules", ".bin", "prisma"))) {
      return { version: packageVersion(join(dir, "node_modules", "prisma", "package.json")) };
    }
    if (dirname(dir) === dir || relative(root, dir) === "") return null;
  }
}

function packageVersion(manifestPath) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return typeof manifest.version === "string" ? manifest.version : "";
  } catch {
    return "";
  }
}

/**
 * The arguments after `prisma` for a deploy or destroy of `modulePath`.
 *
 * @param {"deploy" | "destroy"} mode
 * @param {string} modulePath
 * @param {string} environment - Empty for production.
 * @param {string} cliVersion - The version of the `prisma` CLI that will run.
 * @returns {string[]}
 */
export function composerArguments(mode, modulePath, environment, cliVersion) {
  const entry = takesEntryFlag(cliVersion) ? ["--entry", modulePath] : [modulePath];
  const target = takesEnvironmentFlag(cliVersion) ? "--environment" : "--stage";
  return [mode, ...entry, ...(environment ? [target, environment] : [])];
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
