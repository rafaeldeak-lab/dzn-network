import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RUNTIME_APPROVAL_DOC = "docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md";
const RUNTIME_APPROVAL_HANDOFF = "docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT_HANDOFF.md";
const APPROVED_MESSAGE_READ_ROUTE = "functions/api/dzn-comms/channels/[channelId]/messages.ts";
const APPROVED_MESSAGE_READ_HELPER = "functions/_lib/dzn-comms-message-read.ts";
const APPROVED_MESSAGE_READ_MIGRATION = "migrations/0074_dzn_comms_message_read_model.sql";
const REACTION_CONTRACT_DOC = "docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md";
const REACTION_CONTRACT_HANDOFF = "docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT_HANDOFF.md";
const INTERACTION_DOC = "docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT.md";
const INTERACTION_HANDOFF = "docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT_HANDOFF.md";
const COMMS_RUNTIME_PREFLIGHT = "docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md";
const COMMS_RUNTIME_HANDOFF = "docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT_HANDOFF.md";
const PRESENCE_HANDOFF = "docs/DZN_COMMS_LIVE_PRESENCE_COUNTER_FOUNDATION_HANDOFF.md";
const PLAYER_NAV_HANDOFF = "docs/DZN_PLAYER_NAV_ACCESS_POLISH_HANDOFF.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const PACKAGE_JSON = "package.json";

const RUNTIME_DOC_SNIPPETS = [
  "DZN Comms Reaction Runtime Implementation Approval Preflight",
  "This slice is reaction-runtime approval preflight only.",
  "No runtime reaction APIs are added.",
  "No runtime chat send APIs are added.",
  "No message tables are added.",
  "No reaction tables are added.",
  "No migrations are added.",
  "No Durable Objects/WebSockets are added.",
  "No persistence is added.",
  "No analytics/tracking is added.",
  "No AI provider credentials, vector stores, or metered model calls are added.",
  "Approved First Runtime Shape",
  "disabled-by-default, local/test-only player reaction read/write implementation",
  "must not create the general chat-send runtime",
  "must not create the first DZN Comms message table",
  "must not add owner/admin moderation mutation routes",
  "If an approved DZN Comms message/read runtime does not exist yet",
  "Exact Future Runtime Route Set",
  "GET /api/dzn-comms/messages/:messageId/reactions",
  "POST /api/dzn-comms/messages/:messageId/reactions",
  "DELETE /api/dzn-comms/messages/:messageId/reactions/:reactionKey",
  "GET /api/dzn-comms/channels/:channelId/messages",
  "Blocked route families",
  "POST /api/dzn-comms/messages",
  "POST /api/dzn-comms/moderation/*",
  "Request And Response Contract",
  "currentUserReacted",
  "`added`",
  "`already_present`",
  "`invalid_reaction`",
  "`rate_limited`",
  "`unauthenticated`",
  "`forbidden`",
  "`message_unavailable`",
  "`disabled`",
  "`removed`",
  "`already_absent`",
  "Message Read Prerequisites",
  "trusted DZN user ID bridge membership",
  "Storage And Migration Model",
  "No migration is added by this preflight.",
  "dzn_comms_message_reactions",
  "dzn_comms_reaction_mutations",
  "Unique row per `message_id`, `actor_user_id`, and `reaction_key`.",
  "Feature-Flag Defaults",
  "DZN_COMMS_REACTIONS_READ_ENABLED=false",
  "DZN_COMMS_REACTIONS_WRITE_ENABLED=false",
  "DZN_COMMS_REACTIONS_LOCAL_TEST_RUNTIME=false",
  "DZN_COMMS_REACTIONS_MODERATION_ENABLED=false",
  "NEXT_PUBLIC_DZN_COMMS_REACTIONS_UI_ENABLED=false",
  "Idempotency And Concurrency",
  "Repeated add with the same `clientMutationId` returns the original result.",
  "Concurrent same-user adds for the same message/key produce exactly one active reaction.",
  "Rate Limits",
  "Maximum 20 reaction mutation attempts per actor per minute.",
  "Maximum 6 reaction toggles per actor/message per minute.",
  "Maximum 100 reaction mutation attempts per actor per hour.",
  "Moderation Scope",
  "must inherit message moderation state",
  "must not implement standalone owner/admin reaction moderation mutation routes",
  "Retention Model",
  "Idempotency mutation rows expire after 24 hours",
  "No owner/admin export of reaction rows is approved.",
  "Rollout Plan",
  "Rollout Plan",
  "Rollback Plan",
  "Proof Matrix",
  "Reaction runtime cannot affect billing",
  "Reaction runtime does not create chat send APIs",
  "Live-Site Boundary",
  "does not deploy to `https://dayz-network.com/`",
  "DZN Comms message/read model approval preflight",
  "DZN Comms reaction runtime local/test implementation",
];

