import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const UI_PREFLIGHT_DOC = "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_APPROVAL_PREFLIGHT.md";
const UI_PREFLIGHT_HANDOFF = "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_APPROVAL_PREFLIGHT_HANDOFF.md";
const MESSAGE_READ_DOC = "docs/DZN_COMMS_MESSAGE_READ_MODEL_LOCAL_TEST_FOUNDATION.md";
const MESSAGE_READ_HANDOFF = "docs/DZN_COMMS_MESSAGE_READ_MODEL_LOCAL_TEST_FOUNDATION_HANDOFF.md";
const MESSAGE_READ_APPROVAL_DOC = "docs/DZN_COMMS_MESSAGE_READ_MODEL_APPROVAL_PREFLIGHT.md";
const MESSAGE_READ_ROUTE = "functions/api/dzn-comms/channels/[channelId]/messages.ts";
const MESSAGE_READ_HELPER = "functions/_lib/dzn-comms-message-read.ts";
const MESSAGE_READ_MIGRATION = "migrations/0074_dzn_comms_message_read_model.sql";
const COMMUNITY_PAGE = "app/community/page.tsx";
const COMMS_SHELL = "components/community/dzn-comms-visual-shell.tsx";
const PRESENCE_COUNTER = "components/community/dzn-live-presence-counter.tsx";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const PACKAGE_JSON = "package.json";
const UI_IMPLEMENTATION_DOC = "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_IMPLEMENTATION.md";
const UI_IMPLEMENTATION_HANDOFF = "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_IMPLEMENTATION_HANDOFF.md";
const RENDERED_QA_DOC = "docs/DZN_COMMS_MESSAGE_HISTORY_RENDERED_QA.md";
const RENDERED_QA_HANDOFF = "docs/DZN_COMMS_MESSAGE_HISTORY_RENDERED_QA_HANDOFF.md";
const RENDERED_QA_ARTIFACT_DIR = "docs/artifacts/dzn-comms-message-history-rendered-qa";
const RENDERED_QA_ARTIFACT_README = `${RENDERED_QA_ARTIFACT_DIR}/README.md`;
const RENDERED_QA_ARTIFACT_JSON = `${RENDERED_QA_ARTIFACT_DIR}/dzn-comms-message-history-rendered-qa.json`;
const RENDERED_QA_ARTIFACT_HTML = `${RENDERED_QA_ARTIFACT_DIR}/index.html`;
const BASE_REF = "origin/codex/dzn-comms-message-read-model-local-read-foundation-20260831";
const SLICE_HEAD_REFS = [
  "codex/dzn-comms-message-history-ui-integration-approval-preflight-20260831",
  "origin/codex/dzn-comms-message-history-ui-integration-approval-preflight-20260831",
  "HEAD",
] as const;

const DOC_SNIPPETS = [
  "DZN Comms Message-History UI Integration Approval Preflight",
  "This slice is message-history UI integration approval preflight only.",
  "This slice does not implement that UI fetch.",
  "GET /api/dzn-comms/channels/:channelId/messages",
  "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=true",
  "DZN_COMMS_MESSAGE_READ_ENABLED=true",
  "DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME=local",
  "DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED=true",
  "DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED=true",
  "All flags default disabled.",
  "`global`",
  "`new_players`",
  "`server_owners`",
  "`events`",
  "`pandora_squad`",
  "`support` | no message-history fetch",
  "Use same-origin requests.",
  "Use `cache: \"no-store\"` or equivalent.",
  "Use an `AbortController` timeout",
  "Never persist fetched messages to `localStorage`, `sessionStorage`, `IndexedDB`, Cache API, service workers, cookies, analytics events, or retained exports.",
  "Never create read receipts",
  "The UI must never call POST, PUT, PATCH, or DELETE Comms endpoints in this slice family.",
  "Client flag disabled",
  "Loading",
  "Success",
  "400 invalid cursor",
  "401 unauthenticated",
  "403 private group denied",
  "404 disabled/not configured",
  "503 unavailable",
  "Network timeout/error",
  "Malformed response",
  "Free Discord player",
  "Owner entitlement alone is not private group membership.",
  "profileHref: null",
  "Still blocked after this preflight",
  "No UI code calls `GET /api/dzn-comms/channels/:channelId/messages` yet.",
  "No UI code references `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED` yet.",
  "Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.",
  "DZN Comms message-history UI integration implementation",
];

