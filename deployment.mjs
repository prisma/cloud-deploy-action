// prisma/cloud-deploy-action: reads the deployed preview URL out of Composer's
// deploy output so the action can report it to the Builds API.
//
// The Console shows a build's live preview from Build.deployedUrl. Composer's
// deploy prints the deployed compute service's public address —
// https://<hash>.<region>.prisma.build — on its own line in the deployment
// report. Released Composer (0.6.0) exposes that address only as human text, so
// the action reads it back from the captured output. The machine-readable
// source this should move to is documented in ./README.md (Build status
// reporting, and Known limitations).

// Anchored to the .prisma.build address: the scheme and the literal suffix pin
// both ends, so nothing else in a deploy log (the Actions run URL, the API
// host, a connection string) can match. A single-service app — the shape the
// Console setup PR creates — prints exactly one, and the first is reported.
const DEPLOYED_URL_RE = /https?:\/\/[a-z0-9.-]+\.prisma\.build(?:\/[^\s]*)?/i;

// Composer may color the report; strip SGR escapes before matching so codes
// around the address never break the pin. Built from the escape byte directly
// so the source carries no literal control character.
const ANSI_SGR_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * The first `.prisma.build` address in Composer's deploy output, or null when
 * the output carries none (an app with no publicly reachable service, or a
 * Composer that did not print one).
 */
export function deployedUrlFromOutput(output) {
  if (typeof output !== "string" || output.length === 0) return null;
  const match = output.replace(ANSI_SGR_RE, "").match(DEPLOYED_URL_RE);
  return match ? match[0] : null;
}
