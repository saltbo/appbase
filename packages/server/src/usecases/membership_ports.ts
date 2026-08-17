import type { MembershipGrant } from "../domain/membership.js";

export interface MembershipRepository {
  activeGrant(ownerSub: string, now: string): Promise<MembershipGrant | null>;
  countUsage(
    ownerSub: string,
    capability: string,
    periodKey: string,
  ): Promise<number>;
  claimUniqueUsage(input: {
    ownerSub: string;
    capability: string;
    periodKey: string;
    itemKey: string;
    limit: number;
    createdAt: string;
  }): Promise<{ allowed: boolean; created: boolean; used: number }>;
  releaseUsage(
    ownerSub: string,
    capability: string,
    periodKey: string,
    itemKey: string,
  ): Promise<void>;
}
