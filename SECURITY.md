# Security policy

## Supported versions

Security fixes target the latest public release. Older releases and the private
pre-publication version history are not maintained as separate security branches.
Before the first public release, fixes target `main`.

## Reporting a vulnerability

Use this repository's **Security → Report a vulnerability** feature to submit a
private vulnerability report. Do not disclose vulnerabilities or credentials in
public issues or pull requests. If private reporting is unavailable, contact
maintainer **@kthuno** through a private channel before sharing sensitive details.
Do not post exploit details publicly to request a private contact channel.

Include the affected version, a minimal reproduction using synthetic data,
expected and actual behavior, and the security impact. Do not include real API
keys, database passwords, inventory exports, or original private files.
Coordinate disclosure with the maintainer. No response-time guarantee is offered.

## Deployment boundary

Filament DB has no built-in login. Keep the application port bound to localhost
and provide HTTPS and access control through the existing reverse proxy before
allowing internet access. See [Deployment](docs/deployment.md). CI does not need
production credentials, private networks, or a production database.
