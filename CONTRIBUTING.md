# Contributing to Filament DB

Thank you for contributing. Open an issue to discuss substantial changes before
implementing them. Track planned work in GitHub issues, not a TODO.md file.

## Pull requests

Fork the repository, create a focused branch, and open a pull request against
`main`. Maintainers also normally use pull requests. Only invited maintainers
have write access; opening a pull request does not grant permission to merge it.
A maintainer reviews external contributions and merges accepted changes after
required checks pass. Keep unrelated changes in separate pull requests.

Describe the problem, resulting behavior, and checks performed. Link the related
issue when one exists. Include migration and infrastructure requirements when
relevant. Maintainers use squash merging.

## Development

Read [AGENTS.md](AGENTS.md) and the [development guide](docs/development.md).
Use Python 3.11 or later and Node.js 24 for the frontend checks. No frontend
package installation or build step is needed. Run the documented tests, syntax
checks, and Ruff checks before submitting changes. CI tests Python 3.11, 3.13, and 3.15, and builds and smoke-tests the Docker image.
MySQL integration tests are separate and require a disposable test database.

Preserve existing inventory and history. Test with temporary databases, never
production data. Keep credentials, personal inventory, uploaded files, and host
configuration out of commits, issues, logs, and screenshots. Use sanitized
examples. Documentation and issue descriptions are in English; interface strings
belong in the language catalogs, including the Danish default catalog.

## License and attribution

By submitting a contribution, you agree that it may be distributed under the
project's [AGPL-3.0-only license](LICENSE). Only submit material you have the
right to contribute, and preserve third-party copyright and license notices.
This does not transfer your copyright to the maintainer.
