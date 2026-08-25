import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  buildPublicProfileAppearancePreview,
  publicProfileAttributionFairness,
  type PublicProfileAttribution,
} from "../functions/_lib/public-profile-attribution";
import {
  listPublicEventSuggestions,
  projectSuggestionForPublicTest,
  resetEventSuggestionSchemaReadinessForTests,
} from "../functions/_lib/event-suggestions";
import { rankPublicPlayers } from "../functions/_lib/public-leaderboards";
import type { Env } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

const PUBLIC_PROFILE: PublicProfileAttribution = {
  display_name: "RafaelDeak",
  public_handle: "rafaeldeak-a1b2c",
  public_href: "/players/rafaeldeak-a1b2c",
  public_api_href: "/api/public/player-profiles/rafaeldeak-a1b2c",
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertStaticContracts();
  assertAppearancePreviewContract();
  assertPublicSuggestionProjection();
  await assertPublicSuggestionListAttribution();
  assertAttributionDoesNotInfluenceRanking();
  assertProtectedSurfacesRemainExcluded();
  console.log("Public profile attribution controls polish tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "functions/_lib/public-profile-attribution.ts",
    "functions/api/player/profile-privacy.ts",
    "functions/api/player/profile.ts",
    "functions/api/player/hub.ts",
    "functions/_lib/event-suggestions.ts",
    "functions/api/events/suggestions/index.ts",
    "components/player/player-profile-progression-page.tsx",
    "components/player/player-hub-page.tsx",
    "components/events/event-suggestions-page.tsx",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const helper = read("functions/_lib/public-profile-attribution.ts");
  for (const snippet of [
    "buildPublicProfileAppearancePreview",
    "event_suggestion_author_rows",
    "player_hub_challenge_rows",
    "future_player_safe_member_rosters",
    "ctf_event_scoring_rosters",
    "disables_all_public_attribution_links: true",
    "exposes_private_identifiers: false",
    "affects_competition: false",
  ]) {
    assert.equal(helper.includes(snippet), true, `Attribution preview helper must include ${snippet}.`);
  }
  assertNoSqlMutations(helper, "Attribution helper must remain read-only.");
  assert.doesNotMatch(helper, forbiddenProductionMutationPattern(), "Attribution helper must not touch production/external services.");

  const privacyApi = read("functions/api/player/profile-privacy.ts");
  for (const snippet of [
    "buildPublicProfileAppearancePreview",
    "profile_attribution: buildPublicProfileAppearancePreview",
    "[\"GET\", \"PATCH\"].includes(request.method)",
  ]) {
    assert.equal(privacyApi.includes(snippet), true, `Profile privacy API must include ${snippet}.`);
  }
  assert.doesNotMatch(privacyApi, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(privacyApi, forbiddenProductionMutationPattern(), "Profile privacy API must not activate production services.");

  const profileApi = read("functions/_lib/player-profile-progression.ts");
  assert.equal(profileApi.includes("profile_attribution: buildPublicProfileAppearancePreview(privacy)"), true, "Private profile payload must include attribution preview.");

  const hubApi = read("functions/api/player/hub.ts");
  assert.equal(hubApi.includes("profile_attribution: buildPublicProfileAppearancePreview(profilePrivacy)"), true, "Player Hub payload must include attribution preview.");
  assert.doesNotMatch(hubApi, /\brequireOwnerRequestAccess\b|\bownerAccessErrorResponse\b|\brequireActiveOwnerEntitlement\b/);
  assert.doesNotMatch(hubApi, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i, "Player Hub preview must stay read-only.");

  const suggestions = read("functions/_lib/event-suggestions.ts");
  for (const snippet of [
    "readPublicProfileAttributionsByUserIds",
    "pageRows.map((row) => row.submitted_by_user_id)",
    "authorName: authorProfile?.display_name ?? \"DZN player\"",
    "authorProfile",
  ]) {
    assert.equal(suggestions.includes(snippet), true, `Event suggestions must include ${snippet}.`);
  }
  assert.doesNotMatch(suggestions, /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bserver_rankings\b|\bdiscovery_score\b/i);

  const suggestionsRoute = read("functions/api/events/suggestions/index.ts");
  assert.equal(suggestionsRoute.includes("event-suggestions-v4"), true, "Public suggestion cache version must change after public response shape changed.");

  const suggestionsUi = read("components/events/event-suggestions-page.tsx");
  for (const snippet of [
    "authorProfile?: PublicProfileAttribution",
    "normalizePublicProfileAttribution(suggestion.authorProfile)",
    "View ${profile.display_name}'s public DZN profile",
    "record.public_href === expectedHref",
    "record.public_api_href === expectedApiHref",
    "normalizePublicProfileHandle",
    "DZN player",
  ]) {
    assert.equal(suggestionsUi.includes(snippet), true, `Event suggestions UI must include ${snippet}.`);
  }

  const profileUi = read("components/player/player-profile-progression-page.tsx");
  for (const snippet of [
    "Where My Public Profile Appears",
    "Hide All Public Links",
    "normalizeProfileAttributionPreview(response.profile_attribution",
    "profile_attribution?: ProfileAttributionPreview",
    "CTF/event scoring rosters and owner workflows stay excluded",
  ]) {
    assert.equal(profileUi.includes(snippet), true, `Private profile UI must include ${snippet}.`);
  }
  assert.doesNotMatch(profileUi, /method\s*:\s*["'](?:POST|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const hubUi = read("components/player/player-hub-page.tsx");
  for (const snippet of [
    "Where My Profile Appears",
    "normalizeProfileAttributionPreview(hub.profile_attribution",
    "normalizePublicProfileAttribution(challenge.player_state?.public_profile)",
    "record.public_href === expectedHref",
    "record.public_api_href === expectedApiHref",
    "CTF/event scoring rosters stay out",
  ]) {
    assert.equal(hubUi.includes(snippet), true, `Player Hub UI must include ${snippet}.`);
  }

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:public-profile-attribution-controls-polish"), true, "Focused controls polish test must be wired into package scripts.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  for (const snippet of [
    "Public Profile Attribution Expansion And Controls Polish Slice",
    "private \"where my public profile appears\" preview/control surface",
    "event_suggestion_author_rows",
    "CTF/event scoring rosters",
    "presentation-only",
  ]) {
    assert.equal(platformSpec.includes(snippet), true, `Master spec must include ${snippet}.`);
  }

  const publicPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  assert.equal(publicPolicy.includes("public profile attribution expansion and controls polish"), true, "Public access policy must mention this slice.");

  const handoff = read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md");
  assert.equal(handoff.includes("Follow-On Public Profile Attribution Expansion And Controls Polish"), true, "Profile handoff must include this follow-on slice.");
}

function assertAppearancePreviewContract() {
  const ready = buildPublicProfileAppearancePreview({
    public_profile_enabled: true,
    public_handle: PUBLIC_PROFILE.public_handle,
    public_href: PUBLIC_PROFILE.public_href,
    public_api_href: PUBLIC_PROFILE.public_api_href,
    settings_href: "/api/player/profile-privacy",
  });

  assert.equal(ready.ready, true);
  assert.equal(ready.public_href, PUBLIC_PROFILE.public_href);
  assert.equal(ready.control.disables_all_public_attribution_links, true);
  assert.equal(ready.placements.some((placement) => placement.key === "event_suggestion_author_rows" && placement.can_show_public_profile_link), true);
  assert.equal(ready.placements.some((placement) => placement.key === "player_hub_challenge_rows" && placement.can_show_public_profile_link), true);
  assert.equal(ready.placements.some((placement) => placement.key === "safe_leaderboard_mentions" && placement.link_state === "eligible_when_unique_user_bridge"), true);
  assert.equal(ready.excluded_surfaces.some((surface) => surface.key === "ctf_event_scoring_rosters" && surface.public_profile_links_enabled === false), true);
  for (const placement of ready.placements) {
    assert.equal(placement.exposes_private_identifiers, false);
    assert.equal(placement.affects_competition, false);
    assert.equal(placement.controlled_by, "public_profile_visibility");
  }
  assert.equal(ready.placements.some((placement) => placement.key === "public_event_creator_member_rows" && placement.can_show_public_profile_link), true);
  assert.equal(ready.excluded_surfaces.some((surface) => surface.key === "event_roster_scoring_and_decision_rows" && surface.public_profile_links_enabled === false), true);
  for (const surface of ready.excluded_surfaces) {
    assert.equal(surface.public_profile_links_enabled, false);
    assert.equal(surface.affects_competition, false);
  }
  assertFairnessFlags(ready.fairness);

  const hidden = buildPublicProfileAppearancePreview({
    public_profile_enabled: false,
    public_handle: PUBLIC_PROFILE.public_handle,
    public_href: PUBLIC_PROFILE.public_href,
    public_api_href: PUBLIC_PROFILE.public_api_href,
    settings_href: "/api/player/profile-privacy",
  });
  assert.equal(hidden.ready, false);
  assert.equal(hidden.public_href, null);
  assert.equal(hidden.placements.every((placement) => placement.can_show_public_profile_link === false), true);
  assert.equal(hidden.placements.some((placement) => placement.link_state === "hidden_until_public_profile"), true);
  assertFairnessFlags(publicProfileAttributionFairness());
}

function assertPublicSuggestionProjection() {
  const published = projectSuggestionForPublicTest({
    id: "suggestion-public",
    submitted_by_user_id: "published-user",
    title: "Public author suggestion",
  }, PUBLIC_PROFILE);

  assert.equal(published.authorName, PUBLIC_PROFILE.display_name);
  assert.deepEqual(published.authorProfile, PUBLIC_PROFILE);
  assert.doesNotMatch(JSON.stringify(published), /published-user|submitted_by_user_id/i, "Public suggestion projection must not expose internal submitter IDs.");

  const hidden = projectSuggestionForPublicTest({
    id: "suggestion-hidden",
    submitted_by_user_id: "hidden-user",
    title: "Hidden author suggestion",
  });
  assert.equal(hidden.authorName, "DZN player");
  assert.equal(hidden.authorProfile, null);
  assert.doesNotMatch(JSON.stringify(hidden), /hidden-user|submitted_by_user_id/i, "Hidden public suggestion projection must not expose internal submitter IDs.");
}

async function assertPublicSuggestionListAttribution() {
  const state = createEventSuggestionDb();
  const env = { DB: state.db } as Env;
  resetEventSuggestionSchemaReadinessForTests(env);

  const payload = await listPublicEventSuggestions(env, { sort: "newest", limit: 5 });
  assert.equal(payload.ok, true);
  assert.equal(payload.suggestions.length, 2);

  const published = payload.suggestions.find((suggestion) => suggestion.id === "suggestion-published");
  const hidden = payload.suggestions.find((suggestion) => suggestion.id === "suggestion-hidden");
  assert.equal(published?.authorName, PUBLIC_PROFILE.display_name);
  assert.equal(published?.authorProfile?.public_href, PUBLIC_PROFILE.public_href);
  assert.equal(hidden?.authorName, "DZN player");
  assert.equal(hidden?.authorProfile, null);

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /published-user|hidden-user|submitted_by_user_id|discord-published|discord-hidden/i);
  assert.equal(state.operations.some((operation) => operation.kind === "run"), false, "Public suggestion attribution must be read-only.");
  assert.equal(
    state.operations.some((operation) => /FROM\s+player_profile_privacy_preferences/i.test(operation.sql) && /INNER\s+JOIN\s+users/i.test(operation.sql)),
    true,
    "Public suggestion list must load author profiles only through the generated-handle attribution helper.",
  );
  for (const operation of state.operations) {
    assert.doesNotMatch(operation.sql, forbiddenProtectedInfluencePattern());
  }
}

function assertAttributionDoesNotInfluenceRanking() {
  const ranked = rankPublicPlayers([
    {
      playerName: "PublishedLowKills",
      serverName: "DZN One",
      serverSlug: "dzn-one",
      kills: 2,
      deaths: 0,
      longestKill: 40,
      lastSeen: "2026-08-25T12:00:00.000Z",
      publicProfile: PUBLIC_PROFILE,
    },
    {
      playerName: "HiddenHighKills",
      serverName: "DZN One",
      serverSlug: "dzn-one",
      kills: 9,
      deaths: 3,
      longestKill: 25,
      lastSeen: "2026-08-25T12:01:00.000Z",
      publicProfile: null,
    },
  ]);

  assert.equal(ranked[0].player_name, "HiddenHighKills");
  assert.equal(ranked[0].public_profile, null);
  assert.equal(ranked[1].player_name, "PublishedLowKills");
  assert.equal(ranked[1].public_profile?.public_href, PUBLIC_PROFILE.public_href);
}

function assertProtectedSurfacesRemainExcluded() {
  for (const file of [
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
    "lib/billing/plans.ts",
    "functions/_lib/server-ranking.ts",
    "functions/_lib/advanced-leaderboards.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/cron/player-progression/awards.ts",
    "functions/api/servers/[serverId]/ctf/roster.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /public-profile-attribution|PublicProfileAttribution|public_handle|public_href|\/players\/\[handle\]|\/api\/public\/player-profiles/i,
      `${file} must not depend on public profile attribution state.`,
    );
  }

  const ctfDashboard = read("functions/api/servers/[serverId]/ctf/dashboard.ts");
  assert.equal(ctfDashboard.includes("link_mode: \"presentation_only\""), true, "CTF dashboard attribution must stay presentation-only.");
  assert.doesNotMatch(ctfDashboard, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i, "CTF dashboard attribution must stay read-only.");

  const events = read("functions/_lib/events.ts");
  assert.equal(events.includes("public_event_creator_member_rows"), true, "Public event host/member attribution must be explicit.");
  assert.equal(events.includes("creator_profile: creatorProfile"), true, "Public event host/member rows may carry creator profile metadata.");
  assert.doesNotMatch(events, /readPublicProfileAttributionsByRosterPlayerKeys|publicProfileRosterPlayerKey/i, "Public event host/member links must not use CTF roster attribution.");
}

function createEventSuggestionDb() {
  const operations: FakeOperation[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return eventSuggestionStatement(sql, bindings, operations);
        },
        ...eventSuggestionStatement(sql, [], operations),
      };
    },
  };
  return { db: db as unknown as Env["DB"], operations };
}

