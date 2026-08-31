import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import {
  DZN_COMMS_MESSAGE_HISTORY_LIMIT,
  DZN_COMMS_MESSAGE_HISTORY_MAX_PAYLOAD_BYTES,
  DZN_COMMS_MESSAGE_HISTORY_ROUTE_PREFIX,
  dznCommsMessageHistoryChannelId,
  dznCommsMessageHistoryStaticState,
  dznCommsMessageHistoryUrl,
  isDznCommsMessageHistoryUiEnabled,
  loadDznCommsMessageHistory,
  validateDznCommsMessageHistoryPayload,
  type DznCommsMessageHistoryMessage,
  type DznCommsMessageHistoryPayload,
} from "../components/community/dzn-comms-message-history";

const BASE_REF = "origin/codex/dzn-comms-message-history-ui-integration-approval-preflight-20260831";
const COMMUNITY_PAGE = "app/community/page.tsx";
const COMMS_SHELL = "components/community/dzn-comms-visual-shell.tsx";
const HISTORY_HELPER = "components/community/dzn-comms-message-history.ts";
const MESSAGE_READ_ROUTE = "functions/api/dzn-comms/channels/[channelId]/messages.ts";
const MESSAGE_READ_HELPER = "functions/_lib/dzn-comms-message-read.ts";
const IMPLEMENTATION_DOC = "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_IMPLEMENTATION.md";
const IMPLEMENTATION_HANDOFF = "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_IMPLEMENTATION_HANDOFF.md";
const APPROVAL_PREFLIGHT_DOC = "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_APPROVAL_PREFLIGHT.md";
const APPROVAL_PREFLIGHT_HANDOFF = "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_APPROVAL_PREFLIGHT_HANDOFF.md";
const MESSAGE_READ_DOC = "docs/DZN_COMMS_MESSAGE_READ_MODEL_LOCAL_TEST_FOUNDATION.md";
const MESSAGE_READ_HANDOFF = "docs/DZN_COMMS_MESSAGE_READ_MODEL_LOCAL_TEST_FOUNDATION_HANDOFF.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const PACKAGE_JSON = "package.json";
const RENDERED_QA_DOC = "docs/DZN_COMMS_MESSAGE_HISTORY_RENDERED_QA.md";
const RENDERED_QA_HANDOFF = "docs/DZN_COMMS_MESSAGE_HISTORY_RENDERED_QA_HANDOFF.md";
const RENDERED_QA_ARTIFACT_DIR = "docs/artifacts/dzn-comms-message-history-rendered-qa";
const RENDERED_QA_ARTIFACT_README = `${RENDERED_QA_ARTIFACT_DIR}/README.md`;
const RENDERED_QA_ARTIFACT_JSON = `${RENDERED_QA_ARTIFACT_DIR}/dzn-comms-message-history-rendered-qa.json`;
const RENDERED_QA_ARTIFACT_HTML = `${RENDERED_QA_ARTIFACT_DIR}/index.html`;
const RENDERED_QA_TEST = "scripts/test-dzn-comms-message-history-rendered-qa.ts";

const ALLOWED_CHANGED_PATHS = new Set([
  COMMUNITY_PAGE,
  COMMS_SHELL,
  HISTORY_HELPER,
  APPROVAL_PREFLIGHT_DOC,
  APPROVAL_PREFLIGHT_HANDOFF,
  MESSAGE_READ_DOC,
  MESSAGE_READ_HANDOFF,
  IMPLEMENTATION_DOC,
  IMPLEMENTATION_HANDOFF,
  RENDERED_QA_DOC,
  RENDERED_QA_HANDOFF,
  RENDERED_QA_ARTIFACT_README,
  RENDERED_QA_ARTIFACT_JSON,
  RENDERED_QA_ARTIFACT_HTML,
  MASTER_SPEC,
  PUBLIC_ACCESS_POLICY,
  "scripts/test-dzn-comms-message-history-ui-integration.ts",
  "scripts/test-dzn-comms-message-read-model-approval-preflight.ts",
  "scripts/test-dzn-comms-reaction-contract-preflight.ts",
  "scripts/test-dzn-comms-reaction-runtime-approval-preflight.ts",
  RENDERED_QA_TEST,
  "scripts/test-dzn-comms-message-history-ui-integration-approval-preflight.ts",
  "scripts/test-dzn-comms-message-read-model-local-foundation.ts",
  "scripts/test-dzn-comms-visual-shell.ts",
  "scripts/test-dzn-comms-interaction-contract-preflight.ts",
  "scripts/test-dzn-comms-runtime-approval-preflight.ts",
  PACKAGE_JSON,
]);

