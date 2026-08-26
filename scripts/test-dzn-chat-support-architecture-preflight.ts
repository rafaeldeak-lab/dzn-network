import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PREFLIGHT_DOC = "docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const PREVIOUS_HANDOFF = "docs/PUBLIC_PROFILE_SOCIAL_PREVIEW_VALIDATION_PACKAGE_HANDOFF.md";
const PACKAGE_JSON = "package.json";

const REQUIRED_DOC_SNIPPETS = [
  "This slice is architecture-preflight only.",
  "No runtime chat routes are added.",
  "No support bot runtime is added.",
  "No Durable Objects/WebSockets are added.",
  "No moderation tables are added.",
  "No bot prompts are added.",
  "No vector stores are added.",
  "No AI provider credentials are added.",
  "No metered model calls are added.",
  "DZN Comms",
  "Public Channels",
  "Global Chat",
  "New Players",
  "Server Owners",
  "Events",
  "Private Groups",
  "DZN Assist",
  "Website support only",
  "Safety Ladder",
  "Message blocked",
  "Friendly warning",
  "10-minute timeout",
  "Staff review",
  "Profanity filter",
  "Spam protection",
  "Link protection",
  "Invite approval",
  "Support entry points may be visible on most pages",
  "Global community chat is logged-in player only.",
  "Private group chat requires a trusted DZN membership bridge.",
  "AI support bot must answer only from public DZN website content, setup-help content, pricing content, and public support policy.",
  "No AI provider credential, paid API key, metered model call, vector store, training/eval job, automated spend path, prompt registry, or tool-calling route may be added",
  "No migration is added in this slice.",
  "Do not implement any of the following until a later approved implementation slice",
  "No live Stripe checkout activation, issue #49 mutation, Cloudflare secret change, production D1 write, Nitrado mutation, Discord mutation, deployment, or retained export change is required.",
  "Next should be a DZN Comms visual shell and support launcher prototype",
];

const REQUIRED_MASTER_SPEC_SNIPPETS = [
  "`docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT.md`",
  "DZN Chat And Support Architecture Preflight Slice",
  "site-wide support chat",
  "logged-in global community chat",
  "private group chat",
  "profanity filtering, warning, and timed-mute controls",
  "public-DZN-info-only AI support bot",
  "No runtime chat routes, support bot runtime, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, or metered model calls are implemented by this slice.",
  "Normal player chat access must remain free after Discord login.",
  "Starter and Pro plans must not give chat ranking priority, moderation immunity, scoring advantages, event advantages, XP advantages, badge advantages, or competitive eligibility advantages.",
  "DZN Comms visual shell and support launcher prototype",
];

const REQUIRED_PUBLIC_POLICY_SNIPPETS = [
  "Future DZN global/community/private chat and support chat are still blocked from real runtime implementation until the approved contracts exist.",
  "Support entry points may be visible on most pages",
  "global community chat must require Discord login",
  "private group chat must require a trusted DZN membership bridge",
  "The AI support bot must answer only from public DZN website, setup-help, pricing, and support-policy content",
  "Chat moderation must include profanity filtering, warning, timed-mute/timeout, report, and staff-review hooks.",
  "No runtime chat route, Durable Object/WebSocket, moderation table, bot prompt, vector store, AI provider credential, metered model call, analytics/tracking path, or stored chat/support history is implemented by the preflight.",
];

const REQUIRED_HANDOFF_SNIPPETS = [
  "DZN chat/support architecture preflight",
  "`docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT.md`",
  "`npm run test:dzn-chat-support-architecture-preflight`",
  "DZN Comms visual shell and support launcher prototype",
];

const FORBIDDEN_IMPLEMENTATION_PATHS = [
  "functions/api/chat",
  "functions/api/support-chat",
  "functions/api/dzn-assist",
  "functions/api/community/chat",
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

const FORBIDDEN_RUNTIME_WORDS = [
  /new\s+WebSocket/i,
  /WebSocketPair/i,
  /class\s+\w+\s+extends\s+DurableObject/i,
  /\bchat_messages\b/i,
  /\bchat_moderation_actions\b/i,
  /\bchat_user_mutes\b/i,
  /\bchat_support_sessions\b/i,
  /\bvectorize\b/i,
  /\bcreateEmbedding\b/i,
  /\bopenai\.responses\b/i,
  /\bchat\.completions\b/i,
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

function main() {
  assertDocumentationContracts();
  assertNoRuntimeImplementationFiles();
  assertNoChatMigrations();
  assertNoProviderDependencies();
  assertNoForbiddenRuntimePatterns();
  console.log("DZN chat/support architecture preflight tests passed.");
}

function assertDocumentationContracts() {
  for (const path of [PREFLIGHT_DOC, MASTER_SPEC, PUBLIC_ACCESS_POLICY, PREVIOUS_HANDOFF, PACKAGE_JSON]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const preflight = read(PREFLIGHT_DOC);
  for (const snippet of REQUIRED_DOC_SNIPPETS) {
    assert.equal(preflight.includes(snippet), true, `Preflight doc must include: ${snippet}`);
  }

  const masterSpec = read(MASTER_SPEC);
  for (const snippet of REQUIRED_MASTER_SPEC_SNIPPETS) {
    assert.equal(masterSpec.includes(snippet), true, `Master spec must include: ${snippet}`);
  }

  const publicPolicy = read(PUBLIC_ACCESS_POLICY);
  for (const snippet of REQUIRED_PUBLIC_POLICY_SNIPPETS) {
    assert.equal(publicPolicy.includes(snippet), true, `Public access policy must include: ${snippet}`);
  }

  const previousHandoff = read(PREVIOUS_HANDOFF);
  for (const snippet of REQUIRED_HANDOFF_SNIPPETS) {
    assert.equal(previousHandoff.includes(snippet), true, `Previous handoff must include: ${snippet}`);
  }

  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-chat-support-architecture-preflight"],
    "tsx scripts/test-dzn-chat-support-architecture-preflight.ts",
    "Focused preflight test must be available through package scripts.",
  );
}

function assertNoRuntimeImplementationFiles() {
  for (const path of FORBIDDEN_IMPLEMENTATION_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not be implemented by architecture preflight.`);
  }
}

function assertNoChatMigrations() {
  const migrationFiles = listFiles("migrations").map((path) => path.replace(/\\/g, "/"));
  const forbiddenMigrations = migrationFiles.filter((path) => /(?:chat|support-chat|dzn-assist|support-bot|websocket|vector)/i.test(path));
  assert.deepEqual(forbiddenMigrations, [], "Architecture preflight must not add chat/support migrations.");
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
  assert.deepEqual(forbidden, [], "Architecture preflight must not add AI provider dependencies.");
}

function assertNoForbiddenRuntimePatterns() {
  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));

  for (const path of runtimeFiles) {
    const source = read(path);
    for (const pattern of FORBIDDEN_RUNTIME_WORDS) {
      assert.equal(pattern.test(source), false, `${path} must not contain ${pattern}`);
    }
  }
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

main();
