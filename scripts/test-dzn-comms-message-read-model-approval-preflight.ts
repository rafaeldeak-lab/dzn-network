import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MESSAGE_READ_DOC = "docs/DZN_COMMS_MESSAGE_READ_MODEL_APPROVAL_PREFLIGHT.md";
const MESSAGE_READ_HANDOFF = "docs/DZN_COMMS_MESSAGE_READ_MODEL_APPROVAL_PREFLIGHT_HANDOFF.md";
const MESSAGE_READ_IMPLEMENTATION_DOC = "docs/DZN_COMMS_MESSAGE_READ_MODEL_LOCAL_TEST_FOUNDATION.md";
const MESSAGE_READ_IMPLEMENTATION_HANDOFF = "docs/DZN_COMMS_MESSAGE_READ_MODEL_LOCAL_TEST_FOUNDATION_HANDOFF.md";
const APPROVED_MESSAGE_READ_ROUTE = "functions/api/dzn-comms/channels/[channelId]/messages.ts";
const APPROVED_MESSAGE_READ_HELPER = "functions/_lib/dzn-comms-message-read.ts";
const APPROVED_MESSAGE_READ_MIGRATION = "migrations/0074_dzn_comms_message_read_model.sql";
const REACTION_RUNTIME_DOC = "docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md";
const REACTION_RUNTIME_HANDOFF = "docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT_HANDOFF.md";
const REACTION_CONTRACT_DOC = "docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md";
const REACTION_CONTRACT_HANDOFF = "docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT_HANDOFF.md";
const INTERACTION_DOC = "docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT.md";
const INTERACTION_HANDOFF = "docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT_HANDOFF.md";
const COMMS_RUNTIME_PREFLIGHT = "docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const PACKAGE_JSON = "package.json";

const MESSAGE_READ_DOC_SNIPPETS = [
  "DZN Comms Message/Read Model Approval Preflight",
  "This slice is message/read model approval preflight only.",
  "No runtime chat APIs are added.",
  "No message read route is added.",
  "No message send route is added.",
  "No message, membership, moderation, reaction, report, support, vector, AI, analytics, payment, or retained-export table is added.",
  "No migration is added.",
  "No Durable Objects or WebSockets are added.",
  "No persistence is added.",
  "GET /api/dzn-comms/channels/:channelId/messages",
  "Approved public DZN Comms channel identifiers",
  "`global`",
  "`new-players`",
  "`server-owners`",
  "`events`",
  "Private group reads require trusted membership proof on every request.",
  "trusted DZN user ID bridge",
  "Discord display name.",
  "Public profile handle.",
  "Owner entitlement alone is not private group membership.",
  "Message Visibility States",
  "`visible`",
  "`locked`",
  "`hidden`",
  "`deleted`",
  "`quarantined`",
  "`expired`",
  "`staff_only`",
  "`unavailable`",
  "Rejected send attempts, profanity-blocked bodies, timeout-triggering bodies, spam-filtered bodies, private support prompts, AI support answers, moderation notes, report notes, and raw evidence are not message history.",
  "Response Contract",
  "Public-safe display author fields only",
  "Cache-Control: no-store",
  "Vary: Cookie",
  "dzn_comms_channels",
  "dzn_comms_channel_memberships",
  "dzn_comms_messages",
  "dzn_comms_message_visibility_events",
  "DZN_COMMS_MESSAGE_READ_ENABLED=false",
  "DZN_COMMS_MESSAGE_READ_LOCAL_TEST_RUNTIME=false",
  "DZN_COMMS_PUBLIC_CHANNEL_HISTORY_ENABLED=false",
  "DZN_COMMS_PRIVATE_GROUP_HISTORY_ENABLED=false",
  "NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=false",
  "Mock-To-Real Transition",
  "No read receipts in the first implementation.",
  "No last-read cursor persistence in the first implementation.",
  "Message reads are presentation only.",
  "Starter, Pro, legacy Premium, Network, and Partner plan values must not alter message read visibility",
  "Message reads cannot affect billing",
  "chat sending, reaction runtime, report routes, moderation mutations, DZN Assist AI runtime",
  "does not deploy to `https://dayz-network.com/`",
  "DZN Comms message/read model local/test implementation foundation",
];

const HANDOFF_SNIPPETS = [
  "DZN Comms Message/Read Model Approval Preflight Handoff",
  "documentation/test-only message/read model approval preflight slice",
  "codex/dzn-comms-message-read-model-approval-preflight-20260831",
  "origin/codex/dzn-comms-reaction-runtime-approval-preflight-20260831",
  "No runtime message/read behavior.",
  "Runtime message-history API.",
  "Runtime chat send API.",
  "Runtime reaction API.",
  "Database migrations.",
  "Deployment to `https://dayz-network.com/`.",
  "Entitlement And Access Matrix",
  "Future public channel reads",
  "Future private group reads",
  "Future message writes",
  "Production-Mutation Confirmation",
  "Live checkout remains disabled. Issue `#49` remains reserved for final live payment activation.",
  "`npm run test:dzn-comms-message-read-model-approval-preflight`",
  "Changed-file scope check for no runtime files.",
  "DZN Comms message/read model local/test implementation foundation",
];

