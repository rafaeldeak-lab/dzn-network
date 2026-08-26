import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { onRequestGet as publicProfileShellGet } from "../functions/players/[handle]";
import type { PagesContext } from "../functions/_lib/types";

const PUBLIC_PROFILE_SHELL = "functions/players/[handle].ts";
const PUBLIC_PROFILE_HELPER = "functions/_lib/public-player-profile.ts";
const PUBLIC_PROFILE_METADATA_TEST = "scripts/test-public-profile-share-preview-metadata-polish.ts";
const HANDOFF_DOC = "docs/PUBLIC_PROFILE_SHARE_PREVIEW_CRAWLER_QA_HANDOFF.md";

const STATIC_PROFILE_SHELL = [
  "<!doctype html>",
  "<html>",
  "<head>",
  "<title>Static Preview Shell</title>",
  "<meta name=\"description\" content=\"static profile fallback\">",
  "<meta property=\"og:title\" content=\"static og title\">",
  "<meta name=\"twitter:card\" content=\"summary\">",
  "<script>window.__DZN_APP_SHELL__ = true;</script>",
  "</head>",
  "<body>",
  "<main id=\"public-profile-shell\">Client app shell remains available.</main>",
  "</body>",
  "</html>",
].join("");

type CrawlerCase = {
  key: "published" | "hidden" | "invalid" | "unavailable";
  handle: string;
  requestUrl: string;
  dbMode: "published" | "hidden" | "unavailable";
};

type HeadSnapshot = {
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
  twitter_card: string;
  twitter_title: string;
  twitter_description: string;
  twitter_image: string;
  fallback_copy: string;
  preview_source: string;
  duplicate_managed_tags: false;
  body_shell_preserved: true;
  write_queries: number;
};

