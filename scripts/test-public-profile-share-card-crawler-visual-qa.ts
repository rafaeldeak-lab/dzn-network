import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  injectPublicPlayerProfileSharePreviewMetadataForTest,
  onRequestGet as publicProfileShellGet,
} from "../functions/players/[handle]";
import {
  buildPublicPlayerProfileSharePreviewMetadata,
  PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS,
  type PublicPlayerProfileResponse,
  type PublicPlayerProfileSharePreviewImageCard,
} from "../functions/_lib/public-player-profile";
import { playerProfilePrivacyFairness } from "../functions/_lib/player-profile-privacy";
import type { PagesContext } from "../functions/_lib/types";

const PUBLIC_PROFILE_SHELL = "functions/players/[handle].ts";
const PUBLIC_PROFILE_HELPER = "functions/_lib/public-player-profile.ts";
const CRAWLER_QA_TEST = "scripts/test-public-profile-share-preview-crawler-qa.ts";
const IMAGE_CARD_QA_TEST = "scripts/test-public-profile-share-preview-image-card-polish.ts";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const PREVIOUS_HANDOFF = "docs/PUBLIC_PROFILE_SHARE_PREVIEW_IMAGE_CARD_POLISH_HANDOFF.md";
const HANDOFF_DOC = "docs/PUBLIC_PROFILE_SHARE_CARD_CRAWLER_VISUAL_QA_HANDOFF.md";

const STATIC_PROFILE_SHELL = [
  "<!doctype html>",
  "<html>",
  "<head>",
  "<title>Static Preview Shell</title>",
  "<meta name=\"description\" content=\"static profile fallback\">",
  "<meta property=\"og:title\" content=\"static og title\">",
  "<meta name=\"twitter:card\" content=\"summary\">",
  "</head>",
  "<body>",
  "<main id=\"public-profile-shell\">Client app shell remains available.</main>",
  "</body>",
  "</html>",
].join("");

type VisualCrawlerCase = {
  key: "published" | "hidden" | "invalid" | "unavailable";
  handle: string;
  requestUrl: string;
  dbMode: "published" | "hidden" | "unavailable";
};

type VisualCrawlerCaseKey = VisualCrawlerCase["key"] | "fallback_image";

type HeadSnapshot = {
  key: VisualCrawlerCaseKey;
  route: string;
  status: number;
  content_type: string | null;
  cache_control: string | null;
  asset_path: string;
  title: string;
  description: string;
  canonical: string;
  robots: string;
  og_type: string;
  og_site_name: string;
  og_title: string;
  og_description: string;
  og_url: string;
  og_image: string;
  og_image_alt: string;
  twitter_card: string;
  twitter_title: string;
  twitter_description: string;
  twitter_image: string;
  twitter_image_alt: string;
  fallback_copy: string;
  preview_source: string;
  duplicate_managed_tags: false;
  body_shell_preserved: true;
  write_queries: number;
};

type SocialCardPreview = {
  key: VisualCrawlerCaseKey;
  platform: "open_graph" | "twitter";
  route: string;
  title: string;
  description: string;
  url: string;
  image_url: string;
  image_alt: string;
  image_width: number;
  image_height: number;
  image_mime: "image/png" | "image/jpeg" | "image/webp";
  card_type: "summary_large_image";
  robots: string;
  html: string;
};

type ImageInfo = {
  mime: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  bytes: number;
};

const VISUAL_CRAWLER_CASES: VisualCrawlerCase[] = [
  {
    key: "published",
    handle: "published-survivor",
    requestUrl: "https://dzn.example/players/published-survivor?utm_source=discord&raw_award_evidence=do-not-leak",
    dbMode: "published",
  },
  {
    key: "hidden",
    handle: "hidden-survivor",
    requestUrl: "https://dzn.example/players/hidden-survivor?discord_id=do-not-leak",
    dbMode: "hidden",
  },
  {
    key: "invalid",
    handle: "bad!!handle",
    requestUrl: "https://dzn.example/players/bad!!handle?source_id=do-not-leak",
    dbMode: "published",
  },
  {
    key: "unavailable",
    handle: "published-survivor",
    requestUrl: "https://dzn.example/players/published-survivor?share=unavailable",
    dbMode: "unavailable",
  },
];

