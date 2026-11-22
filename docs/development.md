# Development and testing

[Back to README](../README.md)

Run commands from the project root. Local development requires Python 3.11+; frontend tests require Node.js. The frontend has no build step and needs no npm installation.

## Local environment

Create an isolated environment from the project root:

```sh
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install ruff==0.17.6
```

Python 3.11 or later is supported; Python 3.13 matches the container runtime.
VS Code uses `.venv/bin/python` and discovers the unittest suite in `tests/`.
The MySQL driver is optional for local SQLite development. Install it with
`python -m pip install -r requirements-mysql.txt` only when needed.

Create a focused branch from an up-to-date main:

```sh
git switch main
git pull --ff-only
git switch -c feature/describe-the-change
```

Push the branch and open a pull request. The protected main branch accepts
changes through pull requests with passing checks. Keep personal workspace files
in the ignored `local/` directory. Never copy production inventory into a test
fixture or commit local environment files.

## Automated checks

```sh
python3 -m unittest discover -s tests -v
for file in static/*.js; do node --check "$file"; done
node --experimental-vm-modules --test tests/*.test.cjs
uvx ruff check .
uvx ruff format --check .
```

Test MySQL separately with `python3 tests/mysql_integration.py` after installing the MySQL driver and setting connection details in the environment. The test requires a new, empty database whose name starts with `filamentdb_test`. It checks the API, atomic print recording, and concurrent writes. Never use the production database.

Agents do not perform visual browser checks. The user performs visual verification manually; see the [agent guide](../AGENTS.md).

CI runs on GitHub-hosted runners for pushes and pull requests to `main`.
Checks are named `Python 3.11`, `Python 3.13`, `Python lint`, and `Frontend`.
The workflow has read-only repository access, no deployment step, and no
production secrets. Actions are pinned to full commit hashes; Dependabot proposes
weekly updates for Actions, Python dependencies, and the Docker base image.
The Ruff version is pinned in CI and should be updated there explicitly.
See [Contributing](../CONTRIBUTING.md) for the contribution workflow.

## Local files and secrets

Keep runtime environment files, inventory data, database dumps, backups,
certificates, and private keys out of Git. The repository ignores common file
patterns for these, along with virtual environments, caches, and agent state.
Only the sanitized `.env.example` and `.env.mysql.example` templates are included
in Git; do not put real credentials in them. Environment files are excluded from
the Docker build context, including these templates.

Use the ignored `local/` directory for other private host configuration, or keep
it outside the checkout. A local nginx override can be named `nginx.local.conf`.
The nginx configuration in [Deployment](deployment.md#nginx-reverse-proxy-example)
is a generic documentation example.

Ignore rules do not remove files already tracked by Git or erase historical
commits. Before committing, review `git diff --cached` and `git status --short`.
Do not force-add private files. Docker has separate ignore rules to prevent local
files from being sent to the builder; runtime configuration still comes from the
local environment files as described in [Deployment](deployment.md).

## Task tracking

Track TODOs, planned work, and follow-up tasks as GitHub issues in this repository. Do not create or maintain a `TODO.md` file.

## Documentation

Maintain README, guides, GitHub issues, plans, status files, and agent instructions in English. Use English documentation filenames and keep relative links and heading anchors current. Interface text belongs in language catalogs; documentation language does not determine interface language.

## See also

- [Local startup](getting-started.md)
- [Architecture](architecture.md)
- [Language files](localization.md)
