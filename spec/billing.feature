Feature: Optional billing and remote membership
  Scenario: Add a remotely configured paid tier
    Given existing plans and accounting periods have issued grants and usage
    When an operator adds a named tier using supported capabilities
    Then clients receive additive displayName and isPaid fields
    And historical plans, entitlement mappings and periods cannot be removed

  # Acceptance: S_BILLING_ENVIRONMENTS status=implemented layers=unit
  Scenario: Isolate payment contexts in one database
    Given ordinary paths select production and sandbox paths select sandbox
    Then catalogs, payment identities, snapshots, grants, usage and event deduplication are isolated
    And the authenticated subject, sync records, devices, cursors and encryption keys remain shared
    And verified provider purchases must match the selected context
    And independently authenticated webhooks reconcile known identities in both contexts
    And all legacy rows and payment identities migrate unchanged into production
