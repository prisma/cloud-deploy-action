const DEPLOYED_URL_RE = /https?:\/\/[a-z0-9.-]+\.prisma\.build(?:\/[^\s]*)?/i;

// Built from the escape byte so the source carries no literal control character.
const ANSI_SGR_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** The first `.prisma.build` address in the deploy output, or null when it carries none. */
export function deployedUrlFromOutput(output) {
  if (typeof output !== "string" || output.length === 0) return null;
  const match = output.replace(ANSI_SGR_RE, "").match(DEPLOYED_URL_RE);
  return match ? match[0] : null;
}
