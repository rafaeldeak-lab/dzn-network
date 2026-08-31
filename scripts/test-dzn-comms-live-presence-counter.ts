import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  DZN_COMMS_PRESENCE_COOKIE_MAX_AGE_SECONDS,
  DZN_COMMS_PRESENCE_COOKIE_NAME,
  DZN_COMMS_PRESENCE_TTL_SECONDS,
  hashDznCommsPresenceSessionKey,
  readDznCommsPresence,
  refreshDznCommsPresence,
  type DznCommsPresenceRecord,
  type DznCommsPresenceScope,
  type DznCommsPresenceStorage,
} from "../functions/_lib/dzn-comms-presence";
import { onRequestGet, onRequestPost } from "../functions/api/dzn-comms/presence";
import type { Env, PagesContext } from "../functions/_lib/types";

const ROUTE = "functions/api/dzn-comms/presence.ts";
const HELPER = "functions/_lib/dzn-comms-presence.ts";
const MIGRATION = "migrations/0070_dzn_comms_presence_counter.sql";
const COUNTER = "components/community/dzn-live-presence-counter.tsx";
const SHELL = "components/community/dzn-comms-visual-shell.tsx";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const SAFE_MONETISATION_BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const PRESENCE_HANDOFF = "docs/DZN_COMMS_LIVE_PRESENCE_COUNTER_FOUNDATION_HANDOFF.md";
const STORE_PREVIEW_PAGE = "app/store/page.tsx";
const STORE_PREVIEW_COMPONENT = "components/store/dzn-store-preview-page.tsx";
const STORE_ORDER_ROUTE = "functions/api/store/orders.ts";
const STORE_ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const PACKAGE_JSON = "package.json";

const ENABLED_ENV = {
  DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED: "true",
  DZN_COMMS_PRESENCE_READ_ENABLED: "true",
  DZN_COMMS_PRESENCE_WRITE_ENABLED: "true",
};

async function main() {
  assertFilesExist();
  await assertDisabledByDefault();
  await assertPresenceIsAggregateAndShortLived();
  await assertRouteIgnoresClientCountAndPrivateFields();
  assertMigrationIsMinimalAndNonIdentifying();
  assertUiIsFallbackFirstAndFlagged();
  assertDocsAndBacklogContracts();
  assertNoForbiddenRuntime();
  assertNoProviderDependencies();
  assertPackageScript();
  console.log("DZN Comms live presence counter foundation tests passed.");
}

