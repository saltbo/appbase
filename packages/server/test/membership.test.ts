import { describe, expect, it } from "vitest";

import {
  MembershipLimitError,
  MembershipService,
  type MembershipConfig,
  type MembershipGrant,
  type MembershipRepository,
} from "../src/index";

// Covers: S_ACCOUNT_MEMBERSHIP_FREE_LIMITS case=contract
// Covers: S_ACCOUNT_MEMBERSHIP_PLUS_LIMITS case=contract

const config: MembershipConfig = {
  freePlan: {
    id: "free",
    capabilities: {
      subtitle: { limit: 2, period: "utc_month" },
      media: { limit: 1, period: "lifetime" },
    },
  },
  plans: [
    {
      id: "plus",
      capabilities: {
        subtitle: { limit: null, period: "utc_month" },
        media: { limit: null, period: "lifetime" },
      },
    },
  ],
  now: () => new Date("2026-07-12T12:00:00.000Z"),
};

describe("AppBase membership", () => {
  it("counts unique free usage and rejects the next item", async () => {
    const service = new MembershipService(
      new MemoryMembershipRepository(),
      config,
    );

    await service.claimUnique("user-1", "subtitle", "file-1");
    await service.claimUnique("user-1", "subtitle", "file-1");
    await service.claimUnique("user-1", "subtitle", "file-2");

    await expect(
      service.claimUnique("user-1", "subtitle", "file-3"),
    ).rejects.toBeInstanceOf(MembershipLimitError);
    await expect(service.snapshot("user-1")).resolves.toMatchObject({
      planId: "free",
      capabilities: {
        subtitle: { limit: 2, used: 2, periodKey: "2026-07" },
      },
    });
  });

  it("does not limit an active paid grant", async () => {
    const repository = new MemoryMembershipRepository({
      planId: "plus",
      startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-08-01T00:00:00.000Z",
    });
    const service = new MembershipService(repository, config);

    for (let index = 0; index < 10; index += 1) {
      await service.claimUnique("user-1", "subtitle", `file-${index}`);
    }

    await expect(service.snapshot("user-1")).resolves.toMatchObject({
      planId: "plus",
      grantEndsAt: "2026-08-01T00:00:00.000Z",
      capabilities: { subtitle: { limit: null, used: 0 } },
    });
  });

  it("releases a newly reserved item after a failed operation", async () => {
    const service = new MembershipService(
      new MemoryMembershipRepository(),
      config,
    );

    const reserved = await service.claimUnique("user-1", "media", "movie-1");
    expect(reserved).toBe(true);
    await service.releaseUnique("user-1", "media", "movie-1");

    await expect(service.snapshot("user-1")).resolves.toMatchObject({
      capabilities: { media: { used: 0 } },
    });
  });
});

class MemoryMembershipRepository implements MembershipRepository {
  constructor(private readonly grant: MembershipGrant | null = null) {}
  private readonly usage = new Set<string>();

  activeGrant(): Promise<MembershipGrant | null> {
    return Promise.resolve(this.grant);
  }

  countUsage(
    ownerSub: string,
    capability: string,
    periodKey: string,
  ): Promise<number> {
    const prefix = `${ownerSub}:${capability}:${periodKey}:`;
    return Promise.resolve(
      [...this.usage].filter((value) => value.startsWith(prefix)).length,
    );
  }

  async claimUniqueUsage(input: {
    ownerSub: string;
    capability: string;
    periodKey: string;
    itemKey: string;
    limit: number;
  }): Promise<{ allowed: boolean; created: boolean; used: number }> {
    const key = `${input.ownerSub}:${input.capability}:${input.periodKey}:${input.itemKey}`;
    const used = await this.countUsage(
      input.ownerSub,
      input.capability,
      input.periodKey,
    );
    if (this.usage.has(key)) return { allowed: true, created: false, used };
    if (used >= input.limit) return { allowed: false, created: false, used };
    this.usage.add(key);
    return { allowed: true, created: true, used: used + 1 };
  }

  releaseUsage(
    ownerSub: string,
    capability: string,
    periodKey: string,
    itemKey: string,
  ): Promise<void> {
    this.usage.delete(`${ownerSub}:${capability}:${periodKey}:${itemKey}`);
    return Promise.resolve();
  }
}
