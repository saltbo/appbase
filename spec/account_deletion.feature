Feature: Application account deletion
  Account deletion belongs to the application, independently of its identity provider.

  Scenario: Delete application data without deleting the identity provider account
    Given an authenticated application account with sync and billing data
    When the owner confirms account deletion
    Then application records, encryption keys, membership and billing identity are erased
    And the identity provider account is unchanged
    And another application account is unchanged

  Scenario: Concurrent requests cannot restore a deleted account
    Given a request or billing notification started before deletion
    When the account is deleted before the request persists its result
    Then the database rejects the stale write
    And refreshed identity provider tokens do not automatically recreate the account

  Scenario: Provider cleanup can be resumed
    Given account deletion has blocked application access
    And the billing provider cleanup failed
    When the owner retries deletion
    Then cleanup resumes using the original billing identity
    And deletion completes only after provider cleanup succeeds
