import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

const BASE_REF = "origin/codex/dzn-comms-message-history-ui-integration-implementation-20260831";
const ARTIFACT_DIR = "docs/artifacts/dzn-comms-message-history-rendered-qa";
const ARTIFACT_JSON = `${ARTIFACT_DIR}/dzn-comms-message-history-rendered-qa.json`;
const ARTIFACT_HTML = `${ARTIFACT_DIR}/index.html`;
const ARTIFACT_README = `${ARTIFACT_DIR}/README.md`;

const DOC = "docs/DZN_COMMS_MESSAGE_HISTORY_RENDERED_QA.md";
const HANDOFF = "docs/DZN_COMMS_MESSAGE_HISTORY_RENDERED_QA_HANDOFF.md";
const PREVIOUS_IMPLEMENTATION_DOC = "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_IMPLEMENTATION.md";
const PREVIOUS_IMPLEMENTATION_HANDOFF = "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_IMPLEMENTATION_HANDOFF.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const COMMUNITY_PAGE = "app/community/page.tsx";
const COMMS_SHELL = "components/community/dzn-comms-visual-shell.tsx";
const HISTORY_HELPER = "components/community/dzn-comms-message-history.ts";
const MESSAGE_READ_ROUTE = "functions/api/dzn-comms/channels/[channelId]/messages.ts";
const MESSAGE_READ_HELPER = "functions/_lib/dzn-comms-message-read.ts";
const PACKAGE_JSON = "package.json";

const CASES = [
  "static_fallback",
  "public_channel_read",
  "unavailable_route_fallback",
  "private_group_denial",
] as const;

const VIEWPORTS = {
  desktop: { width: 1425, minHeight: 2_000 },
  mobile: { width: 375, minHeight: 3_700 },
} as const;

const FORBIDDEN_RUNTIME_PATTERNS = [
  /\bmethod\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i,
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
  /\bdataLayer\b/i,
  /\bposthog\b/i,
  /\bmixpanel\b/i,
  /\bamplitude\b/i,
  /\bplausible\b/i,
  /\btrackEvent\b/i,
  /\bcheckout\.sessions\.create\b/i,
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
  /\bwrangler\s+(?:deploy|secret|d1\s+migrations\s+apply|d1\s+execute)/i,
] as const;

const FORBIDDEN_ARTIFACT_STRINGS = [
  "secret private body",
  "hidden private body",
  "private-group-secret",
  "discord_id",
  "raw_dzn_user_id",
  "billing_plan",
  "checkout_session",
  "stripe_customer",
  "nitrado_service",
  "server_wars_score",
  "ctf_score",
  "raw_award_evidence",
  "retained_export_id",
] as const;

const ALLOWED_CHANGED_PATHS = [
  DOC,
  HANDOFF,
  PREVIOUS_IMPLEMENTATION_DOC,
  PREVIOUS_IMPLEMENTATION_HANDOFF,
  MASTER_SPEC,
  PUBLIC_ACCESS_POLICY,
  PACKAGE_JSON,
  "scripts/test-dzn-comms-message-history-ui-integration-approval-preflight.ts",
  "scripts/test-dzn-comms-message-history-ui-integration.ts",
  "scripts/test-dzn-comms-message-read-model-approval-preflight.ts",
  "scripts/test-dzn-comms-reaction-contract-preflight.ts",
  "scripts/test-dzn-comms-reaction-runtime-approval-preflight.ts",
  "scripts/test-dzn-comms-message-history-rendered-qa.ts",
  ARTIFACT_README,
  ARTIFACT_JSON,
  ARTIFACT_HTML,
] as const;

const ALLOWED_CHANGED_PREFIXES = [
  `${ARTIFACT_DIR}/screenshots/`,
] as const;

type CaseKey = (typeof CASES)[number];
type ViewportKey = keyof typeof VIEWPORTS;

type ScreenshotEvidence = {
  viewport: ViewportKey;
  width: number;
  height: number;
  screenshot_path: string;
  image_width: number;
  image_height: number;
  image_mime: "image/png" | "image/jpeg";
  non_blank_sample: true;
};

