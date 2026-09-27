Feature: Application account lifecycle
  An application account is independent of its identity provider identity.

  Scenario: Explicit registration creates an application account
    Given an authenticated identity without an active application account
    When the owner confirms registration
    Then a new application account and device session are created
    And ordinary resource requests never register an account

  Scenario: Deletion is accepted before provider cleanup finishes
    Given an active application account on two devices
    When the owner requests deletion
    Then the account enters deleting state and both device sessions are revoked
    And synchronized data and encryption keys are hard deleted
    And the server retries failed provider cleanup without requiring a client
    And registration is blocked until cleanup finishes

  Scenario: Register an empty replacement account
    Given deletion has completed for an identity
    When the identity confirms registration again
    Then the replacement has a different application account ID and billing customer ID
    And the old devices cannot read or write the replacement
    And the identity provider and other accounts remain unchanged

  Scenario: Upgrade existing account data
    Given records and encrypted data predate application accounts
    When the lifecycle migration runs
    Then their storage owner IDs and encryption contexts remain unchanged
    And existing active accounts remain usable during client migration
    And old identity tokens never resolve to a replacement account

  Scenario: Standard UUID account identifiers preserve existing clients
    Given an existing prefixed application account with encrypted records and payment identities
    When the UUID migration runs
    Then its account and all storage owner references use the same standard UUID
    And its historical encryption context remains readable
    And existing device sessions and account bindings still address that account
    And new registrations use standard UUID v4 identifiers
    And deletion and re-registration never redirect an old binding to a replacement
