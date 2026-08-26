import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RUNTIME_PREFLIGHT = "docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md";
const RUNTIME_HANDOFF = "docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT_HANDOFF.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const INTERACTION_PREFLIGHT = "docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT.md";
const INTERACTION_HANDOFF = "docs/DZN_COMMS_INTERACTION_CONTRACT_PREFLIGHT_HANDOFF.md";
const ARCHITECTURE_PREFLIGHT = "docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT.md";
const ARCHITECTURE_HANDOFF = "docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT_HANDOFF.md";
const VISUAL_HANDOFF = "docs/DZN_COMMS_VISUAL_SHELL_HANDOFF.md";
const VISUAL_ROUTE = "app/community/page.tsx";
const VISUAL_SHELL = "components/community/dzn-comms-visual-shell.tsx";
const SUPPORT_LAUNCHER = "components/community/dzn-support-launcher.tsx";
const PACKAGE_JSON = "package.json";

const RUNTIME_PREFLIGHT_SNIPPETS = [
  "DZN Comms Runtime Implementation Approval Preflight",
  "This slice is runtime-approval preflight only.",
  "live website presence counter contract",
  "No chat APIs are added.",
  "No support chat APIs are added.",
  "No presence APIs are added.",
  "No live visitor counter APIs are added.",
  "No message tables are added.",
  "No presence tables are added.",
  "No database migrations are added.",
  "No Durable Objects/WebSockets are added.",
  "No AI provider credentials are added.",
  "No vector stores are added.",
  "No metered model calls are added.",
  "No analytics/tracking is added.",
  "The first real runtime slice should be the DZN Comms live presence counter foundation, not message sending.",
  "public-safe \"DZN online\" counter",
  "presence indicator, not analytics",
  "Preferred transport sequence",
  "Migration Plan",
  "Feature-Flag Defaults",
  "DZN_COMMS_PRESENCE_READ_ENABLED",
  "DZN_COMMS_PRESENCE_WRITE_ENABLED",
  "DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED",
  "Retention Defaults",
  "Moderation Data Model Plan",
  "Support Bot Runtime Plan",
  "Testing Matrix",
  "Rollback Path",
  "Approval Checklist Before First Runtime PR",
  "Next should be the DZN Comms live presence counter foundation",
];

const PRESENCE_COUNTER_SNIPPETS = [
  "\"scope\": \"site|community|global_chat\"",
  "\"label\": \"DZN online\"",
  "\"precision\": \"approximate\"",
  "\"ttlSeconds\": 45",
  "Return aggregate counts only.",
  "Do not expose online member names from the public site counter.",
  "Do not use the counter as proof that a specific player is online.",
  "Duplicate tabs may be counted as page sessions unless a later privacy review approves safer deduplication.",
  "Any deduplication must avoid fingerprinting and long-lived identifiers.",
  "Anonymous visitor presence must not become a stored user profile or analytics record.",
];

const ISOLATION_SNIPPETS = [
  "billing",
  "owner entitlement",
  "server ownership",
  "rankings",
  "discovery score",
  "reviews",
  "review score",
  "badges",
  "seasons",
  "events",
  "Server Wars",
  "CTF scoring",
  "XP awards",
  "calling-card awards",
  "public profile visibility",
  "retained exports",
  "moderation decisions",
  "competitive eligibility",
];

const MASTER_SPEC_SNIPPETS = [
  "`docs/DZN_COMMS_RUNTIME_IMPLEMENTATION_APPROVAL_PREFLIGHT.md`",
  "DZN Comms Runtime Implementation Approval Preflight",
  "Approved first runtime direction:",
  "DZN Comms live presence counter foundation",
  "public-safe aggregate \"DZN online\" counter",
  "Treat the counter as presence, not analytics.",
  "No presence APIs in this preflight.",
  "No live visitor counter APIs in this preflight.",
  "No presence tables.",
  "Next should be the DZN Comms live presence counter foundation",
];

const PUBLIC_POLICY_SNIPPETS = [
  "The DZN Comms Runtime Implementation Approval Preflight Slice may choose the first runtime direction",
  "requested public live website counter",
  "public-safe aggregate \"DZN online\" presence counter",
  "preferably first on `/community` or the Global Chat shell",
  "This preflight may define future presence read/write flags",
  "must not implement chat APIs, support chat APIs, presence APIs, live visitor counter APIs",
  "The future counter must be presence, not analytics.",
  "must not store browsing history, route history, user journeys, marketing events, tracking events",
  "Next should be the DZN Comms live presence counter foundation",
];

const PRIOR_DOC_SNIPPETS = [
  "The DZN Comms runtime implementation approval preflight is now the approved follow-on slice.",
  "public live website counter",
  "public-safe aggregate presence feature",
  "DZN Comms live presence counter foundation",
];

const HANDOFF_SNIPPETS = [
  "DZN Comms Runtime Implementation Approval Preflight Handoff",
  "documentation/test only",
  "public live website counter",
  "public-safe aggregate presence",
  "no identifying output",
  "`npm run test:dzn-comms-runtime-approval-preflight`",
  "Production-Mutation Confirmation",
  "Live checkout remains disabled. Issue #49 remains reserved for final live payment activation.",
  "Next should be the DZN Comms live presence counter foundation",
];

