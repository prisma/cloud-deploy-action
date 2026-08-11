# Deploy to Prisma Cloud

The official GitHub Action for deploying to [Prisma Cloud](https://www.prisma.io/). Push to your repository and the action installs dependencies, runs your build, and deploys the result from your own CI. The default branch deploys to production. Every other branch gets its own preview deployment, and deleting a branch tears its preview down.

> **Status: experimental.** The action is under active development and its interface can change between minor versions.

## Quick start

1. In the [Prisma Console](https://console.prisma.io), create a service token for your workspace.
2. In your repository settings, add the token as an Actions secret named `PRISMA_SERVICE_TOKEN`.
3. Add the workflow:

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
          # Node 22: prisma-composer 0.6.0 crashes on Node 24.
          node-version: 22
      - uses: prisma/cloud-deploy-action@v1
        with:
          build-command: npm run build
        env:
          PRISMA_SERVICE_TOKEN: ${{ secrets.PRISMA_SERVICE_TOKEN }}

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
        env:
          PRISMA_SERVICE_TOKEN: ${{ secrets.PRISMA_SERVICE_TOKEN }}
```

Connecting a repository through the Prisma Console creates this setup for you with a pull request.

## How it works

Each run has three phases: install, build, and deploy. Your workflow owns checkout and the toolchain. The action runs your install and build commands exactly as configured, and it never inspects your repository to decide how to build. The deploy phase hands your built app to the [Prisma Composer](https://github.com/prisma/composer) CLI.

Deploy targets follow your branches:

- A push to the default branch deploys to production.
- A push to any other branch deploys to a preview stage named after the branch.
- Deleting a branch destroys its preview stage.

If `PRISMA_SERVICE_TOKEN` is missing, the run prints a notice, sets its `outcome` output to `skipped-no-credential`, and exits successfully without deploying. Forks and repositories without the secret keep a green CI.

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

## Outputs

| Output | Values |
| --- | --- |
| `outcome` | `succeeded`, `failed`, or `skipped-no-credential` |
| `build-id` | The id the action reports its build under. |

## Build status reporting

The action reports build progress and outcomes so your deploys can show up in the Prisma Console. Transmission is under development: today each report is logged under `[report-stub]` lines instead of being sent, and the payload shapes are stable. If a run is cancelled mid-flight, a completion step records the attempt as `interrupted`.

## Known limitations

- Keep the workflow on Node 22. prisma-composer 0.6.0 crashes on Node 24, even though the action itself runs on the runner's Node 24.
- Install detection covers npm and bun lockfiles. Repositories using pnpm or yarn need an explicit `install-command`, and deploys are not tested against them yet.

## Security

Branch names reach the action as environment variables and are passed to the Composer CLI as single arguments without a shell, so branch names cannot inject commands. Your install and build commands are your own configuration and run through a shell exactly as written.

## Development

Plain Node with zero dependencies and no build step. Inputs arrive as `INPUT_*` environment variables; outputs and state go to `$GITHUB_OUTPUT` and `$GITHUB_STATE`.

## License

[Apache-2.0](LICENSE)
