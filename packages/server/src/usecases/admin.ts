import type { BillingService } from "./billing.js";
import type { MembershipService } from "./membership.js";
import type { MembershipRepository } from "./membership_ports.js";
import type { BillingState } from "../domain/billing.js";
import { billingGrant } from "../domain/billing.js";

export type AdminEnvironment = "production" | "sandbox";
export interface AdminUserDirectory {
  list(input: {
    page: number;
    pageSize: number;
    query: string;
    now: string;
  }): Promise<{
    items: {
      ownerSub: string;
      appUserId: string;
      state: BillingState | null;
      legacyPlanId: string | null;
    }[];
    totalItems: number;
  }>;
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
/** Administration observes membership; RevenueCat owns complimentary grants. */
export class AdminService {
  constructor(
    readonly environment: AdminEnvironment,
    readonly users: AdminUserDirectory,
    readonly membership: MembershipService,
    readonly billing: BillingService,
    readonly underlying: MembershipRepository,
    readonly now: () => Date = () => new Date(),
  ) {}
  async customers(input: { page: number; pageSize: number; query: string }) {
    const now = this.now().toISOString();
    const result = await this.users.list({ ...input, now });
    const catalog = (await this.billing.catalog()).catalog;
    return {
      items: result.items.map(
        ({ ownerSub, appUserId, state, legacyPlanId }) => {
          const grant = billingGrant(
            state,
            catalog,
            now,
            this.environment === "sandbox",
          );
          const planId = grant?.planId ?? legacyPlanId ?? catalog.freePlan.id;
          const plan = [catalog.freePlan, ...catalog.plans].find(
            (p) => p.id === planId,
          );
          if (!plan) throw new Error(`Unknown membership plan: ${planId}`);
          return {
            ownerSub,
            appUserId,
            planId,
            planName: plan.displayName ?? planId,
            isPaid: planId !== catalog.freePlan.id,
            synchronizedAt: state?.observedAt ?? null,
          };
        },
      ),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / input.pageSize),
      },
    };
  }
  async user(query: string) {
    const user = await this.users.find(query);
    if (!user)
      throw new AdminError(
        404,
        "No known user matches this subject or payment identity.",
      );
    const now = this.now().toISOString();
    const state = await this.billing.repository.state(user.ownerSub);
    const catalog = (await this.billing.catalog()).catalog;
    const providerGrant = billingGrant(
      state,
      catalog,
      now,
      this.environment === "sandbox",
    );
    const legacyGrant =
      providerGrant === null
        ? await this.underlying.activeGrant(user.ownerSub, now)
        : null;
    return {
      ...user,
      subscription:
        state === null
          ? null
          : { observedAt: state.observedAt, entitlements: state.entitlements },
      membership: await this.membership.snapshot(user.ownerSub),
      source: providerGrant
        ? "subscription"
        : legacyGrant
          ? "legacy"
          : "default",
    };
  }
}
