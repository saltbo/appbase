export { defaultThreeWayMerge } from "./domain/sync.js";
export {
  MembershipLimitError,
  type CapabilityDefinition,
  type CapabilitySnapshot,
  type MembershipGrant,
  type MembershipPlan,
  type MembershipSnapshot,
} from "./domain/membership.js";
export {
  MembershipService,
  type MembershipConfig,
} from "./usecases/membership.js";
export type { MembershipRepository } from "./usecases/membership_ports.js";
export type {
  JsonObject,
  JsonValue,
  MutationResult,
  PullResult,
  SyncChange,
  SyncMutation,
} from "./domain/sync.js";
export type {
  AuthVerifier,
  Principal,
  SecretCodec,
  SyncRepository,
} from "./usecases/ports.js";
export {
  AuthenticationError,
  AuthorizationError,
  SyncConflictError,
} from "./usecases/ports.js";
export type { SyncDeps } from "./usecases/sync.js";
export { pullChanges, pushMutations } from "./usecases/sync.js";
