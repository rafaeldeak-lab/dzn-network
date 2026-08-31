import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SITE_HEADER = "components/site-header.tsx";
const PLAYER_HUB_PAGE = "components/player/player-hub-page.tsx";
const PLAYER_PROFILE_PAGE = "components/player/player-profile-progression-page.tsx";
const AUTH_ME_API = "functions/api/auth/me.ts";
const AUTH_TYPES = "components/onboarding/types.ts";
const MIDDLEWARE = "functions/_middleware.ts";
const GLOBALS = "app/globals.css";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const SLICE_DOC = "docs/DZN_PLAYER_NAV_ACCESS_POLISH.md";
const SLICE_HANDOFF = "docs/DZN_PLAYER_NAV_ACCESS_POLISH_HANDOFF.md";
const PACKAGE_JSON = "package.json";

const FORBIDDEN_RUNTIME_PATTERNS = [
  /\bcheckout\.sessions\.create\b/i,
  /\bstripeFormRequest\b/i,
  /\bstripeGetRequest\b/i,
  /\bSTRIPE_SECRET_KEY\b/i,
  /\bSTRIPE_WEBHOOK_SECRET\b/i,
  /\bDZN_LIVE_CHECKOUT_ENABLED\b/i,
  /\bDZN_STORE_LIVE_CHECKOUT_ENABLED\b/i,
  /\/api\/store/i,
  /\/api\/stripe/i,
  /\/api\/account\/purchases/i,
  /\/api\/account\/supporter-cards/i,
  /\bsupporter_cards\b/i,
  /\baccount_entitlements\b/i,
  /\bstore_orders\b/i,
  /\bearned_spins\b/i,
  /\bspin_ledger\b/i,
  /\bwheel_cooldowns\b/i,
  /\bplayer_stats\b/i,
  /\bserver_rankings\b/i,
  /\branking_score\b/i,
  /\bdiscovery_score\b/i,
  /\bserver_war/i,
  /\bctf_/i,
  /\bnew\s+WebSocket\b/i,
  /\bWebSocketPair\b/i,
  /\bDurableObject\b/i,
  /\bnavigator\.sendBeacon\b/i,
  /\bgtag\b/i,
  /\bposthog\b/i,
  /\btrackEvent\b/i,
  /\bopenai\.responses\b/i,
  /\bchat\.completions\b/i,
  /\bcreateEmbedding\b/i,
  /\bvectorize\b/i,
];

main();

function main() {
  assertHeaderPlayerAccess();
  assertAuthSummaryPlayerUrls();
  assertPlayerPageEntryPoints();
  assertAccessBoundaryUnchanged();
  assertDocsAndPackage();

  console.log("Player nav access polish tests passed.");
}

function assertHeaderPlayerAccess() {
  const source = read(SITE_HEADER);
  const loggedOutLinks = sourceBlock(source, "const loggedOutHeaderLinks", "const starterHeaderLinks");
  const actions = sourceBlock(source, "<div className=\"dzn-header-actions\">", "{resolvedAuthenticated && showLogout");

  assertIncludes(source, "import { UserRound } from \"lucide-react\";", "Header should use the existing icon library for the player action.");
  assertIncludes(source, "const PLAYER_HOME_URL = \"/player\";", "Header should keep a fixed player home fallback.");
  assertIncludes(source, "const PLAYER_PROFILE_URL = \"/player/profile\";", "Header should keep a fixed private profile fallback.");
  assertIncludes(source, "const playerHomeHref = resolvedNavigation?.player_home_url ?? PLAYER_HOME_URL;", "Header should use the verified auth summary player home when present.");
  assertIncludes(source, "const playerProfileHref = resolvedNavigation?.player_profile_url ?? PLAYER_PROFILE_URL;", "Header should use the verified auth summary private profile when present.");
  assertIncludes(actions, "data-player-nav-access=\"authenticated-player-home\"", "Authenticated header should expose a stable player-nav marker.");
  assertIncludes(actions, "href={playerHomeHref}", "Authenticated player action should open /player.");
  assertIncludes(actions, "data-player-profile-href={playerProfileHref}", "Authenticated player action should advertise the private profile path for QA.");
  assertIncludes(actions, "Open your DZN Player Hub and private player profile", "Player action needs clear accessible text.");
  assertIncludes(actions, "My Player", "Player action should be visibly clearer than a generic product label.");
  assert.equal(loggedOutLinks.includes("My Player"), false, "Logged-out header links must not expose the private player action.");
  assert.equal(loggedOutLinks.includes("My Profile"), false, "Logged-out header links must not expose the private profile action.");
}