const HANDOFF_SNIPPETS = [
  "DZN Comms Reaction Runtime Implementation Approval Preflight Handoff",
  "documentation/test-only reaction runtime approval preflight slice",
  "No runtime reaction behavior.",
  "Runtime reaction APIs.",
  "Message tables.",
  "Reaction tables.",
  "Database migrations.",
  "Deployment to `https://dayz-network.com/`.",
  "Future reaction reads",
  "Future reaction writes",
  "Future reaction moderation",
  "Production-Mutation Confirmation",
  "Live checkout remains disabled. Issue `#49` remains reserved for final live payment activation.",
  "`npm run test:dzn-comms-reaction-runtime-approval-preflight`",
  "Changed-file scope check for no runtime files.",
  "The DZN Comms message/read model approval preflight is now captured in `docs/DZN_COMMS_MESSAGE_READ_MODEL_APPROVAL_PREFLIGHT.md`.",
  "Next should be DZN Comms message/read model local/test implementation foundation",
];

const RELATED_DOC_SNIPPETS = [
  "docs/DZN_COMMS_REACTION_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md",
];

const STORAGE_MODEL_DOC_SNIPPETS = [
  "dzn_comms_message_reactions",
  "dzn_comms_reaction_mutations",
];

const MESSAGE_READ_BOUNDARY_DOCS = [
  RUNTIME_APPROVAL_DOC,
  RUNTIME_APPROVAL_HANDOFF,
  REACTION_CONTRACT_DOC,
  REACTION_CONTRACT_HANDOFF,
  INTERACTION_HANDOFF,
  PLAYER_NAV_HANDOFF,
  MASTER_SPEC,
  PUBLIC_ACCESS_POLICY,
];

const MASTER_SPEC_SNIPPETS = [
  "DZN Comms Reaction Runtime Implementation Approval Preflight",
  "Approved future runtime shape",
  "Exact first route set",
  "Storage model limited to `dzn_comms_message_reactions` and short-lived `dzn_comms_reaction_mutations`.",
  "Feature flags default disabled",
  "Moderation inheritance from message visibility",
  "Reaction runtime cannot proceed unless a separately approved DZN Comms message/read model exists.",
  "34. DZN Comms reaction runtime implementation approval preflight",
  "35. DZN Comms message/read model approval preflight",
  "36. Issue #49 live checkout activation",
];

