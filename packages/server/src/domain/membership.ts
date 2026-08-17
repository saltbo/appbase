export type CapabilityDefinition = {
  limit: number | null;
  period: "lifetime" | "utc_month";
};

export type MembershipPlan = {
  id: string;
  capabilities: Readonly<Record<string, CapabilityDefinition>>;
};

export type MembershipGrant = {
  planId: string;
  startsAt: string;
  endsAt: string | null;
};

export type CapabilitySnapshot = CapabilityDefinition & {
  used: number;
  periodKey: string;
};

export type MembershipSnapshot = {
  planId: string;
  grantEndsAt: string | null;
  capabilities: Readonly<Record<string, CapabilitySnapshot>>;
};

export class MembershipLimitError extends Error {
  constructor(
    readonly capability: string,
    readonly limit: number,
    readonly used: number,
    readonly periodKey: string,
  ) {
    super(`The ${capability} membership limit has been reached.`);
    this.name = "MembershipLimitError";
  }
}
