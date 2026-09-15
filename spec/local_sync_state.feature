Feature: Installation synchronization state
  Local synchronization state is separate from server application accounts and devices.

  Scenario: Upgrade an existing installation without restarting synchronization
    Given local synchronization state uses the legacy accounts table name
    And the installation has a saved checkpoint and queued offline changes
    When the current persistence schema is initialized
    Then the table is renamed to appbase_sync_state
    And the checkpoint, initial seed status and offline changes are preserved
    And repeating initialization does not change that state

  Scenario: Reject ambiguous migration input
    Given both the legacy and current synchronization state tables exist
    When the current persistence schema is initialized
    Then initialization reports the conflict without deleting either table
