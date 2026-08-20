/**
 * Returns [cmd, leadArgs, logLabel] for running the Composer CLI under Bun.
 *
 * The local bin runs as `bun run --bun prisma-composer`, not `bun <path>`:
 * `--bun` puts a `node` → bun shim first on PATH, so the Composer CLI and the
 * converge child it spawns (a `#!/usr/bin/env node` launcher) both run under
 * Bun. `bun <absolute path>` runs only the CLI under Bun and leaves the child
 * to Node, which cannot resolve the `./service.js` import to `service.ts`.
 *
 * @param {string} composerVersion - @prisma/composer-cli version to fetch via bunx when the local bin is absent.
 * @param {boolean} binExists - Whether node_modules/.bin/prisma-composer exists in the working directory.
 * @param {boolean} unifiedCliAvailable - Whether the local Prisma CLI mounts the Composer command family.
 * @returns {[string, string[], string]}
 */
export function selectComposerCommand(composerVersion, binExists, unifiedCliAvailable) {
  if (unifiedCliAvailable) {
    return [
      "bun",
      ["run", "--bun", "prisma", "composer"],
      "composer=local Prisma CLI (bun run --bun)",
    ];
  }
  if (binExists) {
    return ["bun", ["run", "--bun", "prisma-composer"], "composer=local bin (bun run --bun)"];
  }
  return [
    "bunx",
    ["--bun", "-p", `@prisma/composer-cli@${composerVersion}`, "prisma-composer"],
    `composer=${composerVersion} (bunx fallback)`,
  ];
}
