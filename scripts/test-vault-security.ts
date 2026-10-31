import assert from "node:assert/strict";
import { handlePrivateVault, handlePublicPlayerVault, vaultStoreMode } from "../functions/_lib/vault";
import type { Env } from "../functions/_lib/types";
import { emptyVaultSlots, type VaultCabinetResponse, type VaultSlots } from "../lib/vault";
import { GamesLocalD1 } from "./lib/games-hub-local";
import { createVaultLocalFixture, seedVaultPurchase, VAULT_LOCAL, vaultLocalEnv } from "./lib/vault-local";

/** Real SQLite and the production migration; hooks only schedule competing actions. */
class RaceD1 extends GamesLocalD1 {
  afterRead: ((sql: string) => void) | null = null;

  override prepare(sql: string) {
    const wrap = (statement: ReturnType<GamesLocalD1["prepare"]>): ReturnType<GamesLocalD1["prepare"]> => ({
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      run: () => statement.run(),
      first: async () => {
        const row = await statement.first();
        this.afterRead?.(sql);
        return row;
      },
      all: async () => {
        const rows = await statement.all();
        this.afterRead?.(sql);
        return rows;
      },
    });
    return wrap(super.prepare(sql));
  }
}

type Fixture = { db: RaceD1; env: Env };
const cookie = `dzn_session=${VAULT_LOCAL.playerToken}`;
const otherCookie = `dzn_session=${VAULT_LOCAL.otherToken}`;

async function scenario(name: string, test: (fixture: Fixture) => Promise<void>) {
  const db = new RaceD1();
  try {
    await createVaultLocalFixture(db as unknown as D1Database);
    await test({ db, env: vaultLocalEnv(db as unknown as D1Database) });
    console.log(`PASS ${name}`);
  } finally { db.sqlite.close(); }
}

