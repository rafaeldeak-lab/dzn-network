import {
  emptyVaultSlots, getVaultCatalogItem, legacySupporterCatalog, VAULT_WELCOME_ITEMS,
  type PublicVaultResponse, type VaultCabinetResponse, type VaultCatalogItem,
  type VaultOwnedItem, type VaultScope, type VaultShowcase, type VaultSlots,
} from "../../lib/vault";
import { SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES, serverLifecycleInSql, serverLifecycleSqlExpression } from "../../lib/server-lifecycle";
import { hmacSha256 } from "./crypto";
import { getSessionUser, SESSION_COOKIE } from "./db";
import { json, readBoundedJson, readCookie } from "./http";
import { noStoreForErrorHeaders, privateNoStoreHeaders } from "./performance";
import type { Env, SessionUser } from "./types";

type ScopeOwner = { scope: VaultScope; id: string; displayName: string };
type AuthenticatedOwner = ScopeOwner & { user: SessionUser; sessionHash: string };
type ShowcaseRow = { version: number; published: number; slots_json: string; updated_at: string };
type GrantRow = { id: string; item_id: string; source_type: "welcome" | "earned"; granted_at: string };
type PurchaseRow = { id: string; product_key: string; product_name: string; granted_at: string };
type SqlGuard = { sql: string; values: unknown[] };
type SaveInput = { expectedVersion: number; published: boolean; slots: VaultSlots };

const MAX_BODY_BYTES = 4096;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const REFERENCE = /^(grant|store):[A-Za-z0-9_-]{1,128}$/;
const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRIVATE_SERVER_SQL = `lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
  AND COALESCE(linked_servers.merged_into_server_id, '') = ''`;
const PUBLIC_SERVER_SQL = `${serverLifecycleSqlExpression("linked_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES)})
  AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
  AND COALESCE(linked_servers.merged_into_server_id, '') = ''
  AND linked_servers.public_slug IS NOT NULL AND trim(linked_servers.public_slug) != ''`;

// The purchase adapter only reads the established commerce ledger. It never
// enables checkout or copies financial records into Vault ownership.
const PURCHASE_FROM = `FROM store_commerce_entitlements e
  JOIN store_commerce_orders o ON o.id = e.order_id AND o.purchasing_user_id = e.purchasing_user_id
  JOIN store_commerce_order_items i ON i.order_id = e.order_id AND i.product_key = e.product_key
    AND i.fulfilment_kind = e.fulfilment_kind
  JOIN store_commerce_fulfilments f ON f.id = e.fulfilment_id AND f.order_id = e.order_id
    AND f.purchasing_user_id = e.purchasing_user_id AND f.status = 'completed'
  JOIN store_commerce_receipts r ON r.order_id = e.order_id
    AND r.purchasing_user_id = e.purchasing_user_id AND r.status = 'issued'
  WHERE e.purchasing_user_id = ? AND e.status = 'active' AND e.reversed_at IS NULL
    AND e.fulfilment_kind = 'supporter_card' AND o.status = 'fulfilled'
    AND o.livemode = ? AND o.stripe_mode = ?`;

class VaultError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function vaultEnabled(env: Env): boolean {
  const value = (env as unknown as Record<string, unknown>).DZN_VAULT_ENABLED;
  return value === true || ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export function vaultStoreMode(env: Env): "live" | "test" | null {
  const configured = (env as unknown as Record<string, unknown>).DZN_VAULT_STORE_MODE;
  if (configured !== undefined && configured !== null) {
    const value = typeof configured === "string" ? configured.trim().toLowerCase() : "";
    return value === "live" || value === "test" ? value : null;
  }
  const key = typeof env.STRIPE_SECRET_KEY === "string" ? env.STRIPE_SECRET_KEY.trim() : "";
  return key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : null;
}

export async function handlePrivateVault(request: Request, env: Env, scope: VaultScope, serverId?: unknown): Promise<Response> {
  try {
    if (!["GET", "POST", "PUT"].includes(request.method)) throw new VaultError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
    if (!vaultEnabled(env)) throw new VaultError(404, "VAULT_UNAVAILABLE", "The Vault is not available in this environment.");
    const owner = await authenticatedOwner(env, request, scope, serverId);
    if (request.method === "GET") {
      const cabinet = await readCabinet(env, owner);
      await authenticatedOwner(env, request, scope, serverId);
      return privateReply(cabinet);
    }
    if (!sameOrigin(request)) throw new VaultError(403, "FORBIDDEN", "This action must come from the DZN website.");
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new VaultError(415, "JSON_REQUIRED", "Send a JSON request body.");
    }
    const body = await readBoundedJson<unknown>(request, MAX_BODY_BYTES);
    if (!body.ok) throw new VaultError(body.status, body.error, body.message);
    if (request.method === "POST") {
      if (!record(body.value) || !exactKeys(body.value, ["action"]) || body.value.action !== "claim_welcome") {
        throw new VaultError(400, "INVALID_ACTION", "Choose the welcome collection action.");
      }
      await claimWelcome(env, owner);
    } else {
      await saveShowcase(env, owner, parseSaveInput(body.value));
    }
    // A second owner read prevents a response disclosing the old server owner's
    // private collection if ownership changes immediately after the transaction.
    const currentOwner = await authenticatedOwner(env, request, scope, serverId);
    const cabinet = await readCabinet(env, currentOwner);
    await authenticatedOwner(env, request, scope, serverId);
    return privateReply(cabinet);
  } catch (error) {
    return failure(error, true);
  }
}

