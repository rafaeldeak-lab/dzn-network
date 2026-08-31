import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { onRequest as messageRoute } from "../functions/api/dzn-comms/channels/[channelId]/messages";
import {
  canUseDznCommsMessageReadRuntime,
  DZN_COMMS_MESSAGE_READ_ENABLED_FLAG,
  DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME_FLAG,
  DZN_COMMS_MESSAGE_READ_ROUTE,
  DZN_COMMS_MESSAGE_READ_SCHEMA_VERSION,
  DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED_FLAG,
  DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED_FLAG,
  type DznCommsChannelRow,
  type DznCommsMessageRow,
} from "../functions/_lib/dzn-comms-message-read";
import type { Env, PagesContext } from "../functions/_lib/types";

const ROUTE = "functions/api/dzn-comms/channels/[channelId]/messages.ts";
const HELPER = "functions/_lib/dzn-comms-message-read.ts";
const MIGRATION = "migrations/0074_dzn_comms_message_read_model.sql";
const MESSAGE_READ_PREFLIGHT = "docs/DZN_COMMS_MESSAGE_READ_MODEL_APPROVAL_PREFLIGHT.md";
const MESSAGE_READ_HANDOFF = "docs/DZN_COMMS_MESSAGE_READ_MODEL_APPROVAL_PREFLIGHT_HANDOFF.md";
const IMPLEMENTATION_DOC = "docs/DZN_COMMS_MESSAGE_READ_MODEL_LOCAL_TEST_FOUNDATION.md";
const IMPLEMENTATION_HANDOFF = "docs/DZN_COMMS_MESSAGE_READ_MODEL_LOCAL_TEST_FOUNDATION_HANDOFF.md";
const COMMUNITY_PAGE = "app/community/page.tsx";
const COMMS_SHELL = "components/community/dzn-comms-visual-shell.tsx";
const PACKAGE_JSON = "package.json";

const ENABLED_PUBLIC_ENV = {
  MOCK_AUTH: "true",
  [DZN_COMMS_MESSAGE_READ_ENABLED_FLAG]: "true",
  [DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME_FLAG]: "local",
  [DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED_FLAG]: "true",
  [DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED_FLAG]: "false",
};

const ENABLED_ALL_ENV = {
  ...ENABLED_PUBLIC_ENV,
  [DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED_FLAG]: "true",
};

const FORBIDDEN_RESPONSE_VALUES = [
  "user_public_author",
  "user_private_member",
  "discord_private_123",
  "secret hidden body",
  "secret deleted body",
  "secret quarantined body",
  "secret expired body",
  "secret staff body",
  "secret private body",
  "private@example.test",
  "cus_private",
  "owner_entitlement_private",
  "raw_moderation_evidence",
  "raw_report_detail",
  "nitrado_private",
  "stripe_private",
] as const;

const FORBIDDEN_SQL_PATTERNS = [
  /\bowner_billing_accounts\b/i,
  /\baccount_entitlements\b/i,
  /\bstore_orders\b/i,
  /\bstore_payment_events\b/i,
  /\bsupporter_cards\b/i,
  /\bearned_spins\b/i,
  /\bspin_ledger\b/i,
  /\bserver_rankings\b/i,
  /\bleaderboards\b/i,
  /\bdiscovery_score\b/i,
  /\bserver_reviews\b/i,
  /\breview_score\b/i,
  /\bbadge/i,
  /\bdzn_seasons\b/i,
  /\bcompetitive_events\b/i,
  /\bserver_war/i,
  /\bctf/i,
  /\bplayer_xp\b/i,
  /\bcalling_card/i,
  /\bretained_export/i,
  /\banalytics/i,
  /\bstripe/i,
  /\bnitrado/i,
  /\bdiscord_oauth_tokens\b/i,
] as const;

async function main() {
  assertFilesExist();
  assertFeatureFlagsAreDisabledByDefault();
  assertMigrationContract();
  await assertRouteDisabledByDefault();
  await assertRouteRequiresLoginWhenEnabled();
  await assertPublicChannelReadIsFreeAndSafe();
  await assertPrivateGroupMembershipGate();
  await assertCursorAndLimitContract();
  assertCommunityStaysStaticFallback();
  assertNoForbiddenRuntimeSurface();
  assertDocsAndPackageScript();
  console.log("DZN Comms message/read model local foundation tests passed.");
}

