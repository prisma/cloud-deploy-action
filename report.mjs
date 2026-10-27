// prisma/cloud-deploy-action: Builds API client.
// On non-2xx or network failure this module throws; callers use guardReport
// to convert those failures into warnings without aborting the deploy.
import { resolveCredential } from "./credentials.mjs";

const TIMEOUT_MS = 10_000;

// Local copy of the retry helper from credentials.mjs. Sharing it would
// require reshaping that module's exports, so each module keeps its own copy.
async function fetchWithRetry(fetchImpl, url, init) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 5xx is retryable; any other status is a definitive answer.
      if (response.status >= 500) {
        lastError = new Error(`${url} responded ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Maps an action phase name to the server-side phase vocabulary.
 * "install" runs the user's toolchain and maps to "build".
 * "destroy" is a Composer apply operation and maps to "deploy".
 * "build" and "deploy" pass through unchanged.
 */
export function mapPhase(phase) {
  if (phase === "install") return "build";
  if (phase === "destroy") return "deploy";
  return phase;
}

/**
 * The failure patch for a build, capped to the API's field limits. When the
 * build already carries failure details (the Prisma CLI reported its own,
 * more precise failure), only the state is patched.
 */
export function failurePatch(existing, failingStep, errorText) {
  if (existing && (existing.failingStep || existing.errorMessage)) {
    return { state: "failed" };
  }
  return {
    state: "failed",
    failingStep: failingStep.slice(0, 500),
    errorMessage: errorText.slice(0, 5000),
  };
}

/**
 * Calls fn(). On any rejection logs a single warning line and returns null
 * instead of throwing, so a reporting failure never fails the calling step.
 */
export async function guardReport(fn, label, log) {
  try {
    return await fn();
  } catch (error) {
    log(`::warning::build report failed (${label}): ${error.message}`);
    return null;
  }
}

/**
 * Returns a reporter bound to an API base URL and bearer token.
 * Pass fetchImpl to stub network calls in tests.
 */
export function makeReporter({ apiUrl, token, fetchImpl = fetch }) {
  const base = apiUrl.replace(/\/$/, "");

  async function call(method, path, body) {
    const response = await fetchWithRetry(fetchImpl, `${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`${method} ${path} responded ${response.status}`);
    }
    return response.json();
  }

  return {
    /** POST /v1/builds; returns the new build id ("bld_..."). */
    async create(payload) {
      const envelope = await call("POST", "/v1/builds", payload);
      return envelope.data.id;
    },

    /** GET /v1/builds/{id}; returns the build record. */
    async get(buildId) {
      const envelope = await call("GET", `/v1/builds/${buildId}`);
      return envelope.data;
    },

    /** PATCH /v1/builds/{id} with the given fields. */
    async update(buildId, patch) {
      await call("PATCH", `/v1/builds/${buildId}`, patch);
    },
  };
}

/**
 * Reports a failure that happens before the run has a build report, such as
 * a missing Bun or an undetectable install command. The platform already
 * holds a queued build for this run (the workflow_run webhook creates it),
 * and the create converges on it through the run identity, so the cause
 * lands on that build instead of the platform's generic "workflow run
 * finished without reporting to the platform". Best-effort: never throws,
 * and a run without a credential reports nothing.
 * Returns the build id, or null when nothing was reported.
 */
export async function reportEarlyFailure({
  env,
  apiUrl,
  createPayload,
  failingStep,
  errorText,
  log,
  fetchImpl = fetch,
}) {
  let credential;
  try {
    credential = await resolveCredential(env, apiUrl, { fetchImpl });
  } catch (error) {
    log(`::warning::build report failed (credential): ${error.message}`);
    return null;
  }
  if (credential.source === "none" || credential.denied) return null;
  if (credential.source === "oidc") log(`::add-mask::${credential.token}`);

  const reporter = makeReporter({ apiUrl, token: credential.token, fetchImpl });
  const buildId = await guardReport(() => reporter.create(createPayload), "create", log);
  if (!buildId) return null;
  const result = await guardReport(
    () => reporter.update(buildId, failurePatch(null, failingStep, errorText)),
    "failed",
    log,
  );
  if (result !== null) log("report: failed");
  return buildId;
}
