import { z } from "zod";
import { BillingError, type BillingState } from "../domain/billing.js";
import type { BillingProvider } from "../usecases/billing.js";

const date = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s).toISOString());
const subscription = z.object({
  is_sandbox: z.boolean(),
  store: z.string().min(1),
  unsubscribe_detected_at: date.nullable(),
  refunded_at: date.nullable().optional(),
});
const responseSchema = z.object({
  request_date: date,
  subscriber: z.object({
    management_url: z.string().url().nullable(),
    entitlements: z.record(
      z.string(),
      z.object({
        product_identifier: z.string().min(1),
        purchase_date: date,
        expires_date: date.nullable(),
        grace_period_expires_date: date.nullable().optional(),
      }),
    ),
    subscriptions: z.record(z.string(), subscription),
  }),
});

export async function boundedText(
  response: Response,
  maxBytes = 512 * 1024,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new BillingError(
          "INVALID_PROVIDER_RESPONSE",
          "Billing payload exceeds the supported size.",
        );
      }
      result += decoder.decode(next.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export class RevenueCatProvider implements BillingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  async subscriber(appUserId: string): Promise<BillingState> {
    if (!this.apiKey)
      throw new BillingError(
        "CONFIGURATION_MISSING",
        "RevenueCat server credentials are not configured.",
      );
    let response: Response;
    try {
      response = await this.request(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10000),
          // Workers supports manual redirects; non-2xx responses are rejected below.
          redirect: "manual",
        },
      );
    } catch (cause) {
      throw new BillingError(
        "PROVIDER_UNAVAILABLE",
        "RevenueCat could not be reached.",
        { cause },
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new BillingError(
        "PROVIDER_UNAVAILABLE",
        `RevenueCat returned HTTP ${response.status}.`,
      );
    }
    try {
      const data = responseSchema.parse(
        JSON.parse(await boundedText(response)),
      );
      const entitlements = Object.entries(data.subscriber.entitlements).flatMap(
        ([id, e]) => {
          const sub = data.subscriber.subscriptions[e.product_identifier];
          // This adapter's first contract is renewable subscriptions, not lifetime purchases.
          if (e.expires_date === null)
            throw new BillingError(
              "INVALID_PROVIDER_RESPONSE",
              "Non-expiring purchases are not supported by this subscription adapter.",
            );
          if (!sub)
            throw new BillingError(
              "INVALID_PROVIDER_RESPONSE",
              "An entitlement has no corresponding subscription.",
            );
          if (sub.refunded_at != null) return [];
          return [
            {
              id,
              productId: e.product_identifier,
              store: sub.store,
              sandbox: sub.is_sandbox,
              startsAt: e.purchase_date,
              expiresAt: e.expires_date,
              graceEndsAt: e.grace_period_expires_date ?? null,
              willRenew: sub.unsubscribe_detected_at === null,
            },
          ];
        },
      );
      const managementUrl = data.subscriber.management_url;
      if (
        managementUrl !== null &&
        new URL(managementUrl).protocol !== "https:"
      )
        throw new Error("Invalid management URL.");
      return { observedAt: data.request_date, entitlements, managementUrl };
    } catch (cause) {
      if (cause instanceof BillingError) throw cause;
      throw new BillingError(
        "INVALID_PROVIDER_RESPONSE",
        "RevenueCat returned an invalid subscription snapshot.",
        { cause },
      );
    }
  }
}

export const revenueCatEventSchema = z.object({
  event: z.object({
    id: z.string().min(1).max(200),
    type: z.string().min(1),
    app_user_id: z.string().min(1).max(200).optional(),
    original_app_user_id: z.string().min(1).max(200).optional(),
    aliases: z.array(z.string().min(1).max(200)).max(100).optional(),
    transferred_from: z.array(z.string().min(1).max(200)).max(100).optional(),
    transferred_to: z.array(z.string().min(1).max(200)).max(100).optional(),
  }),
});

export async function verifyWebhookAuthorization(
  actual: string | undefined,
  expected: string,
): Promise<boolean> {
  if (!actual || !expected) return false;
  const bytes = new TextEncoder();
  const importKey = (value: string) =>
    crypto.subtle.importKey(
      "raw",
      bytes.encode(value),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importKey(expected),
    bytes.encode("appbase-webhook"),
  );
  return crypto.subtle.verify(
    "HMAC",
    await importKey(actual),
    signature,
    bytes.encode("appbase-webhook"),
  );
}
