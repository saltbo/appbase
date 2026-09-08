@core
Feature: Optional product administration
  # Acceptance: S_ADMIN_ACCESS status=implemented layers=http
  Scenario: Administrative access is independent of mobile access
    Given a product mounts its optional admin module
    When a customer token requests users or changes a catalog
    Then the server denies the request without reading private data

  # Acceptance: S_ADMIN_PROVIDER_OWNERSHIP status=implemented layers=http
  Scenario: RevenueCat owns complimentary access
    When an operator inspects a customer
    Then administration shows the payment identity and synchronized membership
    And local manual grant and revocation APIs are unavailable
    And complimentary access is managed in RevenueCat

  # Acceptance: S_ADMIN_ENVIRONMENT status=implemented layers=integration,http
  Scenario: The mount determines the management environment
    Given separate production and sandbox administration mounts
    When an operator submits a different environment confirmation
    Then the server rejects the write
    And membership from one environment never affects the other

  # Acceptance: S_ADMIN_UI status=implemented layers=http,browser
  Scenario: Operators inspect and manage membership
    Given an authenticated operator session
    When the operator searches for a known subject
    Then the page shows effective membership, quotas and payment identity
    And successful writes return to freshly loaded membership
    And missing users and permission failures have explicit states
    And no encrypted records, wrapped keys, tokens or usage item identifiers are shown

  # Acceptance: S_ADMIN_CATALOG status=implemented layers=http
  Scenario: Operators configure existing plans and quotas
    When an administrator saves a catalog using its current revision
    Then existing billing validation applies
    And a concurrent edit is rejected without overwriting it

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
    When membership usage, subscription state, or catalog changes
    Then successful conditional writes are reported as successful
    And rejected conditional writes remain conflicts

  # Acceptance: S_ADMIN_CUSTOMERS status=implemented layers=http,integration,browser
  Scenario: Browse payment customers without exposing private records
    Given payment accounts exist in both environments
    When an operator opens administration
    Then a bounded searchable customer list shows membership and last synchronization
    And pagination is ordered by the unique login subject
    And selecting a customer opens membership details
    And encrypted payloads and authentication tokens are never listed

  # Acceptance: S_ADMIN_SINGLE_PAGE status=implemented layers=browser,http
  Scenario: Switch API environments within one page
    Given one administration page and login callback
    When an operator switches production and sandbox
    Then the page URL remains unchanged
    And requests use the selected environment API path
    And old responses cannot replace the new environment view
    And write requests retain the environment in which their form was opened
