import type { MembershipRepository } from "./membership_ports.js";
import type { AdminGrantRepository } from "./admin.js";

/** Wrap the complete billing/legacy chain so manual grants are explicit overrides. */
export class AdminMembershipRepository implements MembershipRepository {
  constructor(
    private readonly underlying: MembershipRepository,
    private readonly manual: AdminGrantRepository,
  ) {}
  async activeGrant(ownerSub: string, now: string) {
    return (
      (await this.manual.activeGrant(ownerSub, now)) ??
      (await this.underlying.activeGrant(ownerSub, now))
    );
  }
  countUsage: MembershipRepository["countUsage"] = (...args) =>
    this.underlying.countUsage(...args);
  claimUniqueUsage: MembershipRepository["claimUniqueUsage"] = (...args) =>
    this.underlying.claimUniqueUsage(...args);
  releaseUsage: MembershipRepository["releaseUsage"] = (...args) =>
    this.underlying.releaseUsage(...args);
}
