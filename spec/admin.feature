@core
Feature: Optional product administration
  # Acceptance: S_ADMIN_ACCESS status=planned layers=http
  Scenario: Administrative access is independent of mobile access
    Given a product mounts its optional admin module
    When a customer token requests users or creates a manual grant
    Then the server denies the request without reading private data

  # Acceptance: S_ADMIN_GRANTS status=planned layers=unit,integration,http
  Scenario: Audited manual authorization overrides membership temporarily
    Given an existing customer has an active subscription
    When an administrator confirms the current and proposed membership with a reason
    Then an environment-bound manual grant records the operator and timestamps
    And the latest created active manual grant wins, with id as a stable tie breaker
    And expiration or audited revocation restores underlying membership
    And RevenueCat state and transactions are unchanged

  # Acceptance: S_ADMIN_ENVIRONMENT status=planned layers=integration,http
  Scenario: The mount determines the management environment
    Given separate production and sandbox administration mounts
    When an operator submits a different environment confirmation
    Then the server rejects the write
    And grants from one environment never affect the other

  # Acceptance: S_ADMIN_UI status=planned layers=http,browser
  Scenario: Operators inspect and manage membership
    Given an authenticated operator session
    When the operator searches for a known subject
    Then the page shows effective membership, quotas and grant audit history
    And grant and revocation forms are secondary pages with explicit confirmation
    And successful writes return to freshly loaded membership
    And missing users and permission failures have explicit states
    And no encrypted records, wrapped keys, tokens or usage item identifiers are shown

  # Acceptance: S_ADMIN_CATALOG status=planned layers=http
  Scenario: Operators configure existing plans and quotas
    When an administrator saves a catalog using its current revision
    Then existing billing validation applies
    And a concurrent edit is rejected without overwriting it
