## 0.3.1

- Add explicit provider logout with callback validation and configurable authorization prompts. Keep local session cleanup separate.

## 0.3.0

Application account lifecycle integration, account-scoped persistence and explicit registration.

## 0.2.0

- Support application-scoped account deletion and local identity cleanup.

# Changelog

## 0.1.4

- Recover failed OIDC initialization, bound network phases without timing out browser interaction, and preserve serialized refresh and session invalidation.

## 0.1.3

- Upgrade to the first-party Darwin OIDC implementation so repeated RFC 8707
  resource indicators survive native authorization requests.

## 0.1.2

- Add one authorization-code grant shared by multiple RFC 8707 protected
  resources, with audience-specific access tokens and serialized refresh-token
  rotation.

## 0.1.1

- Add equal-jitter bounded retry scheduling with deterministic injection for
  product and test environments.

## 0.1.0

- Initial lifecycle/retry controller, secure installation ID, and OIDC adapter.