const HANDOFF_SNIPPETS = [
  "DZN Comms Message-History UI Integration Approval Preflight Handoff",
  "Documentation/test-only approval preflight",
  "codex/dzn-comms-message-history-ui-integration-approval-preflight-20260831",
  "origin/codex/dzn-comms-message-read-model-local-read-foundation-20260831",
  "No `/community` UI fetch.",
  "No message send runtime.",
  "No runtime emoji reaction route.",
  "No DZN Assist AI runtime.",
  "No Durable Object.",
  "No WebSocket.",
  "No analytics/tracking.",
  "No Store/payment change.",
  "No migration.",
  "No deployment to `https://dayz-network.com/`.",
  "No issue #49 change.",
  "Validation To Run",
  "DZN Comms message-history UI integration implementation",
];

const CROSS_DOC_SNIPPETS = [
  "docs/DZN_COMMS_MESSAGE_HISTORY_UI_INTEGRATION_APPROVAL_PREFLIGHT.md",
  "DZN Comms message-history UI integration approval preflight",
];

const MASTER_SPEC_SNIPPETS = [
  "DZN Comms Message-History UI Integration Approval Preflight",
  "`/community` may later fetch the approved message-read route only when `NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=true`",
  "The support surface remains static and does not fetch message history.",
  "The approved channel mapping is `global`, `new_players`, `server_owners`, `events`, and `pandora_squad`.",
  "The UI must fall back to the static shell for disabled flags, loading failure, invalid cursor, unauthenticated public fallback, private group denial, unavailable route, timeout, or malformed response.",
  "No browser storage, read receipts, analytics/tracking, chat sending, reactions, reports, moderation mutations, DZN Assist AI runtime, Durable Objects/WebSockets, Store/payment changes, live checkout, production mutations, retained exports, or competitive-system effects are approved.",
];

const PUBLIC_POLICY_SNIPPETS = [
  "The DZN Comms Message-History UI Integration Approval Preflight Slice may define whether `/community` can later fetch the disabled-by-default read-only route",
  "`NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED`",
  "When the client flag is disabled, `/community` must not call the message-history route",
  "Support remains static and does not fetch message history.",
  "The UI integration cannot send messages",
  "cannot affect billing",
];

const ALLOWED_CHANGED_PATHS = new Set([
  UI_PREFLIGHT_DOC,
  UI_PREFLIGHT_HANDOFF,
  MESSAGE_READ_APPROVAL_DOC,
  MESSAGE_READ_DOC,
  MESSAGE_READ_HANDOFF,
  UI_IMPLEMENTATION_DOC,
  UI_IMPLEMENTATION_HANDOFF,
  RENDERED_QA_DOC,
  RENDERED_QA_HANDOFF,
  RENDERED_QA_ARTIFACT_README,
  RENDERED_QA_ARTIFACT_JSON,
  RENDERED_QA_ARTIFACT_HTML,
  MASTER_SPEC,
  PUBLIC_ACCESS_POLICY,
  "scripts/test-dzn-comms-message-history-ui-integration-approval-preflight.ts",
  "scripts/test-dzn-comms-message-history-ui-integration.ts",
  "scripts/test-dzn-comms-message-history-rendered-qa.ts",
  "scripts/test-dzn-comms-message-read-model-approval-preflight.ts",
  "scripts/test-dzn-comms-reaction-contract-preflight.ts",
  "scripts/test-dzn-comms-reaction-runtime-approval-preflight.ts",
  PACKAGE_JSON,
]);

const ALLOWED_CHANGED_PREFIXES = [
  `${RENDERED_QA_ARTIFACT_DIR}/screenshots/`,
] as const;

