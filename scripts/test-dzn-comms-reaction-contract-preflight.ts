import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REACTION_DOC = "docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md";
const REACTION_HANDOFF = "docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT_HANDOFF.md";
const INTERACTION_DOC = "docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT.md";
const INTERACTION_HANDOFF = "docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT_HANDOFF.md";
const RUNTIME_PREFLIGHT = "docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md";
const RUNTIME_HANDOFF = "docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT_HANDOFF.md";
const PRESENCE_HANDOFF = "docs/DZN_COMMS_LIVE_PRESENCE_COUNTER_FOUNDATION_HANDOFF.md";
const PLAYER_NAV_HANDOFF = "docs/DZN_PLAYER_NAV_ACCESS_POLISH_HANDOFF.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const VISUAL_SHELL = "components/community/dzn-comms-visual-shell.tsx";
const PACKAGE_JSON = "package.json";

const REACTION_DOC_SNIPPETS = [
  "DZN Comms Reaction Interaction Contract Preflight",
  "This slice is reaction-contract preflight only.",
  "No runtime reaction APIs are added.",
  "No chat send APIs are added.",
  "No message tables are added.",
  "No reaction tables are added.",
  "No chat/support/moderation database migrations are added.",
  "No Durable Objects/WebSockets are added.",
  "No persistence is added.",
  "No analytics/tracking is added.",
  "No AI provider credentials, vector stores, or metered model calls are added.",
  "The existing `/community` page may continue showing static local mock reaction chips as actual emoji plus count.",
  "Reactions are player/community expression, not a scoring system.",
  "Starter and Pro must not grant extra reaction weight",
  "Allowed Emoji Set",
  "Runtime reactions must use a server-controlled allow-list.",
  "`rocket`",
  "`wave`",
  "`heart`",
  "`trophy`",
  "`fire`",
  "`target`",
  "`thumbs_up`",
  "`shield`",
  "`eyes`",
  "`check`",
  "Custom Discord emoji.",
  "Paid/supporter-only reaction types.",
  "Future API Contract",
  "GET /api/dzn-comms/messages/:messageId/reactions",
  "POST /api/dzn-comms/messages/:messageId/reactions",
  "DELETE /api/dzn-comms/messages/:messageId/reactions/:reactionKey",
  "clientMutationId",
  "reactionKey",
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
  "Message History Embedding",
  "Idempotency And Count Integrity",
  "one active row per actor, message, and reaction key",
  "Concurrent same-user adds produce exactly one active reaction.",
  "Current-User State And Privacy",
  "They must not list who reacted.",
  "Access Rules",
  "Free Discord player",
  "trusted DZN user ID bridge membership",
  "Rate Limits And Abuse Handling",
  "clientMutationId flooding",
  "Moderation Contract",
  "Cross-owner denial must be tested",
  "Retention And Logging",
  "No reaction analytics may be emitted.",
  "Rollback Controls",
  "DZN_COMMS_REACTIONS_READ_ENABLED",
  "DZN_COMMS_REACTIONS_WRITE_ENABLED",
  "DZN_COMMS_REACTIONS_MODERATION_ENABLED",
  "NEXT_PUBLIC_DZN_COMMS_REACTIONS_UI_ENABLED",
  "Required Proof Before Runtime Reactions",
  "Reaction state must not affect billing",
  "Live-Site Boundary",
  "does not push behavior to `https://dayz-network.com/` by itself",
  "Next should be DZN Comms reaction runtime implementation approval preflight",
];

const CROSS_DOC_SNIPPETS = [
  "docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md",
  "runtime reaction",
  "message table",
  "reaction table",
  "issue #49",
];

const MASTER_SPEC_SNIPPETS = [
  "DZN Comms Reaction Interaction Contract Preflight",
  "DZN Comms reaction interaction contract preflight",
  "allowed emoji",
  "add/remove/list/read",
  "per-user idempotency",
  "aggregate counts",
  "current-user reaction state",
  "rate limits",
  "moderation scope",
  "retention/logging",
  "rollback",
  "runtime reaction",
  "message table",
  "reaction table",
  "Durable Object",
  "WebSocket",
  "analytics/tracking",
  "AI provider",
  "vector store",
  "metered model call",
  "34. Issue #49 live checkout activation",
];