function assertFilesExist() {
  for (const path of [
    ROUTE,
    HELPER,
    MIGRATION,
    MESSAGE_READ_PREFLIGHT,
    MESSAGE_READ_HANDOFF,
    IMPLEMENTATION_DOC,
    IMPLEMENTATION_HANDOFF,
    COMMUNITY_PAGE,
    COMMS_SHELL,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertFeatureFlagsAreDisabledByDefault() {
  const disabled = canUseDznCommsMessageReadRuntime({} as Env);
  assert.equal(disabled.ok, false, "Message reads must be disabled by default.");
  if (!disabled.ok) assert.equal(disabled.code, "DZN_COMMS_MESSAGE_READ_DISABLED");

  const missingRuntime = canUseDznCommsMessageReadRuntime({
    [DZN_COMMS_MESSAGE_READ_ENABLED_FLAG]: "true",
  } as unknown as Env);
  assert.equal(missingRuntime.ok, false, "Message reads must require explicit local/test runtime.");
  if (!missingRuntime.ok) assert.equal(missingRuntime.code, "DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME_REQUIRED");

  for (const runtime of ["production", "preview", "true", "1", "remote"] as const) {
    const result = canUseDznCommsMessageReadRuntime({
      [DZN_COMMS_MESSAGE_READ_ENABLED_FLAG]: "true",
      [DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME_FLAG]: runtime,
    } as unknown as Env);
    assert.equal(result.ok, false, `${runtime} must not enable the local/test message-read runtime.`);
  }

  for (const runtime of ["local", "test"] as const) {
    const result = canUseDznCommsMessageReadRuntime({
      [DZN_COMMS_MESSAGE_READ_ENABLED_FLAG]: "true",
      [DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME_FLAG]: runtime,
    } as unknown as Env);
    assert.equal(result.ok, true, `${runtime} is an approved local/test runtime value.`);
  }
}

function assertMigrationContract() {
  const migration = read(MIGRATION);
  const schemaOnly = migration.replace(/^--.*$/gm, "");
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS dzn_comms_channels",
    "CREATE TABLE IF NOT EXISTS dzn_comms_channel_memberships",
    "CREATE TABLE IF NOT EXISTS dzn_comms_messages",
    "CREATE TABLE IF NOT EXISTS dzn_comms_message_visibility_events",
    "channel_type TEXT NOT NULL CHECK(channel_type IN ('public', 'private_group'))",
    "membership_state TEXT NOT NULL DEFAULT 'active'",
    "visibility TEXT NOT NULL DEFAULT 'visible'",
    "message_kind TEXT NOT NULL DEFAULT 'user_message'",
    "idx_dzn_comms_messages_channel_visible_created",
  ]) {
    assertIncludes(migration, snippet, `Migration must include approved schema snippet: ${snippet}`);
  }

  for (const forbidden of [
    /\bdzn_comms_message_reactions\b/i,
    /\bdzn_comms_reaction_mutations\b/i,
    /\bdzn_comms_message_reports\b/i,
    /\bdzn_comms_moderation_actions\b/i,
    /\bdzn_comms_warning_timeouts\b/i,
    /\bdzn_comms_support_sessions\b/i,
    /\bdzn_comms_support_messages\b/i,
    /\bdzn_comms_ai_sources\b/i,
    /\bdzn_comms_ai_embeddings\b/i,
    /\bdzn_comms_analytics_events\b/i,
    /\bwebsocket\b/i,
    /\bvector\b/i,
    /\bcheckout\b/i,
    /\bstripe\b/i,
    /\bnitrado\b/i,
  ]) {
    assert.doesNotMatch(schemaOnly, forbidden, `Migration must not include blocked table/runtime field ${forbidden}.`);
  }
}

async function assertRouteDisabledByDefault() {
  const db = seededDb();
  const response = await callRoute({ DB: db.db, MOCK_AUTH: "true" } as Env, "global");
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.error, "DZN_COMMS_MESSAGE_READ_DISABLED");
  assert.equal(body.private, true);
  assert.equal(body.cache, "no-store");
  assert.equal(db.operations.length, 0, "Disabled route must not read or write D1.");
  assertNoStoreHeaders(response);
}

