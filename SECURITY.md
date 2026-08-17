# Security policy

Do not open public issues containing tokens, user payloads, database exports,
wrapping keys, or identity-provider configuration. Report vulnerabilities
privately through GitHub Security Advisories for this repository.

Supported releases are listed in `docs/compatibility.md`. Rotate a potentially
exposed master key immediately, retain the previous version until payload
rotation is verified, and revoke affected OIDC credentials at the issuer.
