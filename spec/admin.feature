@core
Feature: Optional product administration
  # Acceptance: S_ADMIN_ACCESS status=implemented layers=http
  Scenario: Administrative access is independent of mobile access
    Given a product mounts its optional admin module
    When a customer token requests users or creates a manual grant
    Then the server denies the request without reading private data

  # Acceptance: S_ADMIN_GRANTS status=implemented layers=integration,http
  Scenario: Audited manual authorization overrides membership temporarily
    Given an existing customer has an active subscription
    When an administrator confirms the current and proposed membership with a reason
    Then an environment-bound manual grant records the operator and timestamps
    And the latest created active manual grant wins, with id as a stable tie breaker
    And expiration or audited revocation restores underlying membership
    And RevenueCat state and transactions are unchanged

  # Acceptance: S_ADMIN_ENVIRONMENT status=implemented layers=integration,http
  Scenario: The mount determines the management environment
    Given separate production and sandbox administration mounts
    When an operator submits a different environment confirmation
    Then the server rejects the write
    And grants from one environment never affect the other

  # Acceptance: S_ADMIN_UI status=implemented layers=http,browser
  Scenario: Operators inspect and manage membership
    Given an authenticated operator session
    When the operator searches for a known subject
    Then the page shows effective membership, quotas and grant audit history
    And grant and revocation forms are secondary pages with explicit confirmation
    And successful writes return to freshly loaded membership
    And missing users and permission failures have explicit states
    And no encrypted records, wrapped keys, tokens or usage item identifiers are shown

  # Acceptance: S_ADMIN_CATALOG status=implemented layers=http
  Scenario: Operators configure existing plans and quotas
    When an administrator saves a catalog using its current revision
    Then existing billing validation applies
    And a concurrent edit is rejected without overwriting it

  # Acceptance: S_ADMIN_CONCURRENCY status=implemented layers=integration,http
  Scenario: A reviewed membership can be changed by only one concurrent grant
    Given two operators review the same user and catalog
    When they submit grants concurrently
    Then only one grant is created and the other receives a conflict
    And catalog, identity, membership source, usage or time-boundary changes invalidate the preview

  # Acceptance: S_ADMIN_SESSION_RETENTION status=implemented layers=integration
  Scenario: Login activity bounds expired authentication state
    Given expired and active login attempts and sessions
    When login state is created or consumed
    Then a bounded oldest-first batch of expired rows is removed
    And active state remains usable

  # Acceptance: S_ADMIN_CLIENT_AUTH status=implemented layers=unit
  Scenario: Match the confidential client's registered token authentication method
    Given the provider registers client_secret_basic or client_secret_post
    When the administration callback exchanges its authorization code
    Then it uses exactly the configured authentication method
    And provider credentials remain on the server

  # Acceptance: S_ADMIN_D1_RUNTIME status=implemented layers=unit
  Scenario: Preserve writes when D1 counts audit triggers
    Given D1 includes revision trigger writes in statement change counts
    When membership usage, subscription state, catalog or manual grants change
    Then successful conditional writes are reported as successful
    And rejected conditional writes remain conflicts
    And preview boundaries fit the D1 compound query limit