async function assertRouteRequiresLoginWhenEnabled() {
  const db = seededDb();
  const response = await callRoute({ DB: db.db, ...ENABLED_PUBLIC_ENV, MOCK_AUTH: "false" } as Env, "global");
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.error, "DZN_COMMS_MESSAGE_READ_UNAUTHENTICATED");
  assert.equal(db.operations.length, 0, "Unauthenticated message reads must fail before D1 message reads.");
  assertNoStoreHeaders(response);
}

async function assertPublicChannelReadIsFreeAndSafe() {
  const db = seededDb();
  const response = await callRoute({ DB: db.db, ...ENABLED_PUBLIC_ENV } as Env, "global", "?limit=25");
  const body = await response.json() as MessageReadPayload;
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.route, DZN_COMMS_MESSAGE_READ_ROUTE);
  assert.equal(body.schema_version, DZN_COMMS_MESSAGE_READ_SCHEMA_VERSION);
  assert.equal(body.channel.id, "global");
  assert.equal(body.channel.type, "public");
  assert.equal(body.channel.readOnly, true);
  assert.equal(body.page.limit, 25);
  assert.deepEqual(body.messages.map((message) => message.id), ["msg_visible_global", "msg_locked_global"]);
  assert.deepEqual(body.messages.map((message) => message.visibility), ["visible", "locked"]);
  assert.equal(body.messages[0]?.author.displayName, "Rafael DZN");
  assert.equal(body.messages[0]?.author.roleLabel, "Owner");
  assert.equal(body.messages[0]?.author.avatarInitials, "RD");
  assert.equal(body.messages[0]?.author.profileHref, null, "Profile links require a separate live visibility recheck.");
  assert.equal(body.messages[1]?.author.roleLabel, null, "Unapproved billing-like role labels must not be returned.");
  assert.equal(body.safety.read_only, true);
  assert.equal(body.safety.no_message_sending, true);
  assert.equal(body.safety.no_reaction_runtime, true);
  assert.equal(body.safety.no_live_checkout, true);
  assert.equal(body.safety.billing_effect, false);
  assert.equal(body.safety.competitive_eligibility_effect, false);
  assertNoStoreHeaders(response);

  for (const forbidden of FORBIDDEN_RESPONSE_VALUES) {
    assert.equal(serialized.includes(forbidden), false, `Message-read response must not expose ${forbidden}.`);
  }

  assert.equal(db.operations.some((operation) => operation.startsWith("all:dzn_comms_messages")), true);
  assert.equal(db.mutationAttempts, 0, "Read-only route must not run D1 mutations.");
}

async function assertPrivateGroupMembershipGate() {
  const allowedDb = seededDb({ includePrivateMembership: true });
  const allowed = await callRoute({ DB: allowedDb.db, ...ENABLED_ALL_ENV } as Env, "pandora-squad");
  const allowedBody = await allowed.json() as MessageReadPayload;

  assert.equal(allowed.status, 200);
  assert.equal(allowedBody.ok, true);
  assert.equal(allowedBody.channel.id, "pandora-squad");
  assert.equal(allowedBody.channel.type, "private_group");
  assert.deepEqual(allowedBody.messages.map((message) => message.id), ["msg_private_visible"]);
  assert.equal(allowedBody.messages[0]?.body, "Private group read succeeds only for active members.");
  assert.equal(allowedDb.operations.some((operation) => operation.startsWith("first:dzn_comms_channel_memberships")), true);

  const deniedDb = seededDb({ includePrivateMembership: false });
  const denied = await callRoute({ DB: deniedDb.db, ...ENABLED_ALL_ENV } as Env, "pandora-squad");
  const deniedBody = await denied.json() as Record<string, unknown>;
  const deniedText = JSON.stringify(deniedBody);

  assert.equal(denied.status, 403);
  assert.equal(deniedBody.ok, false);
  assert.equal(deniedBody.error, "DZN_COMMS_PRIVATE_GROUP_FORBIDDEN");
  assert.equal(deniedText.includes("secret private body"), false, "Private body must not leak when membership is missing.");
  assert.equal(deniedDb.operations.some((operation) => operation.startsWith("all:dzn_comms_messages")), false, "Private messages must not be queried after membership denial.");

  const privateDisabledDb = seededDb({ includePrivateMembership: true });
  const privateDisabled = await callRoute({ DB: privateDisabledDb.db, ...ENABLED_PUBLIC_ENV } as Env, "pandora-squad");
  const privateDisabledBody = await privateDisabled.json() as Record<string, unknown>;
  assert.equal(privateDisabled.status, 404);
  assert.equal(privateDisabledBody.error, "DZN_COMMS_PRIVATE_GROUP_HISTORY_DISABLED");
}