const FORBIDDEN_RUNTIME_PATHS = [
  "functions/api/chat",
  "functions/api/support-chat",
  "functions/api/dzn-assist",
  "functions/api/dzn-comms/channels",
  "functions/api/dzn-comms/messages",
  "functions/api/dzn-comms/moderation",
  "functions/api/dzn-comms/reports",
  "functions/api/dzn-comms/support",
  "functions/api/community/chat",
  "app/api/chat",
  "app/api/support-chat",
  "app/api/dzn-assist",
  "app/api/dzn-comms",
  "app/api/presence",
  "app/api/live-counter",
  "app/api/online-users",
  "app/api/site-presence",
  "app/community/chat/page.tsx",
  "app/community/presence/page.tsx",
  "app/support-chat/page.tsx",
  "app/dzn-assist/page.tsx",
  "components/chat",
  "components/support-chat",
  "components/dzn-assist",
  "components/presence",
  "components/live-counter",
  "lib/chat.ts",
  "lib/chat",
  "lib/support-bot.ts",
  "lib/support-bot",
  "lib/dzn-assist.ts",
  "lib/dzn-assist",
  "lib/dzn-comms.ts",
  "lib/dzn-comms",
  "lib/presence.ts",
  "lib/presence",
  "lib/live-counter.ts",
  "lib/live-counter",
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
  /\bsite_presence\b/i,
  /\bvisitor_presence\b/i,
  /\blive_presence_sessions\b/i,
  /\bpresence_heartbeats\b/i,
  /\bonline_visitors\b/i,
  /\bchat_messages\b/i,
  /\bchat_message_reports\b/i,
  /\bchat_moderation_actions\b/i,
  /\bchat_user_mutes\b/i,
  /\bchat_support_sessions\b/i,
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
  /navigator\.sendBeacon/i,
  /gtag\s*\(/i,
  /analytics\.track/i,
  /posthog/i,
  /mixpanel/i,
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
  assertRuntimePreflightDoc();
  assertIntegratedDocs();
  assertPriorDocsAdvanced();
  assertStaticVisualPrototypeStillStatic();
  assertNoRuntimeImplementationFiles();
  assertNoRuntimeMigrations();
  assertNoProviderDependencies();
  assertNoRuntimePatterns();
  assertPackageScript();
  console.log("DZN Comms runtime approval preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    RUNTIME_PREFLIGHT,
    RUNTIME_HANDOFF,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    INTERACTION_PREFLIGHT,
    INTERACTION_HANDOFF,
    ARCHITECTURE_PREFLIGHT,
    ARCHITECTURE_HANDOFF,
    VISUAL_HANDOFF,
    VISUAL_ROUTE,
    VISUAL_SHELL,
    SUPPORT_LAUNCHER,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertRuntimePreflightDoc() {
  const preflight = read(RUNTIME_PREFLIGHT);
  for (const snippet of [
    ...RUNTIME_PREFLIGHT_SNIPPETS,
    ...PRESENCE_COUNTER_SNIPPETS,
    ...ISOLATION_SNIPPETS,
  ]) {
    assert.equal(preflight.includes(snippet), true, `Runtime preflight must include: ${snippet}`);
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

  const handoff = read(RUNTIME_HANDOFF);
  for (const snippet of HANDOFF_SNIPPETS) {
    assert.equal(handoff.includes(snippet), true, `Runtime approval handoff must include: ${snippet}`);
  }
}

function assertPriorDocsAdvanced() {
  const priorDocs = [
    read(INTERACTION_PREFLIGHT),
    read(INTERACTION_HANDOFF),
    read(ARCHITECTURE_PREFLIGHT),
    read(ARCHITECTURE_HANDOFF),
    read(VISUAL_HANDOFF),
  ].join("\n");

  for (const snippet of PRIOR_DOC_SNIPPETS) {
    assert.equal(priorDocs.includes(snippet), true, `Prior docs must include: ${snippet}`);
  }
}

function assertStaticVisualPrototypeStillStatic() {
  for (const path of [VISUAL_ROUTE, VISUAL_SHELL, SUPPORT_LAUNCHER]) {
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
    assert.equal(existsSync(path), false, `${path} must not be introduced by the runtime approval preflight.`);
  }
}

function assertNoRuntimeMigrations() {
  const migrationFiles = listFiles("migrations").map((path) => path.replace(/\\/g, "/"));
  const forbiddenMigrations = migrationFiles.filter((path) => /(?:chat|support-chat|dzn-assist|support-bot|websocket|vector|visitor)/i.test(path));
  assert.deepEqual(forbiddenMigrations, [], "Runtime approval preflight must still block chat/support/moderation/provider migrations after the approved presence slice.");
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
  assert.deepEqual(forbidden, [], "Runtime approval preflight must not add AI provider dependencies.");
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
      assert.doesNotMatch(source, pattern, `${path} must not contain runtime chat/presence implementation pattern ${pattern}.`);
    }
  }
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-comms-runtime-approval-preflight"],
    "tsx scripts/test-dzn-comms-runtime-approval-preflight.ts",
    "Focused DZN Comms runtime approval preflight test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-comms-runtime-approval-preflight"),
    true,
    "Full npm test should include the DZN Comms runtime approval preflight guard.",
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
