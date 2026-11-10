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
    # NOTE: destroy currently fails against the current CLI — see Known limitations.
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
          environment: ${{ github.event.ref }}
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

Each run has three phases: install, build, and deploy. Your workflow owns checkout and the toolchain. The action runs your install and build commands exactly as configured, and it never inspects your repository to decide how to build. A repository with no build script — one that runs its source directly — sets `build-command: none` to skip the build phase. The deploy phase hands your built app to the top-level `deploy` command of the unified [`prisma` CLI](https://www.npmjs.com/package/prisma) (`prisma deploy`, since `8.0.0-rc.8`; earlier versions used the removed `prisma composer` prefix and are not supported), running it under Bun. The action runs the repository's own `prisma` CLI, which the repository must carry as a devDependency: the CLI and the app must be on the same Composer version, and only the repository's lockfile can guarantee that. The action looks for it in the working directory and its parents up to the repository root, so a monorepo can install it at the root. A repository without it fails with an error that says so, unless it sets `prisma-version` (use an exact version: the npm `next` tag is not the newest release). Bun `1.3.10` or newer must be on the runner PATH — add `oven-sh/setup-bun@v2` before this action (it installs the latest by default). The generated Prisma deploy workflow includes that step automatically.

Deploy targets follow your branches:

- A push to the default branch deploys to production.
- A push to any other branch deploys to a preview environment named after the branch.
- Deleting a branch destroys its preview environment (`mode: destroy` — currently broken against the CLI, see Known limitations; Console-connected repositories get teardown from the platform's branch automation instead).

The credential resolves in order: an explicit `PRISMA_SERVICE_TOKEN` from the environment wins; otherwise the action requests the run's GitHub OIDC token and exchanges it with Prisma for a workspace token that expires after 30 minutes. When neither path yields a credential, or the exchange refuses the repository, the run prints a notice, sets its `outcome` output to `skipped-no-credential`, and exits successfully without deploying. Forks and unconnected repositories keep a green CI. A failure of the exchange itself, such as an outage, fails the run instead of skipping it.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `build-command` | `npm run build` | Your build command, run verbatim. It runs in both modes, because destroy evaluates the built app to know what to remove. The exact value `none` skips the build phase in both modes, for repositories with no build script; an empty value keeps the default. |
| `install-command` | auto | Detected from the lockfile: `npm ci` for `package-lock.json`, `bun install --frozen-lockfile` for a bun lockfile. Set this to override. pnpm and yarn are not supported yet. |
| `module` | `module.ts` | Path to your app's Composer module. On `prisma` 8.0.0-rc.28 and later the action passes it as `--entry`, which overrides the `entry` in `prisma.config.ts`. |
| `mode` | `deploy` | `deploy` or `destroy`. |
| `environment` | derived | Empty derives the environment from the branch: the default branch deploys to production, any other branch name becomes the environment. `destroy` requires a resolved environment. On `prisma` 8.0.0-rc.30 and later the action passes it as `--environment`; earlier versions get `--stage`. |
| `stage` | empty | The older name for `environment`, kept so existing workflows keep working. Setting both to different values fails the run. |
| `prisma-version` | empty | Runs this `prisma` version via bunx when the repository has no `prisma` devDependency. Empty refuses to deploy such a repository. Repositories that carry the devDependency always deploy with their own installed version. |
| `working-directory` | `.` | Where install, build, and deploy run. |
| `api-url` | `https://api.prisma.io` | Prisma API base URL for the OIDC credential exchange. |

## Outputs

| Output | Values |
| --- | --- |
| `outcome` | `succeeded`, `failed`, or `skipped-no-credential` |
| `build-id` | The build id assigned by the Prisma API when reporting is active. Holds a stable placeholder value when the run has no credential, so downstream steps always receive a value. |
| `url` | After a deploy, the public URL of the app's root service (the service declared in the root module, e.g. `app`). Empty when the deploy exposed no service. |
| `urls` | After a deploy, a JSON object mapping every deployed service's Composer address to its public URL, e.g. `{"app":"https://….prisma.build","login.service":"https://…"}`. `{}` on every other outcome (skipped, failed, destroy). |
| `report-path` | The path of the JSON run report the deploy wrote during this run, on success and on failure. Not set when the deploy wrote no report. |

To get a "View deployment" button on pull requests, point the job's environment at the `url` output:

```yaml
  deploy:
    environment:
      name: ${{ github.ref_name == github.event.repository.default_branch && 'production' || format('preview/{0}', github.ref_name) }}
      url: ${{ steps.deploy.outputs.url }}
    steps:
      # …
      - id: deploy
        uses: prisma/cloud-deploy-action@v1
```

Other services are reachable with `fromJSON(steps.deploy.outputs.urls)['login.service']`.

## Job summary

Every run writes a job summary: the outcome, the commit, the ref, and the build id. After a deploy it lists each service with its URL, the databases by id, and the optional inputs each service left unset. After a failure it shows the cause. Writing the summary never changes the run's outcome.

The summary comes from the run report the Prisma CLI writes to `PRISMA_COMPOSER_REPORT_FILE`. The action sets that variable to a file under `$RUNNER_TEMP` unless your workflow already sets it, and exposes the path as the `report-path` output for later steps. Without a report, the summary still shows the outcome and any service URLs from the CLI's structured deploy result.

## Build status reporting

The action reports build progress and outcomes to the Prisma API so your deploys show up in the Prisma Console. Reporting is active when the run has a credential (service token or OIDC exchange). When no credential is available, no reports are sent.

Progress phases map to two server-side labels: `build` and `deploy`. The install and build commands both fall under `build`; the Composer deploy or destroy step falls under `deploy`. Build states are `running` (stamped when the first phase starts), `succeeded`, `failed`, or `cancelled` (sent by the post step when the runner is interrupted mid-flight).

On a successful deploy, the action also reports the deployed preview URL (`deployedUrl`) so the Console can link the live preview from the build. It is the `url` output: the root service's address, read from the structured `deploy` result the Prisma CLI prints to stdout. A CLI that prints no result line falls back to the first `.prisma.build` address in its output. Reporting the URL is best-effort like every other report: a missing address or a failed report call leaves the deploy successful.

A run that fails before install, such as Bun missing or too old, an install command that cannot be detected, or an invalid `mode` or `environment`, still reports its cause when the run has a credential. The build the platform queued for the run is marked `failed` with a failing step (`config` or `install`) and the error text, so the Console shows why instead of "workflow run finished without reporting to the platform". Like every report, this is best-effort and never changes the run's outcome.

On a failed deploy or destroy, the Prisma CLI reports its own failure to the same build (the action hands it the build via `PRISMA_BUILD_ID`), with the exact failing step and cause. The action and the post step defer to that report: they only send their generic messages when the build has no failure details yet.

When a run has no credential, no `[report-stub]` log lines appear; the run is silent on reporting.

## Requirements

Bun `1.3.10` or newer must be on the runner PATH. Add `oven-sh/setup-bun@v2` before this action step; it installs the latest Bun unless a pin (package.json's `packageManager`, a `.bun-version` file, or the step's `bun-version` input) says otherwise. Bun `1.3.9` and older omit Content-Length on the deploy's artifact upload, failing it with HTTP 411, so the action refuses to run on them with an error naming that bug. The generated Prisma deploy workflow adds the setup step for every project.

## Known limitations

- `mode: destroy` does not work against the current CLI: `prisma` up to at least `8.0.0-rc.33` has no `destroy` command, so the destroy invocation fails. Composer removes one environment through the `destroy` operation of `@prisma/composer/control` instead. The action keeps the mode and its invocation shape while the CLI's teardown story is settled. In practice, repositories connected through the Prisma Console get preview teardown from the platform's branch automation when a branch is deleted, without running this action.
- Install detection covers npm and bun lockfiles. Repositories using pnpm or yarn need an explicit `install-command`, and deploys are not tested against them yet.
- Workflow runs triggered from forks receive no OIDC token from GitHub, so they skip deploying unless a `PRISMA_SERVICE_TOKEN` secret is provided.

## Troubleshooting

- Connecting a repository in the Prisma Console runs a setup job that opens a pull request adding the Quick-start workflow above. If that job fails (its install step resolves dependencies from scratch, so it can fail on peer-dependency conflicts a committed lockfile would avoid), no pull request appears and nothing in the Console points back here. Add the Quick-start workflow by hand instead; the OIDC exchange works as soon as the repository is connected, whether or not the setup job succeeded.
- The Console showing "Waiting for GitHub to start the first deployment" means no workflow run has deployed yet. Pushing to the default branch only helps once a workflow with this action exists on that branch; without one, the state never advances.

## Security

The OIDC exchange keeps long-lived credentials out of your repository. GitHub mints a signed token for the specific run, Prisma verifies it against GitHub's keys with a pinned `prisma-cloud` audience, matches the repository by its numeric id against the workspace's connection, and answers with a token that expires after 30 minutes. The minted token is masked in logs.

Branch names reach the action as environment variables and are passed to the `prisma` CLI as single arguments without a shell, so branch names cannot inject commands. Your install and build commands are your own configuration and run through a shell exactly as written.

## Development

Plain Node with zero dependencies and no build step. Inputs arrive as `INPUT_*` environment variables; outputs and state go to `$GITHUB_OUTPUT` and `$GITHUB_STATE`.

CI tests the action in three ways. Unit tests cover the scripts. A matrix runs the exact arguments the action passes against real `prisma` CLIs, including the npm `latest` and `dev` tags. An end-to-end job runs the action itself (`uses: ./`) on the small app in `e2e/app`: it deploys to a new preview environment, checks the outputs and that the service answers, then destroys the environment. It runs once with the app's pinned versions and once moved to `prisma@latest`. The end-to-end job needs the `PRISMA_SERVICE_TOKEN` secret and the `PRISMA_WORKSPACE_ID` variable. CI also runs every 6 hours, and any failure on `main`, on a scheduled run or on a manual run posts to Slack. A sweep step removes `e2e-*` environments that earlier runs left behind through the `SLACK_WEBHOOK_URL` secret.

Publishing a `v1.x.y` release moves the `v1` tag to it automatically (`.github/workflows/major-tag.yml`), unless `v1` already points at a newer release. To move it by hand, run that workflow with the release tag.

## License

[Apache-2.0](LICENSE)
