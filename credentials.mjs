// Resolves the deploy credential. An explicit PRISMA_SERVICE_TOKEN wins;
// otherwise a repository connected through the Prisma Console exchanges the
// GitHub OIDC token of this run for a short-lived workspace token.

const EXCHANGE_PATH = "/v1/auth/github-actions/token";
const OIDC_AUDIENCE = "prisma-cloud";
const TIMEOUT_MS = 15_000;

async function fetchJsonWithRetry(fetchImpl, url, init) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 5xx is retryable; anything else is a definitive answer.
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
 * Returns one of:
 *   { source: "env",  token }                 explicit PRISMA_SERVICE_TOKEN
 *   { source: "oidc", token, workspaceId }    exchanged short-lived token
 *   { source: "oidc", denied: true }          the platform refused the exchange
 *   { source: "none" }                        no credential path available
 * Throws on transient failures (network errors, 5xx after retry), which the
 * caller must surface as a real failure rather than a quiet skip.
 */
export async function resolveCredential(env, apiUrl, { fetchImpl = fetch } = {}) {
  const explicit = (env.PRISMA_SERVICE_TOKEN ?? "").trim();
  if (explicit) return { source: "env", token: explicit };

  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) return { source: "none" };

  const oidcResponse = await fetchJsonWithRetry(
    fetchImpl,
    `${requestUrl}&audience=${OIDC_AUDIENCE}`,
    { headers: { authorization: `Bearer ${requestToken}` } },
  );
  if (!oidcResponse.ok) {
    throw new Error(`GitHub OIDC token request responded ${oidcResponse.status}`);
  }
  const oidcToken = (await oidcResponse.json()).value;

  const exchangeResponse = await fetchJsonWithRetry(
    fetchImpl,
    `${apiUrl.replace(/\/$/, "")}${EXCHANGE_PATH}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: oidcToken }),
    },
  );
  // The exchange returns one generic 401 for every refusal (unknown repo,
  // archived link, uninstalled app). That is an entitlement answer, not an
  // outage, so it maps to the skip path.
  if (exchangeResponse.status === 401) return { source: "oidc", denied: true };
  if (!exchangeResponse.ok) {
    throw new Error(`credential exchange responded ${exchangeResponse.status}`);
  }
  const { data } = await exchangeResponse.json();
  return { source: "oidc", token: data.value, workspaceId: data.workspaceId };
}
