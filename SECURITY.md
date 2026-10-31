# Security Policy

## Supported versions

The latest release on `main` is supported. Older tags stay available for pinning
but do not receive security fixes.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

- Repository → **Security** → **Report a vulnerability**

Do not open a public issue for a vulnerability, and never paste API keys,
tokens, QQ numbers, group ids or full logs into an issue or pull request.

## Scope notes

- The platform core does not store credentials; adapters and plugins own their
  secret storage.
- Generation ids, delivery/invocation ledgers and effect records are
  coordination and observability data. They are not a sandbox and do not grant
  permissions.
- Capability manifests are declarations. An installed plugin runs in the host
  process; install only code you trust.
