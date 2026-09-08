import { describe, expect, it, vi } from "vitest";
import {
  AdminCredentialStore,
  AdminSignInRequired,
  type AdminCredentials,
} from "../src/browser/admin_credentials.js";

function fixture() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  let pending: Promise<unknown> = Promise.resolve();
  const lock = <T>(_name: string, action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action, action);
    pending = result.catch(() => {});
    return result;
  };
  const first = new AdminCredentialStore(
    "operator",
    storage,
    lock,
    () => 100_000,
  );
  const second = new AdminCredentialStore(
    "operator",
    storage,
    lock,
    () => 100_000,
  );
  const expired: AdminCredentials = {
    subject: "operator",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: 90_000,
  };
  const renewed = {
    ...expired,
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: 200_000,
  };
  return { first, second, expired, renewed, data };
}

describe("browser operator credentials", () => {
  it("serializes renewal across store instances and uses the rotated credentials", async () => {
    const { first, second, expired, renewed } = fixture();
    await first.signIn(expired);
    const renew = vi.fn(async () => renewed);
    expect(
      await Promise.all([first.accessToken(renew), second.accessToken(renew)]),
    ).toEqual(["new-access", "new-access"]);
    expect(renew).toHaveBeenCalledOnce();
    expect(renew).toHaveBeenCalledWith(expired);
  });

  it("does not retry an uncertain token exchange from another tab", async () => {
    const { first, second, expired, data } = fixture();
    await first.signIn(expired);
    const renew = vi.fn(async () => {
      expect(data.has("operator")).toBe(false);
      throw new Error("connection lost after redemption");
    });
    await expect(first.accessToken(renew)).rejects.toBeInstanceOf(
      AdminSignInRequired,
    );
    await expect(second.accessToken(renew)).rejects.toBeInstanceOf(
      AdminSignInRequired,
    );
    expect(renew).toHaveBeenCalledOnce();
  });

  it("logout leaves no credentials after an in-flight renewal", async () => {
    const { first, second, expired, renewed, data } = fixture();
    await first.signIn(expired);
    await Promise.all([
      first.accessToken(async () => renewed),
      second.signOut(),
    ]);
    expect(data.size).toBe(0);
    await expect(first.accessToken(async () => renewed)).rejects.toBeInstanceOf(
      AdminSignInRequired,
    );
  });

  it("rejects a refreshed identity change and clears corrupted storage", async () => {
    const { first, expired, renewed, data } = fixture();
    await first.signIn(expired);
    await expect(
      first.accessToken(async () => ({ ...renewed, subject: "other" })),
    ).rejects.toBeInstanceOf(AdminSignInRequired);
    expect(data.size).toBe(0);
    data.set("operator", "{}");
    await expect(first.accessToken(async () => renewed)).rejects.toBeInstanceOf(
      AdminSignInRequired,
    );
    expect(data.size).toBe(0);
  });
});
