import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CONTRACT_DOC = "docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT.md";
const CONTRACT_HANDOFF = "docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT_HANDOFF.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const ARCHITECTURE_PREFLIGHT = "docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT.md";
const ARCHITECTURE_HANDOFF = "docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT_HANDOFF.md";
const VISUAL_HANDOFF = "docs/DZN_COMMS_VISUAL_SHELL_HANDOFF.md";
const VISUAL_ROUTE = "app/community/page.tsx";
const VISUAL_SHELL = "components/community/dzn-comms-visual-shell.tsx";
const SUPPORT_LAUNCHER = "components/community/dzn-support-launcher.tsx";
const PACKAGE_JSON = "package.json";

const CONTRACT_DOC_SNIPPETS = [
  "DZN Comms Interaction Contract And Moderation Preflight",
  "This slice is contract-preflight only.",
  "No runtime chat APIs are added.",
  "No message tables are added.",
  "No chat message database migrations are added.",
  "No Durable Objects/WebSockets are added.",
  "No moderation tables are added.",
  "No bot prompts are added.",
  "No vector stores are added.",
  "No AI provider credentials are added.",
  "No metered model calls are added.",
  "No analytics/tracking is added.",
  "No production mutations are added.",
  "The existing `/community` page remains a static visual prototype",
  "Future Surface Contracts",
  "Free logged-in players can participate in allowed DZN Comms player/community chat without Starter or Pro.",
  "Send Attempt Contract",
  "clientMutationId",
  "Persist only accepted messages.",
  "Fan out only accepted messages to authorized readers.",
  "`accepted`",
  "`blocked`",
  "`warning`",
  "`timeout_applied`",
  "`rate_limited`",
  "`muted`",
  "`unauthenticated`",
  "`forbidden`",
  "Filtering Decision Contract",
  "Profanity filters must be configurable and testable.",
  "allow_with_notice",
  "Warning And Timeout State Contract",
  "Message blocked",
  "Friendly warning",
  "10-minute timeout",
  "Staff review",
  "Read-Only History Contract",
  "Cache-Control: no-store",
  "Vary: Cookie",
  "Report Action Contract",
  "owner entitlement plus linked-server ownership",
  "Owner/Admin Moderation Scope Contract",
  "Cross-owner denial must be tested for every moderation action.",
  "Private Group Membership Proof Contract",
  "trusted DZN user ID bridge",
  "Forbidden membership proof sources",
  "Support Source Policy",
  "Public DZN website content.",
  "Public setup-help content.",
  "Public pricing content.",
  "Public support policy.",
  "No AI provider credential, paid API key, model provider SDK, metered model call",
  "Logging And Retention Contract",
  "Rollback Controls",
  "DZN_COMMS_READ_ENABLED",
  "DZN_COMMS_WRITE_ENABLED",
  "DZN_COMMS_REALTIME_ENABLED",
  "DZN_COMMS_SUPPORT_BOT_ENABLED",
  "DZN_COMMS_MODERATION_ACTIONS_ENABLED",
  "DZN_COMMS_PRIVATE_GROUPS_ENABLED",
  "Required Proof For The First Runtime Slice",
  "No live Stripe checkout activation, issue #49 mutation, Cloudflare secret change, production D1 write, Nitrado mutation, Discord mutation, deployment, retained export change, provider credential, vector store, or metered model call is required.",
  "Next should be the DZN Comms runtime implementation approval preflight",
];

const MASTER_SPEC_SNIPPETS = [
  "`docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT.md`",
  "DZN Comms Interaction Contract And Moderation Preflight",
  "Allowed behavior:",
  "Blocked behavior:",
  "No runtime chat APIs.",
  "No message tables.",
  "No chat message database migrations.",
  "No Durable Objects/WebSockets.",
  "No AI provider credentials.",
  "No metered model calls.",
  "No stored support/chat history.",
  "Free logged-in players can participate in allowed DZN Comms player/community chat without Starter or Pro.",
  "Warnings, timeouts, mutes, reports, moderation status, private group visibility, DZN Assist support state, and future chat history must not affect billing",
  "DZN Comms runtime implementation approval preflight",
];

