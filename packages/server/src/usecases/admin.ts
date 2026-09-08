import type { BillingService } from "./billing.js";
import type { MembershipService } from "./membership.js";
import type { MembershipRepository } from "./membership_ports.js";
import type { BillingState } from "../domain/billing.js";
import { billingGrant } from "../domain/billing.js";
import type {
  AdminPaymentProvider,
  AdminPaymentEvents,
} from "./admin_payments.js";

export type AdminEnvironment = "production" | "sandbox";
/** App-owned semantics, separate from remotely editable plan limits. */
export type AdminBenefitDefinition = {
  displayName: string;
  description: string;
  unit: string;
};
export type AdminBenefitRegistry = Readonly<
  Record<string, AdminBenefitDefinition>
>;
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
    readonly benefits: AdminBenefitRegistry = {},
    readonly paymentProvider?: AdminPaymentProvider,
    readonly paymentEvents?: AdminPaymentEvents,
  ) {
    const names = Object.keys(billing.schema.capabilities);
    if (
      Object.keys(benefits).length &&
      (Object.keys(benefits).length !== names.length ||
        names.some((name) => !benefits[name]))
    )
      throw new Error(
        "Admin benefit definitions must match the application's capabilities.",
      );
  }
  async events(page: number, pageSize: number) {
    if (!this.paymentEvents)
      throw new AdminError(404, "Payment event inspection is not configured.");
    const result = await this.paymentEvents.list(page, pageSize);
    return {
      ...result,
      page,
      pageSize,
      totalPages: Math.ceil(result.totalItems / pageSize),
    };
  }
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
    const snapshot = await this.membership.snapshot(user.ownerSub);
    const membership = snapshot;
    return {
      ...user,
      subscription:
        state === null
          ? null
          : { observedAt: state.observedAt, entitlements: state.entitlements },
      access: (state?.entitlements ?? []).map((entitlement) => ({
        entitlementId: entitlement.id,
        kind: this.paymentProvider?.accessKind(entitlement) ?? "unknown",
        status:
          entitlement.sandbox !== (this.environment === "sandbox")
            ? "other_environment"
            : entitlement.startsAt > now
              ? "scheduled"
              : entitlement.expiresAt === null || entitlement.expiresAt > now
                ? "active"
                : catalog.honorGracePeriod &&
                    entitlement.graceEndsAt !== null &&
                    entitlement.graceEndsAt > now
                  ? "grace_period"
                  : "expired",
      })),
      membership,
      source: providerGrant
        ? "subscription"
        : legacyGrant
          ? "legacy"
          : "default",
    };
  }
}
