// Outcome of last resort: runs after main.mjs on success, failure, AND
// cancellation. Reports the build as cancelled when the main step was
// interrupted before recording a terminal outcome.
import { writeSync } from "node:fs";
import { resolveCredential } from "./credentials.mjs";
import { makeReporter } from "./report.mjs";

const log = (line) => writeSync(1, `${line}\n`);
const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();

const finalOutcome = (process.env.STATE_finalOutcome ?? "").trim();
const buildId = (process.env.STATE_buildId ?? "").trim();

if (finalOutcome) {
  // Any recorded terminal outcome means the main step already said its piece.
  log(`Nothing to do: the main step recorded a final outcome (${finalOutcome}).`);
} else if (!buildId) {
  log("No build was created in the main step; nothing to report.");
} else {
  const apiUrl = input("api-url") || "https://api.prisma.io";

  // Re-resolve rather than persisting the token in state: GITHUB_STATE is
  // visible to other steps, so writing a raw token there is unsafe.
  let credential;
  try {
    credential = await resolveCredential(process.env, apiUrl);
  } catch (error) {
    log(`::warning::post step credential resolution failed: ${error.message}`);
    credential = null;
  }

  if (!credential || credential.source === "none" || credential.denied) {
    log("post step: no credential available, cannot report interrupted outcome.");
  } else {
    if (credential.source === "oidc") {
      log(`::add-mask::${credential.token}`);
    }
    const reporter = makeReporter({ apiUrl, token: credential.token });
    try {
      // The Prisma CLI may have reported its own outcome before the runner
      // was interrupted. A build that is already terminal stays as it is,
      // and a recorded error message is not replaced.
      const existing = await reporter.get(buildId).catch(() => null);
      if (existing && ["succeeded", "failed", "cancelled"].includes(existing.state)) {
        log(`Nothing to do: the build is already ${existing.state}.`);
      } else {
        await reporter.update(
          buildId,
          existing && (existing.errorMessage || existing.failingStep)
            ? { state: "cancelled" }
            : { state: "cancelled", errorMessage: "The workflow run was interrupted." },
        );
        log(`report: cancelled ${buildId}`);
      }
    } catch (error) {
      log(`::warning::interrupted report failed: ${error.message}`);
    }
  }
}
