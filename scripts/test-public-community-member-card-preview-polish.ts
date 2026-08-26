import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  getPublicCommunityMemberDirectoryPayload,
  publicCommunityMemberDirectorySafeguards,
  type PublicCommunityMemberDirectoryPayload,
} from "../functions/_lib/public-community-members";
import {
  projectPublicPlayerProfileDirectoryPreviewForPublicTest,
  readPublicPlayerProfileDirectoryPreviewsByUserIds,
  type PublicPlayerProfilePayload,
} from "../functions/_lib/public-player-profile";
import type { Env } from "../functions/_lib/types";

type FakeOperation = {
  kind: "prepare" | "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

const VISIBLE_USER_ID = "user-visible-preview";
const HIDDEN_SECTION_USER_ID = "user-hidden-sections";
const PUBLIC_HANDLE = "visible-preview-123";
const HIDDEN_SECTION_HANDLE = "hidden-section-preview-123";

async function main() {
  assertStaticContracts();
  assertPublicPreviewProjection();
  await assertBatchPreviewPrivacy();
  await assertCommunityDirectoryPayloadPreviews();
  assertProtectedInfluenceIsolation();
  console.log("Public community member card preview polish tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    "functions/_lib/public-player-profile.ts",
    "functions/_lib/public-community-members.ts",
    "components/community/public-community-members-page.tsx",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
    "docs/PUBLIC_COMMUNITY_MEMBER_CARD_PREVIEW_POLISH_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const publicProfileHelper = read("functions/_lib/public-player-profile.ts");
  for (const snippet of [
    "PublicPlayerProfileDirectoryPreview",
    "readPublicPlayerProfileDirectoryPreviewsByUserIds",
    "projectPublicPlayerProfileDirectoryPreviewForPublicTest",
    "source: \"published_profile_sections\"",
    "uses_visible_profile_sections_only: true",
    "hidden_sections: \"omitted\"",
    "readPublishedProfileDirectoryXpTotals",
    "readPublishedProfileDirectoryChallengeCounts",
    "readPublishedProfileDirectoryCallingCardCounts",
    "readPublishedProfileDirectoryLatestCallingCards",
    "show_xp",
    "show_challenge_progress",
    "show_calling_cards",
  ]) {
    assert.equal(publicProfileHelper.includes(snippet), true, `Public profile helper must include ${snippet}.`);
  }
  assertNoSqlWrites(publicProfileHelper, "Public profile directory preview reads must stay read-only.");
  assert.doesNotMatch(publicProfileHelper, forbiddenProductionMutationPattern(), "Public profile preview helper must not touch production/external services.");

  const communityHelper = read("functions/_lib/public-community-members.ts");
  for (const snippet of [
    "profile_preview",
    "readPublicPlayerProfileDirectoryPreviewsByUserIds",
    "preview_uses_published_profile_sections_only: true",
    "preview_omits_hidden_profile_sections: true",
  ]) {
    assert.equal(communityHelper.includes(snippet), true, `Community member helper must include ${snippet}.`);
  }
  assertNoSqlWrites(communityHelper, "Public community member helper must remain read-only.");
  assert.doesNotMatch(communityHelper, forbiddenProductionMutationPattern(), "Community member helper must not touch production/external services.");

  const publicPage = read("components/community/public-community-members-page.tsx");
  for (const snippet of [
    "ProfilePreviewStrip",
    "Published profile preview",
    "Visible sections only. Hidden profile sections stay private.",
    "Profile sections hidden or not earned yet.",
    "normalizeProfilePreview(value.profile_preview)",
    "privacy?.uses_visible_profile_sections_only !== true",
    "privacy.hidden_sections !== \"omitted\"",
    "profilePreviewIcon",
  ]) {
    assert.equal(publicPage.includes(snippet), true, `Community member page must include ${snippet}.`);
  }
  assert.doesNotMatch(publicPage, /dangerouslySetInnerHTML|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:public-community-member-card-preview-polish"), true, "Focused preview polish test must be wired into package scripts.");

  const docs = [
    read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"),
    read("docs/PUBLIC_ACCESS_POLICY.md"),
    read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md"),
    read("docs/PUBLIC_COMMUNITY_MEMBER_CARD_PREVIEW_POLISH_HANDOFF.md"),
  ].join("\n");
  for (const snippet of [
    "Public Community Member Card Preview Polish Slice",
    "already-published profile sections",
    "retained exports remain blocked",
    "Issue #49 remains reserved",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }
  assert.equal(docs.toLowerCase().includes("hidden profile sections stay private"), true, "Docs must state hidden profile sections stay private.");
  assert.equal(docs.toLowerCase().includes("live checkout remains disabled"), true, "Docs must confirm live checkout remains disabled.");
}

function assertPublicPreviewProjection() {
  const preview = projectPublicPlayerProfileDirectoryPreviewForPublicTest(publicProfilePayload());
  assert.equal(preview?.source, "published_profile_sections");
  assert.equal(preview?.privacy.uses_visible_profile_sections_only, true);
  assert.equal(preview?.privacy.hidden_sections, "omitted");
  assert.deepEqual(preview?.highlights.map((item) => item.key), ["xp", "challenge_progress", "calling_cards"]);
  assert.equal(preview?.highlights[0]?.value, "Survivor Track");
  assert.equal(preview?.highlights[0]?.detail, "375 XP");
  assert.equal(preview?.highlights[1]?.value, "1 challenge completed");
  assert.equal(preview?.highlights[1]?.detail, "1 challenge joined");
  assert.equal(preview?.highlights[2]?.value, "1 card");
  assert.equal(preview?.highlights[2]?.detail, "Survivor Spark");
  assertFairnessFlags(preview?.fairness);
  assertNoPrivateFields(preview);

  const hiddenSections = projectPublicPlayerProfileDirectoryPreviewForPublicTest({
    ...publicProfilePayload(),
    sections: {
      xp: null,
      challenge_progress: null,
      calling_cards: null,
      timeline: [],
    },
  });
  assert.equal(hiddenSections?.visible_section_count, 0);
  assert.deepEqual(hiddenSections?.highlights, []);
  assertNoPrivateFields(hiddenSections);
  assert.doesNotMatch(JSON.stringify(hiddenSections), /375|Survivor Spark|foundation-survivor|awarded_at|completed_at/i);

  assert.equal(projectPublicPlayerProfileDirectoryPreviewForPublicTest(null), null);
}

async function assertBatchPreviewPrivacy() {
  const state = createPreviewDb();
  const previews = await readPublicPlayerProfileDirectoryPreviewsByUserIds(
    { DB: state.db } as Env,
    [VISIBLE_USER_ID, HIDDEN_SECTION_USER_ID, "", null],
  );

  assert.equal(previews.size, 2, JSON.stringify(state.operations.map((operation) => ({
    kind: operation.kind,
    sql: operation.sql.slice(0, 120),
    bindings: operation.bindings,
  }))));
  assert.equal(previews.get(VISIBLE_USER_ID)?.highlights.length, 3);
  assert.equal(previews.get(HIDDEN_SECTION_USER_ID)?.highlights.length, 0);
  assertNoPrivateFields(Object.fromEntries(previews));

  const sectionReads = state.operations.filter((operation) =>
    operation.kind === "all"
    &&
    /player_xp_ledger|player_challenge_participations|player_calling_card_awards/i.test(operation.sql),
  );
  assert.ok(sectionReads.length >= 4, "Visible-section preview should read public profile section summaries.");
  for (const operation of sectionReads) {
    assert.equal(operation.bindings.includes(VISIBLE_USER_ID), true, "Visible sections may read the visible player's public profile section data.");
    assert.equal(operation.bindings.includes(HIDDEN_SECTION_USER_ID), false, "Hidden profile sections must not be queried for card previews.");
    assertNoSqlWrite(operation.sql, "Preview section reads must not mutate data.");
    assert.doesNotMatch(operation.sql, forbiddenProtectedInfluencePattern(), "Preview reads must not depend on protected influence systems.");
  }
}

async function assertCommunityDirectoryPayloadPreviews() {
  const state = createPreviewDb();
  const result = await getPublicCommunityMemberDirectoryPayload({ DB: state.db } as Env, "nuketown-deathmatch", { limit: 10 });
  assert.equal(result.status, 200);
  const payload = result.payload as PublicCommunityMemberDirectoryPayload;
  assert.equal(payload.ok, true);
  assert.equal(payload.members.length, 2);
  assert.equal(payload.community.member_count, 2);
  assert.equal(payload.profile_attribution.preview_uses_published_profile_sections_only, true);
  assert.equal(payload.profile_attribution.preview_omits_hidden_profile_sections, true);
  assert.equal(payload.members[0]?.profile_preview?.highlights.length, 3);
  assert.equal(payload.members[1]?.profile_preview?.highlights.length, 0);
  assert.equal(payload.members.some((member) => member.public_profile.public_handle === "unpublished-preview-123"), false);
  assertNoPrivateFields(payload);

  for (const operation of state.operations) {
    assertNoSqlWrite(operation.sql, "Public directory card preview must not mutate data.");
    assert.doesNotMatch(operation.sql, forbiddenProtectedInfluencePattern(), "Public directory card preview must not read protected influence systems.");
    assert.doesNotMatch(operation.sql, forbiddenProductionMutationPattern(), "Public directory card preview must not touch production/external services.");
  }
  assert.equal(state.operations.some((operation) => operation.kind === "run"), false, "Public directory card preview must be read-only.");
}

function assertProtectedInfluenceIsolation() {
  const publicSafeguards = publicCommunityMemberDirectorySafeguards();
  assert.equal(publicSafeguards.preview_uses_published_profile_sections_only, true);
  assert.equal(publicSafeguards.preview_omits_hidden_profile_sections, true);
  assert.equal(publicSafeguards.affects_billing, false);
  assert.equal(publicSafeguards.affects_rankings, false);
  assert.equal(publicSafeguards.affects_discovery_score, false);
  assert.equal(publicSafeguards.affects_reviews, false);
  assert.equal(publicSafeguards.affects_badges, false);
  assert.equal(publicSafeguards.affects_seasons, false);
  assert.equal(publicSafeguards.affects_server_wars_scoring, false);
  assert.equal(publicSafeguards.affects_xp_awards, false);
  assert.equal(publicSafeguards.affects_calling_card_awards, false);
  assert.equal(publicSafeguards.affects_competitive_eligibility, false);
  assertFairnessFlags(publicSafeguards.fairness);

  for (const file of [
    "functions/api/billing/create-checkout-session.ts",
    "functions/_lib/server-ranking.ts",
    "functions/_lib/public-leaderboards.ts",
    "functions/_lib/server-visibility.ts",
    "functions/_lib/server-reviews.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/cron/player-progression/awards.ts",
    "functions/_lib/player-progression.ts",
    "functions/api/events/[slug]/join.ts",
    "functions/api/events/matchmaking.ts",
    "functions/_lib/ctf-tournaments.ts",
    "functions/api/servers/[serverId]/ctf/dashboard.ts",
    "functions/api/servers/[serverId]/ctf/roster.ts",
    "functions/api/owner/community-members/export.ts",
    "functions/_lib/community-member-source-management.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /ProfilePreviewStrip|readPublicPlayerProfileDirectoryPreviewsByUserIds|PublicPlayerProfileDirectoryPreview|profile_sections_hidden_or_not_earned|published_profile_sections/i,
      `${file} must not depend on public community member card previews.`,
    );
  }
}

function createPreviewDb() {
  const operations: FakeOperation[] = [];
  const db = {
    prepare(sql: string) {
      operations.push({ kind: "prepare", sql, bindings: [] });
      return new FakePreviewStatement(sql, operations);
    },
  };
  return { db: db as unknown as Env["DB"], operations };
}

class FakePreviewStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly operations: FakeOperation[],
  ) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async all<T>() {
    this.operations.push({ kind: "all", sql: this.sql, bindings: this.bindings });
    if (/FROM\s+community_members/i.test(this.sql)) {
      return {
        results: [
          {
            user_id: VISIBLE_USER_ID,
            role_label: "Raid Lead",
            display_order: 1,
            created_at: "2026-08-25T10:00:00.000Z",
          },
          {
            user_id: HIDDEN_SECTION_USER_ID,
            role_label: "Scout",
            display_order: 2,
            created_at: "2026-08-24T10:00:00.000Z",
          },
          {
            user_id: "user-unpublished",
            role_label: "Hidden",
            display_order: 3,
            created_at: "2026-08-23T10:00:00.000Z",
          },
        ] as T[],
      };
    }
    if (/FROM\s+player_profile_privacy_preferences/i.test(this.sql) && /INNER\s+JOIN\s+users/i.test(this.sql)) {
      const wanted = new Set(this.bindings.map(String));
      return {
        results: [
          wanted.has(VISIBLE_USER_ID) ? {
            user_id: VISIBLE_USER_ID,
            username: "Visible Preview",
            public_handle: PUBLIC_HANDLE,
            show_xp: 1,
            show_challenge_progress: 1,
            show_calling_cards: 1,
            show_award_dates: 0,
          } : null,
          wanted.has(HIDDEN_SECTION_USER_ID) ? {
            user_id: HIDDEN_SECTION_USER_ID,
            username: "Hidden Section Preview",
            public_handle: HIDDEN_SECTION_HANDLE,
            show_xp: 0,
            show_challenge_progress: 0,
            show_calling_cards: 0,
            show_award_dates: 0,
          } : null,
        ].filter(Boolean) as T[],
      };
    }
    if (/SUM\(xp_amount\)/i.test(this.sql)) {
      return { results: [{ user_id: VISIBLE_USER_ID, total_xp: 375 }] as T[] };
    }
    if (/FROM\s+player_challenge_participations/i.test(this.sql)) {
      return { results: [{ user_id: VISIBLE_USER_ID, joined_challenges: 2, completed_challenges: 1 }] as T[] };
    }
    if (/COUNT\(\*\)\s+AS\s+calling_card_count/i.test(this.sql)) {
      return { results: [{ user_id: VISIBLE_USER_ID, calling_card_count: 1 }] as T[] };
    }
    if (/ROW_NUMBER\(\)\s+OVER/i.test(this.sql) && /player_calling_card_awards/i.test(this.sql)) {
      return {
        results: [{
          user_id: VISIBLE_USER_ID,
          calling_card_name: "Survivor Spark",
          calling_card_rarity: "foundation",
          awarded_at: "2026-08-25T10:30:00.000Z",
        }] as T[],
      };
    }
    return { results: [] as T[] };
  }

  async first<T>() {
    this.operations.push({ kind: "first", sql: this.sql, bindings: this.bindings });
    if (/FROM\s+linked_servers/i.test(this.sql) && /LEFT\s+JOIN\s+discord_guilds/i.test(this.sql)) {
      const serverRef = String(this.bindings[0] ?? "");
      if (serverRef !== "nuketown-deathmatch") return null as T | null;
      return {
        public_slug: "nuketown-deathmatch",
        server_name: "Nuketown Deathmatch",
        community_guild_id: "community-guild-preview",
        community_name: "Nuketown Community",
        community_icon_url: "https://cdn.discordapp.com/icons/guild/icon.png",
      } as T;
    }
    return null as T | null;
  }

  async run() {
    this.operations.push({ kind: "run", sql: this.sql, bindings: this.bindings });
    return { success: true };
  }
}

function publicProfilePayload(): PublicPlayerProfilePayload {
  return {
    ok: true,
    profile: {
      handle: PUBLIC_HANDLE,
      display_name: "Visible Preview",
      avatar_initial: "V",
      public_href: `/players/${PUBLIC_HANDLE}`,
      public_api_href: `/api/public/player-profiles/${PUBLIC_HANDLE}`,
    },
    visibility: {
      mode: "public_viewer",
      xp: true,
      challenge_progress: true,
      calling_cards: true,
      award_dates: "month",
      private_identifiers: "hidden",
      raw_award_evidence: "hidden",
      exact_award_times: "hidden",
    },
    sections: {
      xp: {
        total_xp: 375,
        profile_level: 3,
        level_label: "Survivor Track",
        xp_to_next_level: 125,
      },
      challenge_progress: {
        joined_challenges: 1,
        completed_challenges: 1,
        items: [{
          slug: "survivor-spark",
          title: "Survivor Spark",
          category: "survival",
          status: "completed",
          progress_percent: 100,
          completed_label: "Aug 2026",
        }],
      },
      calling_cards: {
        count: 1,
        items: [{
          code: "survivor_spark",
          name: "Survivor Spark",
          description: "Completed the first DZN player challenge track.",
          rarity: "foundation",
          awarded_label: "Aug 2026",
        }],
      },
      timeline: [],
    },
    fairness: {
      paid_plan_influence: false,
      ranking_influence: false,
      discovery_score_influence: false,
      review_score_influence: false,
      badge_influence: false,
      season_influence: false,
      event_influence: false,
      server_wars_influence: false,
      xp_award_influence: false,
      calling_card_award_influence: false,
      competitive_eligibility_influence: false,
    },
    fetched_at: "2026-08-26T12:00:00.000Z",
  };
}

function assertFairnessFlags(fairness: Record<string, boolean> | undefined) {
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
    assert.equal(fairness?.[flag], false, `${flag} must remain false.`);
  }
}

function assertNoPrivateFields(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /"discord_id"\s*:/i, "Public member preview must not expose Discord IDs.");
  assert.doesNotMatch(serialized, /"user_id"\s*:/i, "Public member preview must not expose internal user IDs.");
  assert.doesNotMatch(serialized, /"source_id"\s*:|"source_table"\s*:/i, "Public member preview must not expose source identifiers.");
  assert.doesNotMatch(serialized, /"evidence_json"\s*:|"raw_evidence"\s*:/i, "Public member preview must not expose raw award evidence.");
  assert.doesNotMatch(serialized, /"awarded_at"\s*:|"completed_at"\s*:|"joined_at"\s*:|"occurred_at"\s*:/i, "Public member preview must not expose exact award timestamps.");
  assert.doesNotMatch(serialized, /owner_billing_accounts|server_subscriptions|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i);
}

