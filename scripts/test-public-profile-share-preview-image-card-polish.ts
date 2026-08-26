import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildPublicPlayerProfileSharePreviewMetadata,
  PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS,
  resolvePublicPlayerProfileSharePreviewImageCard,
  type PublicPlayerProfileResponse,
  type PublicPlayerProfileSharePreviewImageCard,
} from "../functions/_lib/public-player-profile";
import { playerProfilePrivacyFairness } from "../functions/_lib/player-profile-privacy";

const PUBLIC_PROFILE_HELPER = "functions/_lib/public-player-profile.ts";
const PUBLIC_PROFILE_SHELL = "functions/players/[handle].ts";
const PUBLIC_PROFILE_IMAGE = "public/media/dzn-cinematic-survivor.png";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PREVIOUS_HANDOFF = "docs/PUBLIC_PROFILE_SHARE_PREVIEW_CRAWLER_QA_HANDOFF.md";
const HANDOFF_DOC = "docs/PUBLIC_PROFILE_SHARE_PREVIEW_IMAGE_CARD_POLISH_HANDOFF.md";

type ImageInfo = {
  mime: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  bytes: number;
};

type ShareCardAssetSnapshot = {
  path: string;
  public_path: string;
  exported_path_checked: string | null;
  mime: ImageInfo["mime"];
  width: number;
  height: number;
  bytes: number;
  alt: string;
  twitter_card: "summary_large_image";
  min_width: number;
  min_height: number;
  crawler_friendly: true;
  public_safe_static_asset: true;
};

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

function main() {
  assertStaticContracts();
  const snapshots = assertShareCardAssets();
  assertMetadataUsesShareCardCatalog(snapshots);
  assertFutureShareCardFallback();
  assertNoHiddenProfileFieldsInCardMetadata();
  assertProtectedSystemsStayIndependent();
  assertDocumentationContracts();
  console.log("Public profile share preview image/card polish tests passed.");
}

