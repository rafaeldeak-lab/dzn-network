import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const COMMUNITY_ROUTE = "app/community/page.tsx";
const COMMS_SHELL = "components/community/dzn-comms-visual-shell.tsx";
const SUPPORT_LAUNCHER = "components/community/dzn-support-launcher.tsx";
const LAYOUT = "app/layout.tsx";
const SITE_HEADER = "components/site-header.tsx";
const GLOBALS = "app/globals.css";
const PACKAGE_JSON = "package.json";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const PREFLIGHT_DOC = "docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT.md";
const PREFLIGHT_HANDOFF = "docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT_HANDOFF.md";
const VISUAL_HANDOFF = "docs/DZN_COMMS_VISUAL_SHELL_HANDOFF.md";
const PREFLIGHT_TEST = "scripts/test-dzn-chat-support-architecture-preflight.ts";

const VISUAL_SNIPPETS = [
  "DznCommsVisualShell",
  "data-dzn-comms-prototype=\"static-local-mock-data\"",
  "staticCommsSurfaces",
  "Static Prototype",
  "DZN Comms",
  "Connect. Coordinate. Get support.",
  "data-dzn-comms-reactions=\"emoji-static-preview\"",
  "data-dzn-comms-reaction=\"emoji-static-preview\"",
  "emoji: \"\\u{1F680}\"",
  "emoji: \"\\u{1F44B}\"",
  "emoji: \"\\u{1F49C}\"",
  "aria-label={`${reaction.label} reaction, ${reaction.count}`}",
  "Public Channels",
  "Global Chat",
  "New Players",
  "Server Owners",
  "Events",
  "Private Groups",
  "Pandora Squad",
  "DZN Assist",
  "Website support only",
  "Channel Safety",
  "Group Safety",
  "Online Members",
  "Group Members",
  "Safety Ladder",
  "Message blocked",
  "Friendly warning",
  "10-minute timeout",
  "Staff review",
  "Profanity filter",
  "Spam protection",
  "Link protection",
  "Invite approval",
  "Composer disabled in this static prototype - no messages are sent or stored.",
  "No bot runtime or model call is connected.",
  "No AI call",
  "Open Support Surface",
];

const SUPPORT_LAUNCHER_SNIPPETS = [
  "DznSupportLauncher",
  "data-dzn-support-launcher=\"static-local-preview\"",
  "DZN Assist",
  "Website support only",
  "Static support preview",
  "No message is sent, no history is stored, no analytics are called, and no AI provider is connected.",
  "Support composer disabled in this prototype.",
  "DZN Comms",
  "hiddenLauncherPrefixes",
];

const DOC_SNIPPETS = [
  "DZN Comms Visual Shell Prototype Slice",
  "static local mock data",
  "disabled/non-sending composer",
  "No runtime chat APIs",
  "No Durable Objects/WebSockets",
  "No moderation tables",
  "No bot prompts",
  "No vector stores",
  "No AI provider credentials",
  "No metered model calls",
  "No analytics/tracking",
  "No message persistence",
  "Live checkout remains disabled",
  "Issue #49 remains reserved",
  "cannot affect billing, scoring, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars, CTF scoring, XP awards, calling-card awards, or competitive eligibility",
  "Next should be the DZN Comms interaction contract and moderation preflight",
];

