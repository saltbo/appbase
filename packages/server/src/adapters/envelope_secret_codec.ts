import type { JsonObject } from "../domain/sync";
import type { SecretCodec } from "../usecases/ports";

type UserKeyRow = {
  wrapped_key: string;
  wrap_nonce: string;
  key_version: number;
};

type SecretEnvelope = {
  algorithm: "A256GCM";
  ciphertext: string;
  nonce: string;
  keyVersion: number;
};

export class D1EnvelopeSecretCodec implements SecretCodec {
  private readonly keyring: MasterKeyring;

  constructor(
    private readonly database: D1Database,
    masterKeyOrKeyring: string | MasterKeyring,
    keyVersion = 1,
  ) {
    this.keyring =
      typeof masterKeyOrKeyring === "string"
        ? {
            currentVersion: keyVersion,
            keys: { [keyVersion]: masterKeyOrKeyring },
          }
        : validateKeyring(masterKeyOrKeyring);
  }

  async seal(
    ownerSub: string,
    collection: string,
    recordId: string,
    payload: JsonObject,
  ): Promise<JsonObject> {
    const key = await this.userKey(ownerSub);
    const nonce = randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: aad(ownerSub, collection, recordId, key.version),
      },
      key.cryptoKey,
      ownedBytes(new TextEncoder().encode(JSON.stringify(payload))),
    );
    return envelopeToJson({
      algorithm: "A256GCM",
      ciphertext: toBase64Url(new Uint8Array(ciphertext)),
      nonce: toBase64Url(nonce),
      keyVersion: key.version,
    });
  }

  async open(
    ownerSub: string,
    collection: string,
    recordId: string,
    envelope: JsonObject,
  ): Promise<JsonObject> {
    const parsed = parseEnvelope(envelope);
    const key = await this.userKey(ownerSub, parsed.keyVersion);
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64Url(parsed.nonce),
          additionalData: aad(
            ownerSub,
            collection,
            recordId,
            parsed.keyVersion,
          ),
        },
        key.cryptoKey,
        fromBase64Url(parsed.ciphertext),
      );
      const value: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Decrypted credential payload is invalid.");
      }
      return value as JsonObject;
    } catch (error) {
      throw new Error(
        "The encrypted credential payload could not be authenticated.",
        { cause: error },
      );
    }
  }

  private async userKey(
    ownerSub: string,
    requestedVersion = this.keyring.currentVersion,
  ): Promise<{ cryptoKey: CryptoKey; version: number }> {
    let row = await this.database
      .prepare(
        `SELECT wrapped_key, wrap_nonce, key_version FROM appbase_user_keys
       WHERE owner_sub = ?1 AND key_version = ?2`,
      )
      .bind(ownerSub, requestedVersion)
      .first<UserKeyRow>();
    if (row === null) {
      if (requestedVersion !== this.keyring.currentVersion) {
        throw new Error("The payload key version is unavailable.");
      }
      const rawKey = randomBytes(32);
      const wrapNonce = randomBytes(12);
      const masterKey = await this.masterKey(requestedVersion);
      const wrapped = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: wrapNonce,
          additionalData: new TextEncoder().encode(
            `appbase:user-key:${ownerSub}:${requestedVersion}`,
          ),
        },
        masterKey,
        rawKey,
      );
      await this.database
        .prepare(
          `INSERT OR IGNORE INTO appbase_user_keys
         (owner_sub, key_version, wrapped_key, wrap_nonce, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(
          ownerSub,
          requestedVersion,
          toBase64Url(new Uint8Array(wrapped)),
          toBase64Url(wrapNonce),
          new Date().toISOString(),
        )
        .run();
      row = await this.database
        .prepare(
          `SELECT wrapped_key, wrap_nonce, key_version FROM appbase_user_keys
         WHERE owner_sub = ?1 AND key_version = ?2`,
        )
        .bind(ownerSub, requestedVersion)
        .first<UserKeyRow>();
      if (row === null)
        throw new Error("The user credential key could not be stored.");
    }

    const masterKey = await this.masterKey(row.key_version);
    const raw = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64Url(row.wrap_nonce),
        additionalData: new TextEncoder().encode(
          `appbase:user-key:${ownerSub}:${row.key_version}`,
        ),
      },
      masterKey,
      fromBase64Url(row.wrapped_key),
    );
    return {
      cryptoKey: await importAesKey(new Uint8Array(raw)),
      version: row.key_version,
    };
  }

  private masterKey(version: number): Promise<CryptoKey> {
    const encoded = this.keyring.keys[version];
    if (encoded === undefined) {
      throw new Error(`AppBase master key version ${version} is unavailable.`);
    }
    return importAesKey(fromBase64Url(encoded));
  }
}

export type MasterKeyring = {
  currentVersion: number;
  keys: Readonly<Record<number, string>>;
};

function validateKeyring(value: MasterKeyring): MasterKeyring {
  if (!Number.isSafeInteger(value.currentVersion) || value.currentVersion < 1) {
    throw new Error(
      "AppBase current master key version must be a positive integer.",
    );
  }
  if (value.keys[value.currentVersion] === undefined) {
    throw new Error("AppBase keyring does not contain its current master key.");
  }
  return value;
}

async function importAesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (raw.byteLength !== 32)
    throw new Error("AppBase encryption keys must contain 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function aad(
  ownerSub: string,
  collection: string,
  recordId: string,
  version: number,
): Uint8Array<ArrayBuffer> {
  return ownedBytes(
    new TextEncoder().encode(
      `appbase:secret:${ownerSub}:${collection}:${recordId}:${version}`,
    ),
  );
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(value);
  return value;
}

function envelopeToJson(envelope: SecretEnvelope): JsonObject {
  return { ...envelope };
}

function parseEnvelope(value: JsonObject): SecretEnvelope {
  if (
    value.algorithm !== "A256GCM" ||
    typeof value.ciphertext !== "string" ||
    typeof value.nonce !== "string" ||
    typeof value.keyVersion !== "number" ||
    !Number.isSafeInteger(value.keyVersion)
  ) {
    throw new Error("The encrypted credential envelope is invalid.");
  }
  return {
    algorithm: "A256GCM",
    ciphertext: value.ciphertext,
    nonce: value.nonce,
    keyVersion: value.keyVersion,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return ownedBytes(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function ownedBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(new ArrayBuffer(value.byteLength));
  result.set(value);
  return result;
}