function assertFilesExist() {
  for (const path of [ROUTE, HELPER, MIGRATION, COUNTER, SHELL, MASTER_SPEC, PUBLIC_POLICY, SAFE_MONETISATION_BACKLOG, PRESENCE_HANDOFF, PACKAGE_JSON]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

async function assertDisabledByDefault() {
  const store = new MemoryPresenceStore();
  const now = new Date("2026-08-26T10:00:00.000Z");
  const readPayload = await readDznCommsPresence({ env: {}, storage: store, rawScope: "global_chat", now });

  assert.equal(readPayload.status, "disabled", "Presence reads must be disabled by default.");
  assert.equal(readPayload.onlineCount, null, "Disabled presence reads must not expose a count.");
  assert.deepEqual(store.operations, [], "Disabled reads must not query or mutate presence storage.");

  const heartbeat = await refreshDznCommsPresence({
    env: {},
    storage: store,
    rawScope: "global_chat",
    now,
    existingSessionKey: null,
    createSessionKey: () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  assert.equal(heartbeat.wrote, false, "Presence writes must be disabled by default.");
  assert.equal(heartbeat.setCookieHeader, undefined, "Disabled presence writes must not set a presence cookie.");
  assert.equal(heartbeat.payload.status, "disabled", "Disabled heartbeat must return fallback status.");
  assert.deepEqual(store.operations, [], "Disabled heartbeat must not touch storage.");
}

async function assertPresenceIsAggregateAndShortLived() {
  const store = new MemoryPresenceStore();
  const firstSeen = new Date("2026-08-26T10:00:00.000Z");
  const sameSession = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const secondSession = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const first = await refreshDznCommsPresence({
    env: ENABLED_ENV,
    storage: store,
    rawScope: "global-chat",
    now: firstSeen,
    existingSessionKey: null,
    createSessionKey: () => sameSession,
    secureCookie: false,
  });

  assert.equal(first.wrote, true);
  assert.equal(first.payload.scope, "global_chat", "Hyphenated scopes should normalize to the allowed public scope.");
  assert.equal(first.payload.onlineCount, 1);
  assert.ok(first.setCookieHeader?.startsWith(`${DZN_COMMS_PRESENCE_COOKIE_NAME}=`), "Heartbeat should set an opaque presence cookie when writes are enabled.");
  assert.match(first.setCookieHeader ?? "", /HttpOnly/);
  assert.match(first.setCookieHeader ?? "", new RegExp(`Max-Age=${DZN_COMMS_PRESENCE_COOKIE_MAX_AGE_SECONDS}`));
  assert.match(first.setCookieHeader ?? "", /Path=\/api\/dzn-comms\/presence/);

  const duplicateTab = await refreshDznCommsPresence({
    env: ENABLED_ENV,
    storage: store,
    rawScope: "global_chat",
    now: new Date("2026-08-26T10:00:10.000Z"),
    existingSessionKey: sameSession,
    createSessionKey: () => "cccccccccccccccccccccccccccccccc",
    secureCookie: false,
  });
  assert.equal(duplicateTab.payload.onlineCount, 1, "The same short-lived presence-session key must update, not inflate, the aggregate count.");

  const second = await refreshDznCommsPresence({
    env: ENABLED_ENV,
    storage: store,
    rawScope: "global_chat",
    now: new Date("2026-08-26T10:00:20.000Z"),
    existingSessionKey: null,
    createSessionKey: () => secondSession,
    secureCookie: false,
  });
  assert.equal(second.payload.onlineCount, 2, "Different page sessions may be counted as aggregate online sessions.");

  const stillFresh = await readDznCommsPresence({
    env: ENABLED_ENV,
    storage: store,
    rawScope: "global_chat",
    now: new Date("2026-08-26T10:01:04.000Z"),
  });
  assert.equal(stillFresh.onlineCount, 1, "The latest heartbeat remains inside the 45-second TTL.");

  const expired = await readDznCommsPresence({
    env: ENABLED_ENV,
    storage: store,
    rawScope: "global_chat",
    now: new Date("2026-08-26T10:01:06.000Z"),
  });
  assert.equal(expired.onlineCount, 0, "Presence expires by TTL and does not become retained analytics.");
  assert.equal(expired.ttlSeconds, DZN_COMMS_PRESENCE_TTL_SECONDS);

  const row = [...store.records.values()][0];
  assert.ok(row, "The test store should have a stored hashed presence row.");
  assert.equal(row.presenceKeyHash, await hashDznCommsPresenceSessionKey(sameSession), "Stored presence key should match the server-side hash.");
  assert.notEqual(row.presenceKeyHash, sameSession, "Storage must keep the hashed presence key, not the raw cookie value.");
}

async function assertRouteIgnoresClientCountAndPrivateFields() {
  const fake = new RoutePresenceDb();
  const request = new Request("https://dzn.test/api/dzn-comms/presence?scope=global_chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "global_chat",
      onlineCount: 9999,
      userId: "must-not-leak",
      discordId: "must-not-leak",
      route: "/billing/private",
    }),
  });

  const response = await onRequestPost(makeContext(request, { ...ENABLED_ENV, DB: fake.db } as Env));
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(payload.onlineCount, 1, "The route must ignore client-supplied count fields.");
  assert.equal(response.headers.get("cache-control")?.includes("no-store"), true, "Presence responses must be no-store.");
  assert.equal(response.headers.get("x-dzn-presence-contract"), "aggregate-only");

  const serialized = JSON.stringify(payload);
  for (const forbidden of ["must-not-leak", "discordId", "userId", "/billing/private", "ip", "userAgent", "billing", "owner", "nitrado"]) {
    assert.equal(serialized.includes(forbidden), false, `Presence payload must not expose ${forbidden}.`);
  }

  const getResponse = await onRequestGet(makeContext(new Request("https://dzn.test/api/dzn-comms/presence?scope=invalid-scope"), {
    ...ENABLED_ENV,
    DB: fake.db,
  } as Env));
  const getPayload = await getResponse.json() as Record<string, unknown>;
  assert.equal(getPayload.scope, "community", "Invalid public scopes must fall back to the safe community aggregate scope.");
  assert.equal(getPayload.onlineCount, 0);

  const disabledResponse = await onRequestPost(makeContext(new Request("https://dzn.test/api/dzn-comms/presence?scope=global_chat", {
    method: "POST",
    body: JSON.stringify({ scope: "global_chat" }),
  }), { DB: fake.db } as Env));
  const disabledPayload = await disabledResponse.json() as Record<string, unknown>;
  assert.equal(disabledResponse.status, 202);
  assert.equal(disabledPayload.status, "disabled");
}

function assertMigrationIsMinimalAndNonIdentifying() {
  const migration = read(MIGRATION);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS dzn_comms_presence_sessions/i);
  assert.match(migration, /presence_key_hash TEXT PRIMARY KEY/i);
  assert.match(migration, /scope TEXT NOT NULL CHECK/i);
  assert.match(migration, /expires_at TEXT NOT NULL/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_dzn_comms_presence_sessions_scope_expires/i);

  for (const forbidden of [
    /\bip(?:_address)?\b/i,
    /\buser_agent\b/i,
    /\breferrer\b/i,
    /\broute\b/i,
    /\bpage\b/i,
    /\bdiscord_id\b/i,
    /\buser_id\b/i,
    /\bprofile_handle\b/i,
    /\bbilling\b/i,
    /\bowner_entitlement\b/i,
    /\bnitrado\b/i,
    /\breview\b/i,
    /\bevent_id\b/i,
    /\bchallenge\b/i,
    /\bscore\b/i,
    /\branking\b/i,
  ]) {
    assert.doesNotMatch(migration, forbidden, `Presence migration must not include identifying or competitive field ${forbidden}.`);
  }
}

