/**
 * Returns the install command to run, null to skip the install phase, or
 * undefined when no command is set and none can be detected.
 *
 * Only the exact value "none" skips, for workflows that install dependencies
 * in an earlier step and want the action to use the workspace as it is. An
 * empty input detects the command from the lockfile, so a blank value or a
 * typo can never silently skip an install.
 *
 * @param {string} rawInput - The trimmed install-command input ("" when unset).
 * @param {(name: string) => boolean} hasFile - Whether the working directory holds the named file.
 * @returns {string | null | undefined}
 */
export function selectInstallCommand(rawInput, hasFile) {
  if (rawInput === "none") return null;
  if (rawInput) return rawInput;
  if (hasFile("bun.lock") || hasFile("bun.lockb")) return "bun install --frozen-lockfile";
  if (hasFile("package-lock.json")) return "npm ci";
  return undefined;
}