async function main() {
  assertStaticContracts();
  const snapshots = await renderHeadSnapshots();
  snapshots.set("fallback_image", renderFallbackImageHeadSnapshot());
  const previews = renderSocialCardPreviews(snapshots);
  assertCrawlerFriendlySnapshots(snapshots);
  assertCrawlerFriendlyPreviewCards(previews);
  assertNoHiddenFields(snapshots, previews);
  assertNoTrackingOrMutationPaths(snapshots);
  assertProtectedSystemsStayIndependent();
  assertDocumentationContracts();
  console.log("Public profile share-card crawler visual QA tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    PUBLIC_PROFILE_SHELL,
    PUBLIC_PROFILE_HELPER,
    CRAWLER_QA_TEST,
    IMAGE_CARD_QA_TEST,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    PREVIOUS_HANDOFF,
    HANDOFF_DOC,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const shell = read(PUBLIC_PROFILE_SHELL);
  for (const snippet of [
    "meta property=\"og:image\"",
    "meta property=\"og:image:alt\"",
    "meta name=\"twitter:image\"",
    "meta name=\"twitter:image:alt\"",
    "meta name=\"dzn:share-preview-copy\"",
    "cache-control\", \"no-store\"",
  ]) {
    assert.equal(shell.includes(snippet), true, `Profile shell route must include ${snippet}.`);
  }
}

async function renderHeadSnapshots() {
  const snapshots = new Map<VisualCrawlerCaseKey, HeadSnapshot>();
  for (const crawlerCase of VISUAL_CRAWLER_CASES) {
    const assetRequests: string[] = [];
    const db = crawlerCase.dbMode === "unavailable" ? null : new PublicProfileVisualQaDb(crawlerCase.dbMode);
    const response = await publicProfileShellGet({
      request: new Request(crawlerCase.requestUrl, {
        headers: {
          "user-agent": "DZN-ShareCardVisualSmoke/1.0",
        },
      }),
      env: {
        ...(db ? { DB: db } : {}),
        ASSETS: {
          fetch: async (request: Request) => {
            assetRequests.push(new URL(request.url).pathname);
            return new Response(STATIC_PROFILE_SHELL, {
              headers: {
                "content-type": "text/html",
                "content-length": String(STATIC_PROFILE_SHELL.length),
              },
            });
          },
        },
      },
      params: { handle: crawlerCase.handle },
      waitUntil: () => undefined,
      next: async () => new Response("next route should not be needed", { status: 418 }),
      data: {},
    } as unknown as PagesContext);

    const html = await response.text();
    snapshots.set(
      crawlerCase.key,
      headSnapshotFromHtml({
        key: crawlerCase.key,
        route: new URL(crawlerCase.requestUrl).pathname,
        response,
        html,
        assetPath: assetRequests.join(","),
        writeQueries: db?.writeQueries.length ?? 0,
      }),
    );
  }
  return snapshots;
}

function renderFallbackImageHeadSnapshot(): HeadSnapshot {
  const fallbackCard = PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS[0];
  const unavailableFutureCard: PublicPlayerProfileSharePreviewImageCard = {
    ...fallbackCard,
    path: "/media/future-dzn-social-card.png",
    alt: "DZN future public player profile social card",
  };
  const metadata = buildPublicPlayerProfileSharePreviewMetadata({
    requestUrl: "https://dzn.example/players/fallback-image?share_card=future-dzn-social-card",
    response: publicProfileResponse("fallback-image", "DZN Fallback Runner"),
    imageCards: [unavailableFutureCard],
    availablePublicImagePaths: [fallbackCard.path],
  });

  assert.equal(metadata.image_card.resolution, "fallback_asset");
  assert.equal(metadata.image_card.path, fallbackCard.path);
  assert.equal(metadata.image_card.href, "https://dzn.example/media/dzn-cinematic-survivor.png");

  const html = injectPublicPlayerProfileSharePreviewMetadataForTest(STATIC_PROFILE_SHELL, metadata);
  return headSnapshotFromHtml({
    key: "fallback_image",
    route: "/players/fallback-image",
    response: new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }),
    html,
    assetPath: "/players/preview.html",
    writeQueries: 0,
  });
}

