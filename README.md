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
          # Node 22: prisma-composer 0.6.0 crashes on Node 24.
          node-version: 22
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

Each run has three phases: install, build, and deploy. Your workflow owns checkout and the toolchain. The action runs your install and build commands exactly as configured, and it never inspects your repository to decide how to build. The deploy phase hands your built app to the [Prisma Composer](https://github.com/prisma/composer) CLI.

Deploy targets follow your branches:

- A push to the default branch deploys to production.
- A push to any other branch deploys to a preview stage named after the branch.
- Deleting a branch destroys its preview stage.

The credential resolves in order: an explicit `PRISMA_SERVICE_TOKEN` from the environment wins; otherwise the action requests the run's GitHub OIDC token and exchanges it with Prisma for a workspace token that expires after 30 minutes. When neither path yields a credential, or the exchange refuses the repository, the run prints a notice, sets its `outcome` output to `skipped-no-credential`, and exits successfully without deploying. Forks and unconnected repositories keep a green CI. A failure of the exchange itself, such as an outage, fails the run instead of skipping it.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `build-command` | `npm run build` | Your build command, run verbatim. It runs in both modes, because destroy evaluates the built app to know what to remove. |
| `install-command` | auto | Detected from the lockfile: `npm ci` for `package-lock.json`, `bun install --frozen-lockfile` for a bun lockfile. Set this to override. pnpm and yarn are not supported yet. |
| `module` | `module.ts` | Path to your app's Composer module. |
| `mode` | `deploy` | `deploy` or `destroy`. |
| `stage` | derived | Empty derives the stage from the branch: the default branch deploys to production, any other branch name becomes the stage. `destroy` requires a resolved stage. |
| `composer-version` | `0.6.0` | The Composer CLI version the action invokes. |
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

When a run has no credential, no `[report-stub]` log lines appear; the run is silent on reporting.

## Known limitations

- Keep the workflow on Node 22. prisma-composer 0.6.0 crashes on Node 24, even though the action itself runs on the runner's Node 24.
- Install detection covers npm and bun lockfiles. Repositories using pnpm or yarn need an explicit `install-command`, and deploys are not tested against them yet.
- Workflow runs triggered from forks receive no OIDC token from GitHub, so they skip deploying unless a `PRISMA_SERVICE_TOKEN` secret is provided.

## Security

The OIDC exchange keeps long-lived credentials out of your repository. GitHub mints a signed token for the specific run, Prisma verifies it against GitHub's keys with a pinned `prisma-cloud` audience, matches the repository by its numeric id against the workspace's connection, and answers with a token that expires after 30 minutes. The minted token is masked in logs.

Branch names reach the action as environment variables and are passed to the Composer CLI as single arguments without a shell, so branch names cannot inject commands. Your install and build commands are your own configuration and run through a shell exactly as written.

## Development

Plain Node with zero dependencies and no build step. Inputs arrive as `INPUT_*` environment variables; outputs and state go to `$GITHUB_OUTPUT` and `$GITHUB_STATE`.

## License

[Apache-2.0](LICENSE)