function assertStaticContracts() {
  for (const path of [PUBLIC_PROFILE_HELPER, PUBLIC_PROFILE_SHELL, PUBLIC_PROFILE_IMAGE, MASTER_SPEC, PREVIOUS_HANDOFF, HANDOFF_DOC]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  assert.equal(
    PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS.length >= 1,
    true,
    "At least one public profile share-card asset must be registered.",
  );

  const publicHelper = read(PUBLIC_PROFILE_HELPER);
  for (const snippet of [
    "PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS",
    "resolvePublicPlayerProfileSharePreviewImageCard",
    "image_card: PublicPlayerProfileSharePreviewResolvedImageCard",
    "public_safe_static_asset: true",
    "profile_data_embedded: false",
    "hidden_sections: \"not_used\"",
    "raw_award_evidence: \"not_used\"",
    "summary_large_image",
    "/media/dzn-cinematic-survivor.png",
  ]) {
    assert.equal(publicHelper.includes(snippet), true, `Public profile helper must include ${snippet}.`);
  }

  const shell = read(PUBLIC_PROFILE_SHELL);
  for (const snippet of [
    "meta property=\"og:image\"",
    "meta property=\"og:image:alt\"",
    "meta name=\"twitter:image\"",
    "meta name=\"twitter:image:alt\"",
  ]) {
    assert.equal(shell.includes(snippet), true, `Public profile shell must include ${snippet}.`);
  }
}

function assertShareCardAssets(): ShareCardAssetSnapshot[] {
  const snapshots: ShareCardAssetSnapshot[] = [];
  const seenPaths = new Set<string>();
  const catalogPaths = new Set<string>(PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS.map((card) => card.path));

  assert.equal(
    catalogPaths.has("/media/dzn-cinematic-survivor.png"),
    true,
    "The DZN cinematic survivor card must remain the default public profile share preview image.",
  );

  const helperMediaRefs = Array.from(read(PUBLIC_PROFILE_HELPER).matchAll(/["'](\/media\/[^"']+\.(?:png|jpe?g|webp))["']/gi)).map(
    (match) => match[1],
  );
  for (const ref of helperMediaRefs) {
    assert.equal(catalogPaths.has(ref), true, `${ref} must be registered in PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS.`);
  }

  for (const card of PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS) {
    assert.equal(seenPaths.has(card.path), false, `${card.path} must not be duplicated in the share-card catalog.`);
    seenPaths.add(card.path);
    assertSafeCardContract(card);

    const publicPath = publicAssetPath(card.path, "public");
    assert.equal(existsSync(publicPath), true, `${card.path} must exist in static public assets.`);
    const info = readImageInfo(publicPath);
    assert.equal(info.width >= card.min_width, true, `${card.path} must be at least ${card.min_width}px wide.`);
    assert.equal(info.height >= card.min_height, true, `${card.path} must be at least ${card.min_height}px high.`);
    assert.equal(info.bytes > 1024, true, `${card.path} must not be an empty placeholder image.`);

    let exportedPathChecked: string | null = null;
    if (existsSync("out")) {
      const exportedPath = publicAssetPath(card.path, "out");
      exportedPathChecked = exportedPath;
      assert.equal(existsSync(exportedPath), true, `${card.path} must be copied to exported static assets when out/ exists.`);
      const exportedInfo = readImageInfo(exportedPath);
      assert.deepEqual(
        { width: exportedInfo.width, height: exportedInfo.height, mime: exportedInfo.mime },
        { width: info.width, height: info.height, mime: info.mime },
        `${card.path} exported asset dimensions must match public source dimensions.`,
      );
    }

    snapshots.push({
      path: card.path,
      public_path: publicPath,
      exported_path_checked: exportedPathChecked,
      mime: info.mime,
      width: info.width,
      height: info.height,
      bytes: info.bytes,
      alt: card.alt,
      twitter_card: card.twitter_card,
      min_width: card.min_width,
      min_height: card.min_height,
      crawler_friendly: true,
      public_safe_static_asset: card.privacy.public_safe_static_asset,
    });
  }

  return snapshots;
}

function assertMetadataUsesShareCardCatalog(snapshots: ShareCardAssetSnapshot[]) {
  const availablePaths = snapshots.map((snapshot) => snapshot.path);
  const metadata = buildPublicPlayerProfileSharePreviewMetadata({
    requestUrl: "https://dzn.example/players/cinematic-survivor?share=discord",
    response: publicProfileResponse(),
    availablePublicImagePaths: availablePaths,
  });
  const defaultCard = PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS[0];

  assert.equal(metadata.image_card.path, defaultCard.path);
  assert.equal(metadata.image_card.href, "https://dzn.example/media/dzn-cinematic-survivor.png");
  assert.equal(metadata.image_card.alt, defaultCard.alt);
  assert.equal(metadata.image_card.resolution, "configured_asset");
  assert.equal(metadata.image_card.asset_available, true);
  assert.equal(metadata.image_card.privacy.public_safe_static_asset, true);
  assert.equal(metadata.image_card.privacy.profile_data_embedded, false);
  assert.equal(metadata.image_card.privacy.hidden_sections, "not_used");
  assert.equal(metadata.image_card.privacy.raw_award_evidence, "not_used");
  assert.equal(metadata.image_href, metadata.image_card.href);
  assert.equal(metadata.image_alt, metadata.image_card.alt);
  assert.equal(metadata.open_graph.image, metadata.image_card.href);
  assert.equal(metadata.open_graph.image_alt, metadata.image_card.alt);
  assert.equal(metadata.twitter.card, metadata.image_card.twitter_card);
  assert.equal(metadata.twitter.image, metadata.image_card.href);
  assert.equal(metadata.twitter.image_alt, metadata.image_card.alt);
  assertFairnessUnchanged(metadata.fairness);
}

function assertFutureShareCardFallback() {
  const fallbackCard = PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS[0];
  const missingFutureCard: PublicPlayerProfileSharePreviewImageCard = {
    ...fallbackCard,
    path: "/media/future-dzn-share-card.png",
    alt: "DZN future public player profile preview",
  };
  const invalidFutureCard = {
    ...fallbackCard,
    path: "https://tracker.example/share-card.png",
    alt: "",
  } as PublicPlayerProfileSharePreviewImageCard;
  const incompleteFutureCard = {
    path: "/media/future-incomplete-share-card.png",
    alt: "DZN incomplete public player profile preview",
    twitter_card: "summary_large_image",
    min_width: 1200,
    min_height: 630,
    purpose: "public_profile_share_preview",
    asset_scope: "static_public_asset",
  } as PublicPlayerProfileSharePreviewImageCard;

  for (const candidates of [[missingFutureCard], [invalidFutureCard], [incompleteFutureCard]]) {
    const resolved = resolvePublicPlayerProfileSharePreviewImageCard({
      requestUrl: "https://dzn.example/players/fallback-check",
      candidates,
      availablePublicPaths: [fallbackCard.path],
    });

    assert.equal(resolved.path, fallbackCard.path);
    assert.equal(resolved.href, "https://dzn.example/media/dzn-cinematic-survivor.png");
    assert.equal(resolved.alt, fallbackCard.alt);
    assert.equal(resolved.resolution, "fallback_asset");
    assert.equal(resolved.asset_available, true);
    assert.equal(resolved.privacy.public_safe_static_asset, true);
    assert.equal(resolved.privacy.profile_data_embedded, false);
  }

  const metadata = buildPublicPlayerProfileSharePreviewMetadata({
    requestUrl: "https://dzn.example/players/fallback-check",
    response: null,
    imageCards: [missingFutureCard],
    availablePublicImagePaths: [fallbackCard.path],
  });
  assert.equal(metadata.source, "generic_fallback");
  assert.equal(metadata.robots, "noindex,nofollow");
  assert.equal(metadata.image_card.path, fallbackCard.path);
  assert.equal(metadata.image_card.resolution, "fallback_asset");
  assert.equal(metadata.image_card.asset_available, true);
  assert.doesNotMatch(JSON.stringify(metadata), /future-dzn-share-card|tracker\.example/i);
}

function assertNoHiddenProfileFieldsInCardMetadata() {
  const metadata = buildPublicPlayerProfileSharePreviewMetadata({
    requestUrl: "https://dzn.example/players/private-proof?discord_id=do-not-leak&raw_award_evidence=hidden",
    response: publicProfileResponse(),
    availablePublicImagePaths: PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS.map((card) => card.path),
  });

  const crawlerVisibleCardText = [
    metadata.image_href,
    metadata.image_alt,
    metadata.open_graph.image,
    metadata.open_graph.image_alt,
    metadata.twitter.image,
    metadata.twitter.image_alt,
  ].join("\n");

  for (const forbidden of [
    /discord_id/i,
    /user_id/i,
    /source_id/i,
    /raw_award_evidence/i,
    /private-proof\?discord_id/i,
    /999999|999,999|Hidden Legendary|secret-badge|private evidence/i,
  ]) {
    assert.doesNotMatch(crawlerVisibleCardText, forbidden, `Image/card metadata must not expose ${forbidden}.`);
  }

  assertFairnessUnchanged(metadata.fairness);
}

function assertProtectedSystemsStayIndependent() {
  const runtimeSources = [read(PUBLIC_PROFILE_HELPER), read(PUBLIC_PROFILE_SHELL).replace(/env\.ASSETS\.fetch/g, "assetFetch")].join("\n");
  assert.doesNotMatch(
    runtimeSources,
    /localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|gtag\(|dataLayer|posthog|mixpanel|amplitude|plausible|trackEvent|logShare|auditShare|analytics\./i,
    "Share preview image/card metadata must not add persistence, tracking, analytics, or audit calls.",
  );
  assert.doesNotMatch(
    runtimeSources,
    /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i,
    "Share preview image/card metadata must not add writes, checkout, Nitrado, Discord, or live checkout behavior.",
  );
  assertNoSqlWrites(runtimeSources, "Share preview image/card metadata must remain read-only.");

  const protectedFiles = [
    "functions/_lib/server-ranking.ts",
    "functions/_lib/public-leaderboards.ts",
    "functions/_lib/server-reviews.ts",
    "functions/_lib/review-moderation.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/_lib/server-wars.ts",
    "functions/_lib/events.ts",
    "functions/_lib/owner-events.ts",
    "functions/_lib/player-profile-progression.ts",
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
    "functions/api/billing/readiness.ts",
  ].filter(existsSync);

  for (const file of protectedFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS|resolvePublicPlayerProfileSharePreviewImageCard|image_card/i,
      `${file} must not depend on public profile share-card preview metadata.`,
    );
  }
}

function assertDocumentationContracts() {
  const masterSpec = read(MASTER_SPEC);
  for (const snippet of [
    "Public Profile Share Preview Image/Card Polish Slice",
    "/media/dzn-cinematic-survivor.png",
    "PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS",
    "public-safe static share-card assets",
    "cannot expose hidden profile sections",
  ]) {
    assert.equal(masterSpec.includes(snippet), true, `Master spec must include ${snippet}.`);
  }

  const previousHandoff = read(PREVIOUS_HANDOFF);
  for (const snippet of [
    "Follow-On Public Profile Share Preview Image/Card Polish",
    "Branch: `codex/public-profile-share-preview-image-card-polish-20260826`",
    "test:public-profile-share-preview-image-card-polish",
  ]) {
    assert.equal(previousHandoff.includes(snippet), true, `Previous handoff must include ${snippet}.`);
  }

  const handoff = read(HANDOFF_DOC);
  for (const snippet of [
    "# Public Profile Share Preview Image/Card Polish Handoff",
    "public-safe social preview image quality check",
    "1983x793",
    "fallback_asset",
    "Live checkout remains disabled",
    "Issue #49 remains reserved",
  ]) {
    assert.equal(handoff.includes(snippet), true, `Image/card handoff must include ${snippet}.`);
  }
}

function assertSafeCardContract(card: PublicPlayerProfileSharePreviewImageCard) {
  assert.match(card.path, /^\/media\/[a-z0-9][a-z0-9._/-]*\.(?:png|jpe?g|webp)$/i, `${card.path} must be a local public media asset.`);
  assert.equal(card.path.includes(".."), false, `${card.path} must not traverse directories.`);
  assert.equal(card.path.includes("?"), false, `${card.path} must not include query strings.`);
  assert.equal(card.path.includes("#"), false, `${card.path} must not include fragments.`);
  assert.equal(card.alt.trim().length >= 12, true, `${card.path} alt text must be descriptive.`);
  assert.equal(card.alt.length <= 140, true, `${card.path} alt text must stay crawler-friendly.`);
  assert.equal(card.twitter_card, "summary_large_image");
  assert.equal(card.min_width >= 600, true, `${card.path} minimum width contract must be crawler-friendly.`);
  assert.equal(card.min_height >= 315, true, `${card.path} minimum height contract must be crawler-friendly.`);
  assert.equal(card.purpose, "public_profile_share_preview");
  assert.equal(card.asset_scope, "static_public_asset");
  assert.equal(card.privacy.public_safe_static_asset, true);
  assert.equal(card.privacy.profile_data_embedded, false);
  assert.equal(card.privacy.hidden_sections, "not_used");
  assert.equal(card.privacy.raw_award_evidence, "not_used");
  assert.doesNotMatch(card.alt, /discord|user id|source id|raw evidence|private|hidden xp|tracking|analytics/i);
}

function readImageInfo(filePath: string): ImageInfo {
  const buffer = readFileSync(filePath);
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") === pngSignature) {
    assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR", `${filePath} PNG must contain an IHDR chunk.`);
    return {
      mime: "image/png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      bytes: buffer.length,
    };
  }

  if (buffer.subarray(0, 2).toString("hex") === "ffd8") {
    return readJpegInfo(filePath, buffer);
  }

  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return readWebpInfo(filePath, buffer);
  }

  throw new Error(`${filePath} must be PNG, JPEG, or WebP.`);
}

