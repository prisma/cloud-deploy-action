import assert from "node:assert/strict";
import { test } from "node:test";
import { deployedUrlFromOutput, deployedUrlsFromOutput } from "../deployment.mjs";

const ESC = String.fromCharCode(27);

const DEPLOY_REPORT = [
  "menu-board",
  "└─ menuboard   compute-service cps_wfzg31o86hblgngtaz2lh4mw",
  "               https://wfzg31o86hblgngtaz2lh4mw.ewr.prisma.build",
  "",
  "Done: 12 succeeded",
].join("\n");

test("reads the .prisma.build address from a deploy report", () => {
  assert.equal(
    deployedUrlFromOutput(DEPLOY_REPORT),
    "https://wfzg31o86hblgngtaz2lh4mw.ewr.prisma.build",
  );
});

test("returns the first address when the app deployed several services", () => {
  const report = [
    "shop",
    "├─ web    compute-service cps_web",
    "          https://web123.ewr.prisma.build",
    "└─ admin  compute-service cps_admin",
    "          https://admin456.ewr.prisma.build",
  ].join("\n");
  assert.equal(deployedUrlFromOutput(report), "https://web123.ewr.prisma.build");
});

test("ignores the Actions run URL and the API host in the same log", () => {
  const log = [
    "report: created bld_abc",
    "$ https://api.prisma.io/v1/builds",
    "see https://github.com/org/repo/actions/runs/123",
    "               https://wfzg31o86hblgngtaz2lh4mw.ewr.prisma.build",
  ].join("\n");
  assert.equal(
    deployedUrlFromOutput(log),
    "https://wfzg31o86hblgngtaz2lh4mw.ewr.prisma.build",
  );
});

test("matches through surrounding SGR color escapes", () => {
  const colored = `  ${ESC}[36mhttps://abc123.ewr.prisma.build${ESC}[0m`;
  assert.equal(deployedUrlFromOutput(colored), "https://abc123.ewr.prisma.build");
});

test("keeps a path suffix on the address", () => {
  assert.equal(
    deployedUrlFromOutput("https://abc123.ewr.prisma.build/health"),
    "https://abc123.ewr.prisma.build/health",
  );
});

test("does not match a lookalike host that only ends in .build", () => {
  assert.equal(deployedUrlFromOutput("https://notprisma.build/x"), null);
});

test("returns null when the output carries no .prisma.build address", () => {
  assert.equal(deployedUrlFromOutput("Done: 12 succeeded\nno url here"), null);
});

test("returns null for empty or non-string input", () => {
  assert.equal(deployedUrlFromOutput(""), null);
  assert.equal(deployedUrlFromOutput(undefined), null);
  assert.equal(deployedUrlFromOutput(null), null);
});

// The stdout of a real three-service deploy (kristof-siket/keel), trimmed of entity details.
const KEEL_RESULT = JSON.stringify({
  kind: "result",
  envelope: {
    ok: true,
    commandId: "deploy",
    result: {
      summary: {
        app: "keel",
        nodes: [
          { address: "database", entities: [{ kind: "postgres-database", id: "db_1" }] },
          { address: "mail.db", entities: [{ kind: "postgres-database", id: "db_2" }] },
          {
            address: "mail.service",
            entities: [{ kind: "compute-service", id: "cps_mail", url: "https://mail.fra.prisma.build" }],
          },
          {
            address: "login.service",
            entities: [{ kind: "compute-service", id: "cps_login", url: "https://login.fra.prisma.build" }],
          },
          {
            address: "app",
            entities: [{ kind: "compute-service", id: "cps_app", url: "https://app.fra.prisma.build" }],
          },
        ],
      },
    },
  },
});

test("reads every service URL from the deploy result and picks the root service", () => {
  assert.deepEqual(deployedUrlsFromOutput(`${KEEL_RESULT}\n`), {
    urls: {
      "mail.service": "https://mail.fra.prisma.build",
      "login.service": "https://login.fra.prisma.build",
      app: "https://app.fra.prisma.build",
    },
    url: "https://app.fra.prisma.build",
  });
});

test("ignores other commands' result lines and non-JSON output", () => {
  const skills = JSON.stringify({ kind: "result", envelope: { commandId: "skills.sync", result: {} } });
  const output = [skills, "Done: 41 succeeded", KEEL_RESULT].join("\n");
  assert.equal(deployedUrlsFromOutput(output).url, "https://app.fra.prisma.build");
});

test("falls back to the first nested service when no root service has a URL", () => {
  const result = JSON.parse(KEEL_RESULT);
  result.envelope.result.summary.nodes.pop();
  assert.equal(deployedUrlsFromOutput(JSON.stringify(result)).url, "https://mail.fra.prisma.build");
});

test("falls back to the printed report when the CLI emits no result line", () => {
  assert.deepEqual(deployedUrlsFromOutput(DEPLOY_REPORT), {
    urls: {},
    url: "https://wfzg31o86hblgngtaz2lh4mw.ewr.prisma.build",
  });
  assert.deepEqual(deployedUrlsFromOutput(""), { urls: {}, url: null });
});