async function assertCursorAndLimitContract() {
  const db = seededDb();
  const limited = await callRoute({ DB: db.db, ...ENABLED_PUBLIC_ENV } as Env, "global", "?limit=1");
  const limitedBody = await limited.json() as MessageReadPayload;

  assert.equal(limited.status, 200);
  assert.equal(limitedBody.messages.length, 1);
  assert.equal(limitedBody.page.limit, 1);
  assert.equal(limitedBody.page.hasMore, true);
  assert.match(limitedBody.page.nextCursor ?? "", /^[A-Za-z0-9_-]+$/, "Cursor must be opaque URL-safe text.");
  assert.equal((limitedBody.page.nextCursor ?? "").includes("msg_visible_global"), false, "Cursor must not expose the message id as clear text.");

  const capped = await callRoute({ DB: db.db, ...ENABLED_PUBLIC_ENV } as Env, "global", "?limit=500");
  const cappedBody = await capped.json() as MessageReadPayload;
  assert.equal(cappedBody.page.limit, 50, "Message-read limit must be capped at 50.");

  const invalidCursor = await callRoute({ DB: db.db, ...ENABLED_PUBLIC_ENV } as Env, "global", "?cursor=not-a-valid-cursor");
  const invalidBody = await invalidCursor.json() as Record<string, unknown>;
  assert.equal(invalidCursor.status, 400);
  assert.equal(invalidBody.error, "DZN_COMMS_INVALID_CURSOR");
}