function eventSuggestionStatement(sql: string, bindings: unknown[], operations: FakeOperation[]) {
  return {
    async all<T>() {
      operations.push({ kind: "all", sql, bindings });
      const tableInfo = pragmaTableInfo(sql);
      if (tableInfo) return { results: tableInfo.map((name) => ({ name })) as T[] };
      if (/FROM\s+player_profile_privacy_preferences/i.test(sql) && /INNER\s+JOIN\s+users/i.test(sql)) {
        const wanted = new Set(bindings.map(String));
        return {
          results: wanted.has("published-user")
            ? [{
                user_id: "published-user",
                username: PUBLIC_PROFILE.display_name,
                public_handle: PUBLIC_PROFILE.public_handle,
              }] as T[]
            : [] as T[],
        };
      }
      if (/FROM\s+event_suggestions/i.test(sql) && /LEFT\s+JOIN\s+linked_servers/i.test(sql)) {
        return { results: [eventSuggestionRow("suggestion-published", "published-user"), eventSuggestionRow("suggestion-hidden", "hidden-user")] as T[] };
      }
      if (/FROM\s+event_suggestion_votes/i.test(sql)) return { results: [] as T[] };
      return { results: [] as T[] };
    },
    async first<T>() {
      operations.push({ kind: "first", sql, bindings });
      return null as T | null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      return { success: true };
    },
  };
}

