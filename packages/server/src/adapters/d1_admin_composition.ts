import type {
  BillingCatalog,
  BillingSchema,
  BillingEnvironment,
} from "../domain/billing.js";
import { BillingService, type BillingProvider } from "../usecases/billing.js";
import { BillingMembershipRepository } from "../usecases/billing_membership_repository.js";
import { MembershipService } from "../usecases/membership.js";
import { AdminService, type AdminBenefitRegistry } from "../usecases/admin.js";
import { D1BillingRepository } from "./d1_billing_repository.js";
import { D1MembershipRepository } from "./d1_membership_repository.js";
import { D1AdminUserDirectory } from "./d1_admin_users.js";
import { D1AdminPaymentEvents } from "./d1_admin_events.js";
import type { AdminPaymentProvider } from "../usecases/admin_payments.js";

/** Construct per request. Reuse its membership service for customer reads and quota enforcement. */
export function createD1AdminServices(
  db: D1Database,
  environment: BillingEnvironment,
  provider: BillingProvider,
  baseline: BillingCatalog | BillingSchema,
  now: () => Date = () => new Date(),
  benefits: AdminBenefitRegistry = {},
  paymentProvider?: AdminPaymentProvider,
) {
  const billing = new BillingService(
    new D1BillingRepository(db, environment),
    provider,
    baseline,
  );
  let catalog: Promise<BillingCatalog> | undefined;
  const loadCatalog = () =>
    (catalog ??= billing.catalog().then((r) => r.catalog));
  const underlying = new BillingMembershipRepository(
    new D1MembershipRepository(db, environment),
    billing.repository,
    loadCatalog,
    environment === "sandbox",
  );
  const repository = underlying;
  const membership = new MembershipService(repository, {
    loadCatalog,
    now,
  });
  return {
    billing,
    membership,
    repository,
    admin: new AdminService(
      environment,
      new D1AdminUserDirectory(db, environment),
      membership,
      billing,
      underlying,
      now,
      Object.keys(benefits).length ? benefits : billing.schema.capabilities,
      paymentProvider,
      new D1AdminPaymentEvents(db, environment),
    ),
  };
}
