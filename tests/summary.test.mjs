import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readRunReport, renderJobSummary } from "../summary.mjs";

// The shape of a real production deploy's run report (five services, two
// databases, two services with unset optional inputs), with ids, URLs and
// inputs replaced.
const PRODUCTION_REPORT = {
  version: 1,
  outcome: "succeeded",
  app: "pdp-control-plane-console",
  stage: null,
  nodes: [
    { address: "agentEvents.subscriptions", entities: [{ kind: "postgres-database", id: "db_subs" }] },
    {
      address: "agentEvents.service",
      entities: [
        { kind: "compute-service", id: "cps_events", url: "https://events.ewr.prisma.build", details: { input: "{}" } },
      ],
    },
    { address: "bloom.database", entities: [{ kind: "postgres-database", id: "db_bloom" }] },
    {
      address: "bloom.service",
      entities: [
        { kind: "compute-service", id: "cps_bloom", url: "https://bloom.ewr.prisma.build", details: { input: "{}" } },
      ],
    },
    {
      address: "console",
      entities: [
        { kind: "compute-service", id: "cps_console", url: "https://console.ewr.prisma.build", details: { input: "{}" } },
      ],
    },
    {
      address: "mcp",
      entities: [
        {
          kind: "compute-service",
          id: "cps_mcp",
          url: "https://mcp.ewr.prisma.build",
          details: { input: "{}", absent: "MCP_PUBLIC_URL → MCP_PUBLIC_URL" },
        },
      ],
    },
    {
      address: "githubWebhook",
      entities: [
        {
          kind: "compute-service",
          id: "cps_webhook",
          url: "https://webhook.ewr.prisma.build",
          details: {
            input: "{}",
            absent: "AXIOM_OTEL_LOGS_DATASET → AXIOM_OTEL_LOGS_DATASET\nFOUNDRY_BASE_URL → FOUNDRY_BASE_URL",
          },
        },
      ],
    },
  ],
  failure: null,
};

const RUN = {
  mode: "deploy",
  stage: "",
  sha: "095b237a1c0ffee",
  ref: "main",
  buildId: "bld_igci22j8zecxd2t364y9wb5j",
  reportPath: "/home/runner/work/_temp/prisma-deploy-report.json",
};

test("a successful production deploy lists services, databases, and unset optional inputs", () => {
  assert.equal(
    renderJobSummary({ ...RUN, outcome: "succeeded", report: PRODUCTION_REPORT }),
    `### ✅ Deployed \`pdp-control-plane-console\` to production

Commit \`095b237\` on \`main\` · build \`bld_igci22j8zecxd2t364y9wb5j\`

#### Services

| Service | URL |
| --- | --- |
| \`agentEvents.service\` | https://events.ewr.prisma.build |
| \`bloom.service\` | https://bloom.ewr.prisma.build |
| \`console\` | https://console.ewr.prisma.build |
| \`mcp\` | https://mcp.ewr.prisma.build |
| \`githubWebhook\` | https://webhook.ewr.prisma.build |

Databases: \`agentEvents.subscriptions\` (\`db_subs\`), \`bloom.database\` (\`db_bloom\`).

#### ⚠️ Warnings (2)

- \`mcp\`: optional input \`MCP_PUBLIC_URL\` is not set.
- \`githubWebhook\`: optional inputs \`AXIOM_OTEL_LOGS_DATASET\`, \`FOUNDRY_BASE_URL\` are not set.

<details><summary>For tools and agents</summary>

- Report: \`/home/runner/work/_temp/prisma-deploy-report.json\` (step output \`report-path\`, run report version 1)

</details>

`,
  );
});