const CROSS_DOC_SNIPPETS = [
  "docs/DZN_COMMS_MESSAGE_READ_MODEL_APPROVAL_PREFLIGHT.md",
  "DZN Comms message/read model approval preflight",
];

const MASTER_SPEC_SNIPPETS = [
  "DZN Comms Message/Read Model Approval Preflight",
  "Read-only route limited to `GET /api/dzn-comms/channels/:channelId/messages`.",
  "Public channels limited to `global`, `new-players`, `server-owners`, and `events`.",
  "Private group reads require trusted DZN user ID bridge membership.",
  "Hidden, deleted, quarantined, expired, staff-only, and unavailable messages do not expose bodies to normal readers.",
  "Message reads cannot affect billing, owner entitlement, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, CTF scoring, Server Wars scoring, XP awards, calling-card awards, public profile visibility, retained exports, analytics/tracking, AI, live checkout, production systems, or competitive eligibility.",
  "35. DZN Comms message/read model approval preflight",
  "36. Issue #49 live checkout activation",
];

const PUBLIC_POLICY_SNIPPETS = [
  "The DZN Comms Message/Read Model Approval Preflight Slice may define the future safe read-only message-history contract",
  "GET /api/dzn-comms/channels/:channelId/messages",
  "public channels `global`, `new-players`, `server-owners`, and `events`",
  "private group reads must require trusted DZN user ID bridge membership",
  "Hidden, deleted, quarantined, expired, staff-only, unavailable, rejected, blocked, support, report, and moderation bodies must not be exposed",
  "All future message-read flags default disabled",
  "Message reads cannot affect billing",
];

