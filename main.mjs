// prisma/cloud-deploy-action: install, build, and deploy (or destroy) a
// Prisma Composer app, reporting the attempt to the Builds API when a
// credential is available. Interface and behaviors are frozen by ./README.md.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { selectBuildCommand } from "./build.mjs";
import { selectComposerCommand } from "./composer.mjs";
import { resolveCredential } from "./credentials.mjs";
import { deployedUrlFromOutput } from "./deployment.mjs";
import { guardReport, makeReporter, mapPhase } from "./report.mjs";

// Synchronous stdout keeps ::group:: markers ordered around child output:
// spawnSync blocks the event loop, so buffered async writes would flush late.
const log = (line) => writeSync(1, `${line}\n`);

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
const setOutput = (name, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
const saveState = (name, value) => appendFileSync(process.env.GITHUB_STATE, `${name}=${value}\n`);

const STUB_BUILD_ID = `build_stub_${process.env.GITHUB_RUN_ID}`;

let reporter = null;
let buildId = null;
let firstPhaseReported = false;

function finish(outcome) {
  setOutput("outcome", outcome);
  saveState("finalOutcome", outcome);
}

async function reportUpdate(patch, label) {
  // guardReport returns null on failure (it already logged a warning).
  // update() returns void on success, so a non-null result means succeeded.
  const result = await guardReport(() => reporter.update(buildId, patch), label, log);
  if (result !== null) log(`report: ${label}`);
}

// Fails after a build report has been created: sends a failure state update,
// records the outcome, then exits non-zero.
async function fail(failingStep, errorText) {
  if (reporter && buildId) {
    const result = await guardReport(
      () =>
        reporter.update(buildId, {
          state: "failed",
          failingStep: failingStep.slice(0, 500),
          errorMessage: errorText.slice(0, 5000),
        }),
      "failed",
      log,
    );
    if (result !== null) log("report: failed");
  }
  finish("failed");
  log(`::error::${failingStep} failed: ${errorText}`);
  process.exit(1);
}

// Fails before any build report exists: no API call, just exit.
function failEarly(failingStep, errorText) {
  finish("failed");
  log(`::error::${failingStep} failed: ${errorText}`);
  process.exit(1);
}

async function runPhase(phase, command, args, capture = false) {
  const serverPhase = mapPhase(phase);
  log(`::group::${phase}`);
  if (reporter && buildId) {
    const patch = firstPhaseReported
      ? { phase: serverPhase }
      : { phase: serverPhase, state: "running" };
    firstPhaseReported = true;
    await reportUpdate(patch, `phase ${serverPhase}`);
  }
  const printable = args ? [command, ...args].join(" ") : command;
  log(`$ ${printable}`);
  // String commands come from the consuming repo's own workflow inputs and
  // run through a shell verbatim; argv arrays never touch a shell, so
  // event-controlled values like the stage name cannot inject.
  const stdio = capture ? ["inherit", "pipe", "inherit"] : "inherit";
  // maxBuffer raised so a large but successful deploy is not misreported as a spawn failure.
  const options = capture
    ? { cwd: workdir, stdio, maxBuffer: 64 * 1024 * 1024 }
    : { cwd: workdir, stdio };
  const result = args
    ? spawnSync(command, args, options)
    : spawnSync(command, { ...options, shell: true });
  const captured = capture && result.stdout ? result.stdout.toString() : "";
  if (captured) writeSync(1, captured);
  log("::endgroup::");
  if (result.status !== 0) {
    const error =
      result.error?.message ??
      (result.signal
        ? `${printable} was terminated by ${result.signal}`
        : `${printable} exited with status ${result.status}`);
    await fail(phase, error);
  }
  return captured;
}

const mode = input("mode") || "deploy";
const modulePath = input("module") || "module.ts";
const composerVersion = input("composer-version") || "0.7.0";
const workdir = resolve(process.env.GITHUB_WORKSPACE ?? ".", input("working-directory") || ".");
const repository = process.env.GITHUB_REPOSITORY ?? "";
const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "";
const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;

log(`prisma-deploy: mode=${mode} module=${modulePath} working-directory=${workdir}`);

if (mode !== "deploy" && mode !== "destroy") {
  failEarly("config", `unknown mode "${mode}" (expected "deploy" or "destroy")`);
}

const defaultBranch = (() => {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    return event.repository?.default_branch ?? "";
  } catch {
    return "";
  }
})();

// The default branch deploys to production, which has no stage name; every
// other branch deploys to a stage named after it.
const stage = input("stage") || (branch === defaultBranch ? "" : branch);
if (!input("stage") && !branch) {
  failEarly("config", "cannot derive a stage: the event context has no branch; set the stage input");
}
if (mode === "destroy" && !stage) {
  failEarly(
    "config",
    "destroy refuses to run without a resolved stage; the default branch derives to production, so pass the stage input explicitly",
  );
}
log(stage ? `${mode} target: --stage ${stage}` : `${mode} target: production (default branch, no --stage)`);

// Bun is required: composer runs under Bun, not Node. The generated Prisma
// deploy workflow adds `oven-sh/setup-bun@v2` for every project.
const bunVersionCheck = spawnSync("bun", ["--version"], { stdio: "pipe" });
if (bunVersionCheck.error?.code === "ENOENT") {
  failEarly(
    "config",
    "bun not found on PATH: add `- uses: oven-sh/setup-bun@v2` before this action step; the generated Prisma deploy workflow includes this automatically",
  );
}

