// prisma/cloud-deploy-action: Builds API client.
// On non-2xx or network failure this module throws; callers use guardReport
// to convert those failures into warnings without aborting the deploy.
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
