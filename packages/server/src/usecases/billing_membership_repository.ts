import { billingGrant, type BillingCatalog } from "../domain/billing.js";
import type { MembershipRepository } from "./membership_ports.js";
import type { BillingRepository } from "./billing.js";

export class BillingMembershipRepository implements MembershipRepository {
  constructor(
    private readonly membership: MembershipRepository,
    private readonly billing: BillingRepository,
    private readonly catalog: () => Promise<BillingCatalog>,
    private readonly sandbox: boolean,
  ) {}
  async activeGrant(ownerSub: string, now: string) {
    const grant = billingGrant(
      await this.billing.state(ownerSub),
      await this.catalog(),
      now,
      this.sandbox,
    );
    return grant ?? (await this.membership.activeGrant(ownerSub, now));
  }
  countUsage: MembershipRepository["countUsage"] = (...args) =>
    this.membership.countUsage(...args);
  claimUniqueUsage: MembershipRepository["claimUniqueUsage"] = (...args) =>
    this.membership.claimUniqueUsage(...args);
  releaseUsage: MembershipRepository["releaseUsage"] = (...args) =>
    this.membership.releaseUsage(...args);
}