type RouteRequestEvidence = {
  method: "GET";
  path: string;
  observed_status: number;
  credentials: "include";
  cache: "no-store";
};

type RenderedCaseEvidence = {
  key: CaseKey;
  route: "/community";
  scenario: string;
  client_flag: "disabled" | "enabled";
  server_route_mode:
    | "not_called"
    | "local_pages_seeded_public_success"
    | "local_pages_unavailable_no_db"
    | "local_pages_private_denial";
  data_dzn_comms_message_history_ui: "disabled-static-fallback" | "enabled-read-only";
  data_dzn_comms_history_source: "static-fallback" | "read-only-message-history";
  status_state: "static" | "live" | "fallback";
  status_reason: string | null;
  status_label: string;
  active_channel_label: string;
  composer_disabled: true;
  send_button_disabled: true;
  reaction_runtime: "static-emoji-preview-only";
  route_requests: RouteRequestEvidence[];
  screenshots: ScreenshotEvidence[];
  visible_text_contains: string[];
  visible_text_absent: string[];
};

type RenderedQaArtifact = {
  schema_version: "dzn-comms-message-history-rendered-qa/v1";
  generated_at: string;
  generated_by: "DZN Comms message-history rendered local/test QA";
  source_branch: string;
  base_branch: string;
  source_commit: string;
  route: "/community";
  production_services_required: false;
  screenshots_committed: true;
  feature_flags: {
    default_client_flag: "disabled";
    enabled_client_flag: "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=true";
    server_message_read_flags: "actual local Pages route with temporary local D1 state where needed";
  };
  cases: RenderedCaseEvidence[];
  safety_contract: Record<
    | "chat_sending"
    | "reaction_runtime"
    | "report_routes"
    | "moderation_mutations"
    | "dzn_assist_ai_runtime"
    | "durable_objects"
    | "websockets"
    | "analytics_tracking"
    | "store_payment_changes"
    | "live_checkout"
    | "stripe_mutations"
    | "cloudflare_config_mutations"
    | "production_d1_writes"
    | "nitrado_mutations"
    | "discord_mutations"
    | "retained_exports"
    | "deployment"
    | "issue_49_changes"
    | "billing_effect"
    | "owner_entitlement_effect"
    | "server_ownership_effect"
    | "ranking_effect"
    | "discovery_effect"
    | "review_effect"
    | "badge_effect"
    | "season_effect"
    | "event_effect"
    | "server_wars_effect"
    | "ctf_effect"
    | "xp_award_effect"
    | "calling_card_award_effect"
    | "public_profile_visibility_effect"
    | "competitive_eligibility_effect",
    false
  >;
};

function main() {
  assertFilesExist();
  const artifact = readArtifact();
  assertArtifactShape(artifact);
  assertRenderedCases(artifact);
  assertScreenshots(artifact);
  assertNoPrivateOrProductionLeaks(artifact);
  assertDocsAndPackageWiring();
  assertRuntimeSourcesStillNoMutationHooks();
  assertChangedPathsStayBounded();
  console.log("DZN Comms message-history rendered local/test QA tests passed.");
}