const installCommand = (() => {
  const explicit = input("install-command");
  if (explicit) return explicit;
  if (existsSync(join(workdir, "bun.lock")) || existsSync(join(workdir, "bun.lockb"))) {
    return "bun install --frozen-lockfile";
  }
  if (existsSync(join(workdir, "package-lock.json"))) return "npm ci";
  return null;
})();
if (!installCommand) {
  failEarly(
    "install",
    `install-auto-detect-failed: no bun.lock, bun.lockb, or package-lock.json in ${workdir} (pnpm/yarn are out of scope); set the install-command input`,
  );
}

// Credential guard: resolved before any reporting and before deploy. Runs
// with no credential path skip reporting entirely and exit successfully without
// deploying. A transient exchange failure (outage) fails the run instead of
// skipping it.
const apiUrl = input("api-url") || "https://api.prisma.io";
const credential = await (async () => {
  try {
    return await resolveCredential(process.env, apiUrl);
  } catch (error) {
    finish("failed");
    log(`::error::credential failed: ${error.message}`);
    process.exit(1);
  }
})();

if (credential.source === "none" || credential.denied) {
  const remedy = credential.denied
    ? "This repository is not connected to a Prisma workspace. Connect it in the Prisma Console, or set PRISMA_SERVICE_TOKEN as an Actions secret."
    : "Connect the repository in the Prisma Console and grant this job `permissions: id-token: write`, or set PRISMA_SERVICE_TOKEN as an Actions secret.";
  log(`::notice title=${mode} skipped, no credential::The action cannot ${mode} without a credential. ${remedy}`);
  setOutput("build-id", STUB_BUILD_ID);
  finish("skipped-no-credential");
  process.exit(0);
}

if (credential.source === "oidc") {
  log(`::add-mask::${credential.token}`);
  process.env.PRISMA_SERVICE_TOKEN = credential.token;
  process.env.PRISMA_WORKSPACE_ID = credential.workspaceId;
  log("credential: short-lived workspace token via GitHub OIDC");
}

reporter = makeReporter({ apiUrl, token: credential.token });

// Create the build report. A failure here is a warning, not a deploy blocker.
buildId = await guardReport(
  () =>
    reporter.create({
      source: "ci",
      commitSha: process.env.GITHUB_SHA ?? "",
      branchName: branch,
      runIdentity: {
        provider: "github",
        repositoryId: process.env.GITHUB_REPOSITORY_ID ?? "",
        runId: process.env.GITHUB_RUN_ID ?? "",
        runAttempt: parseInt(process.env.GITHUB_RUN_ATTEMPT ?? "1", 10),
      },
      externalLogUrl: runUrl,
    }),
  "create",
  log,
);

if (buildId) {
  log(`report: created ${buildId}`);
  setOutput("build-id", buildId);
  saveState("buildId", buildId);
} else {
  setOutput("build-id", STUB_BUILD_ID);
}

await runPhase("install", installCommand);

// Destroy builds too, by composer's own requirement: "destroy evaluates the
// same stack program as deploy, which packages the built artifacts — so the
// app must be built first" (its error text on 0.6.0). We wanted destroy to
// skip the build so teardown never depends on the default branch's build
// health; composer does not allow that today. `build-command: none` is
// different: the app has no build step at all, so both modes skip the phase.
const buildCommand = selectBuildCommand(input("build-command"));
if (buildCommand === null) {
  // Install already reported the server-side "build" phase (mapPhase sends
  // install as "build"), so the skip needs no report update of its own.
  log("build: skipped (build-command: none)");
} else {
  await runPhase("build", buildCommand);
}

// The stage reaches the argv array straight from the environment; it is
// never interpolated into a shell string.
//
// The unified Prisma CLI accepts every registered prisma.config.ts section,
// which lets ORM and Composer share one config file.
const localPrismaBin = join(workdir, "node_modules", ".bin", "prisma");
const unifiedCliAvailable =
  existsSync(localPrismaBin) &&
  spawnSync("bun", ["run", "--bun", "prisma", "composer", "--help"], {
    cwd: workdir,
    stdio: "ignore",
  }).status === 0;
const localBin = join(workdir, "node_modules", ".bin", "prisma-composer");
const [composerCmd, composerLead, composerLabel] = selectComposerCommand(
  composerVersion,
  existsSync(localBin),
  unifiedCliAvailable,
);
log(composerLabel);
const composerArgs = [
  ...composerLead,
  ...(mode === "deploy"
    ? ["deploy", modulePath, ...(stage ? ["--stage", stage] : [])]
    : ["destroy", modulePath, "--stage", stage]),
];

const deployOutput = await runPhase(mode, composerCmd, composerArgs, mode === "deploy");

if (reporter && buildId) {
  const deployedUrl = mode === "deploy" ? deployedUrlFromOutput(deployOutput) : null;
  await reportUpdate(
    deployedUrl ? { state: "succeeded", deployedUrl } : { state: "succeeded" },
    "succeeded",
  );
}
finish("succeeded");