function headSnapshotFromHtml(input: {
  key: VisualCrawlerCaseKey;
  route: string;
  response: Response;
  html: string;
  assetPath: string;
  writeQueries: number;
}): HeadSnapshot {
  const head = extractHead(input.html);
  return {
    key: input.key,
    route: input.route,
    status: input.response.status,
    content_type: input.response.headers.get("content-type"),
    cache_control: input.response.headers.get("cache-control"),
    asset_path: input.assetPath,
    title: decodeHtml(extractTitle(head)),
    description: decodeHtml(extractMeta(head, "name", "description")),
    canonical: decodeHtml(extractLink(head, "canonical")),
    robots: decodeHtml(extractMeta(head, "name", "robots")),
    og_type: decodeHtml(extractMeta(head, "property", "og:type")),
    og_site_name: decodeHtml(extractMeta(head, "property", "og:site_name")),
    og_title: decodeHtml(extractMeta(head, "property", "og:title")),
    og_description: decodeHtml(extractMeta(head, "property", "og:description")),
    og_url: decodeHtml(extractMeta(head, "property", "og:url")),
    og_image: decodeHtml(extractMeta(head, "property", "og:image")),
    og_image_alt: decodeHtml(extractMeta(head, "property", "og:image:alt")),
    twitter_card: decodeHtml(extractMeta(head, "name", "twitter:card")),
    twitter_title: decodeHtml(extractMeta(head, "name", "twitter:title")),
    twitter_description: decodeHtml(extractMeta(head, "name", "twitter:description")),
    twitter_image: decodeHtml(extractMeta(head, "name", "twitter:image")),
    twitter_image_alt: decodeHtml(extractMeta(head, "name", "twitter:image:alt")),
    fallback_copy: decodeHtml(extractMeta(head, "name", "dzn:share-preview-copy")),
    preview_source: decodeHtml(extractMeta(head, "name", "dzn:share-preview-source")),
    duplicate_managed_tags: hasDuplicateManagedTags(head) as false,
    body_shell_preserved: input.html.includes("<main id=\"public-profile-shell\">Client app shell remains available.</main>") as true,
    write_queries: input.writeQueries,
  };
}

function renderSocialCardPreviews(snapshots: Map<VisualCrawlerCaseKey, HeadSnapshot>) {
  const previews: SocialCardPreview[] = [];
  for (const snapshot of snapshots.values()) {
    previews.push(renderSocialCardPreview(snapshot, "open_graph"));
    previews.push(renderSocialCardPreview(snapshot, "twitter"));
  }
  return previews;
}

function renderSocialCardPreview(snapshot: HeadSnapshot, platform: SocialCardPreview["platform"]): SocialCardPreview {
  const imageUrl = platform === "open_graph" ? snapshot.og_image : snapshot.twitter_image;
  const imageAlt = platform === "open_graph" ? snapshot.og_image_alt : snapshot.twitter_image_alt;
  const title = platform === "open_graph" ? snapshot.og_title : snapshot.twitter_title;
  const description = platform === "open_graph" ? snapshot.og_description : snapshot.twitter_description;
  const url = platform === "open_graph" ? snapshot.og_url : snapshot.canonical;
  const asset = imageInfoForPublicUrl(imageUrl);
  const html = [
    `<article class="dzn-social-card-preview dzn-social-card-preview--${platform}" role="img" aria-label="${escapeHtmlAttribute(title)}">`,
    `<img src="${escapeHtmlAttribute(imageUrl)}" alt="${escapeHtmlAttribute(imageAlt)}" width="${asset.width}" height="${asset.height}">`,
    `<strong>${escapeHtmlText(title)}</strong>`,
    `<p>${escapeHtmlText(description)}</p>`,
    `<small>${escapeHtmlText(new URL(url).hostname)}</small>`,
    "</article>",
  ].join("");

  return {
    key: snapshot.key,
    platform,
    route: snapshot.route,
    title,
    description,
    url,
    image_url: imageUrl,
    image_alt: imageAlt,
    image_width: asset.width,
    image_height: asset.height,
    image_mime: asset.mime,
    card_type: "summary_large_image",
    robots: snapshot.robots,
    html,
  };
}

