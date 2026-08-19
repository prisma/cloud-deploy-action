/**
 * Returns [cmd, leadArgs, logLabel] for running the Composer CLI under Bun.
 *
 * @param {string} localBin - Absolute path to the local prisma-composer binary.
 * @param {string} composerVersion - @prisma/composer-cli version to fetch via bunx when the local bin is absent.
 * @param {boolean} binExists - Whether the local bin file exists.
 * @returns {[string, string[], string]}
 */
export function selectComposerCommand(localBin, composerVersion, binExists) {
  if (binExists) {
    return ["bun", [localBin], "composer=local bin (bun)"];
  }
  return [
    "bunx",
    ["--bun", "-p", `@prisma/composer-cli@${composerVersion}`, "prisma-composer"],
    `composer=${composerVersion} (bunx fallback)`,
  ];
}