function assertUiIsFallbackFirstAndFlagged() {
  const counter = read(COUNTER);
  assert.match(counter, /NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED\s*===\s*"true"/);
  assert.match(counter, /data-dzn-live-presence-counter="public-safe-aggregate"/);
  assert.match(counter, /data-dzn-presence-fallback="static"/);
  assert.match(counter, /Static fallback/);
  assert.match(counter, /\/api\/dzn-comms\/presence\?scope=/);
  assert.match(counter, /method:\s*"POST"/);
  assert.match(counter, /PRESENCE_REFRESH_MS\s*=\s*30_000/);
  assert.match(counter, /PRESENCE_REQUEST_TIMEOUT_MS\s*=\s*4_000/);

  for (const forbidden of [
    /localStorage/i,
    /sessionStorage/i,
    /indexedDB/i,
    /document\.cookie/i,
    /navigator\.sendBeacon/i,
    /new\s+WebSocket/i,
    /EventSource/i,
    /BroadcastChannel/i,
    /gtag\s*\(/i,
    /dataLayer/i,
    /posthog/i,
    /mixpanel/i,
    /amplitude/i,
    /plausible/i,
    /trackEvent/i,
    /analytics/i,
    /createCheckoutSession/i,
    /DZN_LIVE_CHECKOUT_ENABLED/i,
    /STRIPE_SECRET_KEY/i,
    /DISCORD_BOT_TOKEN/i,
    /NITRADO/i,
    /openai\.responses/i,
    /chat\.completions/i,
    /vectorize/i,
  ]) {
    assert.doesNotMatch(counter, forbidden, `Counter UI must avoid runtime/tracking/payment pattern ${forbidden}.`);
  }

  const shell = read(SHELL);
  assert.match(shell, /DznLivePresenceCounter/);
  assert.match(shell, /data-dzn-comms-prototype="static-local-mock-data"/);
  assert.match(shell, /Composer disabled in this static prototype - no messages are sent or stored\./);
}

function assertDocsAndBacklogContracts() {
  const docs = [read(MASTER_SPEC), read(PUBLIC_POLICY), read(SAFE_MONETISATION_BACKLOG), read(PRESENCE_HANDOFF)].join("\n");
  for (const snippet of [
    "DZN Safe Monetisation And Supporter System Backlog",
    "This decision supersedes the earlier paid-spin idea.",
    "Players must never be able to purchase spins",
    "Maximum three total spins in any rolling 24-hour period",
    "Minimum four-hour cooldown between spins",
    "Every spin provides a reward",
    "Display the complete reward pool and probabilities",
    "DZN FOUNDING SUPPORTER PACK",
    "DZN-SUP-002481",
    "Never grant an entitlement from only the success-page redirect.",
    "Signed webhook verification",
    "Idempotent fulfilment",
    "Refund and chargeback handling",
    "No storage of card information in DZN",
    "Cosmetic purchases never change XP, rankings, scoring, or eligibility",
    "DZN Comms Live Presence Counter Foundation",
    "DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED",
    "DZN_COMMS_PRESENCE_READ_ENABLED",
    "DZN_COMMS_PRESENCE_WRITE_ENABLED",
    "NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED",
    "dzn_comms_presence_sessions",
    "public-safe aggregate",
    "no identifying public output",
    "Live checkout remains disabled",
    "Issue #49 remains reserved for final live payment activation",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs/backlog must include: ${snippet}`);
  }
}

function assertNoForbiddenRuntime() {
  const route = read(ROUTE);
  const helper = read(HELPER);
  const sources = [
    { path: ROUTE, source: route },
    { path: HELPER, source: helper },
  ];

  for (const { path, source } of sources) {
    for (const pattern of [
      /getRequestSessionUser/i,
      /requireOwnerRequestAccess/i,
      /owner_billing_accounts/i,
      /server_subscriptions/i,
      /owner_plan_entitlements/i,
      /server_owners/i,
      /server_rankings/i,
      /leaderboards/i,
      /discovery_score/i,
      /server_reviews/i,
      /review_score/i,
      /server_badge_awards/i,
      /dzn_seasons/i,
      /competitive_events/i,
      /server_war/i,
      /ctf/i,
      /player_xp/i,
      /calling_card/i,
      /NITRADO/i,
      /DISCORD_BOT_TOKEN/i,
      /STRIPE/i,
      /DZN_LIVE_CHECKOUT_ENABLED/i,
      /createCheckoutSession/i,
      /new\s+WebSocket/i,
      /WebSocketPair/i,
      /DurableObject/i,
      /EventSource/i,
      /BroadcastChannel/i,
      /navigator\.sendBeacon/i,
      /gtag\s*\(/i,
      /posthog/i,
      /mixpanel/i,
      /analytics/i,
      /openai\.responses/i,
      /chat\.completions/i,
      /createEmbedding/i,
      /vectorize/i,
      /\bchat_messages\b/i,
      /\bchat_message_reports\b/i,
      /\bchat_moderation_actions\b/i,
      /\bchat_user_mutes\b/i,
      /\bchat_support_sessions\b/i,
    ]) {
      assert.doesNotMatch(source, pattern, `${path} must not contain forbidden runtime pattern ${pattern}.`);
    }
  }

  const wranglerSources = ["wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"]
    .filter((path) => existsSync(path))
    .map((path) => read(path))
    .join("\n");
  assert.doesNotMatch(wranglerSources, /DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED|DZN_COMMS_PRESENCE_READ_ENABLED|DZN_COMMS_PRESENCE_WRITE_ENABLED/i);

  const forbiddenRuntimePaths = [
    "functions/api/chat",
    "functions/api/support-chat",
    "functions/api/dzn-assist",
    "functions/api/dzn-comms/messages",
    "functions/api/dzn-comms/moderation",
    "functions/api/dzn-comms/support",
    "functions/api/community/chat",
    "app/api/chat",
    "app/api/support-chat",
    "app/api/dzn-assist",
    "app/api/dzn-comms",
    "app/community/chat/page.tsx",
    "app/support-chat/page.tsx",
    "app/dzn-assist/page.tsx",
    "components/chat",
    "components/support-chat",
    "components/dzn-assist",
    "lib/chat.ts",
    "lib/chat",
    "lib/support-bot.ts",
    "lib/support-bot",
    "lib/dzn-assist.ts",
    "lib/dzn-assist",
  ];
  for (const path of forbiddenRuntimePaths) {
    assert.equal(existsSync(path), false, `${path} must not be introduced by the presence counter foundation.`);
  }

  const forbiddenStorePaths = [
    "functions/api/supporter",
    "functions/api/wheel",
    "app/supporter/page.tsx",
    "app/wheel/page.tsx",
    "components/supporter",
    "components/wheel",
    "lib/store.ts",
    "lib/supporter.ts",
    "lib/wheel.ts",
  ];
  for (const path of forbiddenStorePaths) {
    assert.equal(existsSync(path), false, `${path} must not be introduced by the backlog-only monetisation addition.`);
  }

  assert.equal(existsSync(STORE_PREVIEW_PAGE), true, "The Store preview route may exist only as the read-only public preview contract.");
  assert.equal(existsSync(STORE_PREVIEW_COMPONENT), true, "The Store preview component may exist only as the read-only public preview contract.");
  assert.equal(existsSync(STORE_ORDER_ROUTE), true, "The Store sandbox order route may exist only as the approved disabled local/test pending-order route.");
  assert.equal(existsSync(STORE_ORDER_HELPER), true, "The Store sandbox order helper may exist only as the approved disabled local/test pending-order helper.");

  const previewSources = [
    { path: STORE_PREVIEW_PAGE, source: read(STORE_PREVIEW_PAGE) },
    { path: STORE_PREVIEW_COMPONENT, source: read(STORE_PREVIEW_COMPONENT) },
  ];
  for (const { path, source } of previewSources) {
    assert.doesNotMatch(source, /fetch\s*\(|\/api\/store|\/api\/billing|createCheckoutSession|checkout\.sessions\.create|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|verifyStripeWebhook/i, `${path} must remain read-only Store preview UI.`);
  }

  const storeOrderSources = [
    { path: STORE_ORDER_ROUTE, source: read(STORE_ORDER_ROUTE) },
    { path: STORE_ORDER_HELPER, source: read(STORE_ORDER_HELPER) },
  ];
  for (const { path, source } of storeOrderSources) {
    assert.equal(source.includes("checkout_session_creation_requires_future_approval") || path === STORE_ORDER_ROUTE, true, `${path} must keep Store checkout unavailable.`);
    assert.doesNotMatch(source, /checkout\.sessions\.create|\/checkout\/sessions|stripeFormRequest|verifyStripeWebhook|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|\bstore_payment_events\b|\baccount_entitlements\b|\bsupporter_cards\b|\bearned_spins\b|\bspin_ledger\b|\bwheel_cooldowns\b/i, `${path} must not add Store checkout, webhook, entitlement, supporter, spin, or wheel runtime.`);
  }
}

function assertNoProviderDependencies() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const dependencyNames = Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  });
  const forbidden = dependencyNames.filter((name) => [
    /^openai$/i,
    /^ai$/i,
    /^@ai-sdk\//i,
    /^langchain$/i,
    /^@langchain\//i,
    /^anthropic$/i,
    /^@anthropic-ai\//i,
  ].some((pattern) => pattern.test(name)));
  assert.deepEqual(forbidden, [], "Presence counter must not add AI provider dependencies.");
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-comms-live-presence-counter"],
    "tsx scripts/test-dzn-comms-live-presence-counter.ts",
    "Focused DZN Comms live presence counter test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-comms-live-presence-counter"),
    true,
    "Full npm test should include the live presence counter guard.",
  );
}

class MemoryPresenceStore implements DznCommsPresenceStorage {
  readonly records = new Map<string, DznCommsPresenceRecord>();
  readonly operations: string[] = [];

  async cleanupExpired(nowIso: string) {
    this.operations.push("cleanupExpired");
    const nowMs = Date.parse(nowIso);
    for (const [key, row] of this.records) {
      if (Date.parse(row.expiresAt) <= nowMs) this.records.delete(key);
    }
  }

  async upsert(record: DznCommsPresenceRecord) {
    this.operations.push("upsert");
    const previous = this.records.get(record.presenceKeyHash);
    this.records.set(record.presenceKeyHash, {
      ...record,
      firstSeenAt: previous?.firstSeenAt ?? record.firstSeenAt,
    });
  }

  async countActive(scope: DznCommsPresenceScope, nowIso: string) {
    this.operations.push("countActive");
    const nowMs = Date.parse(nowIso);
    return [...this.records.values()]
      .filter((row) => row.scope === scope)
      .filter((row) => Date.parse(row.expiresAt) > nowMs)
      .length;
  }
}

class RoutePresenceDb {
  private readonly store = new MemoryPresenceStore();

  readonly db = {
    prepare: (sql: string) => ({
      bind: (...bindings: unknown[]) => this.statement(sql, bindings),
      all: async <T>() => ({ success: true, meta: {}, results: [] as T[] }),
      first: async <T>() => this.first<T>(sql, []),
      run: async () => ({ success: true, meta: {} }),
    }),
  } as unknown as D1Database;

  private statement(sql: string, bindings: unknown[]) {
    return {
      bind: (...nextBindings: unknown[]) => this.statement(sql, nextBindings),
      all: async <T>() => ({ success: true, meta: {}, results: [] as T[] }),
      first: async <T>() => this.first<T>(sql, bindings),
      run: async () => this.run(sql, bindings),
    };
  }

  private async first<T>(sql: string, bindings: unknown[]) {
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+online_count/i.test(sql)) {
      const scope = String(bindings[0] ?? "community") as DznCommsPresenceScope;
      const nowIso = String(bindings[1] ?? new Date(0).toISOString());
      return { online_count: await this.store.countActive(scope, nowIso) } as T;
    }
    return null;
  }

  private async run(sql: string, bindings: unknown[]) {
    if (/DELETE\s+FROM\s+dzn_comms_presence_sessions/i.test(sql)) {
      await this.store.cleanupExpired(String(bindings[0] ?? new Date(0).toISOString()));
    }
    if (/INSERT\s+INTO\s+dzn_comms_presence_sessions/i.test(sql)) {
      const [presenceKeyHash, scope, firstSeenAt, lastSeenAt, expiresAt] = bindings.map((value) => String(value));
      await this.store.upsert({
        presenceKeyHash,
        scope: scope as DznCommsPresenceScope,
        firstSeenAt,
        lastSeenAt,
        expiresAt,
      });
    }
    return { success: true, meta: { changes: 1 } };
  }
}

function makeContext(request: Request, env: Env): PagesContext {
  return {
    request,
    env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  };
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}

void main();