function assertCrawlerFriendlySnapshots(snapshots: Map<VisualCrawlerCaseKey, HeadSnapshot>) {
  const fallbackCard = PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS[0];
  assert.equal(snapshots.size, 5, "Visual crawler QA must cover published, hidden, invalid, unavailable, and fallback-image states.");

  for (const [key, snapshot] of snapshots.entries()) {
    assert.equal(snapshot.status, 200, `${key} should render the profile shell for crawler preview.`);
    assert.equal(snapshot.content_type, "text/html; charset=utf-8", `${key} should return HTML.`);
    assert.equal(snapshot.cache_control, "no-store", `${key} should remain no-store.`);
    assert.equal(snapshot.asset_path, "/players/preview.html", `${key} should render the exported profile shell.`);
    assert.equal(snapshot.duplicate_managed_tags, false, `${key} should not duplicate crawler-managed head tags.`);
    assert.equal(snapshot.body_shell_preserved, true, `${key} should preserve the public profile app shell.`);
    assert.equal(snapshot.write_queries, 0, `${key} should not perform DB writes.`);
    assert.equal(snapshot.og_site_name, "DZN Network", `${key} Open Graph site name should be DZN Network.`);
    assert.equal(snapshot.twitter_card, "summary_large_image", `${key} Twitter card must be crawler-friendly.`);
    assert.equal(snapshot.og_image, "https://dzn.example/media/dzn-cinematic-survivor.png", `${key} Open Graph image should use the default DZN share card.`);
    assert.equal(snapshot.twitter_image, snapshot.og_image, `${key} Twitter image should match Open Graph image.`);
    assert.equal(snapshot.og_image_alt, fallbackCard.alt, `${key} Open Graph image alt should use public-safe catalog text.`);
    assert.equal(snapshot.twitter_image_alt, fallbackCard.alt, `${key} Twitter image alt should match Open Graph image alt.`);
    assert.equal(snapshot.title, snapshot.og_title, `${key} title should match Open Graph title.`);
    assert.equal(snapshot.description, snapshot.og_description, `${key} description should match Open Graph description.`);
    assert.equal(snapshot.description, snapshot.twitter_description, `${key} description should match Twitter description.`);
    assert.equal(snapshot.fallback_copy, snapshot.description, `${key} fallback preview copy should match the visible card description.`);
    assert.equal(snapshot.title.length <= 70, true, `${key} title should stay crawler-card friendly.`);
    assert.equal(snapshot.description.length <= 180, true, `${key} description should stay crawler-card friendly.`);
    assertPublicImageUrl(snapshot.og_image);
    assertPublicImageUrl(snapshot.twitter_image);
  }

  assert.equal(snapshots.get("published")?.robots, "index,follow");
  assert.equal(snapshots.get("published")?.preview_source, "public_profile_payload");
  assert.equal(snapshots.get("published")?.og_type, "profile");
  assert.equal(snapshots.get("published")?.canonical, "https://dzn.example/players/published-survivor");

  assert.equal(snapshots.get("fallback_image")?.robots, "index,follow");
  assert.equal(snapshots.get("fallback_image")?.preview_source, "public_profile_payload");
  assert.equal(snapshots.get("fallback_image")?.canonical, "https://dzn.example/players/fallback-image");

  for (const key of ["hidden", "invalid", "unavailable"] as const) {
    const snapshot = snapshots.get(key);
    assert.equal(snapshot?.robots, "noindex,nofollow", `${key} should use crawler-safe noindex fallback metadata.`);
    assert.equal(snapshot?.preview_source, "generic_fallback", `${key} should use generic fallback metadata.`);
    assert.equal(snapshot?.og_type, "website", `${key} should not claim to be a public profile.`);
  }
}

