import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  buildPublicPlayerProfileSharePreviewMetadata,
  type PublicPlayerProfileResponse,
} from "../functions/_lib/public-player-profile";
import {
  onRequestGet as publicProfileShellGet,
  injectPublicPlayerProfileSharePreviewMetadataForTest,
  publicPlayerProfileSharePreviewHeadTagsForTest,
} from "../functions/players/[handle]";
import type { PagesContext } from "../functions/_lib/types";

const APP_ROUTE = "app/players/[handle]/page.tsx";
const PUBLIC_PROFILE_HELPER = "functions/_lib/public-player-profile.ts";
const PUBLIC_PROFILE_SHELL = "functions/players/[handle].ts";
const PUBLIC_PROFILE_PAGE = "components/player/public-player-profile-page.tsx";
const SHARE_PANEL = "components/player/public-profile-share-panel.tsx";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertStaticContracts();
  assertMetadataProjectionContracts();
  assertHtmlInjectionContracts();
  await assertShellFallbackRouteContract();
  assertNoPersistenceTrackingOrMutation();
  assertProtectedSystemIsolation();
  assertDocumentationContracts();
  console.log("Public profile share preview metadata polish tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    APP_ROUTE,
    PUBLIC_PROFILE_HELPER,
    PUBLIC_PROFILE_SHELL,
    PUBLIC_PROFILE_PAGE,
    SHARE_PANEL,
    "functions/api/public/player-profiles/[handle].ts",
    "functions/_lib/player-profile-privacy.ts",
    "functions/_lib/player-profile-progression.ts",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
    "docs/PUBLIC_PROFILE_OWNER_PREVIEW_SHARE_POLISH_HANDOFF.md",
    "docs/PUBLIC_PROFILE_SHARE_SESSION_FEEDBACK_HANDOFF.md",
    "docs/PUBLIC_PROFILE_SHARE_A11Y_FALLBACK_POLISH_HANDOFF.md",
    "docs/PUBLIC_PROFILE_SHARE_PREVIEW_METADATA_POLISH_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const appRoute = read(APP_ROUTE);
  for (const snippet of [
    "import type { Metadata } from \"next\"",
    "generateMetadata",
    "summary_large_image",
    "openGraph",
    "twitter",
    "DZN Player Profile | DZN Network",
    "generateStaticParams",
    "dynamicParams = false",
    "PublicPlayerProfilePage",
  ]) {
    assert.equal(appRoute.includes(snippet), true, `App route must include ${snippet}.`);
  }

  const publicHelper = read(PUBLIC_PROFILE_HELPER);
  for (const snippet of [
    "PublicPlayerProfileSharePreviewMetadata",
    "buildPublicPlayerProfileSharePreviewMetadata",
    "already_public_profile_payload",
    "uses_saved_visibility_preferences: true",
    "uses_visible_profile_sections_only: true",
    "hidden_sections: \"omitted\"",
    "private_identifiers: \"hidden\"",
    "raw_award_evidence: \"hidden\"",
    "exact_award_times: \"hidden\"",
    "share_history: \"not_stored\"",
    "server_calls_for_share_activity: \"not_performed\"",
    "privacy_setting_writes: \"not_performed\"",
    "payload.visibility.xp ? payload.sections.xp : null",
    "payload.visibility.challenge_progress ? payload.sections.challenge_progress : null",
    "payload.visibility.calling_cards ? payload.sections.calling_cards : null",
    "playerProfilePrivacyFairness",
  ]) {
    assert.equal(publicHelper.includes(snippet), true, `Public profile helper must include ${snippet}.`);
  }
  assertNoSqlWrites(publicHelper, "Public profile helper must remain read-only.");

  const shell = read(PUBLIC_PROFILE_SHELL);
  for (const snippet of [
    "getPublicPlayerProfilePayload",
    "buildPublicPlayerProfileSharePreviewMetadata",
    "safePublicProfileResponse",
    "injectPublicPlayerProfileSharePreviewMetadata",
    "meta property=\"og:title\"",
    "meta property=\"og:description\"",
    "meta property=\"og:image\"",
    "meta name=\"twitter:card\"",
    "meta name=\"twitter:title\"",
    "meta name=\"twitter:description\"",
    "meta name=\"dzn:share-preview-copy\"",
    "meta name=\"dzn:share-preview-source\"",
    "content-type\", \"text/html; charset=utf-8\"",
    "withoutContentLengthHeader",
    "cache-control\", \"no-store\"",
  ]) {
    assert.equal(shell.includes(snippet), true, `Public profile shell must include ${snippet}.`);
  }
}

