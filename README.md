# Prisma Deploy action

`prisma/compute-deploy-action` installs, builds, and deploys (or destroys)
a Prisma Composer app from GitHub Actions, and reports the attempt.
Reporting is a logged stub until the Builds API exists; the payload shapes
below are frozen so the stub can become a real client without changing the
action's interface.

This is the consolidation of four in-repo experimental actions; see
[Provenance](#provenance).

```yaml
- uses: prisma/compute-deploy-action@main
  with:
    build-command: npm run build
  env:
    PRISMA_SERVICE_TOKEN: ${{ secrets.PRISMA_SERVICE_TOKEN }}
```

## Division of labor with the workflow

The workflow provides: checkout, toolchain setup (`actions/setup-node@v4`
with Node 22; `oven-sh/setup-bun@v2` when the repo's lockfile is bun's),
concurrency group, permissions. The action provides everything after:
install, build, deploy or destroy, reporting, outputs.

The action itself runs on the runner's Node 24 (`runs.using: node24`), but
every child process — install, build, and the Composer CLI via `npx` —
resolves `node` from `PATH`, which is whatever the workflow's `setup-node`
chose. Keep the workflow on Node 22: prisma-composer 0.6.0 crashes on
Node 24 (exit 139) even though its engines field asks for >=24.

The canonical workflow shape:

```yaml
name: prisma-deploy

on:
  push:
  delete:

concurrency:
  group: prisma-deploy-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  deploy:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          # Node 22, not 24: prisma-composer 0.6.0 crashes on Node 24.
          node-version: 22
      - uses: prisma/compute-deploy-action@main
        with:
          build-command: npm run build
        env:
          PRISMA_SERVICE_TOKEN: ${{ secrets.PRISMA_SERVICE_TOKEN }}

  teardown:
    # delete fires for tag deletions too; only branch deletions map to a
    # stage, so the teardown job filters on ref_type.
    if: github.event_name == 'delete' && github.event.ref_type == 'branch'
    runs-on: ubuntu-latest
    steps:
      # The deleted ref no longer exists; checkout gives the default
      # branch, which the install phase runs against.
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: prisma/compute-deploy-action@main
        with:
          mode: destroy
          # The deleted ref reaches the action as an env var (INPUT_STAGE),
          # never a shell interpolation, so branch names cannot inject.
          stage: ${{ github.event.ref }}
        env:
          PRISMA_SERVICE_TOKEN: ${{ secrets.PRISMA_SERVICE_TOKEN }}
```

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `build-command` | `npm run build` | The repo's full build. The action runs it verbatim; it contains no framework knowledge. Runs in both modes: composer's destroy evaluates the stack program, which needs the built artifacts. |
| `install-command` | `""` | Empty = auto-detect: `bun.lock`/`bun.lockb` → `bun install --frozen-lockfile`; `package-lock.json` → `npm ci`; neither → fail with a named error (pnpm/yarn are out of scope for now). |
| `module` | `module.ts` | Path to the Composer module. |
| `mode` | `deploy` | `deploy` or `destroy`. |
| `stage` | `""` | Empty = derive: current branch equals the repo's default branch → production (no `--stage`); otherwise `--stage <branch>`. `destroy` refuses to run without a resolved stage. |
| `composer-version` | `0.6.0` | The Composer CLI version the action invokes (`npx prisma-composer@<version>`). Pinned here so moving everyone is one change. |
| `working-directory` | `.` | Where install/build/deploy run. |

## Outputs

| Output | Values |
| --- | --- |
| `outcome` | `succeeded` \| `failed` \| `skipped-no-credential` |
| `build-id` | The stub build id (see Reporting). |

## Behaviors (normative)

1. **Phases.** Both modes run `install` → `build` → then `deploy` or
   `destroy`. We wanted destroy to skip the build (teardown should not
   depend on the default branch's build health, and a delete-event
   checkout builds the default branch's code anyway), but composer 0.6.0
   requires it: "destroy evaluates the same stack program as deploy,
   which packages the built artifacts — so the app must be built first"
   (its own error text). Revisit when composer can destroy from state
   alone. Each phase runs in its own log group. A phase failure sets
   `outcome=failed`, records the failing phase, skips later phases, and
   fails the step.
2. **The credential guard.** If `PRISMA_SERVICE_TOKEN` is absent or
   empty: print one clear `::notice::` (the action cannot deploy without a
   credential; where to configure it), write
   `outcome=skipped-no-credential` to `$GITHUB_OUTPUT` and
   `$GITHUB_STATE`, and exit 0. The guard path sends **no** final report:
   a run without the credential could not authenticate to the real
   reporting API either. Skipped runs simply do not report; the recorded
   state keeps `post.mjs` quiet. The real deploy/destroy invocation stays
   in the code but is unreachable without the secret, so repos without the
   secret (such as the fixture repos) never deploy.
3. **Deploy.** `npx prisma-composer@<composer-version> deploy <module>`
   plus the stage rule above.
4. **Destroy.** Same guard; `npx prisma-composer@<composer-version>
   destroy <module> --stage <stage>`. The deleted ref arrives via an
   environment variable from the workflow, never inline-interpolated into
   a script, and the action passes it to the Composer CLI as one argv
   element with no shell (injection hygiene).
5. **Reporting is a stub, deliberately.** A `report` function logs the
   exact JSON it would send, under log lines prefixed `[report-stub]`,
   and returns a fake id (`build_stub_<run id>`). These payloads are the
   frozen shape for the future Builds API; until that API exists, nothing
   is sent anywhere:
   - create: `{ "repository", "commitSha", "branch", "runUrl", "reporter": "github-action" }` → `{ "id" }`
   - phase update: `{ "phase": "install" | "build" | "deploy" | "destroy" }`
   - final: `{ "outcome": "succeeded" | "failed" | "interrupted", "failingStep"?, "error"? }`

   The final-report vocabulary is exactly `succeeded | failed |
   interrupted`. There is no `skipped` value: credential-skipped runs do
   not report (behavior 2).
6. **`post.mjs` is the outcome of last resort.** It runs on success,
   failure, AND cancellation. If the saved state carries no terminal
   outcome (`succeeded`, `failed`, or `skipped-no-credential`), the run
   died mid-flight and `post.mjs` reports `interrupted` (via the stub).
   Whenever the state carries any terminal outcome, `post.mjs` stays
   quiet. A build can never end without either a terminal report or a
   deliberately unreported credential skip.
7. **No framework logic, ever.** The action must not inspect the repo to
   decide how to build; that knowledge lives in the repo's own files.

## Implementation notes

Plain Node, zero dependencies, no build step: no `@actions/*` packages, no
bundling. Inputs are read from the runner's `INPUT_*` environment
variables, outputs go to `$GITHUB_OUTPUT`, state to `$GITHUB_STATE`,
annotations via `::notice::`/`::error::`. Stdout is written with
`fs.writeSync` so `::group::` markers stay ordered around child-process
output (`spawnSync` blocks the event loop, so buffered async writes would
flush late). String install/build commands run through a shell verbatim;
deploy/destroy are invoked as argv arrays with no shell.

## Provenance

This action consolidates four experimental in-repo implementations of one
frozen contract. Each fixture repo carried the same `action.yml` and
contract README with its own `main.mjs`/`post.mjs`, plus
`IMPLEMENTATION-NOTES.md` recording conflicts and evidence runs:

- [prisma/compute-composer-build-tanstack](https://github.com/prisma/compute-composer-build-tanstack) — PR #2 (and PR #3 for the destroy-path evidence run)
- [prisma/compute-composer-build-nx-ecomm](https://github.com/prisma/compute-composer-build-nx-ecomm) — PR #2
- [prisma/compute-composer-build-nest](https://github.com/prisma/compute-composer-build-nest) — PR #2
- [prisma/compute-composer-build-next-prisma](https://github.com/prisma/compute-composer-build-next-prisma) — PR #2

The consolidation amended the experimental contract in four ways, each
raised independently by the fixtures' implementation notes:

1. `runs.using: node24` — runners deprecated `node20` and force Node 24
   anyway.
2. Destroy mode was amended to `install` → `destroy` without a build,
   then reverted by reality: composer's destroy needs the built
   artifacts (behavior 1). The no-build ambition stands as an upstream
   ask.
3. The credential-guard path sends no final report (behavior 2); the
   experiment's contract could not express a skip in the final-report
   vocabulary, and two of four implementations had reported `succeeded`
   as a workaround.
4. The canonical workflow's teardown job filters
   `github.event.ref_type == 'branch'` so tag deletions cannot trigger a
   destroy with a tag-named stage.
