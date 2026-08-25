import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequest as playerHubHandler } from "../functions/api/player/hub";
import type { Env, PagesContext } from "../functions/_lib/types";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const middlewareSource = read("functions/_middleware.ts");
  assert.equal(middlewareSource.includes("\"/player\""), true, "/player must be a logged-in player page.");
  assert.equal(
    ownerBillingPrefixBlock(middlewareSource).includes("\"/player\""),
    false,
    "/player must not be in the owner-billing page prefix list.",
  );

  const headerSource = read("components/site-header.tsx");
  assert.equal(headerSource.includes("{ href: \"/player\", label: \"Player Hub\", active: \"player\" }"), true);
  assert.equal(headerSource.includes("if (pathname.startsWith(\"/player\")) return \"player\""), true);
  assert.equal(headerSource.includes("const showAddServer = resolvedAuthenticated && canUseOwnerTools"), true);

  const pageSource = read("app/player/page.tsx");
  assert.equal(pageSource.includes("PlayerHubPage"), true);

  const playerHubPageSource = read("components/player/player-hub-page.tsx");
  for (const snippet of [
    "/api/player/hub",
    "Matched Discord Communities",
    "Followed And Saved Servers",
    "Suggested Servers",
    "Suggested Events",
    "Tournaments",
    "Profile Entry Points",
    "ownerSetupHref",
    "/pricing?intent=owner_setup&returnTo=%2Fsetup",
    "Player access is free.",
  ]) {
    assert.equal(playerHubPageSource.includes(snippet), true, `Player Hub page must include ${snippet}`);
  }

  const playerHubApiSource = read("functions/api/player/hub.ts");
  for (const snippet of [
    "getRequestSessionUser",
    "getPlayerCommunitiesPayload",
    "getEventsListPayload",
    "pricingUrlForOwnerAccess(OWNER_SETUP_RETURN_TO)",
    "player_saved_servers",
    "suggested_servers",
    "suggested_events",
    "profile_entry_points",
  ]) {
    assert.equal(playerHubApiSource.includes(snippet), true, `Player Hub API must include ${snippet}`);
  }
  assert.doesNotMatch(playerHubApiSource, /\brequireOwnerRequestAccess\b/);
  assert.doesNotMatch(playerHubApiSource, /\bownerAccessErrorResponse\b/);
  assert.doesNotMatch(playerHubApiSource, /\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(playerHubApiSource, /\bstripeFormRequest\b|\bcreateCheckoutSession\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/);
  assert.doesNotMatch(playerHubApiSource, /\bstoreGuilds\b|\bcanManageDiscordGuild\b/);
  assert.doesNotMatch(playerHubApiSource, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);

  const communitiesSource = read("functions/api/player/communities.ts");
  assert.equal(communitiesSource.includes("export async function getPlayerCommunitiesPayload"), true);
  assert.equal(communitiesSource.includes("fetchDiscordGuilds(token)"), true);
  assert.doesNotMatch(communitiesSource, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b/);
  assert.doesNotMatch(communitiesSource, /\bcanManageDiscordGuild\b/);

  const migration = stripSqlComments(read("migrations/0060_player_hub_foundation.sql"));
  assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS player_saved_servers"), true);
  assert.equal(migration.includes("UNIQUE(user_id, linked_server_id)"), true);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE|ALTER|UPDATE)\b/i);
  assert.doesNotMatch(migration, /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bplayer_profiles\b|\bkill_events\b|\bplayer_events\b|\bcompetitive_events\b/i);
  assert.doesNotMatch(migration, /\bDZN_LIVE_CHECKOUT_ENABLED\b|\bSTRIPE_SECRET_KEY\b|\bDISCORD_BOT_TOKEN\b|\bNITRADO_TOKEN\b/i);

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  assert.equal(platformSpec.includes("Player Hub foundation slice"), true);
  assert.equal(platformSpec.includes("`/player`"), true);
  assert.equal(platformSpec.includes("saved/followed server state"), true);

  const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  assert.equal(publicAccessPolicy.includes("- `/player`"), true);
  assert.equal(publicAccessPolicy.includes("/api/player/hub"), true);

  const unauthenticated = await callPlayerHub({} as Env);
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: "Unauthorized" });

  const mockResponse = await callPlayerHub({ MOCK_AUTH: "true" } as Env);
  assert.equal(mockResponse.status, 200);
  const mockJson = await mockResponse.json() as {
    ok?: boolean;
    access?: { role?: string; can_use_player_surfaces?: boolean; owner_setup_href?: string; owner_setup_requires_entitlement?: boolean };
    communities?: unknown[];
    saved_servers?: { source?: string; servers?: unknown[] };
    suggested_servers?: { source?: string; servers?: unknown[] };
    suggested_events?: { events?: unknown[]; tournaments?: unknown[] };
    profile_entry_points?: Array<{ key?: string; href?: string; owner_entitlement_required?: boolean }>;
  };

  assert.equal(mockJson.ok, true);
  assert.equal(mockJson.access?.role, "player");
  assert.equal(mockJson.access?.can_use_player_surfaces, true);
  assert.equal(mockJson.access?.owner_setup_href, "/pricing?intent=owner_setup&returnTo=%2Fsetup");
  assert.equal(mockJson.access?.owner_setup_requires_entitlement, true);
  assert.equal(Array.isArray(mockJson.communities), true);
  assert.equal(mockJson.saved_servers?.source, "unavailable");
  assert.ok((mockJson.suggested_servers?.servers ?? []).length > 0);
  assert.ok((mockJson.suggested_events?.events ?? []).length > 0);
  assert.ok((mockJson.suggested_events?.tournaments ?? []).length > 0);
  assert.equal(
    mockJson.profile_entry_points?.some((entry) => entry.key === "owner_setup" && entry.href === "/pricing?intent=owner_setup&returnTo=%2Fsetup" && entry.owner_entitlement_required === true),
    true,
  );

  console.log("Player Hub foundation tests passed.");
}

async function callPlayerHub(env: Env) {
  return playerHubHandler({
    request: new Request("https://dzn.example/api/player/hub"),
    env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Promise<Response>;
}

function ownerBillingPrefixBlock(source: string) {
  const match = source.match(/const ownerBillingPagePrefixes = \[[\s\S]*?\];/);
  return match?.[0] ?? "";
}

function stripSqlComments(source: string) {
  return source.replace(/--.*$/gm, "");
}

function read(path: string) {
  return readFileSync(path, "utf8");
}