const ALLOWED_CHANGED_PREFIXES = [
  `${RENDERED_QA_ARTIFACT_DIR}/screenshots/`,
] as const;

const FORBIDDEN_SOURCE_PATTERNS = [
  /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i,
  /\bXMLHttpRequest\b/i,
  /\bnew\s+WebSocket\b/i,
  /\bWebSocketPair\b/i,
  /\bDurableObject\b/i,
  /\bEventSource\b/i,
  /\bBroadcastChannel\b/i,
  /\blocalStorage\b/i,
  /\bsessionStorage\b/i,
  /\bindexedDB\b/i,
  /\bnavigator\.sendBeacon\b/i,
  /\bgtag\s*\(/i,
  /\bposthog\b/i,
  /\btrackEvent\b/i,
  /\bcheckout\.sessions\.create\b/i,
  /\bDZN_LIVE_CHECKOUT_ENABLED\b/i,
  /\bSTRIPE_SECRET_KEY\b/i,
  /\bSTRIPE_WEBHOOK_SECRET\b/i,
  /\bDISCORD_BOT_TOKEN\b/i,
  /\bNITRADO\b/i,
  /\bopenai\.responses\b/i,
  /\bchat\.completions\b/i,
  /\bcreateEmbedding\b/i,
  /\bvectorize\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bwrangler\b/i,
];

const FORBIDDEN_CHANGED_PATH_PATTERNS = [
  /^(?:migrations|public|\.github)\//i,
  /^wrangler(?:\.adm-sync|\.auto-update)?\.toml$/i,
  /^cloudflare-env\.d\.ts$/i,
  /^package-lock\.json$/i,
  /^functions\/api\/dzn-comms\/(?:messages|reactions|reports|moderation|support)/i,
  /^functions\/api\/(?:chat|support-chat|dzn-assist)/i,
  /^app\/api\/(?:chat|support-chat|dzn-assist|dzn-comms)/i,
  /^components\/(?:chat|support-chat|dzn-assist)\//i,
  /^lib\/(?:chat|support-bot|dzn-assist)/i,
];

async function main() {
  assertFilesExist();
  assertFlagAndMappingContract();
  await assertPublicChannelFetchContract();
  await assertPrivateGroupDenialFallback();
  await assertStaticAndFailureFallbacks();
  assertPayloadValidationBlocksUnsafeOutput();
  assertCommunityIntegrationSource();
  assertRouteRemainsReadOnly();
  assertDocsAndPackageScript();
  assertChangedPathsStayBounded();
  console.log("DZN Comms message-history UI integration tests passed.");
}

function assertFilesExist() {
  for (const path of [
    COMMUNITY_PAGE,
    COMMS_SHELL,
    HISTORY_HELPER,
    MESSAGE_READ_ROUTE,
    MESSAGE_READ_HELPER,
    IMPLEMENTATION_DOC,
    IMPLEMENTATION_HANDOFF,
    APPROVAL_PREFLIGHT_DOC,
    APPROVAL_PREFLIGHT_HANDOFF,
    MESSAGE_READ_DOC,
    MESSAGE_READ_HANDOFF,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertFlagAndMappingContract() {
  assert.equal(isDznCommsMessageHistoryUiEnabled(undefined), false, "Message-history UI must be disabled by default.");
  assert.equal(isDznCommsMessageHistoryUiEnabled("false"), false, "False must not enable message-history UI.");
  assert.equal(isDznCommsMessageHistoryUiEnabled("1"), false, "Numeric truthy values must not enable message-history UI.");
  assert.equal(isDznCommsMessageHistoryUiEnabled("true"), true, "Only true enables message-history UI.");
  assert.equal(isDznCommsMessageHistoryUiEnabled(" TRUE "), true, "Explicit true may be whitespace/case-normalized.");

  assert.equal(dznCommsMessageHistoryChannelId("global"), "global");
  assert.equal(dznCommsMessageHistoryChannelId("new_players"), "new-players");
  assert.equal(dznCommsMessageHistoryChannelId("server_owners"), "server-owners");
  assert.equal(dznCommsMessageHistoryChannelId("events"), "events");
  assert.equal(dznCommsMessageHistoryChannelId("pandora_squad"), "pandora-squad");
  assert.equal(dznCommsMessageHistoryChannelId("support"), null, "Support must not fetch message history.");

  assert.equal(
    dznCommsMessageHistoryUrl("global"),
    `${DZN_COMMS_MESSAGE_HISTORY_ROUTE_PREFIX}/global/messages?limit=${DZN_COMMS_MESSAGE_HISTORY_LIMIT}`,
  );
  assert.equal(
    dznCommsMessageHistoryUrl("server_owners"),
    `${DZN_COMMS_MESSAGE_HISTORY_ROUTE_PREFIX}/server-owners/messages?limit=${DZN_COMMS_MESSAGE_HISTORY_LIMIT}`,
  );
  assert.equal(dznCommsMessageHistoryUrl("support"), null);
  assert.equal(
    dznCommsMessageHistoryUrl("events", { cursor: "abc12345", direction: "newer" }),
    `${DZN_COMMS_MESSAGE_HISTORY_ROUTE_PREFIX}/events/messages?limit=${DZN_COMMS_MESSAGE_HISTORY_LIMIT}&cursor=abc12345&direction=newer`,
  );
  assert.equal(
    dznCommsMessageHistoryUrl("events", { cursor: "not valid", direction: "newer" }),
    `${DZN_COMMS_MESSAGE_HISTORY_ROUTE_PREFIX}/events/messages?limit=${DZN_COMMS_MESSAGE_HISTORY_LIMIT}`,
    "Invalid cursors must be ignored instead of sent.",
  );
}

async function assertPublicChannelFetchContract() {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const state = await loadDznCommsMessageHistory({
    surfaceKey: "global",
    fetcher: async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(okPayload({
        channelType: "public",
        messages: [
          message("msg_public_one", "Rafael DZN", "Owner", "RD", "Visible public message."),
          message("msg_public_locked", "NovaRift", "Mod", "N", "Locked public message.", "locked"),
        ],
      }));
    },
  });

  assert.equal(calls.length, 1, "Enabled public-channel load should issue exactly one request.");
  assert.equal(String(calls[0]?.input), "/api/dzn-comms/channels/global/messages?limit=25");
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(calls[0]?.init?.credentials, "include");
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.deepEqual(calls[0]?.init?.headers, { Accept: "application/json" });
  assert.equal(calls[0]?.init?.signal instanceof AbortSignal, true, "Fetch must use an AbortController signal.");

  assert.equal(state.status, "live");
  if (state.status !== "live") throw new Error("Expected live state.");
  assert.equal(state.generatedAt, "2026-08-31T10:30:00.000Z");
  assert.deepEqual(state.messages.map((item) => item.id), ["msg_public_one", "msg_public_locked"]);
  assert.deepEqual(state.messages.map((item) => item.visibility), ["visible", "locked"]);
  assert.equal(state.messages[0]?.author.profileHref, null, "UI history must not introduce public profile links.");
  assert.equal(JSON.stringify(state).includes("discord_private_123"), false, "Private identifiers must not be present.");
}

async function assertPrivateGroupDenialFallback() {
  let requestedUrl = "";
  const state = await loadDznCommsMessageHistory({
    surfaceKey: "pandora_squad",
    fetcher: async (input) => {
      requestedUrl = String(input);
      return jsonResponse({ ok: false, error: "DZN_COMMS_PRIVATE_GROUP_FORBIDDEN", message: "Unavailable" }, 403);
    },
  });

  assert.equal(requestedUrl, "/api/dzn-comms/channels/pandora-squad/messages?limit=25");
  assert.equal(state.status, "fallback");
  if (state.status !== "fallback") throw new Error("Expected fallback state.");
  assert.equal(state.reason, "private-denied");
  assert.equal(state.canRetry, false);
  assert.equal(JSON.stringify(state).includes("secret private body"), false, "Private denied fallback must not include private message bodies.");
}

async function assertStaticAndFailureFallbacks() {
  let supportFetchCalled = false;
  const supportState = await loadDznCommsMessageHistory({
    surfaceKey: "support",
    fetcher: async () => {
      supportFetchCalled = true;
      return jsonResponse(okPayload({ channelType: "public", messages: [] }));
    },
  });
  assert.equal(supportFetchCalled, false, "Support surface must not fetch message history.");
  assert.equal(supportState.status, "static");
  assert.equal(dznCommsMessageHistoryStaticState("client-flag-disabled").status, "static");

  const loginRequired = await loadDznCommsMessageHistory({
    surfaceKey: "global",
    fetcher: async () => jsonResponse({ ok: false, error: "DZN_COMMS_MESSAGE_READ_UNAUTHENTICATED" }, 401),
  });
  assert.equal(loginRequired.status, "fallback");
  if (loginRequired.status !== "fallback") throw new Error("Expected login fallback.");
  assert.equal(loginRequired.reason, "login-required");
  assert.equal(loginRequired.canRetry, false);

  const disabled = await loadDznCommsMessageHistory({
    surfaceKey: "global",
    fetcher: async () => jsonResponse({ ok: false, error: "DZN_COMMS_MESSAGE_READ_DISABLED" }, 404),
  });
  assert.equal(disabled.status, "fallback");
  if (disabled.status !== "fallback") throw new Error("Expected disabled fallback.");
  assert.equal(disabled.reason, "disabled-or-not-configured");
  assert.equal(disabled.canRetry, false);

  const malformed = await loadDznCommsMessageHistory({
    surfaceKey: "global",
    fetcher: async () => new Response("{not json", { status: 200 }),
  });
  assert.equal(malformed.status, "fallback");
  if (malformed.status !== "fallback") throw new Error("Expected malformed fallback.");
  assert.equal(malformed.reason, "malformed-response");

  const overlarge = await loadDznCommsMessageHistory({
    surfaceKey: "global",
    fetcher: async () => new Response("x".repeat(DZN_COMMS_MESSAGE_HISTORY_MAX_PAYLOAD_BYTES + 1), { status: 200 }),
  });
  assert.equal(overlarge.status, "fallback");
  if (overlarge.status !== "fallback") throw new Error("Expected overlarge fallback.");
  assert.equal(overlarge.reason, "overlarge-response");

  const timeout = await loadDznCommsMessageHistory({
    surfaceKey: "global",
    fetcher: async (_input, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
      throw new Error("unreachable");
    },
    timeoutMs: 1,
  });
  assert.equal(timeout.status, "fallback");
  if (timeout.status !== "fallback") throw new Error("Expected timeout fallback.");
  assert.equal(timeout.reason, "timeout");
}

function assertPayloadValidationBlocksUnsafeOutput() {
  const payload = okPayload({
    channelType: "public",
    messages: [message("msg_safe", "Rafael DZN", "Owner", "RD", "Safe body.")],
  });
  assert.notEqual(validateDznCommsMessageHistoryPayload(payload), null, "Safe payload should validate.");

  assert.equal(
    validateDznCommsMessageHistoryPayload({
      ...payload,
      messages: [
        {
          ...payload.messages[0],
          author: { ...payload.messages[0]?.author, profileHref: "/players/private-handle" },
        },
      ],
    }),
    null,
    "Payloads with profile links must be rejected until a later attribution slice rechecks visibility.",
  );
  assert.equal(
    validateDznCommsMessageHistoryPayload({
      ...payload,
      messages: [{ ...payload.messages[0], visibility: "hidden" }],
    }),
    null,
    "Hidden messages must not validate for UI display.",
  );
  assert.equal(
    validateDznCommsMessageHistoryPayload({
      ...payload,
      safety: { ...payload.safety, billing_effect: true },
    }),
    null,
    "Payloads that claim billing effects must be rejected.",
  );
  assert.equal(
    validateDznCommsMessageHistoryPayload({
      ...payload,
      safety: { ...payload.safety, competitive_eligibility_effect: true },
    }),
    null,
    "Payloads that claim competitive eligibility effects must be rejected.",
  );
}

function assertCommunityIntegrationSource() {
  const page = read(COMMUNITY_PAGE);
  const shell = read(COMMS_SHELL);
  const helper = read(HISTORY_HELPER);

  assertIncludes(page, "<DznCommsVisualShell />", "Community page should still render the Comms shell.");
  assertIncludes(shell, "useDznCommsMessageHistory", "Comms shell should use the guarded message-history hook.");
  assertIncludes(shell, "isDznCommsMessageHistoryUiEnabled()", "Comms shell should gate reads through the public UI flag helper.");
  assertIncludes(shell, "loadDznCommsMessageHistory({ surfaceKey })", "Comms shell should call the read-only loader only from the hook.");
  assertIncludes(shell, "data-dzn-comms-message-history-ui={messageHistoryUiEnabled ? \"enabled-read-only\" : \"disabled-static-fallback\"}", "Comms shell should expose the disabled/enabled UI state for QA.");
  assertIncludes(shell, "data-dzn-comms-history-source={messageHistoryState.status === \"live\" ? \"read-only-message-history\" : \"static-fallback\"}", "Comms shell should expose static fallback vs read-only history source.");
  assertIncludes(shell, "messageHistoryState.status === \"live\"", "Comms shell should render loaded messages only after validation.");
  assertIncludes(shell, "FilteredMessageNotice", "Static fallback safety notice should remain present.");
  assertIncludes(shell, "StaticWarningPreview", "Private warning preview should remain static.");
  assertIncludes(shell, "Composer disabled in this static prototype - no messages are sent or stored.", "Composer must remain disabled.");
  assertIncludes(shell, "data-dzn-comms-reaction=\"emoji-static-preview\"", "Reactions must remain static emoji preview only.");
  assertIncludes(helper, "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED", "Helper should own the public flag name.");
  assertIncludes(helper, "method: \"GET\"", "Helper may issue GET only.");
  assertIncludes(helper, "credentials: \"include\"", "Helper should use the browser session cookie.");
  assertIncludes(helper, "cache: \"no-store\"", "Helper should opt out of browser cache for private reads.");
  assertIncludes(helper, "headers: { Accept: \"application/json\" }", "Helper should request JSON explicitly.");
  assertIncludes(helper, "new AbortController()", "Helper should time-bound reads with AbortController.");
  assertIncludes(helper, "profileHref !== null", "Helper must reject profile links until a later visibility recheck.");

  for (const { path, source } of [
    { path: COMMS_SHELL, source: shell },
    { path: HISTORY_HELPER, source: helper },
    { path: COMMUNITY_PAGE, source: page },
  ]) {
    for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path} must not include blocked runtime or mutation pattern ${pattern}.`);
    }
  }

  assert.doesNotMatch(shell, /\/api\/dzn-comms\/channels\//i, "Route string should stay in the helper, not scattered through the shell.");
  assert.doesNotMatch(helper, /read receipts?|last-read|last_read/i, "UI helper must not create read receipt concepts.");
}

function assertRouteRemainsReadOnly() {
  const route = read(MESSAGE_READ_ROUTE);
  const helper = read(MESSAGE_READ_HELPER);

  assertIncludes(route, "request.method !== \"GET\"", "Existing message-history route must remain GET-only.");
  for (const source of [route, helper]) {
    for (const pattern of [
      /onRequestPost/i,
      /onRequestPut/i,
      /onRequestPatch/i,
      /onRequestDelete/i,
      /INSERT\s+INTO/i,
      /UPDATE\s+/i,
      /DELETE\s+FROM/i,
      /checkout\.sessions\.create/i,
      /WebSocketPair/i,
      /DurableObject/i,
      /openai\.responses/i,
      /chat\.completions/i,
    ]) {
      assert.doesNotMatch(source, pattern, `Message-history route/helper must remain read-only and provider-free: ${pattern}`);
    }
  }
}

function assertDocsAndPackageScript() {
  const docs = [
    read(IMPLEMENTATION_DOC),
    read(IMPLEMENTATION_HANDOFF),
    read(APPROVAL_PREFLIGHT_DOC),
    read(APPROVAL_PREFLIGHT_HANDOFF),
    read(MESSAGE_READ_DOC),
    read(MESSAGE_READ_HANDOFF),
    read(MASTER_SPEC),
    read(PUBLIC_ACCESS_POLICY),
  ].join("\n");

  for (const snippet of [
    "DZN Comms Message-History UI Integration Implementation",
    "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED",
    "disabled by default",
    "same-origin",
    "GET /api/dzn-comms/channels/:channelId/messages",
    "static fallback",
    "public-channel reads",
    "private group denial",
    "Support remains static",
    "No chat sending",
    "No runtime reactions",
    "No report routes",
    "No moderation mutations",
    "No DZN Assist AI runtime",
    "No Durable Objects/WebSockets",
    "No analytics/tracking",
    "No Store/payment/live checkout changes",
    "No production mutations",
    "No retained exports",
    "Issue #49 remains reserved for final live payment activation",
    "cannot affect billing, owner entitlement, server ownership, scoring, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, public profile visibility, retained exports, or competitive eligibility",
  ]) {
    assertIncludes(docs, snippet, `Docs should include implementation contract snippet: ${snippet}`);
  }

  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-comms-message-history-ui-integration"],
    "tsx scripts/test-dzn-comms-message-history-ui-integration.ts",
    "Focused UI integration implementation test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-comms-message-history-ui-integration"),
    true,
    "Full npm test should include the UI integration implementation guard.",
  );
  assertOrder(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-comms-message-history-ui-integration-approval-preflight",
    "npm run test:dzn-comms-message-history-ui-integration",
    "Implementation guard should run after the approval preflight guard.",
  );
  assertOrder(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-comms-message-history-ui-integration",
    "npm run test:dzn-comms-runtime-approval-preflight",
    "Implementation guard should run before broader Comms runtime approval.",
  );
}

function assertChangedPathsStayBounded() {
  const changed = changedFiles().map((path) => path.replace(/\\/g, "/"));
  const unexpected = changed.filter((path) => {
    if (ALLOWED_CHANGED_PATHS.has(path)) return false;
    return !ALLOWED_CHANGED_PREFIXES.some((prefix) => path.startsWith(prefix));
  });
  assert.deepEqual(unexpected, [], "This slice may change only the approved UI integration files, docs, tests, and package script.");

  const forbidden = changed.filter((path) => FORBIDDEN_CHANGED_PATH_PATTERNS.some((pattern) => pattern.test(path)));
  assert.deepEqual(forbidden, [], "This slice must not change migrations, assets, workflow/config, backend send/reaction/moderation/AI paths, or package-lock.");
}

function okPayload({
  channelType,
  messages,
}: {
  channelType: "public" | "private_group";
  messages: DznCommsMessageHistoryMessage[];
}): DznCommsMessageHistoryPayload {
  return {
    ok: true,
    status: "ok",
    private: true,
    cache: "no-store",
    generated_at: "2026-08-31T10:30:00.000Z",
    channel: {
      id: channelType === "public" ? "global" : "pandora-squad",
      type: channelType,
      readOnly: true,
    },
    messages,
    page: {
      nextCursor: null,
      hasMore: false,
      limit: 25,
      direction: "older",
    },
    safety: {
      read_only: true,
      no_message_sending: true,
      no_reaction_runtime: true,
      no_report_routes: true,
      no_moderation_mutations: true,
      no_dzn_assist_ai_runtime: true,
      no_durable_objects: true,
      no_websockets: true,
      no_analytics_tracking: true,
      no_store_payment_changes: true,
      no_live_checkout: true,
      no_production_mutations: true,
      no_retained_exports: true,
      billing_effect: false,
      owner_entitlement_effect: false,
      ranking_effect: false,
      discovery_effect: false,
      review_effect: false,
      badge_effect: false,
      season_effect: false,
      event_effect: false,
      server_wars_effect: false,
      ctf_effect: false,
      xp_award_effect: false,
      calling_card_award_effect: false,
      public_profile_visibility_effect: false,
      competitive_eligibility_effect: false,
    },
  };
}

function message(
  id: string,
  displayName: string,
  roleLabel: string | null,
  avatarInitials: string,
  body: string,
  visibility: "visible" | "locked" = "visible",
): DznCommsMessageHistoryMessage {
  return {
    id,
    visibility,
    createdAt: "2026-08-31T10:30:00.000Z",
    author: {
      displayName,
      roleLabel,
      avatarInitials,
      profileHref: null,
    },
    body,
    replyToMessageId: null,
    presentation: {
      kind: "user_message",
    },
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function changedFiles() {
  const files = new Set<string>();
  for (const command of [
    `git diff --name-only ${BASE_REF}...HEAD`,
    "git diff --name-only",
    "git diff --cached --name-only",
  ]) {
    for (const line of execSync(command, { encoding: "utf8" }).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }
  }
  for (const line of execSync("git status --short --untracked-files=all", { encoding: "utf8" }).split(/\r?\n/)) {
    const trimmed = line.slice(3).trim();
    if (!trimmed) continue;
    files.add(trimmed.split(" -> ").at(-1) ?? trimmed);
  }
  return [...files].sort();
}

function assertOrder(source: string, before: string, after: string, message: string) {
  const commands = source.split("&&").map((command) => command.trim());
  const beforeIndex = commands.indexOf(before);
  const afterIndex = commands.indexOf(after);
  assert.notEqual(beforeIndex, -1, `${before} should exist in npm test.`);
  assert.notEqual(afterIndex, -1, `${after} should exist in npm test.`);
  assert.equal(beforeIndex < afterIndex, true, message);
}

function assertIncludes(source: string, snippet: string, message: string) {
  assert.equal(source.includes(snippet), true, message);
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}

void main();
