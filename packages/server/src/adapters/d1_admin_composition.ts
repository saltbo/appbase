import type { BillingCatalog, BillingEnvironment } from "../domain/billing.js";
import { BillingService, type BillingProvider } from "../usecases/billing.js";
import { BillingMembershipRepository } from "../usecases/billing_membership_repository.js";
import { MembershipService } from "../usecases/membership.js";
import { AdminService } from "../usecases/admin.js";
import { AdminMembershipRepository } from "../usecases/admin_membership_repository.js";
import { D1BillingRepository } from "./d1_billing_repository.js";
import { D1MembershipRepository } from "./d1_membership_repository.js";
import { D1AdminRepository } from "./d1_admin_repository.js";
import { D1AdminUserDirectory } from "./d1_admin_users.js";

/** Construct per request. Reuse its membership service for customer reads and quota enforcement. */
export function createD1AdminServices(
  db: D1Database,
  environment: BillingEnvironment,
  provider: BillingProvider,
  baseline: BillingCatalog,
  now: () => Date = () => new Date(),
) {
  const billing = new BillingService(
    new D1BillingRepository(db, environment),
    provider,
    baseline,
  );
  let catalog: Promise<BillingCatalog> | undefined;
  const loadCatalog = () =>
    (catalog ??= billing.catalog().then((r) => r.catalog));
  const manual = new D1AdminRepository(db, environment);
  const underlying = new BillingMembershipRepository(
    new D1MembershipRepository(db, environment),
    billing.repository,
    loadCatalog,
    environment === "sandbox",
  );
  const repository = new AdminMembershipRepository(underlying, manual);
  const membership = new MembershipService(repository, {
    ...baseline,
    loadCatalog,
    now,
  });
  return {
    billing,
    membership,
    repository,
    admin: new AdminService(
      manual,
      new D1AdminUserDirectory(db, environment),
      membership,
      billing,
      underlying,
      now,
    ),
  };
}