const PUBLIC_POLICY_SNIPPETS = [
  "The DZN Comms Interaction Contract And Moderation Preflight Slice may define future send attempt",
  "clientMutationId",
  "accepted/blocked/warning/timeout/rate-limited/muted/unauthenticated/forbidden responses",
  "Free logged-in players can participate in future allowed DZN Comms player/community chat without Starter or Pro.",
  "Private group chat must require a trusted DZN user ID bridge.",
  "Owner/community moderation must require canonical owner entitlement plus linked-server ownership",
  "DZN Assist must stay limited to public DZN website content, setup-help content, pricing content, public support policy",
  "must not implement runtime chat APIs, message tables, chat message database migrations, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, metered model calls, analytics/tracking, stored support/chat history, live checkout changes, or production service mutations",
  "must not affect billing, owner entitlements, server ownership, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, retained exports, or competitive eligibility",
];

const HANDOFF_SNIPPETS = [
  "DZN Comms Interaction Contract And Moderation Preflight Handoff",
  "This slice is documentation/test only.",
  "Send Attempt Contract",
  "Filtering Decision Contract",
  "Warning And Timeout State Contract",
  "Read-Only History Contract",
  "Report Action Contract",
  "Owner/Admin Moderation Scope Contract",
  "Private Group Membership Proof Contract",
  "Support Source Policy",
  "Logging And Retention Contract",
  "Rollback Controls",
  "`npm run test:dzn-comms-interaction-contract-preflight`",
  "Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.",
  "Next should be the DZN Comms runtime implementation approval preflight",
];

const REQUIRED_PRIOR_DOC_SNIPPETS = [
  "The DZN Comms interaction contract and moderation preflight is now the approved follow-on slice.",
  "runtime chat APIs, message tables, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, metered model calls",
  "Next after that should be the DZN Comms runtime implementation approval preflight",
];

const ALLOWED_STATIC_VISUAL_FILES = [
  VISUAL_ROUTE,
  VISUAL_SHELL,
  SUPPORT_LAUNCHER,
];

const FORBIDDEN_RUNTIME_PATHS = [
  "functions/api/chat",
  "functions/api/support-chat",
  "functions/api/dzn-assist",
  "functions/api/dzn-comms",
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
  "lib/dzn-comms.ts",
  "lib/dzn-comms",
];

const FORBIDDEN_PROVIDER_DEPENDENCIES = [
  /^openai$/i,
  /^ai$/i,
  /^@ai-sdk\//i,
  /^langchain$/i,
  /^@langchain\//i,
  /^anthropic$/i,
  /^@anthropic-ai\//i,
];

const FORBIDDEN_RUNTIME_PATTERNS = [
  /new\s+WebSocket/i,
  /WebSocketPair/i,
  /class\s+\w+\s+extends\s+DurableObject/i,
  /\bchat_messages\b/i,
  /\bchat_message_reports\b/i,
  /\bchat_moderation_actions\b/i,
  /\bchat_user_mutes\b/i,
  /\bchat_support_sessions\b/i,
  /\bchat_support_messages\b/i,
  /\bchat_support_source_documents\b/i,
  /\bDZN_COMMS_(?:READ|WRITE|REALTIME|SUPPORT_BOT|MODERATION_ACTIONS|PRIVATE_GROUPS)_ENABLED\b/i,
  /\bvectorize\b/i,
  /\bcreateEmbedding\b/i,
  /\bopenai\.responses\b/i,
  /\bchat\.completions\b/i,
];