function assertMetadataProjectionContracts() {
  const visible = buildPublicPlayerProfileSharePreviewMetadata({
    requestUrl: "https://dzn.example/players/rafaeldeak-a1b2c?share=discord",
    response: publicProfileResponse({
      displayName: "Rafael <Secret>",
      showXp: true,
      showChallenges: false,
      showCards: true,
      xpTotal: 2500,
      levelLabel: "Outbreak Veteran",
      completedChallenges: 99,
      callingCards: 4,
    }),
  });

  assert.equal(visible.source, "public_profile_payload");
  assert.equal(visible.title, "Rafael Secret | DZN Player Profile");
  assert.equal(visible.canonical_href, "https://dzn.example/players/rafaeldeak-a1b2c");
  assert.equal(visible.image_href, "https://dzn.example/media/dzn-cinematic-survivor.png");
  assert.equal(visible.robots, "index,follow");
  assert.equal(visible.open_graph.type, "profile");
  assert.equal(visible.open_graph.site_name, "DZN Network");
  assert.equal(visible.twitter.card, "summary_large_image");
  assert.match(visible.description, /Outbreak Veteran with 2,500 XP/);
  assert.match(visible.description, /4 calling cards/);
  assert.doesNotMatch(visible.description, /99 challenges|Secret>|<|>|discord_id|user_id|source_id|raw evidence payload/i);
  assert.equal(visible.privacy.uses_saved_visibility_preferences, true);
  assert.equal(visible.privacy.uses_visible_profile_sections_only, true);
  assert.equal(visible.privacy.hidden_sections, "omitted");
  assert.equal(visible.privacy.share_history, "not_stored");
  assert.equal(visible.fairness.paid_plan_influence, false);
  assert.equal(visible.fairness.ranking_influence, false);
  assert.equal(visible.fairness.discovery_score_influence, false);
  assert.equal(visible.fairness.review_score_influence, false);
  assert.equal(visible.fairness.badge_influence, false);
  assert.equal(visible.fairness.season_influence, false);
  assert.equal(visible.fairness.event_influence, false);
  assert.equal(visible.fairness.server_wars_influence, false);
  assert.equal(visible.fairness.xp_award_influence, false);
  assert.equal(visible.fairness.calling_card_award_influence, false);
  assert.equal(visible.fairness.competitive_eligibility_influence, false);

  const hiddenSections = buildPublicPlayerProfileSharePreviewMetadata({
    requestUrl: "https://dzn.example/players/quiet-player",
    response: publicProfileResponse({
      showXp: false,
      showChallenges: false,
      showCards: false,
      xpTotal: 999999,
      levelLabel: "Hidden Legendary",
      completedChallenges: 88,
      callingCards: 77,
    }),
  });
  assert.match(hiddenSections.description, /No progression sections are currently visible/);
  assert.doesNotMatch(hiddenSections.description, /999999|999,999|Hidden Legendary|88 challenges|77 calling/i);

  const fallback = buildPublicPlayerProfileSharePreviewMetadata({
    requestUrl: "https://dzn.example/players/not-public?x=1",
    response: {
      status: 404,
      payload: {
        ok: false,
        error: "PUBLIC_PROFILE_NOT_FOUND",
        message: "That DZN player profile is not public.",
        fairness: visible.fairness,
      },
    },
  });
  assert.equal(fallback.source, "generic_fallback");
  assert.equal(fallback.robots, "noindex,nofollow");
  assert.equal(fallback.title, "DZN Player Profile | DZN Network");
  assert.equal(fallback.canonical_href, "https://dzn.example/players/not-public");
  assert.doesNotMatch(fallback.description, /not public|private|hidden|user_id|discord_id|raw/i);
}

