// Outcome of last resort: runs after main.mjs on success, failure, AND
// cancellation. Importing main.mjs would re-run it, so the report stub's
// one line is repeated here instead of shared.
import { writeSync } from "node:fs";

const log = (line) => writeSync(1, `${line}\n`);

const finalOutcome = (process.env.STATE_finalOutcome ?? "").trim();
const buildId = (process.env.STATE_buildId ?? "").trim();

if (finalOutcome) {
  // Any recorded terminal outcome — succeeded, failed, or
  // skipped-no-credential — means the main step already said its piece.
  log(`Nothing to do: the main step recorded a final outcome (${finalOutcome}).`);
} else if (!buildId) {
  log("No build was created in the main step; nothing to report.");
} else {
  log(
    `::notice title=Build interrupted::${buildId} ended without a final outcome (run cancelled or killed), so it is reported as interrupted.`,
  );
  log(`[report-stub] final: ${JSON.stringify({ outcome: "interrupted" })}`);
}
