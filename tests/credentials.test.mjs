import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCredential } from "../credentials.mjs";

const API_URL = "https://api.example.test";

const githubEnv = {
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.test/get?run=1",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-bearer",
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("an explicit PRISMA_SERVICE_TOKEN wins without any network call", async () => {
  let calls = 0;
  const result = await resolveCredential(
    { PRISMA_SERVICE_TOKEN: " tok-explicit " },
    API_URL,
    { fetchImpl: async () => (calls++, jsonResponse(200, {})) },
  );
  assert.deepEqual(result, { source: "env", token: "tok-explicit" });
  assert.equal(calls, 0);
});

test("no token and no OIDC environment resolves to none", async () => {
  const result = await resolveCredential({}, API_URL, {
    fetchImpl: async () => jsonResponse(200, {}),
  });
  assert.deepEqual(result, { source: "none" });
});

test("exchanges the OIDC token with the prisma-cloud audience", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.startsWith("https://token.actions.test/")) {
      assert.match(url, /&audience=prisma-cloud$/);
      assert.equal(init.headers.authorization, "Bearer runner-bearer");
      return jsonResponse(200, { value: "oidc-jwt" });
    }
    assert.equal(url, `${API_URL}/v1/auth/github-actions/token`);
    assert.equal(JSON.parse(init.body).token, "oidc-jwt");
    return jsonResponse(200, { data: { value: "tok-short", workspaceId: "ws_1" } });
  };
  const result = await resolveCredential(githubEnv, API_URL, { fetchImpl });
  assert.deepEqual(result, { source: "oidc", token: "tok-short", workspaceId: "ws_1" });
  assert.equal(seen.length, 2);
});

test("a 401 from the exchange resolves to denied", async () => {
  const fetchImpl = async (url) =>
    url.startsWith("https://token.actions.test/")
      ? jsonResponse(200, { value: "oidc-jwt" })
      : jsonResponse(401, {});
  const result = await resolveCredential(githubEnv, API_URL, { fetchImpl });
  assert.deepEqual(result, { source: "oidc", denied: true });
});

test("a 500 from the exchange retries once and then succeeds", async () => {
  let exchangeCalls = 0;
  const fetchImpl = async (url) => {
    if (url.startsWith("https://token.actions.test/")) {
      return jsonResponse(200, { value: "oidc-jwt" });
    }
    exchangeCalls++;
    return exchangeCalls === 1
      ? jsonResponse(500, {})
      : jsonResponse(200, { data: { value: "tok-short", workspaceId: "ws_1" } });
  };
  const result = await resolveCredential(githubEnv, API_URL, { fetchImpl });
  assert.equal(result.token, "tok-short");
  assert.equal(exchangeCalls, 2);
});

test("persistent exchange failures throw instead of resolving", async () => {
  const fetchImpl = async (url) =>
    url.startsWith("https://token.actions.test/")
      ? jsonResponse(200, { value: "oidc-jwt" })
      : jsonResponse(500, {});
  await assert.rejects(
    resolveCredential(githubEnv, API_URL, { fetchImpl }),
    /responded 500/,
  );
});

test("network errors on the GitHub token request throw after a retry", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error("socket hang up");
  };
  await assert.rejects(resolveCredential(githubEnv, API_URL, { fetchImpl }), /socket hang up/);
  assert.equal(calls, 2);
});
