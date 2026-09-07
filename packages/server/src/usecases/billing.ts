import {
  BillingError,
  validateCatalog,
  type BillingCatalog,
  type BillingState,
  type VersionedCatalog,
} from "../domain/billing.js";

export interface BillingRepository {
  catalog(): Promise<VersionedCatalog | null>;
  replaceCatalog(
    catalog: BillingCatalog,
    expectedRevision: number,
  ): Promise<boolean>;
  identity(ownerSub: string): Promise<string>;
  owner(appUserId: string): Promise<string | null>;
  beginSync(ownerSub: string): Promise<number>;
  commitSync(
    ownerSub: string,
    generation: number,
    state: BillingState,
  ): Promise<boolean>;
  state(ownerSub: string): Promise<BillingState | null>;
  eventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string): Promise<void>;
}
export interface BillingProvider {
  subscriber(appUserId: string): Promise<BillingState>;
}

export class BillingService {
  constructor(
    readonly repository: BillingRepository,
    private readonly provider: BillingProvider,
    readonly baseline: BillingCatalog,
  ) {}
  async catalog(): Promise<VersionedCatalog> {
    // Revision zero is the declared bootstrap configuration, not an error fallback.
    return (
      (await this.repository.catalog()) ?? {
        revision: 0,
        catalog: this.baseline,
      }
    );
  }
  async replaceCatalog(
    catalog: BillingCatalog,
    revision: number,
  ): Promise<VersionedCatalog> {
    validateCatalog(catalog, this.baseline);
    if (!(await this.repository.replaceCatalog(catalog, revision)))
      throw new BillingError(
        "PRECONDITION_FAILED",
        "The catalog changed; reload before editing.",
      );
    return { revision: revision + 1, catalog };
  }
  async synchronize(ownerSub: string): Promise<BillingState> {
    const id = await this.repository.identity(ownerSub);
    const generation = await this.repository.beginSync(ownerSub);
    const state = await this.provider.subscriber(id);
    if (!(await this.repository.commitSync(ownerSub, generation, state)))
      throw new BillingError(
        "SYNC_SUPERSEDED",
        "A newer synchronization started; refresh membership.",
      );
    return state;
  }
  async webhook(event: {
    id: string;
    userIds: readonly string[];
  }): Promise<void> {
    if (await this.repository.eventProcessed(event.id)) return;
    for (const id of new Set(event.userIds)) {
      const owner = await this.repository.owner(id);
      // Notifications can precede SDK identity association; never invent ownership.
      if (owner !== null) await this.synchronize(owner);
    }
    await this.repository.markEventProcessed(event.id);
  }
}
