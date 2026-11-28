import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSingleAppProject } from "../project.mjs";

const listing = (projects, status = 200) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, authorization: init.headers.authorization });
    return { ok: status >= 200 && status < 300, status, json: async () => ({ data: projects }) };
  };
  return { fetchImpl, calls };
};
const credential = { apiUrl: "https://api.example.test/", token: "token" };

test("the project input wins and no request is made", async () => {
  const { fetchImpl, calls } = listing([]);
  assert.equal(await resolveSingleAppProject("my-project", { ...credential, fetchImpl }), "my-project");
  assert.equal(calls.length, 0);
});

test("a credential that can read one project deploys to it", async () => {
  const { fetchImpl, calls } = listing([{ id: "proj_1", name: "web" }]);
  assert.equal(await resolveSingleAppProject("", { ...credential, fetchImpl }), "proj_1");
  assert.deepEqual(calls, [
    { url: "https://api.example.test/v1/projects?limit=2", authorization: "Bearer token" },
  ]);
});

test("a credential that can read several projects needs the input", async () => {
  const { fetchImpl } = listing([{ id: "proj_1" }, { id: "proj_2" }]);
  await assert.rejects(
    resolveSingleAppProject("", { ...credential, fetchImpl }),
    /can read more than one project; set the project input/,
  );
});

test("a credential that can read no project names the fix", async () => {
  const { fetchImpl } = listing([]);
  await assert.rejects(
    resolveSingleAppProject("", { ...credential, fetchImpl }),
    /can read no project; connect the repository to a project in the Prisma Console, or set the project input/,
  );
});

test("a refused listing names the status", async () => {
  const { fetchImpl } = listing([], 403);
  await assert.rejects(resolveSingleAppProject("", { ...credential, fetchImpl }), /\(HTTP 403\); set the project input/);
});

test("a network error names the cause", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch failed");
  };
  await assert.rejects(resolveSingleAppProject("", { ...credential, fetchImpl }), /\(fetch failed\); set the project input/);
});