function assertHtmlInjectionContracts() {
  const metadata = buildPublicPlayerProfileSharePreviewMetadata({
    requestUrl: "https://dzn.example/players/rafaeldeak-a1b2c",
    response: publicProfileResponse({ showXp: true, showChallenges: true, showCards: true }),
  });
  const headTags = publicPlayerProfileSharePreviewHeadTagsForTest(metadata);
  for (const snippet of [
    "<title>RafaelDeak | DZN Player Profile</title>",
    "meta name=\"description\"",
    "link rel=\"canonical\"",
    "meta property=\"og:type\"",
    "meta property=\"og:site_name\"",
    "meta property=\"og:title\"",
    "meta property=\"og:description\"",
    "meta property=\"og:url\"",
    "meta property=\"og:image\"",
    "meta property=\"og:image:alt\"",
    "meta name=\"twitter:card\" content=\"summary_large_image\"",
    "meta name=\"twitter:title\"",
    "meta name=\"twitter:description\"",
    "meta name=\"twitter:image\"",
    "meta name=\"twitter:image:alt\"",
    "meta name=\"dzn:share-preview-copy\"",
    "meta name=\"dzn:share-preview-source\" content=\"public_profile_payload\"",
  ]) {
    assert.equal(headTags.includes(snippet), true, `Head tags must include ${snippet}.`);
  }

  const originalHtml = [
    "<html><head>",
    "<title>Old Title</title>",
    "<meta name=\"description\" content=\"old description\">",
    "<link rel=\"canonical\" href=\"https://old.example/players/old\">",
    "<meta property=\"og:title\" content=\"old og\">",
    "<meta name=\"twitter:card\" content=\"summary\">",
    "</head><body><main id=\"app\">Profile shell</main></body></html>",
  ].join("");
  const injected = injectPublicPlayerProfileSharePreviewMetadataForTest(originalHtml, metadata);
  assert.equal(count(injected, /<title>/g), 1);
  assert.equal(count(injected, /meta name="description"/g), 1);
  assert.equal(count(injected, /meta property="og:title"/g), 1);
  assert.equal(count(injected, /meta name="twitter:card"/g), 1);
  assert.equal(injected.includes("Old Title"), false);
  assert.equal(injected.includes("old description"), false);
  assert.equal(injected.includes("old og"), false);
  assert.equal(injected.includes("<main id=\"app\">Profile shell</main>"), true);
}

async function assertShellFallbackRouteContract() {
  const sourceHtml = [
    "<html><head>",
    "<title>Static Export Title</title>",
    "<meta name=\"description\" content=\"static export description\">",
    "</head><body><main>Profile shell</main></body></html>",
  ].join("");
  const response = await publicProfileShellGet({
    request: new Request("https://dzn.example/players/hidden-player?share=1"),
    env: {
      ASSETS: {
        fetch: async () => new Response(sourceHtml, {
          headers: {
            "content-type": "text/html",
            "content-length": String(sourceHtml.length),
          },
        }),
      },
    },
    params: { handle: "hidden-player" },
    waitUntil: () => undefined,
    next: async () => new Response("next", { status: 418 }),
    data: {},
  } as unknown as PagesContext);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.equal(html.includes("Static Export Title"), false);
  assert.equal(html.includes("static export description"), false);
  assert.equal(html.includes("<meta name=\"robots\" content=\"noindex,nofollow\">"), true);
  assert.equal(html.includes("<meta name=\"dzn:share-preview-source\" content=\"generic_fallback\">"), true);
  assert.equal(html.includes("<main>Profile shell</main>"), true);
}

function assertNoPersistenceTrackingOrMutation() {
  const runtimeSources = [
    read(APP_ROUTE),
    read(PUBLIC_PROFILE_HELPER),
    read(PUBLIC_PROFILE_SHELL).replace(/env\.ASSETS\.fetch/g, "assetFetch"),
    read(PUBLIC_PROFILE_PAGE),
  ].join("\n");
  assert.doesNotMatch(
    runtimeSources,
    /localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|fetchJsonWithRetry\([^)]*share|XMLHttpRequest|gtag|dataLayer|posthog|mixpanel|amplitude|plausible|Sentry|trackEvent|logShare|auditShare/i,
    "Public profile share preview metadata must not persist, send, track, or audit share activity.",
  );
  assert.doesNotMatch(
    runtimeSources,
    /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i,
    "Public profile share preview metadata must not add writes, checkout, Nitrado, or Discord behavior.",
  );
  assertNoSqlWrites(read(PUBLIC_PROFILE_SHELL), "Public profile shell must not write SQL.");

  const sharePanel = read(SHARE_PANEL);
  assert.doesNotMatch(
    sharePanel,
    /dzn:share-preview|openGraph|twitter:card|buildPublicPlayerProfileSharePreviewMetadata|publicPlayerProfileSharePreviewHeadTags/i,
    "Private share controls must not own public route metadata generation.",
  );
}

