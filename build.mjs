/**
 * Returns the build command to run, or null to skip the build phase.
 *
 * Only the exact value "none" skips — for repos with no build script whose
 * source runs directly. An empty input falls back to the default, so a blank
 * value or a typo can never silently skip a build.
 *
 * @param {string} rawInput - The trimmed build-command input ("" when unset).
 * @returns {string | null}
 */
export function selectBuildCommand(rawInput) {
  if (rawInput === "none") return null;
  return rawInput || "npm run build";
}