function assertAuthSummaryPlayerUrls() {
  const api = read(AUTH_ME_API);
  const types = read(AUTH_TYPES);

  assertIncludes(api, "const PLAYER_HOME_URL = \"/player\";", "Auth summary should define the fixed player home URL.");
  assertIncludes(api, "const PLAYER_PROFILE_URL = \"/player/profile\";", "Auth summary should define the fixed private profile URL.");
  assertIncludes(api, "player_home_url: PLAYER_HOME_URL", "Auth summary should return the player home URL.");
  assertIncludes(api, "player_profile_url: PLAYER_PROFILE_URL", "Auth summary should return the private profile URL.");
  assertIncludes(api, "can_use_player_surfaces: true", "Auth summary must keep player access free after login.");
  assertIncludes(api, "owner_action_required: canUseOwnerTools ? null : \"choose_plan\"", "Owner setup should remain a separate pricing boundary.");
  assert.doesNotMatch(api, /\bensureBillingSchema\b|\bupsertOwnerEntitlements\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(api, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);

  assertIncludes(types, "player_home_url: string", "Auth navigation type should include the player home path.");
  assertIncludes(types, "player_profile_url: string", "Auth navigation type should include the private profile path.");
}

function assertPlayerPageEntryPoints() {
  const hub = read(PLAYER_HUB_PAGE);
  const profile = read(PLAYER_PROFILE_PAGE);

  assertIncludes(hub, "data-player-profile-entry=\"hero-private-profile\"", "Player Hub hero should expose a direct private profile entry.");
  assertIncludes(hub, "href=\"/player/profile\"", "Player Hub should link directly to the private player profile page.");
  assertIncludes(hub, "My Profile", "Player Hub should use clear profile copy.");
  assertIncludes(hub, "Player access is free.", "Player Hub must keep the free-player boundary copy.");
  assertIncludes(hub, "/pricing?intent=owner_setup&returnTo=%2Fsetup", "Owner setup must still route through pricing.");
  assertIncludes(profile, "href=\"/player\"", "Private profile page should link back to Player Hub.");
  assertIncludes(profile, "Owner Setup", "Private profile page should keep owner setup separated.");
}

function assertAccessBoundaryUnchanged() {
  const middleware = read(MIDDLEWARE);

  assertIncludes(middleware, "\"/player\"", "/player should remain login-protected.");
  assert.equal(ownerBillingPrefixBlock(middleware).includes("\"/player\""), false, "/player must not be owner-billing gated.");
  assertIncludes(middleware, "\"/setup\"", "/setup should remain owner-billing gated.");
  assertIncludes(middleware, "\"/dashboard\"", "/dashboard should remain owner-billing gated.");

  for (const path of [SITE_HEADER, PLAYER_HUB_PAGE, AUTH_ME_API]) {
    const source = read(path);
    for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path} must not add Store/payment/chat-runtime/tracking/competitive behavior.`);
    }
  }
}

function assertDocsAndPackage() {
  const globals = read(GLOBALS);
  const policy = read(PUBLIC_ACCESS_POLICY);
  const spec = read(MASTER_SPEC);
  const doc = read(SLICE_DOC);
  const handoff = read(SLICE_HANDOFF);
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };

  assertIncludes(globals, ".dzn-header-action--player-home", "Header CSS should include the player action style.");
  assertIncludes(policy, "The player navigation/access polish slice", "Public access policy should document this slice.");
  assertIncludes(spec, "## Player Navigation Access Polish Slice", "Master spec should document this slice.");
  assertIncludes(spec, "DZN Comms reaction interaction contract", "Master spec should leave runtime reactions as the next Comms slice.");
  assertIncludes(doc, "No Store payment, Supporter Card reveal, checkout, entitlement, wheel, chat runtime, or competitive-system behavior is added.", "Slice doc should state the boundary.");
  assertIncludes(handoff, "Next recommended slice: DZN Comms reaction interaction contract", "Handoff should record the next Comms slice.");
  assert.equal(
    packageJson.scripts?.["test:player-nav-access-polish"],
    "tsx scripts/test-player-nav-access-polish.ts",
    "Package scripts should expose the player-nav polish test.",
  );
  assertIncludes(packageJson.scripts?.test ?? "", "npm run test:player-nav-access-polish", "Full test chain should include the player-nav polish test.");
}

function ownerBillingPrefixBlock(source: string) {
  const match = source.match(/const ownerBillingPagePrefixes = \[[\s\S]*?\];/);
  return match?.[0] ?? "";
}

function sourceBlock(source: string, startNeedle: string, endNeedle: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

function assertIncludes(source: string, snippet: string, message: string) {
  assert.equal(source.includes(snippet), true, message);
}

function read(path: string) {
  return readFileSync(path, "utf8");
}