function assertProtectedSystemIsolation() {
  for (const file of protectedInfluenceFiles()) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /buildPublicPlayerProfileSharePreviewMetadata|PublicPlayerProfileSharePreviewMetadata|dzn:share-preview|og:title|twitter:card|share-preview-source|share-preview-copy/i,
      `${file} must not depend on public profile share preview metadata.`,
    );
  }
}

function assertDocumentationContracts() {
  const docs = [
    read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"),
    read("docs/PUBLIC_ACCESS_POLICY.md"),
    read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md"),
    read("docs/PUBLIC_PROFILE_OWNER_PREVIEW_SHARE_POLISH_HANDOFF.md"),
    read("docs/PUBLIC_PROFILE_SHARE_SESSION_FEEDBACK_HANDOFF.md"),
    read("docs/PUBLIC_PROFILE_SHARE_A11Y_FALLBACK_POLISH_HANDOFF.md"),
    read("docs/PUBLIC_PROFILE_SHARE_PREVIEW_METADATA_POLISH_HANDOFF.md"),
  ].join("\n");

  for (const snippet of [
    "Public Profile Share Preview Metadata Polish Slice",
    "Open Graph",
    "Twitter",
    "fallback preview copy",
    "already-public profile fields",
    "saved visibility preferences",
    "no stored share history",
    "no tracking events",
    "no analytics calls",
    "presentation-only",
    "Live checkout remains disabled",
    "Issue #49 remains reserved",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }
  assert.match(
    docs,
    /cannot expose hidden sections, store share history, create tracking events, call analytics, write profile privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or affect competitive eligibility/i,
    "Docs must preserve the metadata isolation statement.",
  );

  const packageJson = read("package.json");
  assert.equal(
    packageJson.includes("test:public-profile-share-preview-metadata-polish"),
    true,
    "Focused share preview metadata test must be wired into package scripts.",
  );
}

function publicProfileResponse(options: {
  displayName?: string;
  showXp?: boolean;
  showChallenges?: boolean;
  showCards?: boolean;
  xpTotal?: number;
  levelLabel?: string;
  completedChallenges?: number;
  callingCards?: number;
}): PublicPlayerProfileResponse {
  return {
    status: 200,
    payload: {
      ok: true,
      profile: {
        handle: "rafaeldeak-a1b2c",
        display_name: options.displayName ?? "RafaelDeak",
        avatar_initial: "R",
        public_href: "/players/rafaeldeak-a1b2c",
        public_api_href: "/api/public/player-profiles/rafaeldeak-a1b2c",
      },
      visibility: {
        mode: "public_viewer",
        xp: options.showXp ?? true,
        challenge_progress: options.showChallenges ?? true,
        calling_cards: options.showCards ?? true,
        award_dates: "hidden",
        private_identifiers: "hidden",
        raw_award_evidence: "hidden",
        exact_award_times: "hidden",
      },
      sections: {
        xp: {
          total_xp: options.xpTotal ?? 1250,
          profile_level: 5,
          level_label: options.levelLabel ?? "Survivor Captain",
          xp_to_next_level: 150,
        },
        challenge_progress: {
          joined_challenges: 6,
          completed_challenges: options.completedChallenges ?? 3,
          items: [
            {
              slug: "hidden-raw-source",
              title: "Should Not Need Raw Evidence",
              category: "community",
              status: "completed",
              progress_percent: 100,
            },
          ],
        },
        calling_cards: {
          count: options.callingCards ?? 2,
          items: [
            {
              code: "verified_survivor",
              name: "Verified Survivor",
              description: null,
              rarity: "earned",
            },
          ],
        },
        timeline: [
          {
            kind: "challenge",
            label: "Internal event should not appear in metadata",
            detail: "raw evidence hidden",
          },
        ],
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
      fetched_at: "2026-08-26T00:00:00.000Z",
    },
  };
}

function protectedInfluenceFiles() {
  return [
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
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
  ];
}

function assertNoSqlWrites(source: string, message: string) {
  assert.doesNotMatch(source, /\bINSERT\s+INTO\b|\bUPDATE\b|\bDELETE\s+FROM\b|\bDROP\b|\bALTER\b|\bCREATE\s+(?:TABLE|INDEX)\b/i, message);
  assert.doesNotMatch(source, /\.run\(/, message);
}

function count(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}