function pragmaTableInfo(sql: string) {
  const match = sql.match(/PRAGMA\s+table_info\(([^)]+)\)/i);
  if (!match) return null;
  return tableColumns()[match[1]] ?? [];
}

function tableColumns(): Record<string, string[]> {
  return {
    event_suggestions: [
      "id",
      "submitted_by_user_id",
      "title",
      "description",
      "normalized_title",
      "content_fingerprint",
      "competition_format",
      "platform",
      "moderation_status",
      "public_status",
      "converted_event_id",
      "upvote_count",
      "downvote_count",
      "report_count",
      "hot_score",
      "created_at",
      "updated_at",
    ],
    event_suggestion_votes: ["suggestion_id", "user_id", "vote_value", "created_at", "updated_at"],
    event_suggestion_reports: ["id", "suggestion_id", "reporter_user_id", "reason", "status", "created_at"],
    event_suggestion_moderation_actions: ["id", "suggestion_id", "actor_user_id", "action", "created_at"],
    linked_servers: ["id", "public_slug", "status", "listing_visibility", "merged_into_server_id", "display_name", "hostname", "server_name", "nitrado_service_name"],
  };
}

function eventSuggestionRow(id: string, submittedByUserId: string) {
  return {
    id,
    submitted_by_user_id: submittedByUserId,
    title: id === "suggestion-published" ? "Published author suggestion" : "Hidden author suggestion",
    description: "A public-safe event suggestion row used to prove author attribution stays presentation-only.",
    normalized_title: id,
    content_fingerprint: `${id}-fingerprint`,
    competition_format: "community_challenge",
    platform: "cross_platform",
    map_name: null,
    suggested_server_id: null,
    suggested_server_slug: null,
    suggested_server_name: null,
    open_to_any_server: 1,
    suggested_date_start: null,
    suggested_date_end: null,
    structure_notes: null,
    moderation_status: "public_voting",
    public_status: "public_voting",
    creator_decision: "approved_for_voting",
    converted_event_id: null,
    creator_response: null,
    upvote_count: id === "suggestion-published" ? 2 : 8,
    downvote_count: 0,
    report_count: 0,
    hot_score: id === "suggestion-published" ? 2 : 8,
    created_at: id === "suggestion-published" ? "2026-08-25T10:00:00.000Z" : "2026-08-25T11:00:00.000Z",
    updated_at: "2026-08-25T11:30:00.000Z",
    published_at: "2026-08-25T11:30:00.000Z",
    moderated_at: "2026-08-25T11:30:00.000Z",
    converted_event_slug: null,
    converted_event_status: null,
    converted_event_visibility: null,
  };
}

