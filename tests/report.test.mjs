import assert from "node:assert/strict";
import { test } from "node:test";
import { failurePatch, guardReport, makeReporter, mapPhase } from "../report.mjs";

const API_URL = "https://api.example.test";
const TOKEN = "tok-test";
const BUILD_ID = "bld_test123";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// --- mapPhase ---

test("mapPhase: install maps to build", () => {
  assert.equal(mapPhase("install"), "build");
});

test("mapPhase: destroy maps to deploy", () => {
  assert.equal(mapPhase("destroy"), "deploy");
});

test("mapPhase: build passes through", () => {
  assert.equal(mapPhase("build"), "build");
});

test("mapPhase: deploy passes through", () => {
  assert.equal(mapPhase("deploy"), "deploy");
});

// --- reporter.create ---

test("create sends source, commitSha, branchName, runIdentity, and externalLogUrl", async () => {
  let sentBody;
  const fetchImpl = async (url, init) => {
    sentBody = JSON.parse(init.body);
    return jsonResponse(201, { data: { id: BUILD_ID } });
  };
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });
  await reporter.create({
    source: "ci",
    commitSha: "abc123def456",
    branchName: "feature/my-branch",
    runIdentity: {
      provider: "github",
      repositoryId: "98765",
      runId: "11111",
      runAttempt: 2,
    },
    externalLogUrl: "https://github.com/org/repo/actions/runs/11111",
  });
  assert.equal(sentBody.source, "ci");
  assert.equal(sentBody.commitSha, "abc123def456");
  assert.equal(sentBody.branchName, "feature/my-branch");
  assert.deepEqual(sentBody.runIdentity, {
    provider: "github",
    repositoryId: "98765",
    runId: "11111",
    runAttempt: 2,
  });
  assert.equal(sentBody.externalLogUrl, "https://github.com/org/repo/actions/runs/11111");
});

test("create unwraps data.id from the response envelope", async () => {
  const fetchImpl = async () => jsonResponse(201, { data: { id: BUILD_ID } });
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });
  const id = await reporter.create({ source: "ci" });
  assert.equal(id, BUILD_ID);
});

test("create throws on non-2xx", async () => {
  const fetchImpl = async () => jsonResponse(400, { error: "bad request" });
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });
  await assert.rejects(reporter.create({ source: "ci" }), /responded 400/);
});

test("create uses Bearer authorization", async () => {
  let authHeader;
  const fetchImpl = async (url, init) => {
    authHeader = init.headers.authorization;
    return jsonResponse(201, { data: { id: BUILD_ID } });
  };
  const reporter = makeReporter({ apiUrl: API_URL, token: "tok-secret", fetchImpl });
  await reporter.create({ source: "ci" });
  assert.equal(authHeader, "Bearer tok-secret");
});

// --- reporter.update ---

test("update sends the patch body to PATCH /v1/builds/{id}", async () => {
  let sentUrl;
  let sentBody;
  const fetchImpl = async (url, init) => {
    sentUrl = url;
    sentBody = JSON.parse(init.body);
    return jsonResponse(200, {});
  };
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });
  await reporter.update(BUILD_ID, { phase: "build", state: "running" });
  assert.equal(sentUrl, `${API_URL}/v1/builds/${BUILD_ID}`);
  assert.deepEqual(sentBody, { phase: "build", state: "running" });
});

test("update throws on non-2xx", async () => {
  const fetchImpl = async () => jsonResponse(422, { error: "validation" });
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });
  await assert.rejects(reporter.update(BUILD_ID, { state: "succeeded" }), /responded 422/);
});

test("update retries once on 5xx then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return calls === 1 ? jsonResponse(500, {}) : jsonResponse(200, {});
  };
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });
  await reporter.update(BUILD_ID, { state: "succeeded" });
  assert.equal(calls, 2);
});

test("update throws after two consecutive 5xx responses", async () => {
  const fetchImpl = async () => jsonResponse(500, {});
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });
  await assert.rejects(reporter.update(BUILD_ID, { state: "succeeded" }), /responded 500/);
});

// --- Phase sequence produces correct patch shapes ---

test("first phase update carries state running; subsequent ones carry only phase", async () => {
  const patches = [];
  const fetchImpl = async (url, init) => {
    patches.push(JSON.parse(init.body));
    return jsonResponse(200, {});
  };
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });

  // Mirror the firstPhaseReported logic from main.mjs
  let firstPhase = true;
  function phasePatch(serverPhase) {
    const patch = firstPhase ? { phase: serverPhase, state: "running" } : { phase: serverPhase };
    firstPhase = false;
    return patch;
  }

  await reporter.update(BUILD_ID, phasePatch(mapPhase("install")));
  await reporter.update(BUILD_ID, phasePatch(mapPhase("build")));
  await reporter.update(BUILD_ID, phasePatch(mapPhase("deploy")));

  assert.deepEqual(patches[0], { phase: "build", state: "running" });
  assert.deepEqual(patches[1], { phase: "build" });
  assert.deepEqual(patches[2], { phase: "deploy" });
});

