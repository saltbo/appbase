export { defaultThreeWayMerge } from "./domain/sync";
export {
  MembershipLimitError,
  type CapabilityDefinition,
  type CapabilitySnapshot,
  type MembershipGrant,
  type MembershipPlan,
  type MembershipSnapshot,
} from "./domain/membership";
export {
  MembershipService,
  type MembershipConfig,
} from "./usecases/membership";
export type { MembershipRepository } from "./usecases/membership_ports";
export type {
  JsonObject,
  JsonValue,
  MutationResult,
  PullResult,
  SyncChange,
  SyncMutation,
} from "./domain/sync";
export type {
  AuthVerifier,
  Principal,
  SecretCodec,
  SyncRepository,
} from "./usecases/ports";
export {
  AuthenticationError,
  AuthorizationError,
  SyncConflictError,
} from "./usecases/ports";
export type { SyncDeps } from "./usecases/sync";
export { pullChanges, pushMutations } from "./usecases/sync";
