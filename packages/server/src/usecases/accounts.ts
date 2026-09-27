import {
  AuthenticationError,
  AuthorizationError,
  type Principal,
} from "./ports.js";
import {
  AccountDeletedError,
  AccountDeletionService,
  type AccountDeletionRepository,
} from "./account_deletion.js";

export type ApplicationAccount = {
  clientId?: string | null;
  id: string;
  subject: string | null;
  status: "active" | "deleting" | "deleted";
  legacy: number;
};
export type DeviceSession = {
  accountId: string;
  deviceId: string;
  subject: string;
  scopes: readonly string[];
  expiresAt: number;
};
export interface AccountRepository extends AccountDeletionRepository {
  current(subject: string): Promise<ApplicationAccount | null>;
  find(id: string): Promise<ApplicationAccount | null>;
  register(
    subject: string,
    id: string,
    now: number,
  ): Promise<ApplicationAccount>;
  saveSession(hash: string, session: DeviceSession, now: number): Promise<void>;
  session(hash: string): Promise<DeviceSession | null>;
  revokeSession(hash: string): Promise<void>;
  due(now: number, limit: number): Promise<readonly string[]>;
  postpone(id: string, now: number): Promise<void>;
  expireSessions(now: number): Promise<void>;
}
export interface AccountCrypto {
  accountId(): string;
  random(): string;
  hash(value: string): Promise<string>;
}
export class AccountLifecycleError extends AuthorizationError {
  constructor(
    readonly code:
      | "ACCOUNT_EXISTS"
      | "REGISTRATION_REQUIRED"
      | "ACCOUNT_DELETING"
      | "ACCOUNT_SESSION_REQUIRED"
      | "ACCOUNT_SESSION_INVALID",
    message: string,
  ) {
    super(message);
  }
}
export class AccountService {
  constructor(
    readonly repository: AccountRepository,
    readonly deletion: AccountDeletionService,
    readonly crypto: AccountCrypto,
    readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}
  async status(principal: Principal) {
    const account = await this.repository.current(principal.sub);
    return account
      ? { accountId: account.clientId ?? account.id, status: account.status }
      : { accountId: null, status: "unregistered" as const };
  }
  async open(
    principal: Principal,
    input: {
      deviceId: string;
      register: boolean;
      accountId?: string | undefined;
    },
  ) {
    // Renewal is pinned to the old account even after the same identity re-registers.
    let account = input.accountId
      ? await this.repository.find(input.accountId)
      : await this.repository.current(principal.sub);
    if (account?.status === "deleted") throw new AccountDeletedError();
    if (account?.status === "deleting")
      throw new AccountLifecycleError(
        "ACCOUNT_DELETING",
        "Account deletion is still in progress.",
      );
    if (input.accountId && (!account || account.subject !== principal.sub))
      throw new AccountDeletedError();
    if (account && input.register)
      throw new AccountLifecycleError(
        "ACCOUNT_EXISTS",
        "An application account already exists. Sign in to continue.",
      );
    if (!account) {
      if (!input.register)
        throw new AccountLifecycleError(
          "REGISTRATION_REQUIRED",
          "Confirm registration to create an application account.",
        );
      account = await this.repository.register(
        principal.sub,
        this.crypto.accountId(),
        this.now(),
      );
    }
    if (account.status !== "active")
      throw new AccountLifecycleError(
        "ACCOUNT_DELETING",
        "Account deletion is still in progress.",
      );
    const token = `ab1_${this.crypto.random()}${this.crypto.random()}`;
    const expiresAt = this.now() + 1800;
    await this.repository.saveSession(
      await this.crypto.hash(token),
      {
        accountId: account.id,
        subject: principal.sub,
        deviceId: input.deviceId,
        scopes: principal.scopes,
        expiresAt,
      },
      this.now(),
    );
    return {
      accountId: account.clientId ?? account.id,
      accessToken: token,
      expiresAt,
      status: "active" as const,
    };
  }
  async authenticate(token: string): Promise<Principal> {
    const session = await this.repository.session(
      await this.crypto.hash(token),
    );
    if (!session || session.expiresAt <= this.now())
      throw new AccountLifecycleError(
        "ACCOUNT_SESSION_INVALID",
        "The application session is no longer valid.",
      );
    const account = await this.repository.find(session.accountId);
    if (!account) throw new AccountDeletedError();
    return {
      sub: session.subject,
      scopes: session.scopes,
      accountId: session.accountId,
    };
  }
  async requireAccount(principal: Principal): Promise<Principal> {
    if (principal.accountId) {
      await this.deletion.requireActive(principal.accountId);
      return principal;
    }
    // Legacy clients can only address their original migrated account, never a replacement.
    const old = await this.repository.find(principal.sub);
    if (old?.legacy && old.status === "active" && old.subject === principal.sub)
      return { ...principal, accountId: old.id };
    throw new AccountLifecycleError(
      "ACCOUNT_SESSION_REQUIRED",
      "Sign in with an updated application to continue.",
    );
  }
  async requestDeletion(principal: Principal) {
    if (!principal.accountId)
      throw new AuthenticationError(
        "An application device session is required for deletion.",
      );
    await this.repository.begin(principal.accountId);
    return { accountId: principal.accountId, status: "deleting" as const };
  }
  async process(id: string) {
    try {
      await this.deletion.delete(id);
    } catch (error) {
      await this.repository.postpone(id, this.now());
      throw error;
    }
  }
  async processDue() {
    await this.repository.expireSessions(this.now());
    for (const id of await this.repository.due(this.now(), 20)) {
      try {
        await this.process(id);
      } catch {
        console.error(
          "Application account cleanup deferred; durable retry scheduled.",
        );
      }
    }
  }
}
export function accountOwner(principal: Principal): string {
  return principal.accountId ?? principal.sub;
}