function assertCrawlerFriendlyPreviewCards(previews: SocialCardPreview[]) {
  assert.equal(previews.length, 10, "Visual crawler QA should render Open Graph and Twitter cards for every state.");

  for (const preview of previews) {
    assert.equal(preview.card_type, "summary_large_image");
    assert.equal(preview.image_width >= 1200, true, `${preview.key} ${preview.platform} image should be at least 1200px wide.`);
    assert.equal(preview.image_height >= 630, true, `${preview.key} ${preview.platform} image should be at least 630px high.`);
    assert.equal(preview.image_mime, "image/png");
    assert.equal(preview.image_alt, PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS[0].alt);
    assert.equal(preview.html.includes(`src="${preview.image_url}"`), true, `${preview.key} ${preview.platform} preview should render the final head image URL.`);
    assert.equal(preview.html.includes(`alt="${preview.image_alt}"`), true, `${preview.key} ${preview.platform} preview should render the final head image alt.`);
    assert.equal(preview.html.includes(`aria-label="${escapeHtmlAttribute(preview.title)}"`), true, `${preview.key} ${preview.platform} preview should expose a screen-reader label.`);
    assert.equal(preview.html.includes("<script"), false, `${preview.key} ${preview.platform} preview must not add scripts.`);
    assert.equal(preview.html.includes("<form"), false, `${preview.key} ${preview.platform} preview must not add forms.`);
    assert.doesNotMatch(
      preview.html,
      /localStorage|sessionStorage|indexedDB|sendBeacon|gtag|dataLayer|posthog|mixpanel|amplitude|plausible|trackEvent|analytics|logShare|auditShare/i,
      `${preview.key} ${preview.platform} rendered preview must not add tracking or storage hooks.`,
    );
  }
}

function assertNoHiddenFields(snapshots: Map<VisualCrawlerCaseKey, HeadSnapshot>, previews: SocialCardPreview[]) {
  const crawlerVisibleText = [
    JSON.stringify([...snapshots.values()]),
    JSON.stringify(previews),
  ].join("\n");

  for (const forbidden of [
    "hidden_legend",
    "999,999",
    "99 challenges",
    "hidden-private-user",
    "discord_999999",
    "internal-user-id",
    "source_id=do-not-leak",
    "raw_award_evidence=do-not-leak",
    "raw evidence payload",
    "exact_award_time",
    "owner_admin",
    "retained_export",
    "billing_plan",
    "checkout_session",
    "server_wars_score",
    "ctf_score",
    "event_internal",
    "future-dzn-social-card",
  ]) {
    assert.equal(crawlerVisibleText.includes(forbidden), false, `Rendered crawler card snapshots must not leak ${forbidden}.`);
  }
}

function assertNoTrackingOrMutationPaths(snapshots: Map<VisualCrawlerCaseKey, HeadSnapshot>) {
  for (const snapshot of snapshots.values()) {
    assert.equal(snapshot.write_queries, 0, `${snapshot.route} must not write database rows.`);
  }

  const runtimeSources = [
    read(PUBLIC_PROFILE_SHELL),
    read(PUBLIC_PROFILE_HELPER),
    read("app/players/[handle]/page.tsx"),
  ].join("\n").replace(/env\.ASSETS\.fetch/g, "assetFetch");

  assert.doesNotMatch(
    runtimeSources,
    /localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|XMLHttpRequest|gtag|dataLayer|posthog|mixpanel|amplitude|plausible|trackEvent|analytics|logShare|auditShare/i,
    "Crawler visual preview must not add share history, browser persistence, analytics, tracking, or audit calls.",
  );
  assert.doesNotMatch(
    runtimeSources,
    /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN|DZN_LIVE_CHECKOUT_ENABLED\s*=\s*true/i,
    "Crawler visual preview must not add writes, checkout, Nitrado, Discord, or live checkout behavior.",
  );
  assertNoSqlWrites(runtimeSources, "Crawler visual preview metadata must remain read-only.");
}

