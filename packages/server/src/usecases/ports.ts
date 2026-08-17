import type { JsonObject, StoredVersion } from "../domain/sync.js";

export type AppendVersionInput = Omit<StoredVersion, "sequence"> & {
  expectedRevision: string | null;
};

export interface SyncRepository {
  findMutation(
    ownerSub: string,
    deviceId: string,
    mutationId: string,
  ): Promise<StoredVersion | null>;
  getCurrent(
    ownerSub: string,
    collection: string,
    recordId: string,
  ): Promise<StoredVersion | null>;
  getVersion(
    ownerSub: string,
    collection: string,
    recordId: string,
    revision: string,
  ): Promise<StoredVersion | null>;
  append(input: AppendVersionInput): Promise<StoredVersion | null>;
  listChanges(
    ownerSub: string,
    afterSequence: number,
    limit: number,
  ): Promise<StoredVersion[]>;
}

export interface SecretCodec {
  seal(
    ownerSub: string,
    collection: string,
    recordId: string,
    payload: JsonObject,
  ): Promise<JsonObject>;
  open(
    ownerSub: string,
    collection: string,
    recordId: string,
    envelope: JsonObject,
  ): Promise<JsonObject>;
}

export type Principal = { sub: string; scopes: readonly string[] };

export interface AuthVerifier {
  verify(accessToken: string): Promise<Principal>;
}

export class AuthenticationError extends Error {
  constructor(message = "A valid bearer access token is required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(
    message = "The authenticated principal is not allowed to use this capability.",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class SyncConflictError extends Error {
  constructor(
    readonly collection: string,
    readonly recordId: string,
  ) {
    super("The record changed while the mutation was being applied.");
    this.name = "SyncConflictError";
  }
}
