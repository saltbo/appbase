import type {
  MembershipGrant,
  MembershipSnapshot,
} from "../domain/membership.js";
import type { BillingService } from "./billing.js";
import type { MembershipService } from "./membership.js";
import type { MembershipRepository } from "./membership_ports.js";
import { billingGrant, type BillingCatalog } from "../domain/billing.js";

export type AdminEnvironment = "production" | "sandbox";
export type AdminRevision = {
  user: number;
  catalog: number;
  validUntil: number;
};
export type ManualGrant = MembershipGrant & {
  id: string;
  environment: AdminEnvironment;
  ownerSub: string;
  source: "manual";
  endsAt: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  previousPlanId: string;
  catalogRevision: number;
  revocation: { reason: string; createdBy: string; createdAt: string } | null;
};
export interface AdminGrantRepository {
  readonly environment: AdminEnvironment;
  activeGrant(ownerSub: string, now: string): Promise<ManualGrant | null>;
  list(ownerSub: string, before?: string): Promise<ManualGrant[]>;
  get(id: string): Promise<ManualGrant | null>;
  revision(ownerSub: string, now: string): Promise<AdminRevision>;
  create(grant: ManualGrant, expected: AdminRevision): Promise<boolean>;
  revoke(
    id: string,
    revocation: NonNullable<ManualGrant["revocation"]>,
  ): Promise<boolean>;
}
// Identity lookup is deliberately separate from sync payload access and billing writes.
export interface AdminUserDirectory {
  find(query: string): Promise<{ ownerSub: string; appUserId?: string } | null>;
}
export class AdminError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}
export class AdminService {
  constructor(
    readonly grants: AdminGrantRepository,
    readonly users: AdminUserDirectory,
    readonly membership: MembershipService,
    readonly billing: BillingService,
    readonly underlying: MembershipRepository,
    readonly now: () => Date = () => new Date(),
  ) {}
  async user(query: string) {
    const user = await this.users.find(query);
    if (!user)
      throw new AdminError(
        404,
        "No known user matches this subject or payment identity.",
      );
    const now = this.now().toISOString();
    const expectedRevision = await this.grants.revision(user.ownerSub, now);
    const confirmedUser = await this.users.find(query);
    if (
      confirmedUser?.ownerSub !== user.ownerSub ||
      confirmedUser.appUserId !== user.appUserId
    )
      throw new AdminError(
        409,
        "The user identity changed. Reload the preview.",
      );
    const state = await this.billing.repository.state(user.ownerSub);
    const manualGrant = await this.grants.activeGrant(user.ownerSub, now);
    const catalog = (await this.billing.catalog()).catalog;
    const subscriptionGrant = billingGrant(
      state,
      catalog,
      now,
      this.grants.environment === "sandbox",
    );
    const legacyGrant =
      manualGrant === null && subscriptionGrant === null
        ? await this.underlying.activeGrant(user.ownerSub, now)
        : null;
    const membership = await this.membership.snapshot(user.ownerSub);
    const fingerprint = await catalogFingerprint(catalog);
    const after = await this.grants.revision(user.ownerSub, now);
    if (!sameRevision(expectedRevision, after))
      throw new AdminError(
        409,
        "Membership changed while loading. Reload the preview.",
      );
    return {
      ...user,
      expectedRevision: {
        ...expectedRevision,
        catalogFingerprint: fingerprint,
      },
      subscription:
        state === null
          ? null
          : { observedAt: state.observedAt, entitlements: state.entitlements },
      membership,
      source: manualGrant
        ? "manual"
        : subscriptionGrant
          ? "subscription"
          : legacyGrant
            ? "legacy"
            : "default",
      manualGrant,
    };
  }
  async create(
    input: {
      id: string;
      ownerSub: string;
      planId: string;
      endsAt: string;
      reason: string;
      expectedMembership: MembershipSnapshot;
      expectedCatalogRevision: number;
      expectedRevision: AdminRevision & { catalogFingerprint: string };
    },
    operator: string,
  ) {
    const current = await this.user(input.ownerSub);
    if (
      !sameRevision(current.expectedRevision, input.expectedRevision) ||
      current.expectedRevision.catalogFingerprint !==
        input.expectedRevision.catalogFingerprint
    )
      throw new AdminError(
        409,
        "The reviewed user or catalog changed. Reload the preview.",
      );
    if (
      snapshotKey(current.membership) !== snapshotKey(input.expectedMembership)
    )
      throw new AdminError(
        409,
        "Membership changed. Review the current membership before granting again.",
      );
    const { catalog, revision } = await this.billing.catalog();
    if (revision !== input.expectedCatalogRevision)
      throw new AdminError(
        409,
        "The catalog changed. Review the proposed plan again.",
      );
    if (
      ![catalog.freePlan, ...catalog.plans].some((p) => p.id === input.planId)
    )
      throw new AdminError(422, "Choose an existing plan.");
    const now = this.now().toISOString();
    if (input.endsAt <= now)
      throw new AdminError(422, "The grant must expire in the future.");
    const grant: ManualGrant = {
      id: input.id,
      environment: this.grants.environment,
      ownerSub: current.ownerSub,
      planId: input.planId,
      source: "manual",
      startsAt: now,
      endsAt: input.endsAt,
      reason: input.reason,
      createdBy: operator,
      createdAt: now,
      previousPlanId: current.membership.planId,
      catalogRevision: revision,
      revocation: null,
    };
    if (
      !(await this.grants.create(grant, {
        ...current.expectedRevision,
        validUntil: Math.min(
          input.expectedRevision.validUntil,
          current.expectedRevision.validUntil,
          Math.floor(Date.parse(grant.endsAt) / 1000),
        ),
      }))
    )
      throw new AdminError(
        409,
        "The preview expired or changed, or this grant already exists. Reload before granting again.",
      );
    return grant;
  }
  async revoke(id: string, reason: string, operator: string) {
    if (!(await this.grants.get(id)))
      throw new AdminError(404, "Manual grant not found.");
    if (
      !(await this.grants.revoke(id, {
        reason,
        createdBy: operator,
        createdAt: this.now().toISOString(),
      }))
    )
      throw new AdminError(
        409,
        "The grant was already revoked. Reload its audit history.",
      );
    return this.grants.get(id);
  }
}

function sameRevision(a: AdminRevision, b: AdminRevision) {
  return a.user === b.user && a.catalog === b.catalog;
}

async function catalogFingerprint(catalog: BillingCatalog): Promise<string> {
  const plans = [catalog.freePlan, ...catalog.plans].map((p) => [
    p.id,
    p.displayName ?? p.id,
    Object.keys(p.capabilities)
      .sort()
      .map((k) => [k, p.capabilities[k]!.limit, p.capabilities[k]!.period]),
  ]);
  const value = JSON.stringify([
    plans,
    Object.keys(catalog.entitlementPlans)
      .sort()
      .map((k) => [k, catalog.entitlementPlans[k]]),
    catalog.honorGracePeriod,
  ]);
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

function snapshotKey(m: MembershipSnapshot): string {
  return JSON.stringify([
    m.planId,
    m.displayName,
    m.isPaid,
    m.grantEndsAt,
    Object.entries(m.capabilities)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => [key, v.limit, v.period, v.periodKey, v.used]),
  ]);
}