function assertFairnessFlags(fairness: Record<string, boolean>) {
  for (const flag of [
    "paid_plan_influence",
    "ranking_influence",
    "discovery_score_influence",
    "review_score_influence",
    "badge_influence",
    "season_influence",
    "event_influence",
    "server_wars_influence",
    "xp_award_influence",
    "calling_card_award_influence",
    "competitive_eligibility_influence",
  ]) {
    assert.equal(fairness[flag], false, `${flag} must remain false.`);
  }
}

function assertNoSqlMutations(source: string, message: string) {
  const sqlTemplates = source.match(/`[\s\S]*?`/g) ?? [];
  for (const template of sqlTemplates) {
    assert.doesNotMatch(template, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i, message);
  }
}

function forbiddenProtectedInfluencePattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bserver_rankings\b|\bdiscovery_score\b|\bserver_badge_awards\b|\bbadge_unlock_progress\b|\bdzn_seasons\b|\bevent_matchups\b|\bevent_participants\b|\bserver_war_score_snapshots\b|\bserver_war_events\b|\bstripe\b|\bnitrado\b|\bdiscord_oauth_tokens\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i;
}

function forbiddenProductionMutationPattern() {
  return /\bcreateCheckoutSession\b|\bstripeFormRequest\b|\bSTRIPE_SECRET_KEY\b|\bDZN_LIVE_CHECKOUT_ENABLED\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bwrangler\s+d1\b|\bwrangler\s+secret\b|\bfetchDiscordApi\b|\bfetchNitrado\b/i;
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
