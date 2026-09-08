import type {
  MembershipGrant,
  MembershipSnapshot,
} from "../domain/membership.js";
import type { BillingService } from "./billing.js";
import type { MembershipService } from "./membership.js";

export type AdminEnvironment = "production" | "sandbox";
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
  create(grant: ManualGrant): Promise<boolean>;
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
    readonly now: () => Date = () => new Date(),
  ) {}
  async user(query: string) {
    const user = await this.users.find(query);
    if (!user)
      throw new AdminError(
        404,
        "No known user matches this subject or payment identity.",
      );
    const state = await this.billing.repository.state(user.ownerSub);
    return {
      ...user,
      subscription:
        state === null
          ? null
          : { observedAt: state.observedAt, entitlements: state.entitlements },
      membership: await this.membership.snapshot(user.ownerSub),
      manualGrant: await this.grants.activeGrant(
        user.ownerSub,
        this.now().toISOString(),
      ),
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
    },
    operator: string,
  ) {
    const current = await this.user(input.ownerSub);
    if (
      JSON.stringify(current.membership) !==
      JSON.stringify(input.expectedMembership)
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
    if (!(await this.grants.create(grant)))
      throw new AdminError(
        409,
        "This grant identifier already exists. Reload the user to inspect the result.",
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
