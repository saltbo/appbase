import {
  MembershipLimitError,
  type CapabilityDefinition,
  type MembershipPlan,
  type MembershipSnapshot,
} from "../domain/membership.js";
import type { MembershipRepository } from "./membership_ports.js";

export type MembershipConfig = {
  freePlan: MembershipPlan;
  plans: readonly MembershipPlan[];
  now?: () => Date;
};

export class MembershipService {
  private readonly plans: ReadonlyMap<string, MembershipPlan>;

  constructor(
    private readonly repository: MembershipRepository,
    private readonly config: MembershipConfig,
  ) {
    this.plans = new Map([
      [config.freePlan.id, config.freePlan],
      ...config.plans.map((plan) => [plan.id, plan] as const),
    ]);
  }

  async snapshot(ownerSub: string): Promise<MembershipSnapshot> {
    const now = this.now();
    const grant = await this.repository.activeGrant(
      ownerSub,
      now.toISOString(),
    );
    const plan =
      grant === null ? this.config.freePlan : this.requirePlan(grant.planId);
    const capabilities = Object.fromEntries(
      await Promise.all(
        Object.entries(plan.capabilities).map(async ([name, definition]) => {
          const periodKey = periodKeyFor(definition, now);
          const used = await this.repository.countUsage(
            ownerSub,
            name,
            periodKey,
          );
          return [name, { ...definition, used, periodKey }] as const;
        }),
      ),
    );
    return {
      planId: plan.id,
      grantEndsAt: grant?.endsAt ?? null,
      capabilities,
    };
  }

  async claimUnique(
    ownerSub: string,
    capability: string,
    itemKey: string,
  ): Promise<boolean> {
    const now = this.now();
    const plan = await this.planFor(ownerSub, now);
    const definition = requireCapability(plan, capability);
    if (definition.limit === null) return false;
    const periodKey = periodKeyFor(definition, now);
    const result = await this.repository.claimUniqueUsage({
      ownerSub,
      capability,
      periodKey,
      itemKey,
      limit: definition.limit,
      createdAt: now.toISOString(),
    });
    if (!result.allowed) {
      throw new MembershipLimitError(
        capability,
        definition.limit,
        result.used,
        periodKey,
      );
    }
    return result.created;
  }

  async releaseUnique(
    ownerSub: string,
    capability: string,
    itemKey: string,
  ): Promise<void> {
    const now = this.now();
    const plan = await this.planFor(ownerSub, now);
    const definition = requireCapability(plan, capability);
    if (definition.limit === null) return;
    await this.repository.releaseUsage(
      ownerSub,
      capability,
      periodKeyFor(definition, now),
      itemKey,
    );
  }

  async limit(ownerSub: string, capability: string): Promise<number | null> {
    return requireCapability(
      await this.planFor(ownerSub, this.now()),
      capability,
    ).limit;
  }

  private async planFor(ownerSub: string, now: Date): Promise<MembershipPlan> {
    const grant = await this.repository.activeGrant(
      ownerSub,
      now.toISOString(),
    );
    return grant === null
      ? this.config.freePlan
      : this.requirePlan(grant.planId);
  }

  private requirePlan(planId: string): MembershipPlan {
    const plan = this.plans.get(planId);
    if (plan === undefined)
      throw new Error(`Unknown membership plan: ${planId}`);
    return plan;
  }

  private now(): Date {
    return this.config.now?.() ?? new Date();
  }
}

function requireCapability(
  plan: MembershipPlan,
  name: string,
): CapabilityDefinition {
  const definition = plan.capabilities[name];
  if (definition === undefined)
    throw new Error(`Unknown membership capability: ${name}`);
  return definition;
}

function periodKeyFor(definition: CapabilityDefinition, now: Date): string {
  return definition.period === "utc_month"
    ? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
    : "lifetime";
}