const CRAWLER_CASES: CrawlerCase[] = [
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

const EXPECTED_HEAD_SNAPSHOTS: Record<CrawlerCase["key"], Omit<HeadSnapshot, "asset_path">> = {
  published: {
    route: "/players/published-survivor",
    status: 200,
    content_type: "text/html; charset=utf-8",
    cache_control: "no-store",
    title: "DZN Pathfinder private | DZN Player Profile",
    description: "DZN Pathfinder private's public DZN profile: Veteran Track with 2,450 XP, 1 challenge completed, 2 calling cards. Private identifiers and raw award evidence stay hidden.",
    canonical: "https://dzn.example/players/published-survivor",
    robots: "index,follow",
    og_type: "profile",
    og_site_name: "DZN Network",
    og_title: "DZN Pathfinder private | DZN Player Profile",
    og_description: "DZN Pathfinder private's public DZN profile: Veteran Track with 2,450 XP, 1 challenge completed, 2 calling cards. Private identifiers and raw award evidence stay hidden.",
    og_url: "https://dzn.example/players/published-survivor",
    og_image: "https://dzn.example/media/dzn-cinematic-survivor.png",
    twitter_card: "summary_large_image",
    twitter_title: "DZN Pathfinder private | DZN Player Profile",
    twitter_description: "DZN Pathfinder private's public DZN profile: Veteran Track with 2,450 XP, 1 challenge completed, 2 calling cards. Private identifiers and raw award evidence stay hidden.",
    twitter_image: "https://dzn.example/media/dzn-cinematic-survivor.png",
    fallback_copy: "DZN Pathfinder private's public DZN profile: Veteran Track with 2,450 XP, 1 challenge completed, 2 calling cards. Private identifiers and raw award evidence stay hidden.",
    preview_source: "public_profile_payload",
    duplicate_managed_tags: false,
    body_shell_preserved: true,
    write_queries: 0,
  },
  hidden: genericFallbackSnapshot("/players/hidden-survivor", "https://dzn.example/players/hidden-survivor"),
  invalid: genericFallbackSnapshot("/players/bad!!handle", "https://dzn.example/players/bad!!handle"),
  unavailable: genericFallbackSnapshot("/players/published-survivor", "https://dzn.example/players/published-survivor"),
};

async function main() {
  assertStaticContracts();
  const snapshots = await renderCrawlerSnapshots();
  assertCrawlerHeadSnapshots(snapshots);
  assertCrawlerNoLeakage(snapshots);
  assertCrawlerNoTrackingOrWrites(snapshots);
  assertProtectedSystemsStayIndependent();
  assertDocumentationContracts();
  console.log("Public profile share preview crawler QA tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    PUBLIC_PROFILE_SHELL,
    PUBLIC_PROFILE_HELPER,
    PUBLIC_PROFILE_METADATA_TEST,
    "app/players/[handle]/page.tsx",
    "functions/api/public/player-profiles/[handle].ts",
    "components/player/public-player-profile-page.tsx",
    "components/player/public-profile-share-panel.tsx",
    HANDOFF_DOC,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const shell = read(PUBLIC_PROFILE_SHELL);
  for (const snippet of [
    "env.ASSETS.fetch",
    "getPublicPlayerProfilePayload",
    "buildPublicPlayerProfileSharePreviewMetadata",
    "injectPublicPlayerProfileSharePreviewMetadata",
    "meta property=\"og:title\"",
    "meta name=\"twitter:card\"",
    "meta name=\"dzn:share-preview-copy\"",
    "cache-control\", \"no-store\"",
    "withoutContentLengthHeader",
  ]) {
    assert.equal(shell.includes(snippet), true, `Profile shell route must include ${snippet}.`);
  }
}

async function renderCrawlerSnapshots() {
  const snapshots = new Map<CrawlerCase["key"], HeadSnapshot>();
  for (const crawlerCase of CRAWLER_CASES) {
    const assetRequests: string[] = [];
    const db = crawlerCase.dbMode === "unavailable" ? null : new PublicProfileCrawlerQaDb(crawlerCase.dbMode);
    const response = await publicProfileShellGet({
      request: new Request(crawlerCase.requestUrl, {
        headers: {
          "user-agent": "DZN-CrawlerSmoke/1.0",
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
    const head = extractHead(html);
    const route = new URL(crawlerCase.requestUrl).pathname;
    const snapshot: HeadSnapshot = {
      route,
      status: response.status,
      content_type: response.headers.get("content-type"),
      cache_control: response.headers.get("cache-control"),
      asset_path: assetRequests.join(","),
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
      twitter_card: decodeHtml(extractMeta(head, "name", "twitter:card")),
      twitter_title: decodeHtml(extractMeta(head, "name", "twitter:title")),
      twitter_description: decodeHtml(extractMeta(head, "name", "twitter:description")),
      twitter_image: decodeHtml(extractMeta(head, "name", "twitter:image")),
      fallback_copy: decodeHtml(extractMeta(head, "name", "dzn:share-preview-copy")),
      preview_source: decodeHtml(extractMeta(head, "name", "dzn:share-preview-source")),
      duplicate_managed_tags: hasDuplicateManagedTags(head) as false,
      body_shell_preserved: html.includes("<main id=\"public-profile-shell\">Client app shell remains available.</main>") as true,
      write_queries: db?.writeQueries.length ?? 0,
    };
    snapshots.set(crawlerCase.key, snapshot);
  }
  return snapshots;
}

function assertCrawlerHeadSnapshots(snapshots: Map<CrawlerCase["key"], HeadSnapshot>) {
  for (const crawlerCase of CRAWLER_CASES) {
    const snapshot = snapshots.get(crawlerCase.key);
    assert.ok(snapshot, `${crawlerCase.key} snapshot should be present.`);
    assert.equal(snapshot.asset_path, "/players/preview.html", `${crawlerCase.key} should render the exported profile shell.`);
    assert.deepEqual(
      withoutAssetPath(snapshot),
      EXPECTED_HEAD_SNAPSHOTS[crawlerCase.key],
      `${crawlerCase.key} final head metadata snapshot should match.`,
    );
  }
}

function assertCrawlerNoLeakage(snapshots: Map<CrawlerCase["key"], HeadSnapshot>) {
  const joined = JSON.stringify([...snapshots.values()]);
  for (const forbidden of [
    "hidden_legend",
    "999,999",
    "99 challenges",
    "hidden-private-user",
    "discord_999999",
    "internal-user-id",
    "source_id",
    "raw_award_evidence",
    "raw evidence payload",
    "exact_award_time",
    "owner_admin",
    "retained_export",
    "billing_plan",
    "checkout_session",
    "server_wars_score",
    "ctf_score",
    "event_internal",
  ]) {
    assert.equal(joined.includes(forbidden), false, `Crawler head snapshots must not leak ${forbidden}.`);
  }
}

function assertCrawlerNoTrackingOrWrites(snapshots: Map<CrawlerCase["key"], HeadSnapshot>) {
  for (const snapshot of snapshots.values()) {
    assert.equal(snapshot.write_queries, 0, `${snapshot.route} must not perform DB writes.`);
  }

  const runtimeSources = [
    read(PUBLIC_PROFILE_SHELL),
    read(PUBLIC_PROFILE_HELPER),
    read("app/players/[handle]/page.tsx"),
  ].join("\n").replace(/env\.ASSETS\.fetch/g, "assetFetch");

  assert.doesNotMatch(
    runtimeSources,
    /localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|XMLHttpRequest|gtag|dataLayer|posthog|mixpanel|amplitude|plausible|trackEvent|analytics|logShare|auditShare/i,
    "Crawler share-preview metadata must not add share history, browser persistence, analytics, tracking, or audit calls.",
  );
  assert.doesNotMatch(
    runtimeSources,
    /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN|DZN_LIVE_CHECKOUT_ENABLED\s*=\s*true/i,
    "Crawler share-preview metadata must not add writes, checkout, Nitrado, Discord, or live checkout behavior.",
  );
}

function assertProtectedSystemsStayIndependent() {
  for (const file of protectedInfluenceFiles()) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /CrawlerSmoke|share-preview-crawler|dzn:share-preview|og:title|twitter:card|buildPublicPlayerProfileSharePreviewMetadata|PublicPlayerProfileSharePreviewMetadata/i,
      `${file} must not depend on crawler share-preview metadata.`,
    );
  }
}

function assertDocumentationContracts() {
  const docs = [
    read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"),
    read("docs/PUBLIC_ACCESS_POLICY.md"),
    read("docs/PUBLIC_PROFILE_SHARE_PREVIEW_METADATA_POLISH_HANDOFF.md"),
    read(HANDOFF_DOC),
  ].join("\n");

  for (const snippet of [
    "Public Profile Share Preview Crawler QA Slice",
    "published, hidden, invalid, and unavailable profiles",
    "snapshots the final `<head>` metadata",
    "crawler-visible",
    "no hidden fields",
    "no analytics/tracking calls",
    "no stored share history",
    "Live checkout remains disabled",
    "Issue #49 remains reserved",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }

  assert.match(
    docs,
    /without hidden fields, analytics\/tracking calls, share-history storage, privacy writes, billing changes, scoring changes, ranking changes, review changes, badge\/season\/Server Wars changes, XP\/calling-card award changes, event changes, or competitive eligibility impact/i,
    "Docs must preserve the crawler QA isolation statement.",
  );

  const packageJson = read("package.json");
  assert.equal(
    packageJson.includes("test:public-profile-share-preview-crawler-qa"),
    true,
    "Focused crawler QA test must be wired into package scripts.",
  );
}

class PublicProfileCrawlerQaDb {
  readonly writeQueries: string[] = [];
  readonly readQueries: string[] = [];

  constructor(private readonly mode: "published" | "hidden") {}

  prepare(sql: string) {
    const normalized = normalizeSql(sql);
    if (isWriteSql(normalized)) {
      this.writeQueries.push(normalized);
      throw new Error("Crawler QA fake DB is read-only.");
    }
    this.readQueries.push(normalized);
    return new PublicProfileCrawlerQaStatement(this, normalized);
  }

  async first<T>(sql: string, bindings: unknown[]): Promise<T | null> {
    if (sql.includes("player_profile_privacy_preferences.public_handle = ?")) {
      const handle = String(bindings[0] ?? "");
      if (this.mode === "published" && handle === "published-survivor") {
        return {
          user_id: "public-user-001",
          username: "DZN Pathfinder <private>",
          public_handle: "published-survivor",
        } as T;
      }
      return null;
    }

    if (sql.includes("from player_profile_privacy_preferences") && sql.includes("where user_id = ?")) {
      const userId = String(bindings[0] ?? "");
      if (this.mode === "published" && userId === "public-user-001") {
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
            user_id: "public-user-001",
            username: "DZN Pathfinder <private>",
            public_handle: "published-survivor",
          },
        ] as T[],
      };
    }

    return { results: [] };
  }
}

class PublicProfileCrawlerQaStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: PublicProfileCrawlerQaDb,
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
    throw new Error("Crawler QA fake DB is read-only.");
  }
}

function genericFallbackSnapshot(route: string, canonical: string): Omit<HeadSnapshot, "asset_path"> {
  return {
    route,
    status: 200,
    content_type: "text/html; charset=utf-8",
    cache_control: "no-store",
    title: "DZN Player Profile | DZN Network",
    description: "View public DZN player profiles shared by their owners on DZN Network.",
    canonical,
    robots: "noindex,nofollow",
    og_type: "website",
    og_site_name: "DZN Network",
    og_title: "DZN Player Profile | DZN Network",
    og_description: "View public DZN player profiles shared by their owners on DZN Network.",
    og_url: canonical,
    og_image: "https://dzn.example/media/dzn-cinematic-survivor.png",
    twitter_card: "summary_large_image",
    twitter_title: "DZN Player Profile | DZN Network",
    twitter_description: "View public DZN player profiles shared by their owners on DZN Network.",
    twitter_image: "https://dzn.example/media/dzn-cinematic-survivor.png",
    fallback_copy: "View public DZN player profiles shared by their owners on DZN Network.",
    preview_source: "generic_fallback",
    duplicate_managed_tags: false,
    body_shell_preserved: true,
    write_queries: 0,
  };
}

function withoutAssetPath(snapshot: HeadSnapshot): Omit<HeadSnapshot, "asset_path"> {
  const { asset_path: assetPath, ...rest } = snapshot;
  void assetPath;
  return rest;
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
    /<meta\b[^>]*\bname=["']twitter:card["']/gi,
    /<meta\b[^>]*\bname=["']dzn:share-preview-source["']/gi,
  ];
  return checks.some((pattern) => (head.match(pattern) ?? []).length !== 1);
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function isWriteSql(sql: string) {
  return /\b(insert|update|delete|drop|alter|create|replace)\b/.test(sql) || /\.run\(/.test(sql);
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

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