const INTERACTION_DOC_SNIPPETS = [
  "The dedicated reaction contract is now captured in `docs/DZN_COMMS_REACTION_INTERACTION_CONTRACT_PREFLIGHT.md`.",
  "The add/remove/list/read API shape for message reactions.",
  "A server-controlled emoji allow-list.",
  "Per-user idempotency so one account cannot inflate a reaction count through repeat requests.",
  "Current-user reaction state without exposing raw user IDs, Discord IDs, or private profile identifiers.",
  "Public-safe aggregate counts only.",
  "No runtime reaction route, message table, reaction table, Durable Object, WebSocket, persistence, analytics/tracking call, AI provider credential, vector store, metered model call, or production mutation",
];

const RELATED_HANDOFF_SNIPPETS = [
  "DZN Comms reaction interaction contract preflight",
  "runtime reaction",
  "reaction table",
  "issue #49",
];

const POLICY_SNIPPETS = [
  "The DZN Comms Reaction Interaction Contract Preflight Slice may define future emoji reaction contracts",
  "server-controlled allow-list",
  "read/add/remove/message-history response shapes",
  "`clientMutationId` idempotency",
  "one active reaction per actor/message/reaction key",
  "public-safe aggregate counts",
  "private current-user reaction state",
  "Visitors may see only static mock reaction presentation",
  "Future free logged-in players may add/remove their own allowed reactions only after a later runtime approval",
  "Starter and Pro must not grant reaction priority",
  "Reactions must not expose raw DZN user IDs",
  "Reaction state must not affect billing",
];

const HANDOFF_SNIPPETS = [
  "DZN Comms Reaction Interaction Contract Preflight Handoff",
  "documentation/test-only reaction preflight slice",
  "No runtime reaction behavior.",
  "Runtime reaction APIs.",
  "Message tables.",
  "Reaction tables.",
  "Deployment to `https://dayz-network.com/`.",
  "Future public-channel reactions",
  "Future private-group reactions",
  "Future reaction moderation",
  "Production-Mutation Confirmation",
  "Live checkout remains disabled. Issue `#49` remains reserved for final live payment activation.",
  "`npm run test:dzn-comms-reaction-contract-preflight`",
  "Only report the feature as live after the normal repository merge/deployment process runs",
  "Next should be DZN Comms reaction runtime implementation approval preflight",
];