export async function handlePublicPlayerVault(request: Request, env: Env, rawHandle: unknown): Promise<Response> {
  try {
    publicReadGuard(request, env);
    const handle = typeof rawHandle === "string" ? rawHandle : "";
    if (handle.length < 3 || handle.length > 48 || !HANDLE.test(handle)) throw notFound();
    const owner = await env.DB.prepare(`SELECT p.user_id AS id FROM player_public_profiles p
      JOIN player_profile_privacy_preferences prefs ON prefs.user_id = p.user_id
      JOIN users ON users.id = p.user_id
      WHERE p.handle = ? AND p.status = 'active' AND prefs.public_profile_enabled = 1 LIMIT 1`)
      .bind(handle).first<{ id: string }>();
    if (!owner) throw notFound();
    const result = await readPublicShowcase(env, { scope: "player", id: owner.id, displayName: "" });
    // Independent Vault publication is its consent. Legacy show_calling_cards
    // does not override it; the entire public profile's privacy still does.
    const stillPublic = await env.DB.prepare(`SELECT p.user_id FROM player_public_profiles p
      JOIN player_profile_privacy_preferences prefs ON prefs.user_id = p.user_id
      WHERE p.handle = ? AND p.user_id = ? AND p.status = 'active' AND prefs.public_profile_enabled = 1`)
      .bind(handle, owner.id).first();
    if (!stillPublic) throw notFound();
    return publicReply(result);
  } catch (error) { return failure(error, false); }
}

export async function handlePublicServerVault(request: Request, env: Env, rawServerId: unknown): Promise<Response> {
  try {
    publicReadGuard(request, env);
    const id = validId(rawServerId);
    if (!id || !await publicServer(env.DB, id)) throw notFound();
    const result = await readPublicShowcase(env, { scope: "server", id, displayName: "" });
    if (!await publicServer(env.DB, id)) throw notFound();
    return publicReply(result);
  } catch (error) { return failure(error, false); }
}

async function authenticatedOwner(env: Env, request: Request, scope: VaultScope, rawServerId?: unknown): Promise<AuthenticatedOwner> {
  // Never create a mock user, session or any other state on a read.
  const user = await getSessionUser(env, request);
  if (!user) throw new VaultError(401, "UNAUTHORIZED", "Log in to open your Vault.");
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) throw new VaultError(401, "UNAUTHORIZED", "Log in to open your Vault.");
  const sessionHash = await hmacSha256(token, env.SESSION_SECRET || "dev-session-secret");
  // Parse both supported SQL and ISO expiry formats rather than comparing their
  // text separators. This strengthens only the new Vault boundary.
  const activeSession = await env.DB.prepare(`SELECT id FROM sessions WHERE user_id = ? AND session_token_hash = ?
    AND datetime(expires_at) > datetime('now')`).bind(user.id, sessionHash).first();
  if (!activeSession) throw new VaultError(401, "UNAUTHORIZED", "Your session has expired. Log in again.");
  if (scope === "player") return { scope, id: user.id, displayName: user.username || "DZN Player", user, sessionHash };
  const id = validId(rawServerId);
  if (!id) throw notFound();
  const server = await env.DB.prepare(`SELECT id, user_id, server_name FROM linked_servers
    WHERE id = ? AND ${PRIVATE_SERVER_SQL}`).bind(id)
    .first<{ id: string; user_id: string | null; server_name: string | null }>();
  if (!server) throw notFound();
  if (server.user_id !== user.id) throw new VaultError(403, "FORBIDDEN", "Only this server's current owner can manage its Vault.");
  return { scope, id: server.id, displayName: server.server_name || "DZN Server", user, sessionHash };
}