function assertCommunityStaysStaticFallback() {
  const page = read(COMMUNITY_PAGE);
  const shell = read(COMMS_SHELL);
  assertIncludes(page, "<DznCommsVisualShell />", "Community route should still render the static visual shell.");
  assertIncludes(shell, "data-dzn-comms-prototype=\"static-local-mock-data\"", "Comms shell should keep the static mock marker.");
  assertIncludes(shell, "Composer disabled in this static prototype - no messages are sent or stored.", "Composer must stay disabled.");

  for (const pattern of [
    /NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED/i,
    /\/api\/dzn-comms\/channels\/[^"]+\/messages/i,
    /DZN_COMMS_MESSAGE_READ_ENABLED/i,
    /localStorage/i,
    /sessionStorage/i,
    /navigator\.sendBeacon/i,
    /new\s+WebSocket/i,
    /EventSource/i,
    /BroadcastChannel/i,
    /gtag\s*\(/i,
    /posthog/i,
    /checkout\.sessions\.create/i,
    /openai\.responses/i,
    /chat\.completions/i,
  ]) {
    assert.doesNotMatch(shell, pattern, `Static Comms shell must not opt into runtime message history or side effects: ${pattern}.`);
  }
}

function assertNoForbiddenRuntimeSurface() {
  for (const path of [
    "functions/api/dzn-comms/messages",
    "functions/api/dzn-comms/reactions",
    "functions/api/dzn-comms/reports",
    "functions/api/dzn-comms/moderation",
    "functions/api/dzn-comms/support",
    "functions/api/chat",
    "functions/api/support-chat",
    "functions/api/dzn-assist",
    "app/api/dzn-comms",
    "app/api/chat",
    "components/chat",
    "components/support-chat",
    "components/dzn-assist",
    "lib/chat.ts",
    "lib/support-bot.ts",
    "lib/dzn-assist.ts",
  ]) {
    assert.equal(existsSync(path), false, `${path} must not be introduced by the read-only message-history slice.`);
  }

  const route = read(ROUTE);
  const helper = read(HELPER);
  const sources = [{ path: ROUTE, source: route }, { path: HELPER, source: helper }];
  for (const { path, source } of sources) {
    for (const pattern of [
      /onRequestPost/i,
      /onRequestPut/i,
      /onRequestPatch/i,
      /onRequestDelete/i,
      /readBoundedJson/i,
      /INSERT\s+INTO/i,
      /UPDATE\s+/i,
      /DELETE\s+FROM/i,
      /checkout\.sessions\.create/i,
      /STRIPE_SECRET_KEY/i,
      /STRIPE_WEBHOOK_SECRET/i,
      /DISCORD_BOT_TOKEN/i,
      /NITRADO/i,
      /new\s+WebSocket/i,
      /WebSocketPair/i,
      /DurableObject/i,
      /navigator\.sendBeacon/i,
      /gtag\s*\(/i,
      /posthog/i,
      /openai\.responses/i,
      /chat\.completions/i,
      /createEmbedding/i,
      /vectorize/i,
    ]) {
      assert.doesNotMatch(source, pattern, `${path} must not include blocked mutation/runtime/provider pattern ${pattern}.`);
    }
  }

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
  const forbiddenProviderDeps = dependencyNames.filter((name) => [
    /^openai$/i,
    /^ai$/i,
    /^@ai-sdk\//i,
    /^langchain$/i,
    /^@langchain\//i,
    /^anthropic$/i,
    /^@anthropic-ai\//i,
  ].some((pattern) => pattern.test(name)));
  assert.deepEqual(forbiddenProviderDeps, [], "Message-read slice must not add AI provider dependencies.");

  for (const path of ["wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"]) {
    if (!existsSync(path)) continue;
    const source = read(path);
    assert.doesNotMatch(source, /DZN_COMMS_MESSAGE_READ_ENABLED|DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED|DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED/i, `${path} must not receive new Comms flags in this slice.`);
    assert.doesNotMatch(source, /DZN_LIVE_CHECKOUT_ENABLED\s*=\s*true/i, `${path} must not enable live checkout.`);
  }
}

function assertDocsAndPackageScript() {
  const docs = [
    read(IMPLEMENTATION_DOC),
    read(IMPLEMENTATION_HANDOFF),
    read(MESSAGE_READ_PREFLIGHT),
    read(MESSAGE_READ_HANDOFF),
  ].join("\n");
  for (const snippet of [
    "DZN Comms Message/Read Model Local/Test Foundation",
    "GET /api/dzn-comms/channels/:channelId/messages",
    "DZN_COMMS_MESSAGE_READ_ENABLED",
    "DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME",
    "DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED",
    "DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED",
    "dzn_comms_channels",
    "dzn_comms_channel_memberships",
    "dzn_comms_messages",
    "dzn_comms_message_visibility_events",
    "Free logged-in Discord players may read visible public-channel messages",
    "Private group reads require active trusted membership",
    "Owner entitlement alone is not private group membership",
    "The `/community` route remains on the static local mock-data shell unless a later UI integration slice enables runtime fetching.",
    "Live checkout remains disabled",
    "Issue #49 remains reserved for final live payment activation",
  ]) {
    assertIncludes(docs, snippet, `Docs must include: ${snippet}`);
  }

  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-comms-message-read-model-local-foundation"],
    "tsx scripts/test-dzn-comms-message-read-model-local-foundation.ts",
    "Focused DZN Comms message/read local foundation test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-comms-message-read-model-local-foundation"),
    true,
    "Full npm test should include the DZN Comms message/read local foundation guard.",
  );
}

async function callRoute(env: Env, channelId: string, query = "") {
  const request = new Request(`https://dzn.test/api/dzn-comms/channels/${channelId}/messages${query}`, { method: "GET" });
  return await messageRoute({
    request,
    env,
    params: { channelId },
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext);
}

function seededDb(options: { includePrivateMembership?: boolean } = {}) {
  return new FakeD1({
    channels: [
      {
        id: "channel_global",
        channel_key: "global",
        channel_type: "public",
        label: "Global Chat",
        scope: "dzn-public",
        is_enabled: 1,
      },
      {
        id: "channel_pandora",
        channel_key: "pandora-squad",
        channel_type: "private_group",
        label: "Pandora Squad",
        scope: "dzn-private-group",
        is_enabled: 1,
      },
    ],
    memberships: options.includePrivateMembership
      ? [{ channel_id: "channel_pandora", user_id: "mock-user", membership_state: "active", expires_at: null }]
      : [{ channel_id: "channel_pandora", user_id: "other-user", membership_state: "active", expires_at: null }],
    messages: [
      messageRow("msg_visible_global", "channel_global", "visible", "2026-08-31T10:30:00.000Z", "Rafael DZN", "Owner", "RD", "Welcome to DZN Global."),
      messageRow("msg_locked_global", "channel_global", "locked", "2026-08-31T10:29:00.000Z", "NovaRift", "Plan: Pro", "N", "Locked still reads as read-only history."),
      messageRow("msg_hidden_global", "channel_global", "hidden", "2026-08-31T10:28:00.000Z", "Hidden", "Member", "H", "secret hidden body"),
      messageRow("msg_deleted_global", "channel_global", "deleted", "2026-08-31T10:27:00.000Z", "Deleted", "Member", "D", "secret deleted body"),
      messageRow("msg_quarantined_global", "channel_global", "quarantined", "2026-08-31T10:26:00.000Z", "Quarantined", "Member", "Q", "secret quarantined body"),
      messageRow("msg_expired_global", "channel_global", "expired", "2026-08-31T10:25:00.000Z", "Expired", "Member", "E", "secret expired body"),
      messageRow("msg_staff_global", "channel_global", "staff_only", "2026-08-31T10:24:00.000Z", "Staff", "Member", "S", "secret staff body"),
      {
        ...messageRow("msg_time_expired_global", "channel_global", "visible", "2026-08-31T10:23:00.000Z", "Expired", "Member", "E", "secret expired body"),
        expires_at: "2026-08-31T10:31:00.000Z",
      },
      messageRow("msg_private_visible", "channel_pandora", "visible", "2026-08-31T10:30:00.000Z", "Rafael DZN", "Owner", "RD", "Private group read succeeds only for active members."),
      messageRow("msg_private_secret", "channel_pandora", "hidden", "2026-08-31T10:29:00.000Z", "Private", "Member", "P", "secret private body"),
    ],
  });
}

function messageRow(
  id: string,
  channelId: string,
  visibility: DznCommsMessageRow["visibility"],
  createdAt: string,
  displayName: string,
  roleLabel: string,
  initials: string,
  body: string,
): DznCommsMessageRow {
  return {
    id,
    channel_id: channelId,
    author_user_id: "user_public_author",
    author_display_name: displayName,
    author_role_label: roleLabel,
    author_avatar_initials: initials,
    author_profile_href: "/players/rafael-dzn-a1b2c",
    body,
    visibility,
    message_kind: "user_message",
    reply_to_message_id: null,
    created_at: createdAt,
    updated_at: null,
    expires_at: null,
  };
}

type SeededMembership = {
  channel_id: string;
  user_id: string;
  membership_state: string;
  expires_at: string | null;
};

type FakeSeed = {
  channels: DznCommsChannelRow[];
  memberships: SeededMembership[];
  messages: DznCommsMessageRow[];
};

class FakeD1 {
  readonly operations: string[] = [];
  mutationAttempts = 0;

  readonly db = {
    prepare: (sql: string) => this.prepare(sql),
    batch: async () => ({ success: true, meta: {}, results: [] }),
    exec: async () => ({ success: true, meta: {} }),
  } as unknown as D1Database;

  constructor(private readonly seed: FakeSeed) {}

  private prepare(sql: string) {
    assertSafeSql(sql);
    return this.statement(sql, []);
  }

  private statement(sql: string, bindings: unknown[]) {
    return {
      bind: (...nextBindings: unknown[]) => this.statement(sql, nextBindings),
      first: async <T>() => this.first<T>(sql, bindings),
      all: async <T>() => this.all<T>(sql, bindings),
      run: async () => {
        this.mutationAttempts += 1;
        throw new Error("DZN Comms message-read fake D1 blocks mutations.");
      },
      raw: async () => [] as unknown[],
    };
  }

  private async first<T>(sql: string, bindings: unknown[]) {
    if (/FROM\s+dzn_comms_channels/i.test(sql)) {
      this.operations.push("first:dzn_comms_channels");
      const key = String(bindings[0] ?? "");
      const id = String(bindings[1] ?? "");
      return (this.seed.channels.find((channel) => channel.is_enabled === 1 && (channel.channel_key === key || channel.id === id)) ?? null) as T | null;
    }

    if (/FROM\s+dzn_comms_channel_memberships/i.test(sql)) {
      this.operations.push("first:dzn_comms_channel_memberships");
      const channelId = String(bindings[0] ?? "");
      const userId = String(bindings[1] ?? "");
      const nowMs = Date.parse(String(bindings[2] ?? new Date(0).toISOString()));
      const row = this.seed.memberships.find((membership) =>
        membership.channel_id === channelId &&
        membership.user_id === userId &&
        membership.membership_state === "active" &&
        (!membership.expires_at || Date.parse(membership.expires_at) > nowMs)
      );
      return (row ? { id: `membership_${channelId}_${userId}` } : null) as T | null;
    }

    throw new Error(`Unexpected first() SQL in fake D1: ${sql}`);
  }

  private async all<T>(sql: string, bindings: unknown[]) {
    if (!/FROM\s+dzn_comms_messages/i.test(sql)) {
      throw new Error(`Unexpected all() SQL in fake D1: ${sql}`);
    }

    this.operations.push("all:dzn_comms_messages");
    const channelId = String(bindings[0] ?? "");
    const nowMs = Date.parse(String(bindings[1] ?? new Date(0).toISOString()));
    const direction = /ORDER\s+BY\s+created_at\s+ASC/i.test(sql) ? "newer" : "older";
    const cursorActive = /created_at\s+[<>]\s+\?/i.test(sql);
    const limit = Number(bindings.at(-1) ?? 50);
    const cursorCreatedAt = cursorActive ? String(bindings[2] ?? "") : null;
    const cursorMessageId = cursorActive ? String(bindings[4] ?? "") : null;
    const cursorMs = cursorCreatedAt ? Date.parse(cursorCreatedAt) : null;

    let rows = this.seed.messages
      .filter((message) => message.channel_id === channelId)
      .filter((message) => message.visibility === "visible" || message.visibility === "locked")
      .filter((message) => !message.expires_at || Date.parse(message.expires_at) > nowMs);

    if (cursorActive && cursorMs !== null && cursorMessageId) {
      rows = rows.filter((message) => {
        const messageMs = Date.parse(message.created_at);
        if (direction === "newer") return messageMs > cursorMs || (messageMs === cursorMs && message.id > cursorMessageId);
        return messageMs < cursorMs || (messageMs === cursorMs && message.id < cursorMessageId);
      });
    }

    rows.sort((a, b) => {
      const timeDiff = Date.parse(a.created_at) - Date.parse(b.created_at);
      const idDiff = a.id.localeCompare(b.id);
      const value = timeDiff || idDiff;
      return direction === "newer" ? value : -value;
    });

    return { success: true, meta: {}, results: rows.slice(0, limit) as T[] };
  }
}

type MessageReadPayload = {
  ok: true;
  route: string;
  schema_version: string;
  channel: {
    id: string;
    type: string;
    readOnly: boolean;
  };
  messages: Array<{
    id: string;
    visibility: string;
    author: {
      displayName: string;
      roleLabel: string | null;
      avatarInitials: string;
      profileHref: string | null;
    };
    body: string;
  }>;
  page: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  safety: {
    read_only: boolean;
    no_message_sending: boolean;
    no_reaction_runtime: boolean;
    no_live_checkout: boolean;
    billing_effect: boolean;
    competitive_eligibility_effect: boolean;
  };
};

function assertSafeSql(sql: string) {
  for (const pattern of FORBIDDEN_SQL_PATTERNS) {
    assert.doesNotMatch(sql, pattern, `Message-read SQL must not touch ${pattern}.`);
  }
}

function assertNoStoreHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control")?.includes("no-store"), true, "Message-read responses must be no-store.");
  assert.match(response.headers.get("vary") ?? "", /cookie/i, "Message-read responses must vary on Cookie.");
  assert.equal(response.headers.get("x-dzn-comms-message-read-contract"), "read-only-local-test");
  assert.equal(response.headers.get("x-dzn-comms-message-read-schema"), DZN_COMMS_MESSAGE_READ_SCHEMA_VERSION);
}

function assertIncludes(source: string, snippet: string, message: string) {
  assert.equal(source.includes(snippet), true, message);
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}

void main();