const FORBIDDEN_VISUAL_MUTATION_PATTERNS = [
  /\bfetch\s*\(/i,
  /XMLHttpRequest/i,
  /new\s+WebSocket/i,
  /EventSource/i,
  /BroadcastChannel/i,
  /localStorage/i,
  /sessionStorage/i,
  /navigator\.sendBeacon/i,
  /createCheckoutSession/i,
  /DZN_LIVE_CHECKOUT_ENABLED/i,
  /STRIPE_SECRET_KEY/i,
  /DISCORD_BOT_TOKEN/i,
  /NITRADO/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bCREATE\s+(?:TABLE|INDEX)\b/i,
  /openai\.responses/i,
  /chat\.completions/i,
  /createEmbedding/i,
  /vectorize/i,
];

main();

function main() {
  assertFilesExist();
  assertContractDoc();
  assertIntegratedDocs();
  assertPriorHandoffsAdvanced();
  assertStaticVisualPrototypeStillStatic();
  assertNoRuntimeImplementationFiles();
  assertNoChatMigrations();
  assertNoProviderDependencies();
  assertNoRuntimePatterns();
  assertPackageScript();
  console.log("DZN Comms interaction contract preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    CONTRACT_DOC,
    CONTRACT_HANDOFF,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    ARCHITECTURE_PREFLIGHT,
    ARCHITECTURE_HANDOFF,
    VISUAL_HANDOFF,
    PACKAGE_JSON,
    ...ALLOWED_STATIC_VISUAL_FILES,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertContractDoc() {
  const contract = read(CONTRACT_DOC);
  for (const snippet of CONTRACT_DOC_SNIPPETS) {
    assert.equal(contract.includes(snippet), true, `Contract doc must include: ${snippet}`);
  }
}

function assertIntegratedDocs() {
  const masterSpec = read(MASTER_SPEC);
  for (const snippet of MASTER_SPEC_SNIPPETS) {
    assert.equal(masterSpec.includes(snippet), true, `Master spec must include: ${snippet}`);
  }

  const publicPolicy = read(PUBLIC_ACCESS_POLICY);
  for (const snippet of PUBLIC_POLICY_SNIPPETS) {
    assert.equal(publicPolicy.includes(snippet), true, `Public access policy must include: ${snippet}`);
  }

  const handoff = read(CONTRACT_HANDOFF);
  for (const snippet of HANDOFF_SNIPPETS) {
    assert.equal(handoff.includes(snippet), true, `Contract handoff must include: ${snippet}`);
  }
}

function assertPriorHandoffsAdvanced() {
  const docs = [
    read(ARCHITECTURE_PREFLIGHT),
    read(ARCHITECTURE_HANDOFF),
    read(VISUAL_HANDOFF),
  ].join("\n");

  for (const snippet of REQUIRED_PRIOR_DOC_SNIPPETS) {
    assert.equal(docs.includes(snippet), true, `Prior docs must include: ${snippet}`);
  }
}

function assertStaticVisualPrototypeStillStatic() {
  for (const path of ALLOWED_STATIC_VISUAL_FILES) {
    const source = read(path);
    for (const pattern of FORBIDDEN_VISUAL_MUTATION_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path} must stay static and must not match ${pattern}.`);
    }
  }

  const shell = read(VISUAL_SHELL);
  assert.equal(shell.includes("data-dzn-comms-prototype=\"static-local-mock-data\""), true, "Visual shell must keep its static marker.");
  assert.equal(shell.includes("Composer disabled in this static prototype - no messages are sent or stored."), true, "Visual composer must remain disabled.");

  const launcher = read(SUPPORT_LAUNCHER);
  assert.equal(launcher.includes("data-dzn-support-launcher=\"static-local-preview\""), true, "Support launcher must keep its static marker.");
  assert.equal(launcher.includes("No message is sent, no history is stored, no analytics are called, and no AI provider is connected."), true, "Support launcher must remain non-sending.");
}

function assertNoRuntimeImplementationFiles() {
  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not be introduced by the interaction contract preflight.`);
  }
}

function assertNoChatMigrations() {
  const migrationFiles = listFiles("migrations").map((path) => path.replace(/\\/g, "/"));
  const forbiddenMigrations = migrationFiles.filter((path) => /(?:chat|support-chat|dzn-assist|dzn-comms|support-bot|websocket|vector)/i.test(path));
  assert.deepEqual(forbiddenMigrations, [], "Interaction contract preflight must not add chat/support migrations.");
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
  const forbidden = dependencyNames.filter((name) => FORBIDDEN_PROVIDER_DEPENDENCIES.some((pattern) => pattern.test(name)));
  assert.deepEqual(forbidden, [], "Interaction contract preflight must not add AI provider dependencies.");
}

function assertNoRuntimePatterns() {
  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));

  for (const path of runtimeFiles) {
    const source = read(path);
    for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path} must not contain runtime chat/support implementation pattern ${pattern}.`);
    }
  }
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-comms-interaction-contract-preflight"],
    "tsx scripts/test-dzn-comms-interaction-contract-preflight.ts",
    "Focused DZN Comms interaction contract preflight test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-comms-interaction-contract-preflight"),
    true,
    "Full npm test should include the DZN Comms interaction contract preflight guard.",
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

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}