async function readCabinet(env: Env, owner: ScopeOwner): Promise<VaultCabinetResponse> {
  const [grants, purchaseRead, saved, claimed, profile] = await Promise.all([
    readNativeItems(env.DB, owner), readPurchases(env, owner), readShowcase(env.DB, owner),
    env.DB.prepare(`SELECT item_id FROM dzn_vault_grants WHERE scope_type = ? AND scope_id = ? AND source_type = 'welcome'`)
      .bind(owner.scope, owner.id).all<{ item_id: string }>(),
    publicProfileLocation(env.DB, owner),
  ]);
  const claimedItems = new Set((claimed.results ?? []).map((item) => item.item_id));
  return {
    ok: true, scope: owner.scope, displayName: owner.displayName,
    items: [...grants, ...purchaseRead.items], showcase: saved,
    welcomeAvailable: VAULT_WELCOME_ITEMS[owner.scope].some((id) => !claimedItems.has(id)),
    purchaseSource: purchaseRead.source, ...profile,
  };
}

async function readNativeItems(db: D1Database, owner: ScopeOwner, selected?: string[]): Promise<VaultOwnedItem[]> {
  if (selected && !selected.length) return [];
  const filter = selected ? ` AND id IN (${selected.map(() => "?").join(",")})` : "";
  const rows = await db.prepare(`SELECT id, item_id, source_type, granted_at FROM dzn_vault_grants
    WHERE scope_type = ? AND scope_id = ? AND status = 'active' AND reversed_at IS NULL${filter}
    ORDER BY granted_at, id`).bind(owner.scope, owner.id, ...(selected ?? [])).all<GrantRow>();
  return (rows.results ?? []).flatMap((row) => {
    const catalog = getVaultCatalogItem(row.item_id);
    if (!catalog || catalog.availability === "preview" || !catalog.scopes.includes(owner.scope)) return [];
    return [{ id: `grant:${row.id}`, catalog, acquiredAt: row.granted_at, source: row.source_type }];
  });
}

async function readPurchases(env: Env, owner: ScopeOwner, selected?: string[]): Promise<{
  items: VaultOwnedItem[]; source: VaultCabinetResponse["purchaseSource"];
}> {
  if (owner.scope === "server") return { items: [], source: "not_applicable" };
  const mode = vaultStoreMode(env);
  if (!mode) return { items: [], source: "unavailable" };
  try {
    const filter = selected ? ` AND e.id IN (${selected.length ? selected.map(() => "?").join(",") : "NULL"})` : "";
    const rows = await env.DB.prepare(`SELECT e.id, e.product_key, i.product_name, e.granted_at ${PURCHASE_FROM}${filter}
      ORDER BY e.granted_at, e.id`).bind(owner.id, mode === "live" ? 1 : 0, mode, ...(selected ?? [])).all<PurchaseRow>();
    return {
      source: "ready",
      items: (rows.results ?? []).map((row) => ({
        id: `store:${row.id}`, catalog: legacySupporterCatalog(row.product_key, row.product_name),
        acquiredAt: row.granted_at, source: "purchase",
      })),
    };
  } catch {
    // A missing or temporarily failed paid ledger must not look like no purchases.
    return { items: [], source: "unavailable" };
  }
}

async function readShowcase(db: D1Database, owner: ScopeOwner): Promise<VaultShowcase> {
  const row = await db.prepare(`SELECT version, published, slots_json, updated_at FROM dzn_vault_showcases
    WHERE scope_type = ? AND scope_id = ?`).bind(owner.scope, owner.id).first<ShowcaseRow>();
  if (!row) return { version: 0, published: false, slots: emptyVaultSlots(), updatedAt: null };
  let slots: VaultSlots;
  try { slots = parseSlots(JSON.parse(row.slots_json)); }
  catch { throw new VaultError(503, "VAULT_NOT_READY", "Your saved showcase could not be read safely."); }
  return { version: row.version, published: row.published === 1, slots, updatedAt: row.updated_at };
}

