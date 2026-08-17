# Contributing

Changes must preserve the dependency boundaries in `AGENTS.md`. Wire changes
start in `protocol/openapi.yaml` and `protocol/semantics.md`, include contract
fixtures, and update `docs/compatibility.md`. Run `./scripts/verify.sh` before
opening a pull request. Security reports belong in the private channel described
by `SECURITY.md`, not a public issue.
