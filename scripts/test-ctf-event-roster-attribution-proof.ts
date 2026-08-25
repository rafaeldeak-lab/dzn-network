import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  publicProfileRosterPlayerKey,
  readPublicProfileAttributionsByRosterPlayerKeys,
  type PublicProfileAttribution,
} from "../functions/_lib/public-profile-attribution";
import type { Env } from "../functions/_lib/types";

const PUBLIC_PROFILE: PublicProfileAttribution = {
  display_name: "Visible Player",
  public_handle: "visible-player-123",
  public_href: "/players/visible-player-123",
  public_api_href: "/api/public/player-profiles/visible-player-123",
};

async function main() {
  assertStaticContracts();
  await assertRosterBridgeLookup();
  assertRosterProjectionIsolation();
  assertScoringAndRegistrationAreUnchanged();
  assertNoProtectedMutationDependencies();
  console.log("CTF event roster attribution proof tests passed.");
}

function assertStaticContracts() {
  const helper = read("functions/_lib/public-profile-attribution.ts");
  for (const snippet of [
    "ctf_event_presentation_roster_rows",
    "readPublicProfileAttributionsByRosterPlayerKeys",
    "publicProfileRosterPlayerKey",
    "player_profiles.linked_server_id = ? AND player_profiles.player_id = ?",
    "INNER JOIN users ON users.discord_id = player_profiles.discord_id",
    "COUNT(DISTINCT users.id)",
    "HAVING COUNT(DISTINCT users.id) = 1",
  ]) {
    assert.equal(helper.includes(snippet), true, `Missing roster attribution helper snippet: ${snippet}`);
  }
  assert.doesNotMatch(helper, /lower\s*\(\s*player_profiles\.player_name|player_profiles\.player_name\s*=\s*\?/i, "Roster attribution must not infer links from player name matching.");

  const dashboardApi = read("functions/api/servers/[serverId]/ctf/dashboard.ts");
  for (const snippet of [
    "readPublicProfileAttributionsByRosterPlayerKeys",
    "fetchRoster(env, db, activeTournament.id)",
    "profile_attribution: ctfRosterProfileAttributionSafeguards()",
    "public_profile: profileKey ? profiles.get(profileKey) ?? null : null",
    "link_mode: \"presentation_only\"",
    "uses_gamertag_matching: false",
    "affects_scoring: false",
    "affects_eligibility: false",
    "affects_owner_decisions: false",
    "affects_billing: false",
  ]) {
    assert.equal(dashboardApi.includes(snippet), true, `Missing CTF dashboard attribution snippet: ${snippet}`);
  }

  const component = read("components/events/tournament-dashboard.tsx");
  for (const snippet of [
    "RosterPresentationPanel",
    "Roster Display",
    "Scoring still uses the locked roster ledger",
    "normalizePublicProfileAttribution(entry.public_profile)",
    "record.public_href === expectedHref && record.public_api_href === expectedApiHref",
  ]) {
    assert.equal(component.includes(snippet), true, `Missing roster presentation UI snippet: ${snippet}`);
  }
}

async function assertRosterBridgeLookup() {
  const db = new FakeRosterAttributionDb();
  const env = { DB: db as unknown as D1Database } as Env;
  const visibleKey = publicProfileRosterPlayerKey({ linked_server_id: "server-alpha", player_id: "player-visible" });
  const hiddenKey = publicProfileRosterPlayerKey({ linked_server_id: "server-alpha", player_id: "player-hidden" });
  const ambiguousKey = publicProfileRosterPlayerKey({ linked_server_id: "server-alpha", player_id: "player-ambiguous" });
  const invalidKey = publicProfileRosterPlayerKey({ linked_server_id: "server-alpha", player_id: "player-invalid" });
  const crossServerKey = publicProfileRosterPlayerKey({ linked_server_id: "server-beta", player_id: "player-visible" });

  const profiles = await readPublicProfileAttributionsByRosterPlayerKeys(env, [
    { linked_server_id: "server-alpha", player_id: "player-visible" },
    { linked_server_id: "server-alpha", player_id: "player-visible" },
    { linked_server_id: "server-alpha", player_id: "player-hidden" },
    { linked_server_id: "server-alpha", player_id: "player-ambiguous" },
    { linked_server_id: "server-alpha", player_id: "player-invalid" },
    { linked_server_id: " ", player_id: "player-empty" },
  ]);

  assert.equal(profiles.size, 1, "Only exact, visible, unambiguous roster bridges should resolve.");
  assert.deepEqual(profiles.get(visibleKey ?? ""), PUBLIC_PROFILE);
  assert.equal(profiles.has(hiddenKey ?? ""), false, "Hidden profile must not resolve.");
  assert.equal(profiles.has(ambiguousKey ?? ""), false, "Ambiguous roster bridge must not resolve.");
  assert.equal(profiles.has(invalidKey ?? ""), false, "Invalid public handle must not resolve.");
  assert.equal(profiles.has(crossServerKey ?? ""), false, "Same player id on a different server must not resolve unless the exact key is trusted.");
  assert.equal(db.writeCount, 0, "Roster attribution lookup must be read-only.");
  assert.match(db.lastSql, /player_profiles\.linked_server_id = \? AND player_profiles\.player_id = \?/);
  assert.doesNotMatch(db.lastSql, /lower\s*\(|player_name\s*=/i, "Lookup SQL must not link by gamertag.");
}

function assertRosterProjectionIsolation() {
  const serialized = JSON.stringify(PUBLIC_PROFILE);
  assert.doesNotMatch(serialized, /server-alpha|player-visible|discord|user_id|linked_server_id|player_id/i, "Public attribution object must not expose internal roster, Discord, or user identifiers.");
  assert.equal(PUBLIC_PROFILE.public_href, `/players/${PUBLIC_PROFILE.public_handle}`);
  assert.equal(PUBLIC_PROFILE.public_api_href, `/api/public/player-profiles/${PUBLIC_PROFILE.public_handle}`);
}

function assertScoringAndRegistrationAreUnchanged() {
  const rosterApi = read("functions/api/servers/[serverId]/ctf/roster.ts");
  for (const forbidden of [
    "public-profile-attribution",
    "readPublicProfileAttributionsByRosterPlayerKeys",
    "public_profile",
    "public_handle",
    "profile_attribution",
  ]) {
    assert.equal(rosterApi.includes(forbidden), false, `Roster registration must not depend on public attribution: ${forbidden}`);
  }

  const scoring = read("functions/_lib/ctf-tournaments.ts");
  for (const forbidden of [
    "public-profile-attribution",
    "readPublicProfileAttributionsByRosterPlayerKeys",
    "public_profile",
    "public_handle",
    "profile_attribution",
  ]) {
    assert.equal(scoring.includes(forbidden), false, `CTF scoring engine must not depend on public attribution: ${forbidden}`);
  }

  for (const snippet of [
    "isPlayerOnLockedRoster",
    "incrementCtfPoints",
    "markCtfFlagRaised",
    "auditCtfEvent",
    "ctf_match_participants",
    "ctf_event_audit",
  ]) {
    assert.equal(scoring.includes(snippet), true, `Existing CTF scoring contract missing: ${snippet}`);
  }
}

function assertNoProtectedMutationDependencies() {
  const implementation = [
    read("functions/_lib/public-profile-attribution.ts"),
    read("functions/api/servers/[serverId]/ctf/dashboard.ts"),
    read("components/events/tournament-dashboard.tsx"),
  ].join("\n");
  assert.doesNotMatch(implementation, protectedMutationPattern(), "Roster attribution slice must not write protected billing, ranking, review, badge, season, event, Server Wars, progression, or ownership tables.");
  assert.doesNotMatch(implementation, liveServicePattern(), "Roster attribution slice must not call live checkout, Nitrado, Discord mutation, Cloudflare secret, or production D1 paths.");
}

function read(path: string) {
  return readFileSync(path, "utf8");
}

function protectedMutationPattern() {
  return /\b(?:UPDATE|INSERT\s+(?:OR\s+IGNORE\s+)?INTO|DELETE\s+FROM)\s+(?:owner_billing_accounts|server_subscriptions|owner_plan_entitlements|server_owners|server_rankings|leaderboards|discovery_score|server_reviews|server_review_reports|server_review_moderation_actions|badges|server_badge_awards|badge_unlock_progress|dzn_seasons|dzn_season_entries|dzn_season_awards|competitive_events|competitive_event_servers|competitive_event_matches|event_participants|server_war_events|server_war_score_snapshots|server_war_results|player_progression_award_sources|player_xp_ledger|player_calling_card_awards|stripe)\b/i;
}

function liveServicePattern() {
  return /\bcreateCheckoutSession\b|\bstripeFormRequest\b|\bSTRIPE_SECRET_KEY\b|\bDZN_LIVE_CHECKOUT_ENABLED\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bwrangler\s+d1\b|\bwrangler\s+secret\b|\bfetchDiscordApi\b|\bfetchNitrado\b/i;
}

type FakeRow = {
  linked_server_id: string;
  player_id: string;
  username: string;
  public_handle: string | null;
  public_profile_enabled: number;
  matched_user_count: number;
};

class FakeRosterAttributionDb {
  readonly rows: FakeRow[] = [
    {
      linked_server_id: "server-alpha",
      player_id: "player-visible",
      username: "Visible Player",
      public_handle: "visible-player-123",
      public_profile_enabled: 1,
      matched_user_count: 1,
    },
    {
      linked_server_id: "server-alpha",
      player_id: "player-hidden",
      username: "Hidden Player",
      public_handle: "hidden-player-123",
      public_profile_enabled: 0,
      matched_user_count: 1,
    },
    {
      linked_server_id: "server-alpha",
      player_id: "player-ambiguous",
      username: "Ambiguous Player",
      public_handle: "ambiguous-player-123",
      public_profile_enabled: 1,
      matched_user_count: 2,
    },
    {
      linked_server_id: "server-alpha",
      player_id: "player-invalid",
      username: "Invalid Player",
      public_handle: "../not-safe",
      public_profile_enabled: 1,
      matched_user_count: 1,
    },
    {
      linked_server_id: "server-beta",
      player_id: "player-visible",
      username: "Wrong Server Player",
      public_handle: "wrong-server-player-123",
      public_profile_enabled: 1,
      matched_user_count: 1,
    },
  ];
  lastSql = "";
  writeCount = 0;

  prepare(sql: string) {
    this.lastSql = sql;
    return new FakeRosterStatement(this, sql);
  }
}

class FakeRosterStatement {
  private values: unknown[] = [];

  constructor(private readonly db: FakeRosterAttributionDb, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async all<T>() {
    assert.match(this.sql, /FROM player_profiles/i);
    const requestedKeys = new Set<string>();
    for (let index = 0; index < this.values.length; index += 2) {
      const linkedServerId = stringValue(this.values[index]);
      const playerId = stringValue(this.values[index + 1]);
      const key = publicProfileRosterPlayerKey({ linked_server_id: linkedServerId, player_id: playerId });
      if (key) requestedKeys.add(key);
    }
    const results = this.db.rows
      .filter((row) => requestedKeys.has(publicProfileRosterPlayerKey(row) ?? ""))
      .filter((row) => row.public_profile_enabled === 1 && row.public_handle)
      .map((row) => ({
        linked_server_id: row.linked_server_id,
        player_id: row.player_id,
        username: row.username,
        public_handle: row.public_handle,
        matched_user_count: row.matched_user_count,
      }));
    return { results } as { results: T[] };
  }

  async run() {
    this.db.writeCount += 1;
    return { success: true };
  }
}

function stringValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

void main();
