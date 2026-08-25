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
