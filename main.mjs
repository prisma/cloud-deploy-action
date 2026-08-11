// prisma/cloud-deploy-action: install, build, and deploy (or destroy) a
// Prisma Composer app, reporting the attempt. Interface and behaviors are
// frozen by ./README.md; reporting is a logged stub until the Builds API
// exists.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveCredential } from "./credentials.mjs";

// Synchronous stdout keeps ::group:: markers ordered around child output:
// spawnSync blocks the event loop, so buffered async writes would flush late.
const log = (line) => writeSync(1, `${line}\n`);

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
const setOutput = (name, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
const saveState = (name, value) => appendFileSync(process.env.GITHUB_STATE, `${name}=${value}\n`);

const buildId = `build_stub_${process.env.GITHUB_RUN_ID}`;

/** Stub of the future Builds API client: logs the exact JSON it would send. */
function report(kind, payload) {
  log(`[report-stub] ${kind}: ${JSON.stringify(payload)}`);
  return { id: buildId };
}

// Records the terminal outcome. post.mjs reports `interrupted` only when no
// outcome ever lands in the saved state.
function finish(outcome) {
  setOutput("outcome", outcome);
  saveState("finalOutcome", outcome);
}

function fail(failingStep, error) {
  report("final", { outcome: "failed", failingStep, error });
  finish("failed");
  log(`::error::${failingStep} failed: ${error}`);
  process.exit(1);
}

function runPhase(phase, command, args) {
  log(`::group::${phase}`);
  report("phase", { phase });
  const printable = args ? [command, ...args].join(" ") : command;
  log(`$ ${printable}`);
  // String commands come from the consuming repo's own workflow inputs and
  // run through a shell verbatim; argv arrays never touch a shell, so
  // event-controlled values like the stage name cannot inject.
  const result = args
    ? spawnSync(command, args, { cwd: workdir, stdio: "inherit" })
    : spawnSync(command, { cwd: workdir, stdio: "inherit", shell: true });
  log("::endgroup::");
  if (result.status !== 0) {
    const error =
      result.error?.message ??
      (result.signal
        ? `${printable} was terminated by ${result.signal}`
        : `${printable} exited with status ${result.status}`);
    fail(phase, error);
  }
}

const mode = input("mode") || "deploy";
const modulePath = input("module") || "module.ts";
const composerVersion = input("composer-version") || "0.6.0";
const workdir = resolve(process.env.GITHUB_WORKSPACE ?? ".", input("working-directory") || ".");
const repository = process.env.GITHUB_REPOSITORY ?? "";
const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "";
const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;

log(`prisma-deploy: mode=${mode} module=${modulePath} composer=${composerVersion} working-directory=${workdir}`);

report("create", {
  repository,
  commitSha: process.env.GITHUB_SHA ?? "",
  branch,
  runUrl,
  reporter: "github-action",
});
setOutput("build-id", buildId);
saveState("buildId", buildId);

if (mode !== "deploy" && mode !== "destroy") {
  fail("config", `unknown mode "${mode}" (expected "deploy" or "destroy")`);
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
  fail("config", "cannot derive a stage: the event context has no branch; set the stage input");
}
if (mode === "destroy" && !stage) {
  fail(
    "config",
    "destroy refuses to run without a resolved stage; the default branch derives to production, so pass the stage input explicitly",
  );
}
log(stage ? `${mode} target: --stage ${stage}` : `${mode} target: production (default branch, no --stage)`);

const installCommand = (() => {
  const explicit = input("install-command");
  if (explicit) return explicit;
  if (existsSync(join(workdir, "bun.lock")) || existsSync(join(workdir, "bun.lockb"))) {
    return "bun install --frozen-lockfile";
  }
  if (existsSync(join(workdir, "package-lock.json"))) return "npm ci";
  fail(
    "install",
    `install-auto-detect-failed: no bun.lock, bun.lockb, or package-lock.json in ${workdir} (pnpm/yarn are out of scope); set the install-command input`,
  );
})();

runPhase("install", installCommand);

// Destroy builds too, by composer's own requirement: "destroy evaluates the
// same stack program as deploy, which packages the built artifacts — so the
// app must be built first" (its error text on 0.6.0). We wanted destroy to
// skip the build so teardown never depends on the default branch's build
// health; composer does not allow that today.
runPhase("build", input("build-command") || "npm run build");

// The credential guard: everything past this point needs a credential. An
// explicit PRISMA_SERVICE_TOKEN wins; a connected repository exchanges its
// GitHub OIDC token instead. Runs with no credential path end here, green.
// No final report is sent; the saved state keeps post.mjs quiet.
const apiUrl = input("api-url") || "https://api.prisma.io";
const credential = await (async () => {
  try {
    return await resolveCredential(process.env, apiUrl);
  } catch (error) {
    // Transient exchange failures are real errors, never a quiet skip: a
    // platform outage must not look like a repository without a credential.
    fail("credential", error.message);
  }
})();
if (credential.source === "none" || credential.denied) {
  const remedy = credential.denied
    ? "This repository is not connected to a Prisma workspace. Connect it in the Prisma Console, or set PRISMA_SERVICE_TOKEN as an Actions secret."
    : "Connect the repository in the Prisma Console and grant this job `permissions: id-token: write`, or set PRISMA_SERVICE_TOKEN as an Actions secret.";
  log(`::notice title=${mode} skipped, no credential::The action cannot ${mode} without a credential. ${remedy}`);
  finish("skipped-no-credential");
  process.exit(0);
}
if (credential.source === "oidc") {
  log(`::add-mask::${credential.token}`);
  process.env.PRISMA_SERVICE_TOKEN = credential.token;
  process.env.PRISMA_WORKSPACE_ID = credential.workspaceId;
  log("credential: short-lived workspace token via GitHub OIDC");
}

// The stage reaches the argv array straight from the environment; it is
// never interpolated into a shell string.
//
// The CLI bin is named prisma-composer but ships inside @prisma/composer;
// there is no npm package named prisma-composer, so `npx prisma-composer@v`
// 404s. The repo's own install already provides the bin (the packages are in
// its dependencies), so prefer the local bin; fall back to fetching the
// pinned package only when the repo does not carry it.
const localBin = join(workdir, "node_modules", ".bin", "prisma-composer");
const [composerCmd, composerLead] = existsSync(localBin)
  ? [localBin, []]
  : ["npx", [`--package=@prisma/composer@${composerVersion}`, "prisma-composer"]];
const composerArgs = [
  ...composerLead,
  ...(mode === "deploy"
    ? ["deploy", modulePath, ...(stage ? ["--stage", stage] : [])]
    : ["destroy", modulePath, "--stage", stage]),
];

runPhase(mode, composerCmd, composerArgs);
report("final", { outcome: "succeeded" });
finish("succeeded");
