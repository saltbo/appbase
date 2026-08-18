# Changelog

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