function assertProtectedSystemsStayIndependent() {
  for (const file of protectedInfluenceFiles()) {
    if (!existsSync(file)) continue;
    const source = read(file);
    assert.doesNotMatch(
      source,
      /DZN-ShareCardVisualSmoke|share-card-crawler-visual|dzn-social-card-preview|renderSocialCardPreview|SocialCardPreview/i,
      `${file} must not depend on public profile share-card crawler visual QA.`,
    );
  }

  const fairness = playerProfilePrivacyFairness();
  assert.equal(fairness.paid_plan_influence, false);
  assert.equal(fairness.ranking_influence, false);
  assert.equal(fairness.discovery_score_influence, false);
  assert.equal(fairness.review_score_influence, false);
  assert.equal(fairness.badge_influence, false);
  assert.equal(fairness.season_influence, false);
  assert.equal(fairness.event_influence, false);
  assert.equal(fairness.server_wars_influence, false);
  assert.equal(fairness.xp_award_influence, false);
  assert.equal(fairness.calling_card_award_influence, false);
  assert.equal(fairness.competitive_eligibility_influence, false);
}

function assertDocumentationContracts() {
  const docs = [
    read(MASTER_SPEC),
    read(PUBLIC_ACCESS_POLICY),
    read(PREVIOUS_HANDOFF),
    read(HANDOFF_DOC),
  ].join("\n");

  for (const snippet of [
    "Public Profile Share-Card Crawler Visual QA Slice",
    "published, hidden, invalid, unavailable, and fallback-image states",
    "rendered social-card preview",
    "correct image URL and alt text",
    "no hidden sections",
    "no analytics/tracking calls",
    "no stored share history",
    "Live checkout remains disabled",
    "Issue #49 remains reserved",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }

  const packageJson = read("package.json");
  assert.equal(
    packageJson.includes("test:public-profile-share-card-crawler-visual-qa"),
    true,
    "Focused share-card crawler visual QA test must be wired into package scripts.",
  );
}

class PublicProfileVisualQaDb {
  readonly writeQueries: string[] = [];
  readonly readQueries: string[] = [];

  constructor(private readonly mode: "published" | "hidden") {}

  prepare(sql: string) {
    const normalized = normalizeSql(sql);
    if (isWriteSql(normalized)) {
      this.writeQueries.push(normalized);
      throw new Error("Visual QA fake DB is read-only.");
    }
    this.readQueries.push(normalized);
    return new PublicProfileVisualQaStatement(this, normalized);
  }

  async first<T>(sql: string, bindings: unknown[]): Promise<T | null> {
    if (sql.includes("player_profile_privacy_preferences.public_handle = ?")) {
      const handle = String(bindings[0] ?? "");
      if (this.mode === "published" && handle === "published-survivor") {
        return {
          user_id: "public-user-visual-001",
          username: "DZN Pathfinder <private>",
          public_handle: "published-survivor",
        } as T;
      }
      return null;
    }

    if (sql.includes("from player_profile_privacy_preferences") && sql.includes("where user_id = ?")) {
      const userId = String(bindings[0] ?? "");
      if (this.mode === "published" && userId === "public-user-visual-001") {
        return {
          public_handle: "published-survivor",
          public_profile_enabled: 1,
          show_xp: 1,
          show_challenge_progress: 1,
          show_calling_cards: 1,
          show_award_dates: 0,
          show_discord_identity: 0,
          show_source_details: 0,
          updated_at: "2026-08-26T10:00:00.000Z",
        } as T;
      }
      return null;
    }

    if (sql.includes("from player_xp_ledger")) {
      return { total_xp: 2450 } as T;
    }

    return null;
  }

  async all<T>(sql: string, bindings: unknown[]): Promise<{ results: T[] }> {
    void bindings;
    if (sql.includes("from player_challenges")) {
      return {
        results: [
          {
            id: "qa-survivor-proof",
            slug: "qa-survivor-proof",
            title: "Crawler Survivor Proof",
            description: "Visible challenge summary for crawler metadata.",
            category: "community",
            status: "active",
            reward_xp: 100,
            calling_card_code: "crawler_scout",
            calling_card_name: "Crawler Scout",
            calling_card_description: "Visible card reward name only.",
            calling_card_rarity: "earned",
            target_value: 1,
            sort_order: 10,
            starts_at: null,
            ends_at: null,
          },
          {
            id: "qa-hidden-decoy",
            slug: "qa-hidden-decoy",
            title: "hidden_legend",
            description: "raw evidence payload",
            category: "private",
            status: "active",
            reward_xp: 999999,
            calling_card_code: "hidden_private_card",
            calling_card_name: "hidden-private-user",
            calling_card_description: "exact_award_time",
            calling_card_rarity: "retained_export",
            target_value: 99,
            sort_order: 20,
            starts_at: null,
            ends_at: null,
          },
        ] as T[],
      };
    }

    if (sql.includes("from player_challenge_participations")) {
      return {
        results: [
          {
            challenge_id: "qa-survivor-proof",
            status: "completed",
            progress_value: 1,
            target_value: 1,
            xp_awarded: 100,
            calling_card_awarded: "crawler_scout",
            joined_at: "2026-08-20T12:00:00.000Z",
            completed_at: "2026-08-21T12:00:00.000Z",
            updated_at: "2026-08-21T12:00:00.000Z",
          },
        ] as T[],
      };
    }

    if (sql.includes("from player_calling_card_awards")) {
      return {
        results: [
          {
            calling_card_code: "crawler_scout",
            calling_card_name: "Crawler Scout",
            calling_card_description: "Visible public calling card.",
            calling_card_rarity: "earned",
            awarded_at: "2026-08-21T12:00:00.000Z",
          },
          {
            calling_card_code: "qa_pathfinder",
            calling_card_name: "QA Pathfinder",
            calling_card_description: "Visible public calling card.",
            calling_card_rarity: "earned",
            awarded_at: "2026-08-22T12:00:00.000Z",
          },
        ] as T[],
      };
    }

    if (sql.includes("where player_profile_privacy_preferences.user_id in")) {
      return {
        results: [
          {
            user_id: "public-user-visual-001",
            username: "DZN Pathfinder <private>",
            public_handle: "published-survivor",
          },
        ] as T[],
      };
    }

    return { results: [] };
  }
}

class PublicProfileVisualQaStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: PublicProfileVisualQaDb,
    private readonly sql: string,
  ) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  first<T>() {
    return this.db.first<T>(this.sql, this.bindings);
  }

  all<T>() {
    return this.db.all<T>(this.sql, this.bindings);
  }

  run() {
    this.db.writeQueries.push(this.sql);
    throw new Error("Visual QA fake DB is read-only.");
  }
}

