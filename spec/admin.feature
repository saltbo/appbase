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

  # Acceptance: S_ADMIN_PLAN_LIST status=implemented layers=browser
  Scenario: Browse plans before editing one plan
    Given an operator opens plans in the selected environment
    Then a list shows the configured free and paid plans
    And no edit form appears in the list
    When the operator edits one plan
    Then only that plan's name and quotas can change
    And subscription mapping has a separate configuration form
    And switching environment returns to that environment's plan list

  # Acceptance: S_ADMIN_SESSION_REFRESH status=implemented layers=http,browser
  Scenario: Browser authentication uses the identity provider directly
    Given the host configures a public browser client with PKCE
    When an operator signs in through the identity provider
    Then the browser validates the callback state and identity token
    And protected API requests send the provider access token
    And the server verifies issuer, audience, expiry and environment permissions
    And the browser renews expired access using the provider refresh token
    And concurrent tabs cannot redeem a rotating refresh token simultaneously
    And logout discards browser credentials without an AppBase session row
    And failed refresh requires sign-in without leaking credentials

  # Acceptance: S_ADMIN_PAYMENT_WORKSPACE status=implemented layers=http,browser
  Scenario: Inspect payment data and provider configuration
    When an operator opens administration in an authorized environment
    Then customer subscription status distinguishes purchased and complimentary access
    And provider identities and processed notifications are inspectable
    And configuration shows provider setup without disclosing credentials
    And provider-specific management actions are identified as external

  # Acceptance: S_ADMIN_BENEFIT_BOUNDARIES status=implemented layers=http,browser
  Scenario: Distinguish cloud quotas from local unlock policy
    Given the application defines the execution boundary and units of its benefits
    When an operator inspects or edits a plan
    Then cloud quotas and local unlock policies appear in separate groups
    And local usage is not presented as a server-measured zero
    And remote changes to existing local policy do not require a client release
    And the administrator cannot reclassify enforcement or invent an unimplemented benefit

  # Acceptance: S_ADMIN_PLAN_CREATE status=implemented layers=browser
  Scenario: Configure a new plan for existing capabilities without a native release
    When an administrator creates a plan from an existing plan template
    Then its new identity and limits are saved using the catalog revision
    And existing plans and benefit execution definitions remain unchanged
    And the administrator can map a new provider entitlement to that plan
    And duplicate identities and stale writes are rejected
