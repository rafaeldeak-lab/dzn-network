/** Synthetic local-only Vault fixtures. No remote services or production credentials. */
import { readFileSync } from "node:fs";
import { hmacSha256 } from "../../functions/_lib/crypto";
import type { Env } from "../../functions/_lib/types";

export const VAULT_LOCAL = {
  playerId: "vault-player", otherPlayerId: "vault-other", serverId: "vault-server",
  handle: "vault-player", otherHandle: "vault-other",
  playerToken: "local-vault-player-token", otherToken: "local-vault-other-token",
  sessionSecret: "local-vault-fixture-secret",
} as const;

export function vaultLocalEnv(db: D1Database): Env {
  return {
    DB: db, SESSION_SECRET: VAULT_LOCAL.sessionSecret,
    DZN_VAULT_ENABLED: "true", DZN_VAULT_STORE_MODE: "test",
  } as Env;
}

export async function createVaultLocalFixture(db: D1Database, options: { withVault?: boolean; withStore?: boolean } = {}) {
  const tables = [
    `CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT UNIQUE NOT NULL, username TEXT, avatar TEXT)`,
    `CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_token_hash TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL)`,
    `CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT, server_name TEXT, public_slug TEXT,
      status TEXT, listing_visibility TEXT, lifecycle_status TEXT, merged_into_server_id TEXT)`,
    `CREATE TABLE player_public_profiles (user_id TEXT PRIMARY KEY, handle TEXT UNIQUE, status TEXT)`,
    `CREATE TABLE player_profile_privacy_preferences (user_id TEXT PRIMARY KEY, public_profile_enabled INTEGER, show_calling_cards INTEGER DEFAULT 1)`,
  ];
  for (const sql of tables) await db.prepare(sql).run();
  await db.prepare(`INSERT INTO users (id, discord_id, username, avatar) VALUES
    (?, '100000000000000001', 'Rafael · Local Preview', NULL), (?, '100000000000000002', 'Other Collector', NULL)`)
    .bind(VAULT_LOCAL.playerId, VAULT_LOCAL.otherPlayerId).run();
  for (const [id, token] of [[VAULT_LOCAL.playerId, VAULT_LOCAL.playerToken], [VAULT_LOCAL.otherPlayerId, VAULT_LOCAL.otherToken]]) {
    const hash = await hmacSha256(token, VAULT_LOCAL.sessionSecret);
    await db.prepare("INSERT INTO sessions (id, user_id, session_token_hash, expires_at) VALUES (?, ?, ?, '2099-01-01 00:00:00')")
      .bind(`session-${id}`, id, hash).run();
    await db.prepare("INSERT INTO player_public_profiles (user_id, handle, status) VALUES (?, ?, 'active')").bind(id, id).run();
    await db.prepare("INSERT INTO player_profile_privacy_preferences (user_id, public_profile_enabled) VALUES (?, 1)").bind(id).run();
  }
  await db.prepare(`INSERT INTO linked_servers (id, user_id, server_name, public_slug, status, listing_visibility, lifecycle_status)
    VALUES (?, ?, 'DZN Vanguard · Local Preview', 'vault-vanguard', 'live', 'public', 'active_live')`)
    .bind(VAULT_LOCAL.serverId, VAULT_LOCAL.playerId).run();
  if (options.withStore !== false) await createPurchaseTables(db);
  if (options.withVault !== false) await applyVaultMigration(db);
}

export async function applyVaultMigration(db: D1Database) {
  const sql = readFileSync("migrations/0115_vault_cabinets.sql", "utf8").replace(/^--.*$/gm, "");
  let buffer = "";
  let trigger = false;
  for (const line of sql.split(/\r?\n/)) {
    if (!buffer && !line.trim()) continue;
    buffer += `${line}\n`;
    if (/^\s*CREATE\s+TRIGGER\b/i.test(buffer)) trigger = true;
    if (trigger ? /^\s*END;\s*$/i.test(line) : /;\s*$/.test(line)) {
      await db.prepare(buffer.trim().replace(/;\s*$/, "")).run();
      buffer = "";
      trigger = false;
    }
  }
  if (buffer.trim()) await db.prepare(buffer.trim()).run();
}

async function createPurchaseTables(db: D1Database) {
  // These minimal source tables expose the exact existing 0084 read contract.
  // They do not simulate or implement payment processing.
  const tables = [
    `CREATE TABLE store_commerce_orders (id TEXT PRIMARY KEY, purchasing_user_id TEXT, status TEXT, livemode INTEGER, stripe_mode TEXT)`,
    `CREATE TABLE store_commerce_order_items (order_id TEXT PRIMARY KEY, product_key TEXT, product_name TEXT, fulfilment_kind TEXT)`,
    `CREATE TABLE store_commerce_fulfilments (id TEXT PRIMARY KEY, order_id TEXT, purchasing_user_id TEXT, status TEXT)`,
    `CREATE TABLE store_commerce_receipts (order_id TEXT PRIMARY KEY, purchasing_user_id TEXT, status TEXT)`,
    `CREATE TABLE store_commerce_entitlements (id TEXT PRIMARY KEY, fulfilment_id TEXT, order_id TEXT,
      purchasing_user_id TEXT, product_key TEXT, fulfilment_kind TEXT, status TEXT, granted_at TEXT, reversed_at TEXT)`,
  ];
  for (const sql of tables) await db.prepare(sql).run();
}

export async function seedVaultPurchase(db: D1Database, options: {
  id: string; userId?: string; mode?: "test" | "live";
  entitlementStatus?: "active" | "reversed"; orderStatus?: string; receiptStatus?: string; fulfilmentStatus?: string;
}) {
  const userId = options.userId ?? VAULT_LOCAL.playerId;
  const mode = options.mode ?? "test";
  const status = options.entitlementStatus ?? "active";
  const order = `order-${options.id}`;
  const fulfilment = `fulfilment-${options.id}`;
  const product = `local-supporter-${options.id}`;
  await db.batch([
    db.prepare("INSERT INTO store_commerce_orders VALUES (?, ?, ?, ?, ?)")
      .bind(order, userId, options.orderStatus ?? "fulfilled", mode === "live" ? 1 : 0, mode),
    db.prepare("INSERT INTO store_commerce_order_items VALUES (?, ?, ?, 'supporter_card')")
      .bind(order, product, `Supporter ${options.id}`),
    db.prepare("INSERT INTO store_commerce_fulfilments VALUES (?, ?, ?, ?)")
      .bind(fulfilment, order, userId, options.fulfilmentStatus ?? "completed"),
    db.prepare("INSERT INTO store_commerce_receipts VALUES (?, ?, ?)")
      .bind(order, userId, options.receiptStatus ?? "issued"),
    db.prepare(`INSERT INTO store_commerce_entitlements VALUES (?, ?, ?, ?, ?, 'supporter_card', ?, '2026-10-01T12:00:00.000Z', ?)`)
      .bind(options.id, fulfilment, order, userId, product, status, status === "reversed" ? "2026-10-02T12:00:00.000Z" : null),
  ]);
  return `store:${options.id}`;
}
