import type { BillingEntitlement } from "../domain/billing.js";

export type AdminPaymentConfiguration = {
  providerId: string;
  providerName: string;
  dashboardUrl: string | null;
  webhookPath: string | null;
  settings: readonly { name: string; configured: boolean }[];
};

/** Provider adapters own display metadata and provider-specific access classification. */
export interface AdminPaymentProvider {
  configuration: AdminPaymentConfiguration;
  accessKind(
    entitlement: BillingEntitlement,
  ): "purchased" | "complimentary" | "unknown";
}

export interface AdminPaymentEvents {
  list(
    page: number,
    pageSize: number,
  ): Promise<{
    items: { id: string; processedAt: string }[];
    totalItems: number;
  }>;
}