function publicProfileResponse(handle: string, displayName: string): PublicPlayerProfileResponse {
  const fairness = playerProfilePrivacyFairness();
  return {
    status: 200,
    payload: {
      ok: true,
      profile: {
        handle,
        display_name: displayName,
        avatar_initial: displayName.slice(0, 1).toUpperCase() || "D",
        public_href: `/players/${handle}`,
        public_api_href: `/api/public/player-profiles/${handle}`,
      },
      visibility: {
        mode: "public_viewer",
        xp: true,
        challenge_progress: true,
        calling_cards: true,
        award_dates: "hidden",
        private_identifiers: "hidden",
        raw_award_evidence: "hidden",
        exact_award_times: "hidden",
      },
      sections: {
        xp: {
          total_xp: 2450,
          profile_level: 7,
          level_label: "Veteran Track",
          xp_to_next_level: 550,
        },
        challenge_progress: {
          joined_challenges: 2,
          completed_challenges: 1,
          items: [],
        },
        calling_cards: {
          count: 2,
          items: [],
        },
        timeline: [],
      },
      fairness,
      fetched_at: "2026-08-26T00:00:00.000Z",
    },
  };
}

function imageInfoForPublicUrl(imageUrl: string): ImageInfo {
  const url = new URL(imageUrl);
  assert.equal(url.origin, "https://dzn.example", "Crawler preview images must stay same-origin in local QA.");
  assert.equal(url.search, "", "Crawler preview image URLs must not contain query strings.");
  assert.equal(url.hash, "", "Crawler preview image URLs must not contain fragments.");
  assert.equal(url.pathname, PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS[0].path);
  return readImageInfo(publicAssetPath(url.pathname));
}

