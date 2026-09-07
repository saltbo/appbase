import type { MembershipPlan, MembershipGrant } from "./membership.js";

export type BillingCatalog = {
  freePlan: MembershipPlan;
  plans: readonly MembershipPlan[];
  entitlementPlans: Readonly<Record<string, string>>;
  honorGracePeriod: boolean;
};
export type VersionedCatalog = { revision: number; catalog: BillingCatalog };
export type BillingEntitlement = {
  id: string;
  productId: string;
  store: string;
  sandbox: boolean;
  startsAt: string;
  expiresAt: string;
  graceEndsAt: string | null;
  willRenew: boolean;
};
export type BillingState = {
  observedAt: string;
  entitlements: readonly BillingEntitlement[];
  managementUrl: string | null;
};
export class BillingError extends Error {
  constructor(
    public readonly code:
      | "CONFIGURATION_MISSING"
      | "INVALID_CATALOG"
      | "PRECONDITION_FAILED"
      | "SYNC_SUPERSEDED"
      | "PROVIDER_UNAVAILABLE"
      | "INVALID_PROVIDER_RESPONSE",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function billingGrant(
  state: BillingState | null,
  catalog: BillingCatalog,
  now: string,
  sandbox: boolean,
): MembershipGrant | null {
  if (state === null) return null;
  // Plan order is the product's explicit priority when multiple entitlements exist.
  for (const plan of catalog.plans) {
    const grants = state.entitlements
      .filter(
        (e) =>
          e.sandbox === sandbox &&
          catalog.entitlementPlans[e.id] === plan.id &&
          e.startsAt <= now,
      )
      .map((e) => ({
        planId: plan.id,
        startsAt: e.startsAt,
        endsAt:
          catalog.honorGracePeriod &&
          e.graceEndsAt !== null &&
          e.graceEndsAt > e.expiresAt
            ? e.graceEndsAt
            : e.expiresAt,
      }))
      .filter((g) => g.endsAt > now)
      .sort((a, b) => b.endsAt.localeCompare(a.endsAt));
    if (grants[0]) return grants[0];
  }
  return null;
}

export function validateCatalog(
  catalog: BillingCatalog,
  baseline: BillingCatalog,
): void {
  const all = [catalog.freePlan, ...catalog.plans];
  const original = [baseline.freePlan, ...baseline.plans];
  const ids = all.map((p) => p.id);
  if (
    catalog.freePlan.id !== baseline.freePlan.id ||
    ids.length !== new Set(ids).size ||
    original.some((p) => !ids.includes(p.id)) ||
    ids.some((id) => !original.some((p) => p.id === id))
  ) {
    throw new BillingError(
      "INVALID_CATALOG",
      "Existing plan identities must be preserved.",
    );
  }
  for (const plan of all) {
    const capabilities = original.find((p) => p.id === plan.id)!.capabilities;
    if (
      Object.keys(plan.capabilities).length !==
        Object.keys(capabilities).length ||
      Object.entries(plan.capabilities).some(
        ([key, value]) =>
          capabilities[key]?.period !== value.period ||
          (value.limit !== null &&
            (!Number.isSafeInteger(value.limit) || value.limit < 0)),
      )
    ) {
      throw new BillingError(
        "INVALID_CATALOG",
        "Capability names and accounting periods must be preserved; limits must be nonnegative integers or null.",
      );
    }
  }
  if (
    Object.values(catalog.entitlementPlans).some(
      (id) => !catalog.plans.some((p) => p.id === id),
    )
  ) {
    throw new BillingError(
      "INVALID_CATALOG",
      "Entitlements must reference a paid plan.",
    );
  }
}