function readJpegInfo(filePath: string, buffer: Buffer): ImageInfo {
  let offset = 2;
  while (offset + 8 < buffer.length) {
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      return {
        mime: "image/jpeg",
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
        bytes: buffer.length,
      };
    }
    offset += length;
  }
  throw new Error(`${filePath} JPEG dimensions could not be read.`);
}

function readWebpInfo(filePath: string, buffer: Buffer): ImageInfo {
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      mime: "image/webp",
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
      bytes: buffer.length,
    };
  }
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return {
      mime: "image/webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      bytes: buffer.length,
    };
  }
  if (chunk === "VP8 ") {
    return {
      mime: "image/webp",
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      bytes: buffer.length,
    };
  }
  throw new Error(`${filePath} WebP dimensions could not be read.`);
}

function publicAssetPath(publicPath: string, root: "public" | "out") {
  assert.equal(publicPath.startsWith("/"), true, `${publicPath} must be root-relative.`);
  return join(root, ...publicPath.split("/").filter(Boolean));
}

function publicProfileResponse(): PublicPlayerProfileResponse {
  const fairness = playerProfilePrivacyFairness();
  return {
    status: 200,
    payload: {
      ok: true,
      profile: {
        handle: "private-proof",
        display_name: "Cinematic Survivor",
        avatar_initial: "C",
        public_href: "/players/private-proof",
        public_api_href: "/api/public/player-profiles/private-proof",
      },
      visibility: {
        mode: "public_viewer",
        xp: false,
        challenge_progress: false,
        calling_cards: false,
        award_dates: "hidden",
        private_identifiers: "hidden",
        raw_award_evidence: "hidden",
        exact_award_times: "hidden",
      },
      sections: {
        xp: {
          total_xp: 999999,
          profile_level: 999,
          level_label: "Hidden Legendary",
          xp_to_next_level: 0,
        },
        challenge_progress: {
          joined_challenges: 99,
          completed_challenges: 88,
          items: [],
        },
        calling_cards: {
          count: 77,
          items: [
            {
              code: "secret-badge",
              name: "Private Evidence",
              description: "private evidence",
              rarity: "secret",
            },
          ],
        },
        timeline: [],
      },
      fairness,
      fetched_at: "2026-08-26T00:00:00.000Z",
    },
  };
}

function assertFairnessUnchanged(fairness: ReturnType<typeof playerProfilePrivacyFairness>) {
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

function assertNoSqlWrites(source: string, message: string) {
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i, message);
}

function read(path: string) {
  return readFileSync(path, "utf8");
}
