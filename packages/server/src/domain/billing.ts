import type { MembershipPlan, MembershipGrant } from "./membership.js";

export type BenefitSchema = {
  type: "quota";
  displayName: string;
  description: string;
  unit: string;
  period: "lifetime" | "utc_month";
};
export type BillingSchema = {
  capabilities: Readonly<Record<string, BenefitSchema>>;
};

export type BillingEnvironment = "production" | "sandbox";

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
  expiresAt: string | null;
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
          e.expiresAt !== null &&
          e.graceEndsAt > e.expiresAt
            ? e.graceEndsAt
            : e.expiresAt,
      }))
      .filter((g) => g.endsAt === null || g.endsAt > now)
      .sort((a, b) =>
        a.endsAt === null
          ? b.endsAt === null
            ? 0
            : -1
          : b.endsAt === null
            ? 1
            : b.endsAt.localeCompare(a.endsAt),
      );
    if (grants[0]) return grants[0];
  }
  return null;
}

export function validateCatalog(
  catalog: BillingCatalog,
  baseline: BillingCatalog | null,
  schema?: BillingSchema,
): void {
  const all = [catalog.freePlan, ...catalog.plans];
  const original = baseline ? [baseline.freePlan, ...baseline.plans] : [];
  const ids = all.map((p) => p.id);
  if (
    (baseline !== null && catalog.freePlan.id !== baseline.freePlan.id) ||
    ids.length !== new Set(ids).size ||
    (!schema && original.some((p) => !ids.includes(p.id)))
  ) {
    throw new BillingError(
      "INVALID_CATALOG",
      "Existing plan identities must be preserved.",
    );
  }
  for (const plan of all) {
    const capabilities =
      schema?.capabilities ??
      (original.find((p) => p.id === plan.id) ?? baseline!.freePlan)
        .capabilities;
    if (
      plan.displayName !== undefined &&
      (!plan.displayName.trim() || plan.displayName.length > 100)
    ) {
      throw new BillingError(
        "INVALID_CATALOG",
        "Plan display names must contain 1 to 100 characters.",
      );
    }
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
    Object.keys(baseline?.entitlementPlans ?? {}).some(
      (id) => !(id in catalog.entitlementPlans),
    ) ||
    Object.values(catalog.entitlementPlans).some(
      (id) => !catalog.plans.some((p) => p.id === id),
    )
  ) {
    throw new BillingError(
      "INVALID_CATALOG",
      "Historical entitlements must be retained and reference a paid plan.",
    );
  }
}
