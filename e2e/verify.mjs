// Checks a deploy made by the action in CI: its outputs, then that the
// deployed service answers for the environment it was deployed to.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const { OUTCOME, URL, URLS, REPORT_PATH, ENVIRONMENT } = process.env;

assert.equal(OUTCOME, "succeeded", `outcome is "${OUTCOME}"; a missing PRISMA_SERVICE_TOKEN secret gives skipped-no-credential`);
assert.match(URL, /^https:\/\//, `url output is "${URL}"`);
assert.ok(Object.values(JSON.parse(URLS)).includes(URL), `urls output ${URLS} does not include ${URL}`);
assert.ok(REPORT_PATH && existsSync(REPORT_PATH), `report-path output "${REPORT_PATH}" names no file`);

const deadline = Date.now() + 3 * 60_000;
for (;;) {
  try {
    const response = await fetch(URL, { signal: AbortSignal.timeout(15_000) });
    if (response.ok) {
      const body = await response.json();
      assert.deepEqual(body, { environment: ENVIRONMENT });
      console.log(`${URL} answered for environment ${ENVIRONMENT}`);
      break;
    }
    console.log(`${URL} answered ${response.status}; retrying`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    console.log(`${URL} is not reachable yet (${error.message}); retrying`);
  }
  assert.ok(Date.now() < deadline, `${URL} did not answer within 3 minutes`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