const FORBIDDEN_VISUAL_RUNTIME_PATTERNS = [
  /\bfetch\s*\(/i,
  /fetchJsonWithRetry/i,
  /XMLHttpRequest/i,
  /new\s+WebSocket/i,
  /WebSocketPair/i,
  /EventSource/i,
  /BroadcastChannel/i,
  /localStorage/i,
  /sessionStorage/i,
  /navigator\.sendBeacon/i,
  /navigator\.clipboard/i,
  /navigator\.share/i,
  /createCheckoutSession/i,
  /DZN_LIVE_CHECKOUT_ENABLED/i,
  /STRIPE_SECRET_KEY/i,
  /DISCORD_BOT_TOKEN/i,
  /NITRADO/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\b/i,
  /\bALTER\b/i,
  /\bCREATE\s+(?:TABLE|INDEX)\b/i,
  /\.run\(/i,
  /openai\.responses/i,
  /chat\.completions/i,
  /createEmbedding/i,
  /vectorize/i,
];

const FORBIDDEN_BACKEND_PATHS = [
  "functions/api/chat",
  "functions/api/support-chat",
  "functions/api/dzn-assist",
  "functions/api/community/chat",
  "app/api/chat",
  "app/api/support-chat",
  "app/api/dzn-assist",
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

const FORBIDDEN_PROVIDER_DEPENDENCIES = [
  /^openai$/i,
  /^ai$/i,
  /^@ai-sdk\//i,
  /^langchain$/i,
  /^@langchain\//i,
  /^anthropic$/i,
  /^@anthropic-ai\//i,
];

main();

function main() {
  assertStaticFiles();
  assertVisualContracts();
  assertSupportLauncherContract();
  assertHeaderAndLayout();
  assertNoBackendImplementation();
  assertNoProviderDependencies();
  assertDocumentationContracts();
  assertPreflightGuardAdvancedPastNoPageBlocker();
  console.log("DZN Comms visual shell tests passed.");
}

function assertStaticFiles() {
  for (const path of [
    COMMUNITY_ROUTE,
    COMMS_SHELL,
    SUPPORT_LAUNCHER,
    LAYOUT,
    SITE_HEADER,
    GLOBALS,
    PACKAGE_JSON,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    PREFLIGHT_DOC,
    PREFLIGHT_HANDOFF,
    VISUAL_HANDOFF,
    PREFLIGHT_TEST,
    "public/media/dzn-pricing-bg-layer.png",
    "public/media/dzn-pricing-fog-ember-overlay.png",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  assert.equal(statSync("public/media/dzn-pricing-bg-layer.png").size > 1000, true, "DZN Comms background asset should exist.");
  assert.equal(statSync("public/media/dzn-pricing-fog-ember-overlay.png").size > 1000, true, "DZN Comms overlay asset should exist.");
}

function assertVisualContracts() {
  const route = read(COMMUNITY_ROUTE);
  assert.equal(route.includes("DznCommsVisualShell"), true, "Community route should render the static visual shell.");
  assertNoForbiddenRuntime(route, COMMUNITY_ROUTE);

  const shell = read(COMMS_SHELL);
  for (const snippet of VISUAL_SNIPPETS) {
    assert.equal(shell.includes(snippet), true, `Visual shell should include ${snippet}.`);
  }
  assert.equal(
    shell.includes("useState<{ key: CommsSurfaceKey; generation: number }>"),
    true,
    "Visual shell should use local state only for surface switching.",
  );
  assert.equal(shell.includes("disabled"), true, "Visual shell should include disabled controls.");
  assert.equal(shell.includes("/api/"), false, "Visual shell must not reference API routes.");
  assert.equal(shell.includes("{reaction.label} {reaction.count}"), false, "Reaction chips should render emoji plus count, not text-label plus count.");
  assertNoForbiddenRuntime(shell, COMMS_SHELL);

  const globals = read(GLOBALS);
  for (const snippet of [
    ".dzn-comms-bg-layer",
    ".dzn-comms-fog-layer",
    "@keyframes dzn-comms-bg-drift",
    "@keyframes dzn-comms-fog-drift",
    "prefers-reduced-motion: reduce",
  ]) {
    assert.equal(globals.includes(snippet), true, `Global styles should include ${snippet}.`);
  }
}

function assertSupportLauncherContract() {
  const launcher = read(SUPPORT_LAUNCHER);
  for (const snippet of SUPPORT_LAUNCHER_SNIPPETS) {
    assert.equal(launcher.includes(snippet), true, `Support launcher should include ${snippet}.`);
  }
  assert.equal(launcher.includes("/api/"), false, "Support launcher must not reference API routes.");
  assertNoForbiddenRuntime(launcher, SUPPORT_LAUNCHER);
}

function assertHeaderAndLayout() {
  const layout = read(LAYOUT);
  assert.equal(layout.includes("DznSupportLauncher"), true, "Root layout should include the static site-wide support launcher.");

  const header = read(SITE_HEADER);
  assert.equal(header.includes("type SiteHeaderActive"), true, "Header active type should exist.");
  assert.equal(header.includes('"community"'), true, "Header active type should include community.");
  assert.equal(header.includes('{ href: "/community", label: "Community", active: "community" }'), true, "Authenticated nav should include Community.");
  assert.equal(header.includes('if (pathname.startsWith("/community")) return "community";'), true, "Community route should have active header state.");

  const loggedOutHeaderBlock = sourceBlock(header, "const loggedOutHeaderLinks", "const starterHeaderLinks");
  const starterHeaderBlock = sourceBlock(header, "const starterHeaderLinks", "const proHeaderLinks");
  const proHeaderBlock = sourceBlock(header, "const proHeaderLinks", "let pageHeaderAuthState");

  assert.equal(loggedOutHeaderBlock.includes("Community"), false, "Logged-out nav should not expose community chat as a normal nav item.");
  assert.equal(starterHeaderBlock.includes("Community"), true, "Free/starter authenticated nav should include Community.");
  assert.equal(proHeaderBlock.includes("Community"), true, "Pro authenticated nav should include Community.");
}

function assertNoBackendImplementation() {
  for (const path of FORBIDDEN_BACKEND_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not be introduced by the static visual shell slice.`);
  }

  const migrationFiles = listFiles("migrations").map((path) => path.replace(/\\/g, "/"));
  const forbiddenMigrations = migrationFiles.filter((path) => /(?:chat|support-chat|dzn-assist|support-bot|websocket|vector)/i.test(path));
  assert.deepEqual(forbiddenMigrations, [], "Static visual shell must not add chat/support migrations.");
}

function assertNoProviderDependencies() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const dependencyNames = Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  });
  const forbidden = dependencyNames.filter((name) => FORBIDDEN_PROVIDER_DEPENDENCIES.some((pattern) => pattern.test(name)));
  assert.deepEqual(forbidden, [], "Static visual shell must not add AI provider dependencies.");
  assert.equal(
    packageJson.scripts?.["test:dzn-comms-visual-shell"],
    "tsx scripts/test-dzn-comms-visual-shell.ts",
    "Focused DZN Comms visual shell test should be wired into package scripts.",
  );
}

function assertDocumentationContracts() {
  const docs = [
    read(MASTER_SPEC),
    read(PUBLIC_ACCESS_POLICY),
    read(PREFLIGHT_DOC),
    read(PREFLIGHT_HANDOFF),
    read(VISUAL_HANDOFF),
  ].join("\n");

  for (const snippet of DOC_SNIPPETS) {
    assert.equal(docs.includes(snippet), true, `Docs should include ${snippet}.`);
  }
}

function assertPreflightGuardAdvancedPastNoPageBlocker() {
  const preflightTest = read(PREFLIGHT_TEST);
  assert.equal(
    preflightTest.includes("app/community/page.tsx"),
    false,
    "Preflight guard should no longer forbid the approved static /community visual prototype.",
  );
  assert.equal(
    preflightTest.includes("components/community/dzn-comms-visual-shell.tsx"),
    false,
    "Preflight guard should not forbid the approved static DZN Comms visual shell.",
  );
  assert.equal(
    preflightTest.includes("functions/api/chat"),
    true,
    "Preflight guard should still forbid backend chat API implementation.",
  );
}

function assertNoForbiddenRuntime(source: string, label: string) {
  for (const pattern of FORBIDDEN_VISUAL_RUNTIME_PATTERNS) {
    assert.doesNotMatch(source, pattern, `${label} must remain static local UI and must not match ${pattern}.`);
  }
}

function sourceBlock(source: string, startNeedle: string, endNeedle: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
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
