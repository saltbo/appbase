export interface AdminCredentials {
  subject: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface CredentialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class AdminSignInRequired extends Error {
  constructor(options?: ErrorOptions) {
    super("Sign in to administration again.", options);
  }
}

/** Browser localStorage and Web Locks share the same origin-scoped namespace. */
export class AdminCredentialStore {
  constructor(
    private readonly key: string,
    private readonly storage: CredentialStorage,
    private readonly lock: <T>(
      name: string,
      action: () => Promise<T>,
    ) => Promise<T>,
    private readonly now: () => number = Date.now,
  ) {}

  private read(): AdminCredentials | null {
    const raw = this.storage.getItem(this.key);
    if (raw === null) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (
        typeof value !== "object" ||
        value === null ||
        !("subject" in value) ||
        typeof value.subject !== "string" ||
        !value.subject ||
        !("accessToken" in value) ||
        typeof value.accessToken !== "string" ||
        !value.accessToken ||
        !("refreshToken" in value) ||
        typeof value.refreshToken !== "string" ||
        !value.refreshToken ||
        !("expiresAt" in value) ||
        typeof value.expiresAt !== "number" ||
        !Number.isFinite(value.expiresAt)
      )
        throw new Error("Invalid stored credentials.");
      return value as AdminCredentials;
    } catch {
      this.storage.removeItem(this.key);
      return null;
    }
  }

  expiresAt(): number | null {
    return this.read()?.expiresAt ?? null;
  }

  async signIn(credentials: AdminCredentials): Promise<void> {
    await this.lock(this.key, async () => {
      this.storage.setItem(this.key, JSON.stringify(credentials));
    });
  }

  async signOut(): Promise<void> {
    await this.lock(this.key, async () => this.storage.removeItem(this.key));
  }

  async accessToken(
    renew: (credentials: AdminCredentials) => Promise<AdminCredentials>,
  ): Promise<string> {
    return this.lock(this.key, async () => {
      const current = this.read();
      if (!current) throw new AdminSignInRequired();
      if (current.expiresAt > this.now() + 30_000) return current.accessToken;
      // A tab crash or uncertain exchange must not cause reuse of a rotating token.
      this.storage.removeItem(this.key);
      try {
        const next = await renew(current);
        if (next.subject !== current.subject || next.expiresAt <= this.now())
          throw new Error(
            "The refreshed identity does not match the operator.",
          );
        this.storage.setItem(this.key, JSON.stringify(next));
        return next.accessToken;
      } catch (cause) {
        throw new AdminSignInRequired({ cause });
      }
    });
  }
}
