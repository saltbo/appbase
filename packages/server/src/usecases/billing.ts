import {
  BillingError,
  validateCatalog,
  type BillingCatalog,
  type BillingSchema,
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
  readonly schema: BillingSchema;
  private readonly legacyCatalog: BillingCatalog | undefined;
  constructor(
    readonly repository: BillingRepository,
    private readonly provider: BillingProvider,
    definition: BillingSchema | BillingCatalog,
  ) {
    // Existing hosts retain the pre-schema constructor until their explicit migration.
    this.legacyCatalog = "freePlan" in definition ? definition : undefined;
    this.schema =
      "capabilities" in definition
        ? definition
        : {
            capabilities: Object.fromEntries(
              Object.entries(definition.freePlan.capabilities).map(
                ([id, value]) => [
                  id,
                  {
                    type: "quota" as const,
                    displayName: id,
                    description: id,
                    unit: "units",
                    period: value.period,
                  },
                ],
              ),
            ),
          };
  }
  async administrationCatalog(): Promise<VersionedCatalog | null> {
    const stored = await this.repository.catalog();
    return (
      stored ??
      (this.legacyCatalog ? { revision: 0, catalog: this.legacyCatalog } : null)
    );
  }
  async catalog(): Promise<VersionedCatalog> {
    const result = await this.administrationCatalog();
    if (!result)
      throw new BillingError(
        "CONFIGURATION_MISSING",
        "Create the default plan in administration before using membership.",
      );
    return result;
  }

  async replaceCatalog(
    catalog: BillingCatalog,
    revision: number,
  ): Promise<VersionedCatalog> {
    const current = await this.administrationCatalog();
    if ((current?.revision ?? 0) !== revision)
      throw new BillingError(
        "PRECONDITION_FAILED",
        "The catalog changed; reload before editing.",
      );
    validateCatalog(
      catalog,
      current?.catalog ?? null,
      this.legacyCatalog ? undefined : this.schema,
    );
    if (!(await this.repository.replaceCatalog(catalog, revision)))
      throw new BillingError(
        "PRECONDITION_FAILED",
        "The catalog changed; reload before editing.",
      );
    return { revision: revision + 1, catalog };
  }
  async synchronize(ownerSub: string): Promise<BillingState> {
    await this.catalog();
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