const PUBLIC_POLICY_SNIPPETS = [
  "The DZN Comms Reaction Runtime Implementation Approval Preflight Slice may choose the future local/test-only reaction route set",
  "approved future route set is limited to reading reaction aggregates",
  "must not implement those routes",
  "The future first runtime slice must not proceed unless a separately approved DZN Comms message/read model exists.",
  "Future reaction storage is limited to `dzn_comms_message_reactions` and short-lived `dzn_comms_reaction_mutations`",
  "Starter and Pro must not grant reaction weight",
  "Reaction runtime cannot affect billing",
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

const FORBIDDEN_MIGRATION_PATTERN = /(?:chat_messages|message_reactions|reaction|support-chat|dzn-assist|support-bot|websocket|vector)/i;

const FORBIDDEN_RUNTIME_PATTERNS = [
  /new\s+WebSocket/i,
  /WebSocketPair/i,
  /class\s+\w+\s+extends\s+DurableObject/i,
  /\bchat_messages\b/i,
  /\bchat_message_reactions\b/i,
  /\bdzn_comms_message_reactions\b/i,
  /\bdzn_comms_reaction_mutations\b/i,
  /\breaction_ledger\b/i,
  /\bDZN_COMMS_REACTIONS_(?:READ|WRITE|MODERATION|LOCAL_TEST_RUNTIME)_ENABLED\b/i,
  /\bNEXT_PUBLIC_DZN_COMMS_REACTIONS_UI_ENABLED\b/i,
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
  assertRuntimeApprovalDoc();
  assertRuntimeApprovalHandoff();
  assertCrossDocs();
  assertPackageScript();
  assertNoRuntimeReactionFiles();
  assertNoReactionMigrations();
  assertNoChangedRuntimeFiles();
  assertNoProtectedProductionFilesChanged();
  assertNoMutationCommandsInDocs();
  console.log("DZN Comms reaction runtime approval preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    RUNTIME_APPROVAL_DOC,
    RUNTIME_APPROVAL_HANDOFF,
    REACTION_CONTRACT_DOC,
    REACTION_CONTRACT_HANDOFF,
    INTERACTION_DOC,
    INTERACTION_HANDOFF,
    COMMS_RUNTIME_PREFLIGHT,
    COMMS_RUNTIME_HANDOFF,
    PRESENCE_HANDOFF,
    PLAYER_NAV_HANDOFF,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertRuntimeApprovalDoc() {
  const doc = read(RUNTIME_APPROVAL_DOC);
  for (const snippet of RUNTIME_DOC_SNIPPETS) {
    assertIncludes(doc, snippet, `Runtime approval doc must include: ${snippet}`);
  }
  assert.doesNotMatch(doc, /paid.*reaction.*weight/i, "Paid plans must not add reaction weight.");
  assert.doesNotMatch(doc, /\bclient\s+may\s+set\s+count\b/i, "Client must not set reaction counts.");
}

function assertRuntimeApprovalHandoff() {
  const handoff = read(RUNTIME_APPROVAL_HANDOFF);
  for (const snippet of HANDOFF_SNIPPETS) {
    assertIncludes(handoff, snippet, `Runtime approval handoff must include: ${snippet}`);
  }
}

function assertCrossDocs() {
  for (const path of [
    REACTION_CONTRACT_DOC,
    REACTION_CONTRACT_HANDOFF,
    INTERACTION_DOC,
    INTERACTION_HANDOFF,
    COMMS_RUNTIME_PREFLIGHT,
    COMMS_RUNTIME_HANDOFF,
    PRESENCE_HANDOFF,
    PLAYER_NAV_HANDOFF,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
  ]) {
    const source = read(path);
    for (const snippet of RELATED_DOC_SNIPPETS) {
      assertIncludes(source, snippet, `${path} must include: ${snippet}`);
    }
    assert.match(
      source,
      /DZN Comms reaction runtime implementation approval preflight/i,
      `${path} must name the reaction runtime approval preflight.`,
    );
    assert.match(source, /issue\s+`?#49`?/i, `${path} must keep the issue #49 live-checkout boundary.`);
  }

  for (const path of [RUNTIME_APPROVAL_DOC, RUNTIME_APPROVAL_HANDOFF, MASTER_SPEC, PUBLIC_ACCESS_POLICY]) {
    const source = read(path);
    for (const snippet of STORAGE_MODEL_DOC_SNIPPETS) {
      assertIncludes(source, snippet, `${path} must include approved storage model snippet: ${snippet}`);
    }
  }

  for (const path of MESSAGE_READ_BOUNDARY_DOCS) {
    const source = read(path);
    assert.match(source, /message[-/]read/i, `${path} must identify the message/read prerequisite.`);
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
    packageJson.scripts?.["test:dzn-comms-reaction-runtime-approval-preflight"],
    "tsx scripts/test-dzn-comms-reaction-runtime-approval-preflight.ts",
    "Focused DZN Comms reaction runtime approval preflight test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-comms-reaction-runtime-approval-preflight"),
    true,
    "Full npm test should include the DZN Comms reaction runtime approval preflight guard.",
  );
}

function assertNoRuntimeReactionFiles() {
  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in the runtime approval preflight.`);
  }
}

function assertNoReactionMigrations() {
  const migrationFiles = listFiles("migrations").map((path) => path.replace(/\\/g, "/"));
  const forbiddenMigrations = migrationFiles.filter((path) => FORBIDDEN_MIGRATION_PATTERN.test(path));
  assert.deepEqual(forbiddenMigrations, [], "Runtime approval preflight must not add chat/reaction/support/provider migrations.");
}

function assertNoChangedRuntimeFiles() {
  const changedRuntimeFiles = listChangedFiles().filter(
    (path) =>
      /^(?:app|components|functions|lib)[\\/]/.test(path) &&
      /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path),
  );

  const approvedPrerequisiteFiles = new Set([APPROVED_MESSAGE_READ_ROUTE, APPROVED_MESSAGE_READ_HELPER]);
  const unexpectedRuntimeFiles = changedRuntimeFiles.filter((path) => !approvedPrerequisiteFiles.has(path.replace(/\\/g, "/")));

  assert.deepEqual(unexpectedRuntimeFiles, [], "Reaction runtime preflight may only see the approved message/read prerequisite runtime files.");

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
  assert.deepEqual(protectedChanges, [], "Runtime approval preflight must not change production config, migrations, workflows, package-lock, or public assets.");
}

function assertNoMutationCommandsInDocs() {
  for (const path of [RUNTIME_APPROVAL_DOC, RUNTIME_APPROVAL_HANDOFF]) {
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