async function publicProfileLocation(db: D1Database, owner: ScopeOwner) {
  if (owner.scope === "server") {
    const server = await publicServer(db, owner.id);
    return { publicProfileEnabled: Boolean(server), publicProfilePath: server ? `/servers/profile?slug=${encodeURIComponent(server.public_slug)}` : null };
  }
  const profile = await db.prepare(`SELECT p.handle FROM player_public_profiles p
    JOIN player_profile_privacy_preferences prefs ON prefs.user_id = p.user_id
    WHERE p.user_id = ? AND p.status = 'active' AND prefs.public_profile_enabled = 1`)
    .bind(owner.id).first<{ handle: string }>();
  return { publicProfileEnabled: Boolean(profile), publicProfilePath: profile ? `/players/${encodeURIComponent(profile.handle)}` : null };
}

async function publicServer(db: D1Database, id: string) {
  return db.prepare(`SELECT linked_servers.public_slug FROM linked_servers WHERE linked_servers.id = ? AND ${PUBLIC_SERVER_SQL}`)
    .bind(id).first<{ public_slug: string }>();
}

async function readPublicShowcase(env: Env, owner: ScopeOwner): Promise<PublicVaultResponse> {
  const saved = await readShowcase(env.DB, owner);
  if (!saved.published) return { ok: true, showcase: null };
  const references = selectedReferences(saved.slots);
  const [grants, purchases] = await Promise.all([
    readNativeItems(env.DB, owner, references.filter((id) => id.startsWith("grant:")).map((id) => id.slice(6))),
    readPurchases(env, owner, references.filter((id) => id.startsWith("store:")).map((id) => id.slice(6))),
  ]);
  const available = new Map([...grants, ...purchases.items].map((item) => [item.id, item.catalog]));
  const itemFor = (id: string | null, scene = false): VaultCatalogItem | null => {
    const item = id ? available.get(id) : undefined;
    return item && (scene ? item.kind === "scene" : item.kind !== "scene") ? item : null;
  };
  // Recheck publication after ownership reads. An unpublish or replacement
  // during this request cannot return the prior public selection.
  const current = await env.DB.prepare(`SELECT version, published FROM dzn_vault_showcases
    WHERE scope_type = ? AND scope_id = ?`).bind(owner.scope, owner.id).first<{ version: number; published: number }>();
  if (!current || current.published !== 1 || current.version !== saved.version) return { ok: true, showcase: null };
  return { ok: true, showcase: { slots: {
    hero: itemFor(saved.slots.hero),
    supporting: saved.slots.supporting.map((id) => itemFor(id)) as [VaultCatalogItem | null, VaultCatalogItem | null, VaultCatalogItem | null, VaultCatalogItem | null],
    scene: itemFor(saved.slots.scene, true),
  } } };
}

async function claimWelcome(env: Env, owner: AuthenticatedOwner) {
  // Verify schema availability before building a write, without creating it.
  await readShowcase(env.DB, owner);
  const guard = ownerGuard(owner);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [assertion(env.DB, guard)];
  for (const itemId of VAULT_WELCOME_ITEMS[owner.scope]) {
    const item = getVaultCatalogItem(itemId);
    if (!item || item.availability !== "welcome" || !item.scopes.includes(owner.scope)) {
      throw new VaultError(503, "VAULT_NOT_READY", "The welcome collection is not ready.");
    }
    statements.push(env.DB.prepare(`INSERT INTO dzn_vault_grants
      (id, scope_type, scope_id, item_id, source_type, source_key, status, granted_at)
      VALUES (?, ?, ?, ?, 'welcome', ?, 'active', ?)
      ON CONFLICT(scope_type, scope_id, item_id) DO NOTHING`)
      .bind(crypto.randomUUID(), owner.scope, owner.id, itemId, `welcome-v1:${itemId}`, now));
  }
  statements.push(env.DB.prepare(`INSERT INTO dzn_vault_audit
    (id, scope_type, scope_id, actor_user_id, action, detail_json, created_at)
    VALUES (?, ?, ?, ?, 'welcome_claimed', ?, ?) ON CONFLICT(id) DO NOTHING`)
    .bind(`welcome-v1:${owner.scope}:${owner.id}`, owner.scope, owner.id, owner.user.id,
      JSON.stringify({ items: VAULT_WELCOME_ITEMS[owner.scope] }), now));
  statements.push(assertion(env.DB, guard));
  await guardedBatch(env.DB, statements);
}

