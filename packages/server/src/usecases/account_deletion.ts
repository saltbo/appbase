import { AuthorizationError } from "./ports.js";

export interface AccountDeletionRepository {
  complete?(ownerSub: string): Promise<void>;
  isDeleted(ownerSub: string): Promise<boolean>;
  begin(ownerSub: string): Promise<void>;
  pendingBillingIdentities(ownerSub: string): Promise<readonly string[]>;
  completeBillingIdentity(ownerSub: string, identity: string): Promise<void>;
}

/** The host owns any additional product stores; this service never calls an IdP. */
export class AccountDeletionService {
  constructor(
    readonly repository: AccountDeletionRepository,
    private readonly deleteBillingIdentity: (identity: string) => Promise<void>,
    private readonly deleteProductData: (
      ownerSub: string,
    ) => Promise<void> = async () => {},
  ) {}

  async requireActive(ownerSub: string): Promise<void> {
    if (await this.repository.isDeleted(ownerSub))
      throw new AccountDeletedError();
  }

  async delete(ownerSub: string): Promise<void> {
    // Fence writes before external work. A failed/uncertain attempt stays retryable.
    await this.repository.begin(ownerSub);
    await this.deleteProductData(ownerSub);
    for (const identity of await this.repository.pendingBillingIdentities(
      ownerSub,
    )) {
      await this.deleteBillingIdentity(identity);
      await this.repository.completeBillingIdentity(ownerSub, identity);
    }
    await this.repository.complete?.(ownerSub);
  }
}

export class AccountDeletedError extends AuthorizationError {
  constructor() {
    super("This application account has been deleted.");
  }
}
