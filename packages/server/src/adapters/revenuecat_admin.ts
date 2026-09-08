import type { AdminPaymentProvider } from "../usecases/admin_payments.js";

export function revenueCatAdministration(input: {
  apiKeyConfigured: boolean;
  webhookAuthorizationConfigured: boolean;
  iosSdkConfigured: boolean;
  androidSdkConfigured: boolean;
}): AdminPaymentProvider {
  return {
    configuration: {
      providerId: "revenuecat",
      providerName: "RevenueCat",
      dashboardUrl: "https://app.revenuecat.com",
      webhookPath: "/billing/webhooks/revenuecat",
      settings: [
        { name: "Server API key", configured: input.apiKeyConfigured },
        {
          name: "Webhook authorization",
          configured: input.webhookAuthorizationConfigured,
        },
        { name: "iOS SDK key", configured: input.iosSdkConfigured },
        { name: "Android SDK key", configured: input.androidSdkConfigured },
      ],
    },
    accessKind: (entitlement) =>
      entitlement.store === "promotional" ? "complimentary" : "purchased",
  };
}