function request(method = "GET", body?: unknown, sessionCookie = cookie) {
  return new Request("https://local.test/api/player/vault", {
    method,
    headers: { cookie: sessionCookie, origin: "https://local.test", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function player(env: Env, method = "GET", body?: unknown, sessionCookie = cookie) {
  return handlePrivateVault(request(method, body, sessionCookie), env, "player");
}

function server(env: Env, method = "GET", body?: unknown, sessionCookie = cookie) {
  return handlePrivateVault(request(method, body, sessionCookie), env, "server", VAULT_LOCAL.serverId);
}

async function cabinet(response: Response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<VaultCabinetResponse>;
}

function nativeSelection(value: VaultCabinetResponse): VaultSlots {
  return {
    hero: value.items.find(item => item.catalog.kind !== "scene")?.id ?? null,
    supporting: [null, null, null, null],
    scene: value.items.find(item => item.catalog.kind === "scene")?.id ?? null,
  };
}

function savedCount(db: RaceD1) {
  return db.sqlite.prepare("SELECT COUNT(*) AS count FROM dzn_vault_showcases").get()?.count;
}

function auditCount(db: RaceD1) {
  return db.sqlite.prepare("SELECT COUNT(*) AS count FROM dzn_vault_audit").get()?.count;
}

function noNativeWrites(db: RaceD1) {
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM dzn_vault_grants").get()?.count, 0);
  assert.equal(savedCount(db), 0);
  assert.equal(auditCount(db), 0);
}

function beforeBatch(db: RaceD1, change: () => void) {
  db.beforeBatch = () => { db.beforeBatch = null; change(); };
}

function afterNativeRead(db: RaceD1, change: () => void) {
  db.afterRead = sql => {
    if (!sql.includes("SELECT id, item_id, source_type, granted_at")) return;
    db.afterRead = null;
    change();
  };
}

function expireCurrentSession(db: RaceD1) {
  // Same UTC date and ISO formatting exercise the T-versus-space comparison edge.
  db.sqlite.exec("UPDATE sessions SET expires_at = date('now') || 'T00:00:00.000Z' WHERE user_id = 'vault-player'");
}

async function run() {
  await scenario("revoked session between initial authentication and welcome claim commits nothing", async ({ db, env }) => {
    beforeBatch(db, () => db.sqlite.exec("DELETE FROM sessions WHERE user_id = 'vault-player'"));
    assert.equal((await player(env, "POST", { action: "claim_welcome" })).status, 409);
    noNativeWrites(db);
  });

  await scenario("same-day expired ISO sessions cannot read or mutate the private cabinet", async ({ db, env }) => {
    expireCurrentSession(db);
    assert.equal((await player(env)).status, 401);
    assert.equal((await player(env, "POST", { action: "claim_welcome" })).status, 401);
    noNativeWrites(db);
  });

  await scenario("session expiry immediately before the transaction rolls back the entire claim", async ({ db, env }) => {
    beforeBatch(db, () => expireCurrentSession(db));
    assert.equal((await player(env, "POST", { action: "claim_welcome" })).status, 409);
    noNativeWrites(db);
  });

  await scenario("current-owner transfer defeats an in-flight server grant", async ({ db, env }) => {
    beforeBatch(db, () => db.sqlite.exec("UPDATE linked_servers SET user_id = 'vault-other' WHERE id = 'vault-server'"));
    assert.equal((await server(env, "POST", { action: "claim_welcome" })).status, 409);
    noNativeWrites(db);
    assert.equal((await server(env)).status, 403);
    const newOwner = await cabinet(await server(env, "POST", { action: "claim_welcome" }, otherCookie));
    assert.equal(newOwner.items.length, 2);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM dzn_vault_grants WHERE scope_type = 'server' AND scope_id = 'vault-server'").get()?.count, 2);
  });

  await scenario("grant reversal between selection validation and commit cannot publish the item", async ({ db, env }) => {
    const value = await cabinet(await player(env, "POST", { action: "claim_welcome" }));
    const slots = nativeSelection(value);
    beforeBatch(db, () => db.sqlite.prepare("UPDATE dzn_vault_grants SET status = 'reversed', reversed_at = CURRENT_TIMESTAMP WHERE id = ?").run(slots.hero!.slice(6)));
    assert.equal((await player(env, "PUT", { expectedVersion: 0, published: true, slots })).status, 409);
    assert.equal(savedCount(db), 0);
    assert.equal(auditCount(db), 1, "The failed save must not add an audit event beyond the welcome claim.");
  });

  await scenario("purchase reversal between validation and commit cannot create a showcase", async ({ db, env }) => {
    const item = await seedVaultPurchase(db as unknown as D1Database, { id: "paid-race" });
    beforeBatch(db, () => db.sqlite.exec("UPDATE store_commerce_entitlements SET status = 'reversed', reversed_at = CURRENT_TIMESTAMP WHERE id = 'paid-race'"));
    assert.equal((await player(env, "PUT", { expectedVersion: 0, published: true, slots: { ...emptyVaultSlots(), hero: item } })).status, 409);
    assert.equal(savedCount(db), 0);
    assert.equal(auditCount(db), 0);
  });

  await scenario("a competing update wins without a stale writer overwriting it or adding audit", async ({ db, env }) => {
    const value = await cabinet(await player(env, "POST", { action: "claim_welcome" }));
    const slots = nativeSelection(value);
    await cabinet(await player(env, "PUT", { expectedVersion: 0, published: true, slots }));
    const empty = JSON.stringify(emptyVaultSlots());
    beforeBatch(db, () => db.sqlite.prepare("UPDATE dzn_vault_showcases SET version = 2, published = 0, slots_json = ? WHERE scope_type = 'player'").run(empty));
    assert.equal((await player(env, "PUT", { expectedVersion: 1, published: true, slots })).status, 409);
    assert.deepEqual({ ...db.sqlite.prepare("SELECT version, published, slots_json FROM dzn_vault_showcases").get() }, { version: 2, published: 0, slots_json: empty });
    assert.equal(auditCount(db), 2);
  });

  await scenario("a competing first save cannot be overwritten by an expected-zero create", async ({ db, env }) => {
    const value = await cabinet(await player(env, "POST", { action: "claim_welcome" }));
    beforeBatch(db, () => db.sqlite.prepare("INSERT INTO dzn_vault_showcases (scope_type, scope_id, version, published, slots_json, updated_by_user_id) VALUES ('player', 'vault-player', 1, 0, ?, 'vault-player')").run(JSON.stringify(emptyVaultSlots())));
    assert.equal((await player(env, "PUT", { expectedVersion: 0, published: true, slots: nativeSelection(value) })).status, 409);
    assert.equal(savedCount(db), 1);
    assert.equal(db.sqlite.prepare("SELECT published FROM dzn_vault_showcases").get()?.published, 0);
    assert.equal(auditCount(db), 1);
  });

  await scenario("an owner who loses a server during a private read receives no collection", async ({ db, env }) => {
    await cabinet(await server(env, "POST", { action: "claim_welcome" }));
    afterNativeRead(db, () => db.sqlite.exec("UPDATE linked_servers SET user_id = 'vault-other' WHERE id = 'vault-server'"));
    const response = await server(env);
    assert.equal(response.status, 403);
    assert.equal(Object.hasOwn(await response.json() as object, "items"), false);
  });

  await scenario("public-profile opt-out during a public read suppresses the response", async ({ db, env }) => {
    const value = await cabinet(await player(env, "POST", { action: "claim_welcome" }));
    await cabinet(await player(env, "PUT", { expectedVersion: 0, published: true, slots: nativeSelection(value) }));
    afterNativeRead(db, () => db.sqlite.exec("UPDATE player_profile_privacy_preferences SET public_profile_enabled = 0 WHERE user_id = 'vault-player'"));
    const response = await handlePublicPlayerVault(new Request("https://local.test/public"), env, VAULT_LOCAL.handle);
    assert.equal(response.status, 404);
    assert.equal(Object.hasOwn(await response.json() as object, "showcase"), false);
  });

  await scenario("unpublishing during a public read cannot return the previous selection", async ({ db, env }) => {
    const value = await cabinet(await player(env, "POST", { action: "claim_welcome" }));
    await cabinet(await player(env, "PUT", { expectedVersion: 0, published: true, slots: nativeSelection(value) }));
    afterNativeRead(db, () => db.sqlite.exec("UPDATE dzn_vault_showcases SET published = 0, version = version + 1 WHERE scope_type = 'player'"));
    const response = await handlePublicPlayerVault(new Request("https://local.test/public"), env, VAULT_LOCAL.handle);
    assert.deepEqual(await response.json(), { ok: true, showcase: null });
  });

  await scenario("invalid paid mode cannot fall back to a key or prevent a privacy-only unpublish", async ({ db, env }) => {
    const item = await seedVaultPurchase(db as unknown as D1Database, { id: "paid-outage" });
    const slots = { ...emptyVaultSlots(), hero: item };
    await cabinet(await player(env, "PUT", { expectedVersion: 0, published: true, slots }));
    const outage = { ...env, DZN_VAULT_STORE_MODE: "invalid", STRIPE_SECRET_KEY: "sk_test_local_fixture" } as unknown as Env;
    assert.equal(vaultStoreMode(outage), null);
    const hidden = await cabinet(await player(outage, "PUT", { expectedVersion: 1, published: false, slots }));
    assert.equal(hidden.showcase.published, false);
    assert.equal(hidden.showcase.slots.hero, item, "Unpublish must preserve the original selected reference.");
    assert.equal(hidden.purchaseSource, "unavailable");
    assert.equal((await player(outage, "PUT", { expectedVersion: 2, published: true, slots })).status, 503);
    assert.equal(db.sqlite.prepare("SELECT published FROM dzn_vault_showcases").get()?.published, 0);
  });

  await scenario("a reversed item may be hidden but cannot be republished", async ({ db, env }) => {
    const item = await seedVaultPurchase(db as unknown as D1Database, { id: "paid-refund" });
    const slots = { ...emptyVaultSlots(), hero: item };
    await cabinet(await player(env, "PUT", { expectedVersion: 0, published: true, slots }));
    db.sqlite.exec("UPDATE store_commerce_entitlements SET status = 'reversed', reversed_at = CURRENT_TIMESTAMP WHERE id = 'paid-refund'");
    const hidden = await cabinet(await player(env, "PUT", { expectedVersion: 1, published: false, slots }));
    assert.equal(hidden.showcase.published, false);
    assert.equal((await player(env, "PUT", { expectedVersion: 2, published: true, slots })).status, 400);
  });

  await scenario("privacy-only unpublish still rejects an owner transfer during the transaction", async ({ db, env }) => {
    const value = await cabinet(await server(env, "POST", { action: "claim_welcome" }));
    const slots = nativeSelection(value);
    await cabinet(await server(env, "PUT", { expectedVersion: 0, published: true, slots }));
    beforeBatch(db, () => db.sqlite.exec("UPDATE linked_servers SET user_id = 'vault-other' WHERE id = 'vault-server'"));
    assert.equal((await server(env, "PUT", { expectedVersion: 1, published: false, slots })).status, 409);
    assert.equal(db.sqlite.prepare("SELECT version FROM dzn_vault_showcases").get()?.version, 1);
    assert.equal(auditCount(db), 2);
  });

  console.log("Vault independent security and concurrency tests passed.");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
