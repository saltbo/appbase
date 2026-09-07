#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

// Tokens are supplied by the operator's identity tool, never written to the catalog.
const [operation, file] = process.argv.slice(2);
const origin = process.env.APPBASE_URL;
const token = process.env.APPBASE_ACCESS_TOKEN;
if (!origin || !token || !["get", "put"].includes(operation) || !file) {
  throw new Error("Usage: APPBASE_URL=... APPBASE_ACCESS_TOKEN=... node scripts/billing-catalog.mjs get|put catalog.json");
}
const url = new URL("/billing/configuration", origin);
if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("Use HTTPS outside localhost.");
const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
let options = { headers, signal: AbortSignal.timeout(20000), redirect: "error" };
if (operation === "put") {
  const { etag, catalog } = JSON.parse(await readFile(file, "utf8"));
  if (typeof etag !== "string") throw new Error("Read the catalog first; its ETag is required.");
  options = { ...options, method: "PUT", headers: { ...headers, "Content-Type": "application/json", "If-Match": etag }, body: JSON.stringify(catalog) };
}
const response = await fetch(url, options);
if (!response.ok) throw new Error(`Catalog ${operation} failed (HTTP ${response.status}). ${response.status === 412 ? "Reload and reconcile your edits." : "Check administrator authority and server logs."}`);
const etag = response.headers.get("ETag");
const catalog = await response.json();
await writeFile(file, JSON.stringify({ etag, catalog }, null, 2) + "\n", { mode: 0o600 });
console.log(`${operation === "put" ? "Saved" : "Read"} catalog ${etag}.`);
