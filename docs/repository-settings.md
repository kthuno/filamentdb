# GitHub repository settings

[Back to README](../README.md)

These settings describe the public repository's contribution policy. Repository
files alone do not enforce GitHub permissions or enable security features; apply
these settings in GitHub after creating the repository.

## Access and pull requests

Use `main` as the default branch. Keep @kthuno as the sole administrator initially.
External contributors fork the repository and submit pull requests; they receive
no write access. Invite trusted maintainers with write access only when needed.
The CODEOWNERS file assigns @kthuno as the default reviewer.

Enable squash merging only, and automatically delete merged pull request
branches. Issues are enabled; use the supplied bug and feature templates.

## Main branch ruleset

Create an active branch ruleset targeting `main`:

- Require a pull request before merging.
- Initially require zero approving reviews so the sole maintainer can merge
  their own pull requests. The maintainer manually reviews external changes.
- Require all conversations to be resolved.
- Block force pushes and branch deletion.
- Require linear history.
- Require these status checks after CI has run once: `Python 3.11`, `Python 3.13`,
  `Python 3.15`, `Python lint`, `Frontend`, and `Docker build and smoke`. Select
  GitHub Actions as their expected source.
- Require branches to be up to date before merging.
- Leave the bypass list empty for normal operation.

Once another reviewer is available, require one approving review, dismiss stale
approvals after new commits, and require a code owner review. Review this policy
before enabling it: a pull request author cannot approve their own pull request.
Administrators can change repository rules; these settings do not remove that
administrative authority.

## Release tags

Create an active tag ruleset targeting `v*` that restricts tag creation, updates,
and deletion. Allow only the repository administrator role to bypass this
ruleset for release management. Do not grant ordinary contributors or automation
permission to replace release tags. Publish `v1.0.0` only after CI is green.

## Actions and security

Use GitHub-hosted runners. Set the default workflow token to read-only and disable
Actions creating or approving pull requests. Require approval for workflow runs
from all external contributors before running their code. Allow the official
Actions used by CI; their versions are pinned to full commit hashes.

Do not add production secrets, a production Docker context, or self-hosted runners.
CI uses temporary SQLite databases. The MySQL integration suite remains a separate
check against a disposable database.

Enable private vulnerability reporting before publication so SECURITY.md has a
working reporting channel. Enable secret scanning, push protection, Dependabot
alerts, and Dependabot security updates. The checked-in Dependabot configuration
also requests weekly version updates. Review and merge these through pull requests.

## Starting the public history

Keep the existing repository private. Copy only the reviewed source and public
project files into a separate checkout; exclude the old `.git` directory, local
environment files, inventory, uploads, backups, caches, and agent state. Review
any files already present in the destination before copying or committing.

Set VERSION to `1.0.0` only in the new checkout. Use the owner's verified GitHub
noreply email for the initial commit. Run the full checks and a secret scan of
the actual staged files before pushing the single initial commit. Do not run the
deployment script to prepare a release: it increments VERSION and deploys.

Create the first commit before enforcing required status checks, then enable the
rules after the initial CI run. Keep the repository private during preparation;
if the account plan does not enforce rules for private repositories, activate and
verify them immediately when making the repository public. Create the protected
`v1.0.0` tag on the tested commit and publish a GitHub release. This does not deploy
the application or change the current production database or Docker volume.

## References

- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Actions security](https://docs.github.com/en/actions/reference/security/secure-use)
- [Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository)
