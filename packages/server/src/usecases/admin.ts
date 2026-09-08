import type { BillingService } from "./billing.js";
import type { MembershipService } from "./membership.js";
import type { MembershipRepository } from "./membership_ports.js";
import { billingGrant } from "../domain/billing.js";

export type AdminEnvironment = "production" | "sandbox";
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
