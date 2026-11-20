# Contributing to Hyperglass

Hyperglass is maintained by the community. Contributions must preserve deployment compatibility for the Python package, CLI and configuration interfaces.

## Before opening a pull request

- Read the relevant documentation and tests before changing behaviour.
- Explain the user-visible problem and the approach taken to solve it.
- Add or update tests for behaviour that can be tested automatically.
- Update the documentation when configuration, installation, or user-visible behaviour changes.
- Remove credentials, tokens, private keys, and private network details from examples and issue reports.
- Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue or pull request.

## Pull request scope

Small, focused pull requests are easier to review, revert and bisect.

- Keep each pull request to one concern. Open separate pull requests for unrelated fixes, features, or toolchain changes.
- Put generated fixtures and other generated files in their own commit, separate from the change that needs them.
- Release pull requests change only the version and the changelog. Merge runtime changes in their own pull requests first.
- Tag a release on the release pull request's merge commit on `main`, after the `main` run for that commit has published its `sha-<commit>` image. The tag run promotes that image instead of building a new one. It fails for a commit that `main` did not publish, or when the tag differs from the version that commit declares (`python3 version.py <version>` sets it).
- When you carry work over from another pull request, keep the original author on those commits or add a `Co-authored-by:` trailer.
- Every pull request to `main` needs an approving review from someone other than its author.

## Development standards

- Format Python with Black and keep imports ordered with isort.
- Keep Ruff and the frontend lint, formatting, type, and test checks clean.
- Keep text visible to administrators and users configurable unless there is a clear reason not to.
- Keep the UI usable on desktop and mobile and preserve accessible labels and controls.
- Include IPv6 handling when adding or changing network device support.
- Keep device queries non-blocking and avoid introducing work on the event loop that can wait on a network device.
- Keep public documentation factual and include the exact commands needed to reproduce an installation or bug.

## Local checks

Python dependencies are locked in `uv.lock`. Install them, including the development group and the UI extra, with [uv](https://docs.astral.sh/uv/):

```shell
uv sync --extra ui
```

After changing dependencies in `pyproject.toml`, run `uv lock` and commit `uv.lock` with the change; CI installs with `--locked` and fails if the two disagree.

The backend tests use an isolated in-memory Redis fixture, `fakeredis[lua]`, from the development group:

```shell
uv run pytest hyperglass --ignore hyperglass/plugins/external
```

The UI checks run from `hyperglass/ui`:

```shell
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
```

The UI tests read `hyperglass/ui/__tests__/fixtures/config.json`, generated from the configuration in `.tests/ui-fixture/`. After a change to the UI parameters, their defaults or the frontend `Config` type, regenerate it from the repository root and commit the result. CI fails when the committed file is out of date.

```shell
python .tests/ui-fixture/generate.py
```

The internal Python package and CLI remain named `hyperglass`. Do not rename imports, environment variables, configuration paths, service names, or CLI commands as part of a documentation or public-brand change unless the change explicitly includes a migration plan.