function readImageInfo(filePath: string): ImageInfo {
  const buffer = readFileSync(filePath);
  assert.equal(buffer.length > 1024, true, `${filePath} should not be an empty placeholder image.`);
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR", `${filePath} PNG must contain an IHDR chunk.`);
    return {
      mime: "image/png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      bytes: buffer.length,
    };
  }
  throw new Error(`${filePath} should be a PNG share-card asset for this visual QA slice.`);
}

function assertPublicImageUrl(value: string) {
  const url = new URL(value);
  assert.equal(url.origin, "https://dzn.example", `${value} must stay on the public DZN origin in local QA.`);
  assert.equal(url.pathname, "/media/dzn-cinematic-survivor.png", `${value} must use the static DZN share-card image.`);
  assert.equal(url.search, "", `${value} must not include query strings.`);
  assert.equal(url.hash, "", `${value} must not include fragments.`);
}

function publicAssetPath(publicPath: string) {
  assert.equal(publicPath.startsWith("/"), true, `${publicPath} must be root-relative.`);
  return join("public", ...publicPath.split("/").filter(Boolean));
}

function extractHead(html: string) {
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  assert.ok(match, "Rendered profile shell should contain a head element.");
  return match[1];
}

function extractTitle(head: string) {
  const match = head.match(/<title>([\s\S]*?)<\/title>/i);
  assert.ok(match, "Crawler head should include a title tag.");
  return match[1];
}

function extractMeta(head: string, selectorAttr: "name" | "property", selectorValue: string) {
  const tag = findTag(head, "meta", selectorAttr, selectorValue);
  return extractAttribute(tag, "content");
}

function extractLink(head: string, relValue: string) {
  const tag = findTag(head, "link", "rel", relValue);
  return extractAttribute(tag, "href");
}

function findTag(head: string, tagName: "meta" | "link", selectorAttr: string, selectorValue: string) {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*\\b${escapeRegExp(selectorAttr)}=["']${escapeRegExp(selectorValue)}["'][^>]*>`, "i");
  const match = head.match(tagPattern);
  assert.ok(match, `Crawler head should include <${tagName} ${selectorAttr}="${selectorValue}">.`);
  return match[0];
}

function extractAttribute(tag: string, attribute: string) {
  const attrPattern = new RegExp(`\\b${escapeRegExp(attribute)}=(["'])(.*?)\\1`, "i");
  const match = tag.match(attrPattern);
  assert.ok(match, `${tag} should include ${attribute}.`);
  return match[2];
}

function hasDuplicateManagedTags(head: string) {
  const checks = [
    /<title>/gi,
    /<meta\b[^>]*\bname=["']description["']/gi,
    /<link\b[^>]*\brel=["']canonical["']/gi,
    /<meta\b[^>]*\bname=["']robots["']/gi,
    /<meta\b[^>]*\bproperty=["']og:title["']/gi,
    /<meta\b[^>]*\bproperty=["']og:image["']/gi,
    /<meta\b[^>]*\bproperty=["']og:image:alt["']/gi,
    /<meta\b[^>]*\bname=["']twitter:card["']/gi,
    /<meta\b[^>]*\bname=["']twitter:image["']/gi,
    /<meta\b[^>]*\bname=["']twitter:image:alt["']/gi,
    /<meta\b[^>]*\bname=["']dzn:share-preview-source["']/gi,
  ];
  return checks.some((pattern) => (head.match(pattern) ?? []).length !== 1);
}

function protectedInfluenceFiles() {
  return [
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
    "functions/api/billing/readiness.ts",
    "functions/_lib/server-ranking.ts",
    "functions/_lib/public-leaderboards.ts",
    "functions/_lib/server-visibility.ts",
    "functions/_lib/server-reviews.ts",
    "functions/_lib/review-moderation.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/cron/player-progression/awards.ts",
    "functions/_lib/player-progression.ts",
    "functions/_lib/player-profile-progression.ts",
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

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function isWriteSql(sql: string) {
  return /\b(insert|update|delete|drop|alter|create|replace)\b/.test(sql) || /\.run\(/.test(sql);
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeHtmlAttribute(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