function assertNoSqlWrites(source: string, message: string) {
  const sqlTemplates = source.match(/`[\s\S]*?`/g) ?? [];
  for (const template of sqlTemplates) assertNoSqlWrite(template, message);
}

function assertNoSqlWrite(sql: string, message: string) {
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i, message);
}

function forbiddenProtectedInfluencePattern() {
  return /\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bserver_rankings\b|\bdiscovery_score\b|\bserver_reviews\b|\breview_score\b|\bserver_badge_awards\b|\bbadge_unlock_progress\b|\bdzn_seasons\b|\bcompetitive_events\b|\bcompetitive_event_matches\b|\bctf_tournament\b|\bevent_matchups\b|\bevent_participants\b|\bserver_war_score_snapshots\b|\bserver_war_events\b|\bplayer_progression_award_sources\b|\bstripe\b|\bnitrado\b|\bdiscord_oauth_tokens\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i;
}

function forbiddenProductionMutationPattern() {
  return /\bcreateCheckoutSession\b|\bstripeFormRequest\b|\bSTRIPE_SECRET_KEY\b|\bDZN_LIVE_CHECKOUT_ENABLED\s*=\s*true\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bwrangler\s+d1\b|\bwrangler\s+secret\b|\bfetchDiscordApi\b|\bfetchNitrado\b|\bCOMMUNITY_MEMBER_EXPORTS_BUCKET\b/i;
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