test("a preview deploy names its stage", () => {
  const summary = renderJobSummary({ ...RUN, stage: "feat-x", outcome: "succeeded", report: PRODUCTION_REPORT });
  assert.match(summary, /^### ✅ Deployed `pdp-control-plane-console` to `feat-x`\n/);
});

test("a failed deploy shows the report's failure cause", () => {
  const report = {
    version: 1,
    outcome: "failed",
    app: null,
    stage: "feat-x",
    nodes: [],
    failure: { code: "DEPLOY.PREFLIGHT_FAILED", message: "1 required setting has no value: TOLT_PUBLIC_API_KEY." },
  };
  assert.equal(
    renderJobSummary({ ...RUN, stage: "feat-x", outcome: "failed", report, cause: "deploy failed: exited with status 1" }),
    `### ❌ Deploy failed

Commit \`095b237\` on \`main\` · build \`bld_igci22j8zecxd2t364y9wb5j\`

#### Cause

\`\`\`text
DEPLOY.PREFLIGHT_FAILED: 1 required setting has no value: TOLT_PUBLIC_API_KEY.
\`\`\`

<details><summary>For tools and agents</summary>

- Report: \`/home/runner/work/_temp/prisma-deploy-report.json\` (step output \`report-path\`, run report version 1)

</details>

`,
  );
});

test("without a report, a failure shows the action's own error and no report section", () => {
  assert.equal(
    renderJobSummary({ ...RUN, outcome: "failed", report: null, cause: "build failed: npm run build exited with status 2" }),
    `### ❌ Deploy failed

Commit \`095b237\` on \`main\` · build \`bld_igci22j8zecxd2t364y9wb5j\`

#### Cause

\`\`\`text
build failed: npm run build exited with status 2
\`\`\`

`,
  );
});

test("without a report, a success lists the service URLs from the deploy output", () => {
  assert.equal(
    renderJobSummary({ ...RUN, outcome: "succeeded", report: null, urls: { app: "https://app.fra.prisma.build" } }),
    `### ✅ Deployed to production

Commit \`095b237\` on \`main\` · build \`bld_igci22j8zecxd2t364y9wb5j\`

#### Services

| Service | URL |
| --- | --- |
| \`app\` | https://app.fra.prisma.build |

`,
  );
});

test("a skipped run says so and shows no build", () => {
  assert.equal(
    renderJobSummary({ ...RUN, buildId: null, outcome: "skipped-no-credential", report: null }),
    "### ⏭ Skipped: no credential\n\nCommit `095b237` on `main`\n\n",
  );
});

test("a successful destroy names the stage it removed", () => {
  const summary = renderJobSummary({ ...RUN, mode: "destroy", stage: "feat-x", outcome: "succeeded", report: null });
  assert.match(summary, /^### ✅ Destroyed stage `feat-x`\n/);
});

test("readRunReport ignores a missing file, invalid JSON, and a report older than this run", () => {
  const dir = mkdtempSync(join(tmpdir(), "summary-test-"));
  const path = join(dir, "report.json");
  assert.equal(readRunReport(path, 0), null);
  writeFileSync(path, "not json");
  assert.equal(readRunReport(path, 0), null);
  writeFileSync(path, JSON.stringify(PRODUCTION_REPORT));
  assert.deepEqual(readRunReport(path, 0), PRODUCTION_REPORT);
  assert.equal(readRunReport(path, Date.now() + 60_000), null);
});

// An unknown mode fails before any tool runs, so main.mjs can run here end to end.
function runMainWithUnknownMode(stepSummary) {
  const dir = mkdtempSync(join(tmpdir(), "summary-main-"));
  const output = join(dir, "output");
  const result = spawnSync(process.execPath, [new URL("../main.mjs", import.meta.url).pathname], {
    env: {
      PATH: process.env.PATH,
      INPUT_MODE: "bogus",
      GITHUB_REF_NAME: "main",
      GITHUB_SHA: "095b237a1c0ffee",
      GITHUB_OUTPUT: output,
      GITHUB_STATE: join(dir, "state"),
      GITHUB_STEP_SUMMARY: stepSummary ?? join(dir, "summary.md"),
      RUNNER_TEMP: dir,
    },
    encoding: "utf8",
  });
  return { dir, result, outputs: readFileSync(output, "utf8") };
}

test("main.mjs writes a summary on an early failure and keeps the failed outcome", () => {
  const { dir, result, outputs } = runMainWithUnknownMode();
  assert.equal(result.status, 1);
  assert.match(outputs, /^outcome=failed$/m);
  assert.equal(
    readFileSync(join(dir, "summary.md"), "utf8"),
    '### ❌ Deploy failed\n\nCommit `095b237` on `main`\n\n#### Cause\n\n```text\nconfig failed: unknown mode "bogus" (expected "deploy" or "destroy")\n```\n\n',
  );
});

test("main.mjs keeps its outcome and exit code when the summary cannot be written", () => {
  const unwritable = mkdtempSync(join(tmpdir(), "summary-dir-"));
  const { result, outputs } = runMainWithUnknownMode(unwritable);
  assert.equal(result.status, 1);
  assert.match(outputs, /^outcome=failed$/m);
  assert.match(result.stdout, /::warning::could not write the job summary/);
});