function assertFilesExist() {
  for (const path of [
    DOC,
    HANDOFF,
    PREVIOUS_IMPLEMENTATION_DOC,
    PREVIOUS_IMPLEMENTATION_HANDOFF,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    COMMUNITY_PAGE,
    COMMS_SHELL,
    HISTORY_HELPER,
    MESSAGE_READ_ROUTE,
    MESSAGE_READ_HELPER,
    PACKAGE_JSON,
    ARTIFACT_README,
    ARTIFACT_JSON,
    ARTIFACT_HTML,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function readArtifact(): RenderedQaArtifact {
  const artifact = JSON.parse(read(ARTIFACT_JSON)) as RenderedQaArtifact;
  assert.equal(artifact.schema_version, "dzn-comms-message-history-rendered-qa/v1");
  return artifact;
}

function assertArtifactShape(artifact: RenderedQaArtifact) {
  assert.equal(artifact.generated_by, "DZN Comms message-history rendered local/test QA");
  assert.equal(artifact.route, "/community");
  assert.equal(artifact.production_services_required, false);
  assert.equal(artifact.screenshots_committed, true);
  assert.equal(artifact.feature_flags.default_client_flag, "disabled");
  assert.equal(artifact.feature_flags.enabled_client_flag, "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=true");
  assert.equal(
    artifact.feature_flags.server_message_read_flags,
    "actual local Pages route with temporary local D1 state where needed",
  );
  assert.deepEqual(artifact.cases.map((item) => item.key), [...CASES]);
  assert.equal(Object.values(artifact.safety_contract).every((value) => value === false), true);
}

function assertRenderedCases(artifact: RenderedQaArtifact) {
  const cases = new Map(artifact.cases.map((item) => [item.key, item]));
  assertCase(cases.get("static_fallback"), {
    clientFlag: "disabled",
    serverRouteMode: "not_called",
    ui: "disabled-static-fallback",
    source: "static-fallback",
    state: "static",
    reason: "client-flag-disabled",
    channel: "# Global Chat",
    requests: 0,
    contains: ["Static Prototype", "Static preview active", "Welcome everyone"],
  });
  assertCase(cases.get("public_channel_read"), {
    clientFlag: "enabled",
    serverRouteMode: "local_pages_seeded_public_success",
    ui: "enabled-read-only",
    source: "read-only-message-history",
    state: "live",
    reason: "live",
    channel: "# Global Chat",
    requests: 1,
    contains: ["Read-Only History", "Saved history synced", "Rendered QA public message", "Read-only"],
  });
  assertCase(cases.get("unavailable_route_fallback"), {
    clientFlag: "enabled",
    serverRouteMode: "local_pages_unavailable_no_db",
    ui: "enabled-read-only",
    source: "static-fallback",
    state: "fallback",
    reason: "unavailable",
    channel: "# Global Chat",
    requests: 1,
    contains: ["Read-Only History", "Saved history unavailable", "Welcome everyone"],
  });
  assertCase(cases.get("private_group_denial"), {
    clientFlag: "enabled",
    serverRouteMode: "local_pages_private_denial",
    ui: "enabled-read-only",
    source: "static-fallback",
    state: "fallback",
    reason: "private-denied",
    channel: "Pandora Squad",
    requests: 1,
    contains: ["Read-Only History", "Private group history unavailable", "Pandora Squad"],
  });

  const publicCase = cases.get("public_channel_read");
  assert.ok(publicCase);
  assert.equal(publicCase.route_requests[0]?.path, "/api/dzn-comms/channels/global/messages?limit=25");
  assert.equal(publicCase.route_requests[0]?.observed_status, 200);

  const unavailableCase = cases.get("unavailable_route_fallback");
  assert.ok(unavailableCase);
  assert.equal(unavailableCase.route_requests[0]?.path, "/api/dzn-comms/channels/global/messages?limit=25");
  assert.equal(unavailableCase.route_requests[0]?.observed_status, 503);

  const privateCase = cases.get("private_group_denial");
  assert.ok(privateCase);
  assert.equal(privateCase.route_requests[0]?.path, "/api/dzn-comms/channels/pandora-squad/messages?limit=25");
  assert.equal(privateCase.route_requests[0]?.observed_status, 403);
}

function assertCase(
  value: RenderedCaseEvidence | undefined,
  expected: {
    clientFlag: RenderedCaseEvidence["client_flag"];
    serverRouteMode: RenderedCaseEvidence["server_route_mode"];
    ui: RenderedCaseEvidence["data_dzn_comms_message_history_ui"];
    source: RenderedCaseEvidence["data_dzn_comms_history_source"];
    state: RenderedCaseEvidence["status_state"];
    reason: string | null;
    channel: string;
    requests: number;
    contains: string[];
  },
) {
  assert.ok(value, "Rendered QA case should exist.");
  assert.equal(value.route, "/community");
  assert.equal(value.client_flag, expected.clientFlag);
  assert.equal(value.server_route_mode, expected.serverRouteMode);
  assert.equal(value.data_dzn_comms_message_history_ui, expected.ui);
  assert.equal(value.data_dzn_comms_history_source, expected.source);
  assert.equal(value.status_state, expected.state);
  assert.equal(value.status_reason, expected.reason);
  assert.equal(value.active_channel_label, expected.channel);
  assert.equal(value.composer_disabled, true);
  assert.equal(value.send_button_disabled, true);
  assert.equal(value.reaction_runtime, "static-emoji-preview-only");
  assert.equal(value.route_requests.length, expected.requests);
  for (const request of value.route_requests) {
    assert.equal(request.method, "GET");
    assert.equal(request.credentials, "include");
    assert.equal(request.cache, "no-store");
    assert.match(request.path, /^\/api\/dzn-comms\/channels\/(?:global|pandora-squad)\/messages\?limit=25$/);
  }
  for (const expectedText of expected.contains) {
    assert.equal(
      value.visible_text_contains.includes(expectedText),
      true,
      `${value.key} should record visible proof text: ${expectedText}`,
    );
  }
  for (const forbiddenText of value.visible_text_absent) {
    assert.equal(
      value.visible_text_contains.some((visibleText) => visibleText.includes(forbiddenText)),
      false,
      `${value.key} visible proof text must not expose ${forbiddenText}.`,
    );
  }
}

function assertScreenshots(artifact: RenderedQaArtifact) {
  for (const renderedCase of artifact.cases) {
    assert.deepEqual(renderedCase.screenshots.map((item) => item.viewport).sort(), ["desktop", "mobile"]);
    for (const screenshot of renderedCase.screenshots) {
      const expected = VIEWPORTS[screenshot.viewport];
      assert.equal(screenshot.width, expected.width);
      assert.equal(screenshot.height >= expected.minHeight, true);
      assert.equal(screenshot.screenshot_path.startsWith(`${ARTIFACT_DIR}/screenshots/`), true);
      assert.equal(existsSync(screenshot.screenshot_path), true, `${screenshot.screenshot_path} should exist.`);
      assert.equal(screenshot.non_blank_sample, true);
      const info = readImageInfo(screenshot.screenshot_path);
      assert.equal(info.width, screenshot.image_width);
      assert.equal(info.height, screenshot.image_height);
      assert.equal(info.mime, screenshot.image_mime);
      assert.equal(info.width, expected.width);
      assert.equal(info.height >= expected.minHeight, true);
      assert.equal(info.bytes > 12_000, true, `${screenshot.screenshot_path} should not be a tiny placeholder.`);
    }
  }
}

function assertNoPrivateOrProductionLeaks(artifact: RenderedQaArtifact) {
  const artifactText = [read(ARTIFACT_JSON), read(ARTIFACT_HTML), read(ARTIFACT_README)].join("\n");
  assert.equal(JSON.stringify(artifact).includes("Seeded private squad message"), false);
  for (const forbidden of FORBIDDEN_ARTIFACT_STRINGS) {
    assert.equal(artifactText.includes(forbidden), false, `Rendered QA artifact must not include ${forbidden}.`);
  }
  assert.doesNotMatch(
    artifactText,
    /<script|<form|localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|XMLHttpRequest|gtag|dataLayer|posthog|mixpanel|amplitude|plausible|trackEvent/i,
    "Rendered QA artifact must not include scripts, forms, tracking calls, or storage hooks.",
  );
  assert.doesNotMatch(
    artifactText,
    /checkout\.sessions\.create|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|DISCORD_BOT_TOKEN|NITRADO_(?:API|TOKEN|SERVICE|SECRET)|wrangler\s+(?:deploy|secret|d1\s+migrations\s+apply|d1\s+execute)|\bINSERT\s+INTO\b|\bUPDATE\s+\w+|\bDELETE\s+FROM\b/i,
    "Rendered QA artifact must not include payment, provider, production, or database write hooks.",
  );
}

function assertDocsAndPackageWiring() {
  const docs = [
    read(DOC),
    read(HANDOFF),
    read(PREVIOUS_IMPLEMENTATION_DOC),
    read(PREVIOUS_IMPLEMENTATION_HANDOFF),
    read(MASTER_SPEC),
    read(PUBLIC_ACCESS_POLICY),
    read(ARTIFACT_README),
  ].join("\n");

  for (const snippet of [
    "DZN Comms Message-History Rendered Local/Test QA",
    "`/community`",
    "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED",
    "static fallback",
    "public-channel read",
    "unavailable route fallback",
    "private-group denial",
    "desktop",
    "mobile",
    "local/test only",
    "No chat sending.",
    "No runtime reactions.",
    "No report routes.",
    "No moderation mutations.",
    "No DZN Assist AI runtime.",
    "No Durable Objects/WebSockets.",
    "No analytics/tracking.",
    "No Store/payment/live checkout changes.",
    "No production mutations.",
    "No retained exports.",
    "Issue #49 remains reserved",
    "cannot affect billing, owner entitlement, server ownership, scoring, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, public profile visibility, retained exports, or competitive eligibility",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }

  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-comms-message-history-rendered-qa"],
    "tsx scripts/test-dzn-comms-message-history-rendered-qa.ts",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-comms-message-history-rendered-qa"),
    true,
    "Full npm test should include rendered QA.",
  );
  assertOrder(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-comms-message-history-ui-integration",
    "npm run test:dzn-comms-message-history-rendered-qa",
  );
  assertOrder(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-comms-message-history-rendered-qa",
    "npm run test:dzn-comms-runtime-approval-preflight",
  );
}

function assertRuntimeSourcesStillNoMutationHooks() {
  const source = [
    read(COMMUNITY_PAGE),
    read(COMMS_SHELL),
    read(HISTORY_HELPER),
    read(MESSAGE_READ_ROUTE),
    read(MESSAGE_READ_HELPER).replace(/INSERT\s+INTO\s+dzn_comms_messages/gi, "seed-fixture-only"),
  ].join("\n");

  assert.equal(read(COMMUNITY_PAGE).includes("<DznCommsVisualShell />"), true);
  assert.equal(read(COMMS_SHELL).includes("data-dzn-comms-message-history-ui"), true);
  assert.equal(read(COMMS_SHELL).includes("data-dzn-comms-history-source"), true);
  assert.equal(read(COMMS_SHELL).includes("data-dzn-comms-message-history-state"), true);
  assert.equal(read(HISTORY_HELPER).includes("method: \"GET\""), true);
  assert.equal(read(MESSAGE_READ_ROUTE).includes("request.method !== \"GET\""), true);

  for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
    assert.doesNotMatch(source, pattern, `Rendered QA slice must not add runtime mutation/provider pattern ${pattern}.`);
  }
}

function assertChangedPathsStayBounded() {
  const allowed = new Set(ALLOWED_CHANGED_PATHS.map((path) => path.replace(/\\/g, "/")));
  const changed = changedFiles().map((path) => path.replace(/\\/g, "/"));
  const unexpected = changed.filter((path) => {
    if (allowed.has(path)) return false;
    return !ALLOWED_CHANGED_PREFIXES.some((prefix) => path.startsWith(prefix));
  });
  assert.deepEqual(unexpected, [], "Rendered QA slice should change only docs, QA artifacts, package script, and its focused test.");
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

function readImageInfo(path: string) {
  const buffer = readFileSync(path);
  const stats = statSync(path);
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR", `${path} should include a PNG IHDR chunk.`);
    return {
      mime: "image/png" as const,
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      bytes: stats.size,
    };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    const dimensions = readJpegDimensions(buffer, path);
    return {
      mime: "image/jpeg" as const,
      width: dimensions.width,
      height: dimensions.height,
      bytes: stats.size,
    };
  }
  throw new Error(`${path} should be a PNG or JPEG screenshot.`);
}

function readJpegDimensions(buffer: Buffer, path: string) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) break;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  throw new Error(`${path} should include JPEG dimensions.`);
}

function assertOrder(source: string, before: string, after: string) {
  const commands = source.split("&&").map((command) => command.trim());
  const beforeIndex = commands.indexOf(before);
  const afterIndex = commands.indexOf(after);
  assert.notEqual(beforeIndex, -1, `${before} should exist in npm test.`);
  assert.notEqual(afterIndex, -1, `${after} should exist in npm test.`);
  assert.equal(beforeIndex < afterIndex, true, `${before} should run before ${after}.`);
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}

main();