const FORBIDDEN_RUNTIME_PATHS = [
  "functions/api/dzn-comms/messages",
  "functions/api/dzn-comms/reactions",
  "functions/api/dzn-comms/moderation",
  "functions/api/dzn-comms/reports",
  "functions/api/dzn-comms/support",
  "functions/api/chat",
  "functions/api/support-chat",
  "functions/api/dzn-assist",
  "functions/api/community/chat",
  "app/api/dzn-comms",
  "app/api/chat",
  "app/api/support-chat",
  "app/api/dzn-assist",
  "components/chat",
  "components/support-chat",
  "components/dzn-assist",
  "lib/dzn-comms.ts",
  "lib/dzn-comms",
  "lib/chat.ts",
  "lib/chat",
  "lib/support-bot.ts",
  "lib/support-bot",
];

const FORBIDDEN_UI_MESSAGE_HISTORY_PATTERNS = [
  /NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED/i,
  /\/api\/dzn-comms\/channels\/[^"`']+\/messages/i,
  /DZN_COMMS_MESSAGE_READ_ENABLED/i,
  /dzn_comms_messages/i,
  /read receipts?/i,
  /last-read/i,
  /localStorage/i,
  /sessionStorage/i,
  /indexedDB/i,
  /navigator\.sendBeacon/i,
  /\bgtag\s*\(/i,
  /\bposthog\b/i,
  /\btrackEvent\b/i,
  /\bcheckout\.sessions\.create\b/i,
  /\bopenai\.responses\b/i,
  /\bchat\.completions\b/i,
  /\bcreateEmbedding\b/i,
  /\bvectorize\b/i,
];

const FORBIDDEN_CHANGED_RUNTIME_PATTERN =
  /^(?:app|components|functions|lib)[\\/].*\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;

const FORBIDDEN_CHANGED_PRODUCTION_PATTERN =
  /^(?:migrations|public|\.github)[\\/]|^(?:cloudflare-env\.d\.ts|wrangler(?:\.adm-sync|\.auto-update)?\.toml|package-lock\.json)$/i;

const FORBIDDEN_DOC_MUTATION_COMMANDS = [
  "wrangler d1 migrations apply",
  "wrangler pages secret",
  "wrangler secret",
  "wrangler deploy",
  "stripe products",
  "stripe prices",
  "stripe listen",
  "git merge",
];

main();

function main() {
  assertFilesExist();
  assertPreflightDoc();
  assertHandoffDoc();
  assertCrossDocs();
  assertPackageScript();
  assertCommunityStillStatic();
  assertApprovedMessageReadRouteRemainsGetOnly();
  assertNoForbiddenRuntimeFiles();
  assertNoRuntimeOrProductionFilesChanged();
  assertNoProductionMutationCommands();
  console.log("DZN Comms message-history UI integration approval preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    UI_PREFLIGHT_DOC,
    UI_PREFLIGHT_HANDOFF,
    MESSAGE_READ_DOC,
    MESSAGE_READ_HANDOFF,
    MESSAGE_READ_APPROVAL_DOC,
    MESSAGE_READ_ROUTE,
    MESSAGE_READ_HELPER,
    MESSAGE_READ_MIGRATION,
    COMMUNITY_PAGE,
    COMMS_SHELL,
    PRESENCE_COUNTER,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertPreflightDoc() {
  const doc = read(UI_PREFLIGHT_DOC);
  for (const snippet of DOC_SNIPPETS) {
    assertIncludes(doc, snippet, `UI preflight doc must include: ${snippet}`);
  }
  assert.doesNotMatch(doc, /paid.*message.*visibility/i, "Paid plans must not alter message visibility.");
  assert.doesNotMatch(doc, /client-submitted.*private.*membership.*allowed/i, "Client-submitted private membership must not be accepted.");
}

function assertHandoffDoc() {
  const handoff = read(UI_PREFLIGHT_HANDOFF);
  for (const snippet of HANDOFF_SNIPPETS) {
    assertIncludes(handoff, snippet, `UI preflight handoff must include: ${snippet}`);
  }
}

function assertCrossDocs() {
  for (const path of [MESSAGE_READ_DOC, MESSAGE_READ_HANDOFF, MESSAGE_READ_APPROVAL_DOC, MASTER_SPEC, PUBLIC_ACCESS_POLICY]) {
    const source = read(path);
    for (const snippet of CROSS_DOC_SNIPPETS) {
      assertIncludes(source, snippet, `${path} must include: ${snippet}`);
    }
    assert.match(source, /issue\s+`?#49`?/i, `${path} must keep the issue #49 live-checkout boundary.`);
  }

  const masterSpec = read(MASTER_SPEC);
  for (const snippet of MASTER_SPEC_SNIPPETS) {
    assertIncludes(masterSpec, snippet, `Master spec must include: ${snippet}`);
  }

  const policy = read(PUBLIC_ACCESS_POLICY);
  for (const snippet of PUBLIC_POLICY_SNIPPETS) {
    assertIncludes(policy, snippet, `Public policy must include: ${snippet}`);
  }
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-comms-message-history-ui-integration-approval-preflight"],
    "tsx scripts/test-dzn-comms-message-history-ui-integration-approval-preflight.ts",
    "Focused DZN Comms message-history UI integration approval test should be wired into package scripts.",
  );

  const fullTest = packageJson.scripts?.test ?? "";
  assert.equal(
    fullTest.includes("npm run test:dzn-comms-message-history-ui-integration-approval-preflight"),
    true,
    "Full npm test should include the DZN Comms message-history UI integration approval guard.",
  );
  assertOrder(
    fullTest,
    "npm run test:dzn-comms-message-read-model-local-foundation",
    "npm run test:dzn-comms-message-history-ui-integration-approval-preflight",
    "UI integration preflight should run after the local/test message-read foundation.",
  );
  assertOrder(
    fullTest,
    "npm run test:dzn-comms-message-history-ui-integration-approval-preflight",
    "npm run test:dzn-comms-runtime-approval-preflight",
    "UI integration preflight should run before the broader runtime approval guard.",
  );
}

function assertCommunityStillStatic() {
  const page = read(COMMUNITY_PAGE);
  const shell = read(COMMS_SHELL);
  const presence = read(PRESENCE_COUNTER);

  assertIncludes(page, "<DznCommsVisualShell />", "Community page must still render the static visual shell.");
  assertIncludes(shell, "data-dzn-comms-prototype=\"static-local-mock-data\"", "Comms shell must keep the static mock marker.");
  assertIncludes(shell, "data-dzn-comms-reactions=\"emoji-static-preview\"", "Comms shell must keep reactions as static emoji preview only.");
  assertIncludes(shell, "Composer disabled in this static prototype - no messages are sent or stored.", "Composer must stay disabled.");
  assertIncludes(shell, "No bot runtime or model call is connected.", "DZN Assist must stay disconnected.");

  for (const pattern of FORBIDDEN_UI_MESSAGE_HISTORY_PATTERNS) {
    assert.doesNotMatch(page, pattern, `Community page must not include message-history UI runtime pattern ${pattern}.`);
    assert.doesNotMatch(shell, pattern, `Comms shell must not include message-history UI runtime pattern ${pattern}.`);
  }

  assert.doesNotMatch(
    presence,
    /\/api\/dzn-comms\/channels\/[^"`']+\/messages|NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED/i,
    "Presence counter must stay separate from message-history UI fetching.",
  );
}

function assertApprovedMessageReadRouteRemainsGetOnly() {
  const route = read(MESSAGE_READ_ROUTE);
  const helper = read(MESSAGE_READ_HELPER);

  assertIncludes(route, "request.method !== \"GET\"", "Message-read route must explicitly allow GET only.");
  for (const snippet of [
    "onRequestPost",
    "onRequestPut",
    "onRequestPatch",
    "onRequestDelete",
    "readBoundedJson",
    "INSERT INTO",
    "UPDATE ",
    "DELETE FROM",
    "checkout.sessions.create",
    "new WebSocket",
    "WebSocketPair",
    "DurableObject",
    "openai.responses",
    "chat.completions",
  ]) {
    assert.equal(route.includes(snippet), false, `Message-read route must not include ${snippet}.`);
    assert.equal(helper.includes(snippet), false, `Message-read helper must not include ${snippet}.`);
  }
}

function assertNoForbiddenRuntimeFiles() {
  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in the UI integration approval preflight.`);
  }
}

function assertNoRuntimeOrProductionFilesChanged() {
  const changed = listChangedFiles().map((path) => path.replace(/\\/g, "/"));
  const unexpected = changed.filter((path) => {
    if (ALLOWED_CHANGED_PATHS.has(path)) return false;
    return !ALLOWED_CHANGED_PREFIXES.some((prefix) => path.startsWith(prefix));
  });
  assert.deepEqual(unexpected, [], "UI integration approval preflight may change only approved docs, package script, and guard test files.");

  const runtimeChanges = changed.filter((path) => FORBIDDEN_CHANGED_RUNTIME_PATTERN.test(path));
  assert.deepEqual(runtimeChanges, [], "UI integration approval preflight must not change runtime app/component/function/lib files.");

  const productionChanges = changed.filter((path) => FORBIDDEN_CHANGED_PRODUCTION_PATTERN.test(path));
  assert.deepEqual(productionChanges, [], "UI integration approval preflight must not change migrations, public assets, workflows, Wrangler config, package-lock, or Cloudflare types.");
}

function assertNoProductionMutationCommands() {
  for (const path of [UI_PREFLIGHT_DOC, UI_PREFLIGHT_HANDOFF, MESSAGE_READ_DOC, MESSAGE_READ_HANDOFF]) {
    const source = read(path);
    for (const command of FORBIDDEN_DOC_MUTATION_COMMANDS) {
      assert.equal(source.includes(command), false, `${path} must not include production mutation command ${command}.`);
    }
  }

  for (const path of ["wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"]) {
    if (!existsSync(path)) continue;
    const source = read(path);
    assert.doesNotMatch(source, /DZN_LIVE_CHECKOUT_ENABLED\s*=\s*true/i, `${path} must not enable live checkout.`);
    assert.doesNotMatch(source, /NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED/i, `${path} must not opt in the message-history UI flag in this preflight.`);
  }
}

function assertOrder(source: string, before: string, after: string, message: string) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert.notEqual(beforeIndex, -1, `${before} should exist in npm test.`);
  assert.notEqual(afterIndex, -1, `${after} should exist in npm test.`);
  assert.equal(beforeIndex < afterIndex, true, message);
}

function listChangedFiles(): string[] {
  const files = new Set<string>();
  const sliceHead = resolveSliceHead();
  const baseline = resolveBaseline(sliceHead);

  addChangedFileLines(files, execGit(`git diff --name-only ${baseline}...${sliceHead}`));
  addChangedFileLines(files, execGit("git diff --name-only"));
  addChangedFileLines(files, execGit("git diff --cached --name-only"));

  for (const line of execGit("git status --short --untracked-files=all").split(/\r?\n/)) {
    const trimmed = line.slice(3).trim();
    if (trimmed) files.add(trimmed.split(" -> ").at(-1) ?? trimmed);
  }

  return [...files].sort();
}

function resolveSliceHead() {
  for (const ref of SLICE_HEAD_REFS) {
    const resolved = execGit(`git rev-parse --verify ${ref}`).trim();
    if (resolved) return ref;
  }

  return "HEAD";
}

function resolveBaseline(sliceHead: string) {
  const base = execGit(`git rev-parse --verify ${BASE_REF}`).trim();
  if (base) return BASE_REF;

  const parents = execGit(`git rev-list --parents -n 1 ${sliceHead}`)
    .trim()
    .split(/\s+/);
  return parents[1] ?? `${sliceHead}^`;
}

function addChangedFileLines(files: Set<string>, output: string) {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) files.add(trimmed);
  }
}

function execGit(command: string) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

function assertIncludes(source: string, snippet: string, message: string) {
  assert.equal(source.includes(snippet), true, message);
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}
