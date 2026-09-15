import type { AuthVerifier, Principal } from "../usecases/ports.js";
import type { AccountService } from "../usecases/accounts.js";
export class AccountAuthVerifier implements AuthVerifier {
  constructor(
    readonly identity: AuthVerifier,
    readonly accounts: AccountService,
  ) {}
  verify(token: string): Promise<Principal> {
    return token.startsWith("ab1_")
      ? this.accounts.authenticate(token)
      : this.identity.verify(token);
  }
}