const FORBIDDEN_RUNTIME_PATHS = [
  "functions/api/dzn-comms/messages",
  "functions/api/dzn-comms/reactions",
  "functions/api/dzn-comms/moderation",
  "functions/api/dzn-comms/reports",
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

const FORBIDDEN_PROTECTED_CHANGED_PATH = /^(?:migrations|public|\.github)[\\/]|^(?:cloudflare-env\.d\.ts|wrangler(?:\.adm-sync|\.auto-update)?\.toml|package-lock\.json)$/i;

const FORBIDDEN_MIGRATION_PATTERN = /(?:chat_messages|message_reactions|reaction_mutations|message_reports|moderation_actions|warning_timeouts|support_sessions|support_messages|ai_sources|ai_embeddings|analytics_events|websocket|vector)/i;

const FORBIDDEN_RUNTIME_PATTERNS = [
  /new\s+WebSocket/i,
  /WebSocketPair/i,
  /class\s+\w+\s+extends\s+DurableObject/i,
  /\bdzn_comms_message_reactions\b/i,
  /\bdzn_comms_reaction_mutations\b/i,
  /\bNEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED\b/i,
  /\bnavigator\.sendBeacon\b/i,
  /\bgtag\b/i,
  /\bposthog\b/i,
  /\btrackEvent\b/i,
  /\bvectorize\b/i,
  /\bcreateEmbedding\b/i,
  /\bopenai\.responses\b/i,
  /\bchat\.completions\b/i,
  /\bcheckout\.sessions\.create\b/i,
  /\bDZN_LIVE_CHECKOUT_ENABLED\s*=\s*true\b/i,
  /\bDZN_STORE_LIVE_CHECKOUT_ENABLED\s*=\s*true\b/i,
];

const FORBIDDEN_DOC_MUTATION_COMMANDS = [
  "wrangler d1 migrations apply",
  "wrangler pages secret",
  "wrangler secret",
  "stripe products",
  "stripe prices",
  "stripe listen",
  "git merge",
];

main();

function main() {
  assertFilesExist();
  assertMessageReadDoc();
  assertMessageReadHandoff();
  assertCrossDocs();
  assertPackageScript();
  assertNoRuntimeMessageFiles();
  assertApprovedMessageReadRuntimeFiles();
  assertNoMessageMigrations();
  assertNoChangedRuntimeFiles();
  assertNoProtectedProductionFilesChanged();
  assertNoMutationCommandsInDocs();
  console.log("DZN Comms message/read model approval preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    MESSAGE_READ_DOC,
    MESSAGE_READ_HANDOFF,
    MESSAGE_READ_IMPLEMENTATION_DOC,
    MESSAGE_READ_IMPLEMENTATION_HANDOFF,
    REACTION_RUNTIME_DOC,
    REACTION_RUNTIME_HANDOFF,
    REACTION_CONTRACT_DOC,
    REACTION_CONTRACT_HANDOFF,
    INTERACTION_DOC,
    INTERACTION_HANDOFF,
    COMMS_RUNTIME_PREFLIGHT,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertMessageReadDoc() {
  const doc = read(MESSAGE_READ_DOC);
  for (const snippet of MESSAGE_READ_DOC_SNIPPETS) {
    assertIncludes(doc, snippet, `Message/read approval doc must include: ${snippet}`);
  }
  assert.doesNotMatch(doc, /paid.*message.*visibility/i, "Paid plans must not alter message visibility.");
  assert.doesNotMatch(doc, /client-submitted.*entitlement.*allowed/i, "Client-submitted entitlement must not be accepted.");
}

function assertMessageReadHandoff() {
  const handoff = read(MESSAGE_READ_HANDOFF);
  for (const snippet of HANDOFF_SNIPPETS) {
    assertIncludes(handoff, snippet, `Message/read handoff must include: ${snippet}`);
  }
}

function assertCrossDocs() {
  for (const path of [
    REACTION_RUNTIME_DOC,
    REACTION_RUNTIME_HANDOFF,
    REACTION_CONTRACT_DOC,
    REACTION_CONTRACT_HANDOFF,
    INTERACTION_DOC,
    INTERACTION_HANDOFF,
    COMMS_RUNTIME_PREFLIGHT,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
  ]) {
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
    packageJson.scripts?.["test:dzn-comms-message-read-model-approval-preflight"],
    "tsx scripts/test-dzn-comms-message-read-model-approval-preflight.ts",
    "Focused DZN Comms message/read approval preflight test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-comms-message-read-model-approval-preflight"),
    true,
    "Full npm test should include the DZN Comms message/read model approval preflight guard.",
  );
}

function assertNoRuntimeMessageFiles() {
  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in the message/read approval preflight.`);
  }
}

function assertApprovedMessageReadRuntimeFiles() {
  const channelRuntimeFiles = listFiles("functions/api/dzn-comms/channels").map((path) => path.replace(/\\/g, "/"));
  assert.deepEqual(
    channelRuntimeFiles,
    [APPROVED_MESSAGE_READ_ROUTE],
    "Only the approved read-only channel message route may exist under functions/api/dzn-comms/channels.",
  );
  assert.equal(existsSync(APPROVED_MESSAGE_READ_HELPER), true, "Approved message/read helper should exist after the implementation foundation.");
}

function assertNoMessageMigrations() {
  const migrationFiles = listFiles("migrations").map((path) => path.replace(/\\/g, "/"));
  const forbiddenMigrations = migrationFiles
    .filter((path) => path !== APPROVED_MESSAGE_READ_MIGRATION)
    .filter((path) => FORBIDDEN_MIGRATION_PATTERN.test(path));
  assert.deepEqual(forbiddenMigrations, [], "Message/read approval preflight must not add chat/message/support/provider migrations.");
}

function assertNoChangedRuntimeFiles() {
  const changedRuntimeFiles = listChangedFiles().filter(
    (path) =>
      /^(?:app|components|functions|lib)[\\/]/.test(path) &&
      /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path),
  );

  const allowedRuntimeFiles = new Set([APPROVED_MESSAGE_READ_ROUTE, APPROVED_MESSAGE_READ_HELPER]);
  const unexpectedRuntimeFiles = changedRuntimeFiles.filter((path) => !allowedRuntimeFiles.has(path.replace(/\\/g, "/")));

  assert.deepEqual(unexpectedRuntimeFiles, [], "Only the approved message/read route and helper may change runtime files.");

  for (const path of unexpectedRuntimeFiles) {
    const source = read(path);
    for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path} must not contain runtime/chat/payment/tracking pattern ${pattern}.`);
    }
  }
}

function assertNoProtectedProductionFilesChanged() {
  const protectedChanges = listChangedFiles()
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path !== APPROVED_MESSAGE_READ_MIGRATION)
    .filter((path) => FORBIDDEN_PROTECTED_CHANGED_PATH.test(path));
  assert.deepEqual(protectedChanges, [], "Message/read implementation must not change production config, workflows, package-lock, or public assets.");
}

function assertNoMutationCommandsInDocs() {
  for (const path of [MESSAGE_READ_DOC, MESSAGE_READ_HANDOFF]) {
    const source = read(path);
    for (const command of FORBIDDEN_DOC_MUTATION_COMMANDS) {
      assert.equal(source.includes(command), false, `${path} must not include production mutation command ${command}.`);
    }
  }
}

function listChangedFiles(): string[] {
  const output = execSync("git status --short --untracked-files=all", { encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((path) => path.split(" -> ").at(-1) ?? path);
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (!stat.isDirectory()) return [root];
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function assertIncludes(source: string, snippet: string, message: string) {
  assert.equal(source.includes(snippet), true, message);
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}