// --- Failure payload ---

test("failure update carries state failed with failingStep and errorMessage", async () => {
  const patches = [];
  const fetchImpl = async (url, init) => {
    patches.push(JSON.parse(init.body));
    return jsonResponse(200, {});
  };
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });
  await reporter.update(BUILD_ID, {
    state: "failed",
    failingStep: "build",
    errorMessage: "npm run build exited with status 1",
  });
  assert.equal(patches[0].state, "failed");
  assert.equal(patches[0].failingStep, "build");
  assert.ok(patches[0].errorMessage.includes("exited with status 1"));
});

test("failure payload is truncated to API caps before being sent", async () => {
  const patches = [];
  const fetchImpl = async (url, init) => {
    patches.push(JSON.parse(init.body));
    return jsonResponse(200, {});
  };
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });

  // Simulate what main.mjs's fail() does before calling reporter.update
  const longStep = "s".repeat(600);
  const longMessage = "m".repeat(6000);
  await reporter.update(BUILD_ID, {
    state: "failed",
    failingStep: longStep.slice(0, 500),
    errorMessage: longMessage.slice(0, 5000),
  });

  assert.equal(patches[0].failingStep.length, 500);
  assert.equal(patches[0].errorMessage.length, 5000);
});

// --- Interrupted maps to cancelled ---

test("interrupted run sends state cancelled to the API", async () => {
  const patches = [];
  const fetchImpl = async (url, init) => {
    patches.push(JSON.parse(init.body));
    return jsonResponse(200, {});
  };
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });

  // This is what post.mjs sends when no terminal outcome was recorded.
  await reporter.update(BUILD_ID, {
    state: "cancelled",
    errorMessage: "The workflow run was interrupted.",
  });

  assert.equal(patches[0].state, "cancelled");
  assert.equal(patches[0].errorMessage, "The workflow run was interrupted.");
});

// --- guardReport ---

test("guardReport returns the function result on success", async () => {
  const warnings = [];
  const mockLog = (line) => warnings.push(line);
  const result = await guardReport(() => Promise.resolve("hello"), "test", mockLog);
  assert.equal(result, "hello");
  assert.equal(warnings.length, 0);
});

test("guardReport returns null and logs a warning on rejection", async () => {
  const warnings = [];
  const mockLog = (line) => warnings.push(line);
  const result = await guardReport(
    () => Promise.reject(new Error("network error")),
    "create",
    mockLog,
  );
  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("::warning::"));
  assert.ok(warnings[0].includes("create"));
  assert.ok(warnings[0].includes("network error"));
});

test("non-2xx report responses warn and do not throw when wrapped with guardReport", async () => {
  const warnings = [];
  const mockLog = (line) => warnings.push(line);
  const fetchImpl = async () => jsonResponse(503, {});
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });

  const result = await guardReport(
    () => reporter.update(BUILD_ID, { state: "succeeded" }),
    "succeeded",
    mockLog,
  );

  assert.equal(result, null);
  assert.ok(warnings.some((w) => w.includes("::warning::")));
});

// --- reporter.get ---

test("get unwraps data from the response envelope", async () => {
  let sentUrl;
  let sentMethod;
  const fetchImpl = async (url, init) => {
    sentUrl = url;
    sentMethod = init.method;
    return jsonResponse(200, {
      data: { id: BUILD_ID, state: "failed", failingStep: "DEPLOY.PREFLIGHT_FAILED" },
    });
  };
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });
  const build = await reporter.get(BUILD_ID);
  assert.equal(sentUrl, `${API_URL}/v1/builds/${BUILD_ID}`);
  assert.equal(sentMethod, "GET");
  assert.equal(build.failingStep, "DEPLOY.PREFLIGHT_FAILED");
});

test("get throws on non-2xx", async () => {
  const fetchImpl = async () => jsonResponse(404, {});
  const reporter = makeReporter({ apiUrl: API_URL, token: TOKEN, fetchImpl });
  await assert.rejects(reporter.get(BUILD_ID), /responded 404/);
});

// --- failurePatch ---

test("failurePatch keeps an existing failure report and patches only state", () => {
  const existing = { failingStep: "DEPLOY.PREFLIGHT_FAILED", errorMessage: "preflight failed" };
  assert.deepEqual(failurePatch(existing, "deploy", "exited with status 2"), { state: "failed" });
});

test("failurePatch sends the full report when the build has no failure details", () => {
  const patch = failurePatch({ failingStep: null, errorMessage: null }, "deploy", "exited with status 2");
  assert.deepEqual(patch, { state: "failed", failingStep: "deploy", errorMessage: "exited with status 2" });
  assert.deepEqual(failurePatch(null, "deploy", "x"), { state: "failed", failingStep: "deploy", errorMessage: "x" });
});