const FORBIDDEN_RUNTIME_PATHS = [
  "functions/api/dzn-comms/messages",
  "functions/api/dzn-comms/reactions",
  "functions/api/dzn-comms/channels",
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

const FORBIDDEN_MIGRATION_PATTERN = /(?:chat_messages|message_reactions|reaction|support-chat|dzn-assist|support-bot|websocket|vector)/i;

const FORBIDDEN_RUNTIME_PATTERNS = [
  /new\s+WebSocket/i,
  /WebSocketPair/i,
  /class\s+\w+\s+extends\s+DurableObject/i,
  /\bchat_messages\b/i,
  /\bchat_message_reactions\b/i,
  /\bdzn_comms_message_reactions\b/i,
  /\breaction_ledger\b/i,
  /\bDZN_COMMS_REACTIONS_(?:READ|WRITE|MODERATION)_ENABLED\b/i,
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
  assertReactionDocContract();
  assertIntegratedDocs();
  assertStaticVisualReactionsRemainPreviewOnly();
  assertNoRuntimeReactionFiles();
  assertNoReactionMigrations();
  assertNoRuntimePatterns();
  assertNoMutationCommandsInDocs();
  assertPackageScript();
  console.log("DZN Comms reaction interaction contract preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    REACTION_DOC,
    REACTION_HANDOFF,
    INTERACTION_DOC,
    INTERACTION_HANDOFF,
    RUNTIME_PREFLIGHT,
    RUNTIME_HANDOFF,
    PRESENCE_HANDOFF,
    PLAYER_NAV_HANDOFF,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    VISUAL_SHELL,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertReactionDocContract() {
  const doc = read(REACTION_DOC);
  for (const snippet of REACTION_DOC_SNIPPETS) {
    assertIncludes(doc, snippet, `Reaction contract doc must include: ${snippet}`);
  }
  assert.doesNotMatch(doc, /\bcount\s*:\s*client/i, "Reaction counts must not be client-controlled.");
  assert.doesNotMatch(doc, /paid.*reaction.*weight/i, "Paid plans must not add reaction weight.");
}

function assertIntegratedDocs() {
  for (const path of [
    INTERACTION_DOC,
    INTERACTION_HANDOFF,
    RUNTIME_PREFLIGHT,
    RUNTIME_HANDOFF,
    PRESENCE_HANDOFF,
    PLAYER_NAV_HANDOFF,
    MASTER_SPEC,
  ]) {
    const source = read(path);
    for (const snippet of CROSS_DOC_SNIPPETS) {
      assertIncludes(source, snippet, `${path} must include: ${snippet}`);
    }
  }

  const interaction = read(INTERACTION_DOC);
  for (const snippet of INTERACTION_DOC_SNIPPETS) {
    assertIncludes(interaction, snippet, `Interaction doc must include: ${snippet}`);
  }

  const masterSpec = read(MASTER_SPEC);
  for (const snippet of MASTER_SPEC_SNIPPETS) {
    assertIncludes(masterSpec, snippet, `Master spec must include: ${snippet}`);
  }

  for (const path of [INTERACTION_HANDOFF, RUNTIME_PREFLIGHT, RUNTIME_HANDOFF, PRESENCE_HANDOFF, PLAYER_NAV_HANDOFF]) {
    const source = read(path);
    for (const snippet of RELATED_HANDOFF_SNIPPETS) {
      assertIncludes(source, snippet, `${path} must include: ${snippet}`);
    }
  }

  const policy = read(PUBLIC_ACCESS_POLICY);
  for (const snippet of POLICY_SNIPPETS) {
    assertIncludes(policy, snippet, `Public policy must include: ${snippet}`);
  }

  const handoff = read(REACTION_HANDOFF);
  for (const snippet of HANDOFF_SNIPPETS) {
    assertIncludes(handoff, snippet, `Reaction handoff must include: ${snippet}`);
  }
}

function assertStaticVisualReactionsRemainPreviewOnly() {
  const shell = read(VISUAL_SHELL);
  assertIncludes(shell, "data-dzn-comms-reactions=\"emoji-static-preview\"", "Visual shell should keep static reaction preview marker.");
  assertIncludes(shell, "data-dzn-comms-reaction=\"emoji-static-preview\"", "Reaction chips should remain static preview elements.");
  assertIncludes(shell, "emoji: \"\\u{1F680}\"", "Visual shell should render actual emoji data for rocket.");
  assertIncludes(shell, "emoji: \"\\u{1F49C}\"", "Visual shell should render actual emoji data for heart.");
  assertIncludes(shell, "aria-label={`${reaction.label} reaction, ${reaction.count}`}", "Static reaction chips should keep accessible labels.");
  assert.equal(shell.includes("{reaction.label} {reaction.count}"), false, "Reaction chips should not render text labels plus counts.");
  for (const pattern of [
    /fetch\s*\(/i,
    /XMLHttpRequest/i,
    /EventSource/i,
    /BroadcastChannel/i,
    /localStorage/i,
    /sessionStorage/i,
    /navigator\.sendBeacon/i,
    /\/api\/dzn-comms\/messages/i,
    /\/api\/dzn-comms\/reactions/i,
    /\bDZN_COMMS_REACTIONS/i,
  ]) {
    assert.doesNotMatch(shell, pattern, `Static visual shell must not add runtime reaction behavior ${pattern}.`);
  }
}

function assertNoRuntimeReactionFiles() {
  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in the reaction contract preflight.`);
  }
}

function assertNoReactionMigrations() {
  const migrationFiles = listFiles("migrations").map((path) => path.replace(/\\/g, "/"));
  const forbiddenMigrations = migrationFiles.filter((path) => FORBIDDEN_MIGRATION_PATTERN.test(path));
  assert.deepEqual(forbiddenMigrations, [], "Reaction preflight must not add chat/reaction/support/provider migrations.");
}

function assertNoRuntimePatterns() {
  const runtimeFiles = listChangedFiles().filter(
    (path) =>
      /^(?:app|components|functions|lib)[\\/]/.test(path) &&
      /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path),
  );

  for (const path of runtimeFiles) {
    const source = read(path);
    for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path} must not contain reaction/chat/payment/tracking runtime pattern ${pattern}.`);
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

function assertNoMutationCommandsInDocs() {
  for (const path of [REACTION_DOC, REACTION_HANDOFF]) {
    const source = read(path);
    for (const command of FORBIDDEN_DOC_MUTATION_COMMANDS) {
      assert.equal(source.includes(command), false, `${path} must not include production mutation command ${command}.`);
    }
  }
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-comms-reaction-contract-preflight"],
    "tsx scripts/test-dzn-comms-reaction-contract-preflight.ts",
    "Focused DZN Comms reaction preflight test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-comms-reaction-contract-preflight"),
    true,
    "Full npm test should include the DZN Comms reaction preflight guard.",
  );
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
