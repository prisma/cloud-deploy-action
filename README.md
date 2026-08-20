# Deploy to Prisma Cloud

The official GitHub Action for deploying to [Prisma Cloud](https://www.prisma.io/). Push to your repository and the action installs dependencies, runs your build, and deploys the result from your own CI. The default branch deploys to production. Every other branch gets its own preview deployment, and deleting a branch tears its preview down.

> **Status: experimental.** The action is under active development and its interface can change between minor versions.

## Quick start

For a repository connected through the Prisma Console, no credential setup is needed: the action authenticates with the OIDC token GitHub mints for the run and exchanges it for a short-lived Prisma workspace token. Give each job `id-token: write` permission and add the workflow:

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
  id-token: write

jobs:
  deploy:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: oven-sh/setup-bun@v2
      - uses: prisma/cloud-deploy-action@v1
        with:
          build-command: npm run build

  teardown:
    # The delete event also fires for tags; only branch deletions map to a preview.
    if: github.event_name == 'delete' && github.event.ref_type == 'branch'
    runs-on: ubuntu-latest
    steps:
      # The deleted ref no longer exists, so checkout gives the default branch.
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: oven-sh/setup-bun@v2
      - uses: prisma/cloud-deploy-action@v1
        with:
          mode: destroy
          stage: ${{ github.event.ref }}
```

Connecting a repository through the Prisma Console creates this setup for you with a pull request.

### Using a service token instead

Repositories that are not connected in the Console can deploy with an explicit credential. Create a service token in the Console, add it as an Actions secret named `PRISMA_SERVICE_TOKEN`, and pass it to the action step:

```yaml
      - uses: prisma/cloud-deploy-action@v1
        with:
          build-command: npm run build
        env:
          PRISMA_SERVICE_TOKEN: ${{ secrets.PRISMA_SERVICE_TOKEN }}
```

An explicit token always wins over the OIDC exchange.

## How it works

Each run has three phases: install, build, and deploy. Your workflow owns checkout and the toolchain. The action runs your install and build commands exactly as configured, and it never inspects your repository to decide how to build. A repository with no build script — one that runs its source directly — sets `build-command: none` to skip the build phase. The deploy phase hands your built app to the Composer commands of the unified [`prisma` CLI](https://www.npmjs.com/package/prisma), running it under Bun. Repositories with a `prisma` devDependency deploy with their own installed version; everything else uses the pinned `prisma-version` fallback fetched via bunx. Bun must be on the runner PATH — add `oven-sh/setup-bun@v2` before this action. The generated Prisma deploy workflow includes that step automatically.

Deploy targets follow your branches:

- A push to the default branch deploys to production.
- A push to any other branch deploys to a preview stage named after the branch.
- Deleting a branch destroys its preview stage.

The credential resolves in order: an explicit `PRISMA_SERVICE_TOKEN` from the environment wins; otherwise the action requests the run's GitHub OIDC token and exchanges it with Prisma for a workspace token that expires after 30 minutes. When neither path yields a credential, or the exchange refuses the repository, the run prints a notice, sets its `outcome` output to `skipped-no-credential`, and exits successfully without deploying. Forks and unconnected repositories keep a green CI. A failure of the exchange itself, such as an outage, fails the run instead of skipping it.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `build-command` | `npm run build` | Your build command, run verbatim. It runs in both modes, because destroy evaluates the built app to know what to remove. The exact value `none` skips the build phase in both modes, for repositories with no build script; an empty value keeps the default. |
| `install-command` | auto | Detected from the lockfile: `npm ci` for `package-lock.json`, `bun install --frozen-lockfile` for a bun lockfile. Set this to override. pnpm and yarn are not supported yet. |
| `module` | `module.ts` | Path to your app's Composer module. |
| `mode` | `deploy` | `deploy` or `destroy`. |
| `stage` | derived | Empty derives the stage from the branch: the default branch deploys to production, any other branch name becomes the stage. `destroy` requires a resolved stage. |
| `prisma-version` | `8.0.0-rc.6` | The `prisma` package version the action fetches via bunx — the fallback for repositories that do not carry the `prisma` devDependency. Repositories that do carry it deploy with their own installed version. |
| `composer-version` | `0.7.0` | Deprecated and ignored: the action always runs the unified `prisma` CLI. Pin the bunx fallback with `prisma-version` instead. |
| `working-directory` | `.` | Where install, build, and deploy run. |
| `api-url` | `https://api.prisma.io` | Prisma API base URL for the OIDC credential exchange. |

## Outputs

| Output | Values |
| --- | --- |
| `outcome` | `succeeded`, `failed`, or `skipped-no-credential` |
| `build-id` | The build id assigned by the Prisma API when reporting is active. Holds a stable placeholder value when the run has no credential, so downstream steps always receive a value. |

## Build status reporting

The action reports build progress and outcomes to the Prisma API so your deploys show up in the Prisma Console. Reporting is active when the run has a credential (service token or OIDC exchange). When no credential is available, no reports are sent.

Progress phases map to two server-side labels: `build` and `deploy`. The install and build commands both fall under `build`; the Composer deploy or destroy step falls under `deploy`. Build states are `running` (stamped when the first phase starts), `succeeded`, `failed`, or `cancelled` (sent by the post step when the runner is interrupted mid-flight).

On a successful deploy, the action also reports the deployed preview URL (`deployedUrl`) so the Console can link the live preview from the build. It reads the address — Composer's `https://<hash>.<region>.prisma.build` line — from the deploy report, anchored to the `.prisma.build` suffix; an app with several public services reports the first. Reporting the URL is best-effort like every other report: a missing address or a failed report call leaves the deploy successful.

When a run has no credential, no `[report-stub]` log lines appear; the run is silent on reporting.

## Requirements

Bun must be on the runner PATH. Add `oven-sh/setup-bun@v2` before this action step. The generated Prisma deploy workflow adds this step for every project.

## Known limitations

- Install detection covers npm and bun lockfiles. Repositories using pnpm or yarn need an explicit `install-command`, and deploys are not tested against them yet.
- Workflow runs triggered from forks receive no OIDC token from GitHub, so they skip deploying unless a `PRISMA_SERVICE_TOKEN` secret is provided.
- The deployed preview URL is read from Composer's human deploy output, because released Composer (0.6.0) does not expose it as data. When Composer emits the deploy result in a machine-readable form — a `--json` result carrying each deployed service's public URL — the action should read the URL from there rather than from the printed report.

## Security

The OIDC exchange keeps long-lived credentials out of your repository. GitHub mints a signed token for the specific run, Prisma verifies it against GitHub's keys with a pinned `prisma-cloud` audience, matches the repository by its numeric id against the workspace's connection, and answers with a token that expires after 30 minutes. The minted token is masked in logs.

Branch names reach the action as environment variables and are passed to the Composer CLI as single arguments without a shell, so branch names cannot inject commands. Your install and build commands are your own configuration and run through a shell exactly as written.

## Development

Plain Node with zero dependencies and no build step. Inputs arrive as `INPUT_*` environment variables; outputs and state go to `$GITHUB_OUTPUT` and `$GITHUB_STATE`.

## License

[Apache-2.0](LICENSE)