async function saveShowcase(env: Env, owner: AuthenticatedOwner, input: SaveInput) {
  const cabinet = await readCabinet(env, owner);
  if (cabinet.showcase.version !== input.expectedVersion) throw conflict();
  const references = selectedReferences(input.slots);
  // Privacy-reducing unpublication keeps all saved references unchanged and must
  // remain possible during an ownership-source outage or after a reversal.
  const unpublishOnly = !input.published && JSON.stringify(input.slots) === JSON.stringify(cabinet.showcase.slots);
  if (!unpublishOnly && cabinet.purchaseSource === "unavailable" && [...references, ...selectedReferences(cabinet.showcase.slots)].some((id) => id.startsWith("store:"))) {
    throw new VaultError(503, "PURCHASE_SOURCE_UNAVAILABLE", "Your purchased collection is temporarily unavailable. Your saved showcase has been kept.");
  }
  const owned = new Map(cabinet.items.map((item) => [item.id, item]));
  for (const reference of unpublishOnly ? [] : references) {
    if (!owned.has(reference)) throw new VaultError(400, "ITEM_NOT_OWNED", "Choose an item currently owned by this cabinet.");
  }
  if (!unpublishOnly && ((input.slots.hero && owned.get(input.slots.hero)?.catalog.kind === "scene")
    || input.slots.supporting.some((id) => id && owned.get(id)?.catalog.kind === "scene")
    || (input.slots.scene && owned.get(input.slots.scene)?.catalog.kind !== "scene"))) {
    throw new VaultError(400, "INVALID_SLOT", "Scenes belong in the scene slot; other collectibles belong in display slots.");
  }
  const access = ownerGuard(owner);
  const entitlementGuard = ownershipGuard(owner, unpublishOnly ? [] : references, vaultStoreMode(env));
  const guard = combineGuards(access, entitlementGuard, {
    sql: input.expectedVersion === 0
      ? "NOT EXISTS (SELECT 1 FROM dzn_vault_showcases WHERE scope_type = ? AND scope_id = ?)"
      : "EXISTS (SELECT 1 FROM dzn_vault_showcases WHERE scope_type = ? AND scope_id = ? AND version = ?)",
    values: input.expectedVersion === 0 ? [owner.scope, owner.id] : [owner.scope, owner.id, input.expectedVersion],
  });
  const nextVersion = input.expectedVersion + 1;
  const now = new Date().toISOString();
  const slotsJson = JSON.stringify(input.slots);
  await guardedBatch(env.DB, [
    assertion(env.DB, guard),
    env.DB.prepare(`INSERT INTO dzn_vault_showcases (scope_type, scope_id, version, published, slots_json, updated_by_user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        version = excluded.version, published = excluded.published, slots_json = excluded.slots_json,
        updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`)
      .bind(owner.scope, owner.id, nextVersion, input.published ? 1 : 0, slotsJson, owner.user.id, now),
    env.DB.prepare(`INSERT INTO dzn_vault_audit
      (id, scope_type, scope_id, actor_user_id, action, previous_version, next_version, detail_json, created_at)
      VALUES (?, ?, ?, ?, 'showcase_saved', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), owner.scope, owner.id, owner.user.id, input.expectedVersion, nextVersion,
        JSON.stringify({ published: input.published, slots: input.slots }), now),
    assertion(env.DB, combineGuards(access, entitlementGuard)),
  ]);
}

function ownerGuard(owner: AuthenticatedOwner): SqlGuard {
  const session: SqlGuard = {
    sql: `EXISTS (SELECT 1 FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.user_id = ? AND sessions.session_token_hash = ? AND datetime(sessions.expires_at) > datetime('now'))`,
    values: [owner.user.id, owner.sessionHash],
  };
  if (owner.scope === "player") return session;
  return combineGuards(session, {
    sql: `EXISTS (SELECT 1 FROM linked_servers WHERE id = ? AND user_id = ? AND ${PRIVATE_SERVER_SQL})`,
    values: [owner.id, owner.user.id],
  });
}

function ownershipGuard(owner: ScopeOwner, references: string[], mode: "live" | "test" | null): SqlGuard {
  return combineGuards(...references.map((reference): SqlGuard => {
    if (reference.startsWith("grant:")) return {
      sql: `EXISTS (SELECT 1 FROM dzn_vault_grants WHERE id = ? AND scope_type = ? AND scope_id = ? AND status = 'active' AND reversed_at IS NULL)`,
      values: [reference.slice(6), owner.scope, owner.id],
    };
    if (owner.scope !== "player" || !mode) return { sql: "0", values: [] };
    return { sql: `EXISTS (SELECT 1 ${PURCHASE_FROM} AND e.id = ?)`, values: [owner.id, mode === "live" ? 1 : 0, mode, reference.slice(6)] };
  }));
}

function combineGuards(...guards: SqlGuard[]): SqlGuard {
  return { sql: guards.length ? guards.map((guard) => `(${guard.sql})`).join(" AND ") : "1", values: guards.flatMap((guard) => guard.values) };
}

function assertion(db: D1Database, guard: SqlGuard) {
  // SQLite integer overflow aborts the entire D1 batch, including prior writes.
  return db.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE abs(-9223372036854775808) END AS vault_allowed`).bind(...guard.values);
}

async function guardedBatch(db: D1Database, statements: D1PreparedStatement[]) {
  try { await db.batch(statements); }
  catch (error) {
    if (/integer overflow|UNIQUE constraint failed: dzn_vault_showcases/i.test(error instanceof Error ? error.message : String(error))) throw conflict();
    throw error;
  }
}

function parseSaveInput(value: unknown): SaveInput {
  if (!record(value) || !exactKeys(value, ["expectedVersion", "published", "slots"])
    || !Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 0 || Number(value.expectedVersion) >= Number.MAX_SAFE_INTEGER
    || typeof value.published !== "boolean") {
    throw new VaultError(400, "INVALID_SHOWCASE", "Supply the current version, publication choice and six display slots.");
  }
  return { expectedVersion: Number(value.expectedVersion), published: value.published, slots: parseSlots(value.slots) };
}

function parseSlots(value: unknown): VaultSlots {
  if (!record(value) || !exactKeys(value, ["hero", "supporting", "scene"])
    || !Array.isArray(value.supporting) || value.supporting.length !== 4) {
    throw new VaultError(400, "INVALID_SLOTS", "Use one hero, four supporting slots and one scene.");
  }
  const all = [value.hero, ...value.supporting, value.scene];
  if (all.some((id) => id !== null && (typeof id !== "string" || !REFERENCE.test(id)))) {
    throw new VaultError(400, "INVALID_SLOTS", "Each slot must be empty or reference an owned item.");
  }
  const selected = all.filter((id): id is string => typeof id === "string");
  if (new Set(selected).size !== selected.length) throw new VaultError(400, "DUPLICATE_ITEM", "Each collectible can appear once in a showcase.");
  return { hero: value.hero as string | null, supporting: [...value.supporting] as VaultSlots["supporting"], scene: value.scene as string | null };
}

function selectedReferences(slots: VaultSlots): string[] { return [slots.hero, ...slots.supporting, slots.scene].filter((id): id is string => id !== null); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function exactKeys(value: Record<string, unknown>, allowed: string[]) { const keys = Object.keys(value); return keys.length === allowed.length && keys.every((key) => allowed.includes(key)); }
function validId(value: unknown) { return typeof value === "string" && ID.test(value) ? value : null; }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); if (!origin) return false; try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; } }
function notFound() { return new VaultError(404, "VAULT_NOT_FOUND", "This public Vault or server is not available."); }
function conflict() { return new VaultError(409, "VAULT_CONFLICT", "The showcase, ownership or session changed. Refresh before saving again."); }
function privateReply(data: unknown, status = 200) { return json(data, { status, headers: privateNoStoreHeaders() }); }
function publicReply(data: unknown, status = 200) { return json(data, { status, headers: noStoreForErrorHeaders() }); }
function publicReadGuard(request: Request, env: Env) {
  if (request.method !== "GET") throw new VaultError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  if (!vaultEnabled(env)) throw new VaultError(404, "VAULT_UNAVAILABLE", "The Vault is not available in this environment.");
}
function failure(error: unknown, privateResponse: boolean) {
  const known = error instanceof VaultError ? error : new VaultError(503, "VAULT_NOT_READY", "The Vault is temporarily unavailable. Your collection has been kept.");
  return (privateResponse ? privateReply : publicReply)({ ok: false, error: known.code, message: known.message }, known.status);
}
