import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  buildPublicProfileShareCardCrawlerVisualQaEvidence,
  type HeadSnapshot,
  type SocialCardPreview,
  type VisualCrawlerCaseKey,
} from "./test-public-profile-share-card-crawler-visual-qa";

const ARTIFACT_DIR = "docs/artifacts/public-profile-social-preview-validation-package";
const ARTIFACT_JSON = `${ARTIFACT_DIR}/public-profile-social-preview-validation-package.json`;
const ARTIFACT_HTML = `${ARTIFACT_DIR}/index.html`;
const LOCAL_CARD_IMAGE_SRC = "../../../public/media/dzn-cinematic-survivor.png";
const GENERATED_BY = "npm run test:public-profile-social-preview-validation-package";
const DETERMINISTIC_GENERATED_AT = "2026-08-26T00:00:00.000Z";
const SNAPSHOT_STATES: VisualCrawlerCaseKey[] = ["published", "hidden", "invalid", "unavailable", "fallback_image"];

const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const PREVIOUS_HANDOFF = "docs/PUBLIC_PROFILE_SHARE_CARD_CRAWLER_VISUAL_QA_HANDOFF.md";
const HANDOFF_DOC = "docs/PUBLIC_PROFILE_SOCIAL_PREVIEW_VALIDATION_PACKAGE_HANDOFF.md";

type SanitizedPreviewCardArtifact = {
  platform: SocialCardPreview["platform"];
  title: string;
  description: string;
  url: string;
  image_url: string;
  image_alt: string;
  image_width: number;
  image_height: number;
  image_mime: SocialCardPreview["image_mime"];
  card_type: SocialCardPreview["card_type"];
  robots: string;
  rendered_card_html: string;
};

type SanitizedPreviewCaseArtifact = {
  state: VisualCrawlerCaseKey;
  route: string;
  expected_profile_state: "published_profile" | "safe_fallback";
  status: number;
  content_type: string | null;
  cache_control: string | null;
  asset_path: string;
  robots: string;
  preview_source: string;
  canonical: string;
  title: string;
  description: string;
  final_head_html: string;
  open_graph_card: SanitizedPreviewCardArtifact;
  twitter_card: SanitizedPreviewCardArtifact;
  reviewer_notes: string[];
};

type SocialPreviewValidationPackage = {
  schema_version: "dzn-public-profile-social-preview-validation-package/v1";
  package_generated_at: string;
  generated_by: string;
  production_services_required: false;
  package_files: {
    json: string;
    html: string;
  };
  scope: {
    route: "/players/[handle]";
    states: VisualCrawlerCaseKey[];
    source: "local_pages_function_render_with_fake_assets_and_read_only_db";
    purpose: string;
  };
  safety_contract: Record<
    | "hidden_sections_exposed"
    | "analytics_tracking_calls"
    | "stored_share_history"
    | "privacy_setting_writes"
    | "billing_changes"
    | "scoring_changes"
    | "ranking_changes"
    | "review_changes"
    | "badge_changes"
    | "season_changes"
    | "server_wars_changes"
    | "xp_award_changes"
    | "calling_card_award_changes"
    | "event_changes"
    | "competitive_eligibility_changes"
    | "production_d1_writes"
    | "cloudflare_secret_changes"
    | "stripe_mutations"
    | "nitrado_calls"
    | "discord_mutations"
    | "live_checkout_enabled"
    | "issue_49_mutated",
    false
  >;
  crawler_contract: {
    card_image_path: "/media/dzn-cinematic-survivor.png";
    local_image_preview_src: typeof LOCAL_CARD_IMAGE_SRC;
    minimum_width: 1200;
    minimum_height: 630;
    image_url_policy: "same-origin absolute crawler URL in head, local relative image in reviewer HTML";
    hidden_invalid_unavailable_policy: "generic noindex,nofollow metadata";
    fallback_image_policy: "missing future card references fall back to the default static DZN card";
  };
  cases: SanitizedPreviewCaseArtifact[];
};

async function main() {
  const artifact = await buildSocialPreviewValidationPackage();
  writeArtifactPackage(artifact);
  assertArtifactPackage(artifact);
  assertWrittenArtifactsMatch(artifact);
  assertDocumentationContracts();
  console.log("Public profile social preview validation package tests passed.");
}

async function buildSocialPreviewValidationPackage(): Promise<SocialPreviewValidationPackage> {
  const { snapshots, previews } = await buildPublicProfileShareCardCrawlerVisualQaEvidence();
  const cases = SNAPSHOT_STATES.map((state) => {
    const snapshot = snapshots.get(state);
    assert.ok(snapshot, `${state} snapshot should exist.`);
    const openGraph = previewFor(previews, state, "open_graph");
    const twitter = previewFor(previews, state, "twitter");
    return toArtifactCase(snapshot, openGraph, twitter);
  });

  return {
    schema_version: "dzn-public-profile-social-preview-validation-package/v1",
    package_generated_at: DETERMINISTIC_GENERATED_AT,
    generated_by: GENERATED_BY,
    production_services_required: false,
    package_files: {
      json: ARTIFACT_JSON,
      html: ARTIFACT_HTML,
    },
    scope: {
      route: "/players/[handle]",
      states: SNAPSHOT_STATES,
      source: "local_pages_function_render_with_fake_assets_and_read_only_db",
      purpose:
        "Reviewer artifact for inspecting sanitized final head and social-card snapshots without running production services.",
    },
    safety_contract: {
      hidden_sections_exposed: false,
      analytics_tracking_calls: false,
      stored_share_history: false,
      privacy_setting_writes: false,
      billing_changes: false,
      scoring_changes: false,
      ranking_changes: false,
      review_changes: false,
      badge_changes: false,
      season_changes: false,
      server_wars_changes: false,
      xp_award_changes: false,
      calling_card_award_changes: false,
      event_changes: false,
      competitive_eligibility_changes: false,
      production_d1_writes: false,
      cloudflare_secret_changes: false,
      stripe_mutations: false,
      nitrado_calls: false,
      discord_mutations: false,
      live_checkout_enabled: false,
      issue_49_mutated: false,
    },
    crawler_contract: {
      card_image_path: "/media/dzn-cinematic-survivor.png",
      local_image_preview_src: LOCAL_CARD_IMAGE_SRC,
      minimum_width: 1200,
      minimum_height: 630,
      image_url_policy: "same-origin absolute crawler URL in head, local relative image in reviewer HTML",
      hidden_invalid_unavailable_policy: "generic noindex,nofollow metadata",
      fallback_image_policy: "missing future card references fall back to the default static DZN card",
    },
    cases,
  };
}

function toArtifactCase(
  snapshot: HeadSnapshot,
  openGraph: SocialCardPreview,
  twitter: SocialCardPreview,
): SanitizedPreviewCaseArtifact {
  assert.equal(openGraph.image_url, snapshot.og_image, `${snapshot.key} Open Graph card should mirror final og:image.`);
  assert.equal(openGraph.image_alt, snapshot.og_image_alt, `${snapshot.key} Open Graph card should mirror final og:image:alt.`);
  assert.equal(twitter.image_url, snapshot.twitter_image, `${snapshot.key} Twitter card should mirror final twitter:image.`);
  assert.equal(twitter.image_alt, snapshot.twitter_image_alt, `${snapshot.key} Twitter card should mirror final twitter:image:alt.`);

  return {
    state: snapshot.key,
    route: snapshot.route,
    expected_profile_state: snapshot.key === "published" || snapshot.key === "fallback_image" ? "published_profile" : "safe_fallback",
    status: snapshot.status,
    content_type: snapshot.content_type,
    cache_control: snapshot.cache_control,
    asset_path: snapshot.asset_path,
    robots: snapshot.robots,
    preview_source: snapshot.preview_source,
    canonical: snapshot.canonical,
    title: snapshot.title,
    description: snapshot.description,
    final_head_html: sanitizeHeadHtmlForArtifact(snapshot.head_html),
    open_graph_card: sanitizePreviewCard(openGraph),
    twitter_card: sanitizePreviewCard(twitter),
    reviewer_notes: reviewerNotesFor(snapshot),
  };
}

function previewFor(
  previews: SocialCardPreview[],
  state: VisualCrawlerCaseKey,
  platform: SocialCardPreview["platform"],
) {
  const preview = previews.find((candidate) => candidate.key === state && candidate.platform === platform);
  assert.ok(preview, `${state} ${platform} preview should exist.`);
  return preview;
}

function sanitizePreviewCard(preview: SocialCardPreview): SanitizedPreviewCardArtifact {
  assert.equal(preview.image_url, "https://dzn.example/media/dzn-cinematic-survivor.png");
  assert.equal(preview.image_alt.length > 12, true);
  assert.equal(preview.image_width >= 1200, true);
  assert.equal(preview.image_height >= 630, true);
  assert.equal(preview.html.includes("<script"), false);
  assert.equal(preview.html.includes("<form"), false);
  return {
    platform: preview.platform,
    title: preview.title,
    description: preview.description,
    url: preview.url,
    image_url: preview.image_url,
    image_alt: preview.image_alt,
    image_width: preview.image_width,
    image_height: preview.image_height,
    image_mime: preview.image_mime,
    card_type: preview.card_type,
    robots: preview.robots,
    rendered_card_html: preview.html,
  };
}

function reviewerNotesFor(snapshot: HeadSnapshot) {
  if (snapshot.key === "published") {
    return [
      "Published state is indexable and uses only already-public profile payload fields.",
      "Private identifiers, raw award evidence, exact timestamps, and hidden sections are absent.",
    ];
  }
  if (snapshot.key === "fallback_image") {
    return [
      "Fallback-image state stays indexable because the profile payload is public.",
      "The missing future image candidate is not present; metadata falls back to the default DZN static card.",
    ];
  }
  return [
    "This state uses the generic noindex,nofollow fallback metadata.",
    "No profile-derived public fields are emitted for this state.",
  ];
}

function writeArtifactPackage(artifact: SocialPreviewValidationPackage) {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(ARTIFACT_JSON, `${stableJson(artifact)}\n`);
  writeFileSync(ARTIFACT_HTML, renderArtifactHtml(artifact));
}

function assertArtifactPackage(artifact: SocialPreviewValidationPackage) {
  assert.equal(artifact.production_services_required, false);
  assert.deepEqual(
    artifact.cases.map((entry) => entry.state),
    SNAPSHOT_STATES,
    "Artifact must preserve the requested state order.",
  );
  assert.equal(artifact.cases.length, 5);
  assert.equal(Object.values(artifact.safety_contract).every((value) => value === false), true);

  for (const entry of artifact.cases) {
    assert.equal(entry.status, 200, `${entry.state} should preserve the static shell status.`);
    assert.equal(entry.content_type, "text/html; charset=utf-8", `${entry.state} should preserve HTML content type.`);
    assert.equal(entry.cache_control, "no-store", `${entry.state} should remain no-store.`);
    assert.equal(entry.asset_path, "/players/preview.html", `${entry.state} should use the exported preview shell.`);
    assert.equal(entry.open_graph_card.image_url, "https://dzn.example/media/dzn-cinematic-survivor.png");
    assert.equal(entry.twitter_card.image_url, entry.open_graph_card.image_url);
    assert.equal(entry.open_graph_card.image_alt, entry.twitter_card.image_alt);
    assert.equal(entry.open_graph_card.rendered_card_html.includes(entry.open_graph_card.image_url), true);
    assert.equal(entry.twitter_card.rendered_card_html.includes(entry.twitter_card.image_alt), true);
    assert.equal(entry.final_head_html.includes("og:image"), true);
    assert.equal(entry.final_head_html.includes("og:image:alt"), true);
    assert.equal(entry.final_head_html.includes("twitter:image"), true);
    assert.equal(entry.final_head_html.includes("twitter:image:alt"), true);
  }

  assert.equal(artifact.cases.find((entry) => entry.state === "published")?.robots, "index,follow");
  assert.equal(artifact.cases.find((entry) => entry.state === "fallback_image")?.robots, "index,follow");
  for (const state of ["hidden", "invalid", "unavailable"] as const) {
    assert.equal(artifact.cases.find((entry) => entry.state === state)?.robots, "noindex,nofollow");
  }

  const artifactText = `${stableJson(artifact)}\n${renderArtifactHtml(artifact)}`;
  assertNoForbiddenLeaks(artifactText);
  assertNoTrackingOrMutationHooks(artifactText);
  assert.equal(Buffer.byteLength(stableJson(artifact), "utf8") < 160_000, true, "JSON artifact should stay bounded.");
  assert.equal(Buffer.byteLength(renderArtifactHtml(artifact), "utf8") < 220_000, true, "HTML artifact should stay bounded.");
}

function assertWrittenArtifactsMatch(artifact: SocialPreviewValidationPackage) {
  assert.equal(existsSync(ARTIFACT_JSON), true, "Reviewer JSON artifact should exist.");
  assert.equal(existsSync(ARTIFACT_HTML), true, "Reviewer HTML artifact should exist.");
  assert.equal(read(ARTIFACT_JSON), `${stableJson(artifact)}\n`, "Reviewer JSON artifact should be deterministic.");
  assert.equal(read(ARTIFACT_HTML), renderArtifactHtml(artifact), "Reviewer HTML artifact should be deterministic.");
}

function assertDocumentationContracts() {
  for (const path of [MASTER_SPEC, PUBLIC_ACCESS_POLICY, PREVIOUS_HANDOFF, HANDOFF_DOC, ARTIFACT_JSON, ARTIFACT_HTML]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const docs = [read(MASTER_SPEC), read(PUBLIC_ACCESS_POLICY), read(PREVIOUS_HANDOFF), read(HANDOFF_DOC)].join("\n");
  for (const snippet of [
    "Public Profile Social Preview Validation Package Slice",
    "sanitized rendered head/card snapshots",
    "without running production services",
    "published, hidden, invalid, unavailable, and fallback-image states",
    "Global / Group Chat And Support Bot Roadmap",
    "public DZN website and setup-help content",
    "profanity filtering, warning, and timed-mute controls",
    "Live checkout remains disabled",
    "Issue #49 remains reserved",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }

  const packageJson = read("package.json");
  assert.equal(
    packageJson.includes("test:public-profile-social-preview-validation-package"),
    true,
    "Focused validation package test must be wired into package scripts.",
  );
}

function renderArtifactHtml(artifact: SocialPreviewValidationPackage) {
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "  <meta name=\"robots\" content=\"noindex,nofollow\">",
    "  <title>DZN Public Profile Social Preview Validation Package</title>",
    "  <style>",
    "    :root { color-scheme: dark; --bg: #040711; --panel: #101521; --line: #293247; --text: #f6f7fb; --muted: #aeb7c7; --cyan: #7feaff; --green: #67f0a7; --amber: #ffd66d; }",
    "    * { box-sizing: border-box; }",
    "    body { margin: 0; background: radial-gradient(circle at 20% 0%, #17204a 0, transparent 32rem), #040711; color: var(--text); font: 14px/1.55 Arial, sans-serif; }",
    "    main { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 40px 0; }",
    "    h1, h2, h3 { margin: 0; letter-spacing: 0; }",
    "    h1 { font-size: 32px; line-height: 1.1; }",
    "    h2 { font-size: 22px; margin-bottom: 12px; }",
    "    h3 { font-size: 15px; margin-bottom: 8px; color: var(--cyan); }",
    "    p { color: var(--muted); margin: 8px 0 0; }",
    "    code, pre { font-family: Consolas, 'Liberation Mono', monospace; }",
    "    .summary, .case { border: 1px solid var(--line); background: rgba(16, 21, 33, 0.92); border-radius: 8px; padding: 18px; margin-top: 18px; }",
    "    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }",
    "    .chip { border: 1px solid rgba(127, 234, 255, 0.35); border-radius: 999px; color: var(--cyan); padding: 6px 10px; font-weight: 700; }",
    "    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 14px; }",
    "    .kv { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 8px 14px; margin-top: 12px; }",
    "    .kv dt { color: var(--muted); }",
    "    .kv dd { margin: 0; overflow-wrap: anywhere; }",
    "    .card { border: 1px solid rgba(127, 234, 255, 0.28); background: #070b16; border-radius: 8px; overflow: hidden; }",
    "    .card img { width: 100%; aspect-ratio: 1200 / 630; object-fit: cover; display: block; background: #050812; }",
    "    .card-body { padding: 12px; }",
    "    .card strong { display: block; font-size: 16px; line-height: 1.2; }",
    "    .card small { color: var(--amber); display: block; margin-top: 8px; overflow-wrap: anywhere; }",
    "    pre { overflow: auto; white-space: pre-wrap; border: 1px solid var(--line); background: #050812; border-radius: 8px; padding: 12px; color: #dbeafe; }",
    "    .safe { color: var(--green); font-weight: 700; }",
    "    @media (max-width: 760px) { main { width: min(100vw - 20px, 1180px); padding: 24px 0; } .grid { grid-template-columns: 1fr; } .kv { grid-template-columns: 1fr; } h1 { font-size: 26px; } }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <h1>DZN Public Profile Social Preview Validation Package</h1>",
    `    <p>Generated by ${escapeHtmlText(artifact.generated_by)}. Production services required: <span class="safe">${artifact.production_services_required}</span>.</p>`,
    "    <section class=\"summary\">",
    "      <h2>Contract</h2>",
    "      <div class=\"chips\">",
    ...artifact.scope.states.map((state) => `        <span class="chip">${escapeHtmlText(state)}</span>`),
    "      </div>",
    "      <dl class=\"kv\">",
    `        <dt>Route</dt><dd><code>${escapeHtmlText(artifact.scope.route)}</code></dd>`,
    `        <dt>Image policy</dt><dd>${escapeHtmlText(artifact.crawler_contract.image_url_policy)}</dd>`,
    `        <dt>Fallback policy</dt><dd>${escapeHtmlText(artifact.crawler_contract.fallback_image_policy)}</dd>`,
    `        <dt>Local image preview</dt><dd><code>${escapeHtmlText(artifact.crawler_contract.local_image_preview_src)}</code></dd>`,
    "      </dl>",
    "    </section>",
    ...artifact.cases.flatMap(renderCaseHtml),
    "  </main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function renderCaseHtml(entry: SanitizedPreviewCaseArtifact) {
  return [
    `    <section class="case" id="${escapeHtmlAttribute(entry.state)}">`,
    `      <h2>${escapeHtmlText(entry.state)} <span class="safe">${escapeHtmlText(entry.robots)}</span></h2>`,
    "      <dl class=\"kv\">",
    `        <dt>Route</dt><dd><code>${escapeHtmlText(entry.route)}</code></dd>`,
    `        <dt>Canonical</dt><dd><code>${escapeHtmlText(entry.canonical)}</code></dd>`,
    `        <dt>Preview source</dt><dd><code>${escapeHtmlText(entry.preview_source)}</code></dd>`,
    `        <dt>Open Graph image</dt><dd><code>${escapeHtmlText(entry.open_graph_card.image_url)}</code></dd>`,
    `        <dt>Image alt</dt><dd>${escapeHtmlText(entry.open_graph_card.image_alt)}</dd>`,
    "      </dl>",
    "      <div class=\"grid\">",
    renderPreviewCardHtml("Open Graph", entry.open_graph_card),
    renderPreviewCardHtml("Twitter", entry.twitter_card),
    "      </div>",
    "      <h3>Final Rendered Head</h3>",
    `      <pre><code>${escapeHtmlText(entry.final_head_html)}</code></pre>`,
    "      <h3>Reviewer Notes</h3>",
    `      <p>${entry.reviewer_notes.map(escapeHtmlText).join(" ")}</p>`,
    "    </section>",
  ];
}

function renderPreviewCardHtml(label: string, card: SanitizedPreviewCardArtifact) {
  return [
    "        <article class=\"card\">",
    `          <img src="${escapeHtmlAttribute(LOCAL_CARD_IMAGE_SRC)}" alt="${escapeHtmlAttribute(card.image_alt)}" data-crawler-image-url="${escapeHtmlAttribute(card.image_url)}">`,
    "          <div class=\"card-body\">",
    `            <h3>${escapeHtmlText(label)}</h3>`,
    `            <strong>${escapeHtmlText(card.title)}</strong>`,
    `            <p>${escapeHtmlText(card.description)}</p>`,
    `            <small>${escapeHtmlText(card.image_url)}</small>`,
    "          </div>",
    "        </article>",
  ].join("\n");
}

function sanitizeHeadHtmlForArtifact(head: string) {
  const sanitized = head
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  assertNoForbiddenLeaks(sanitized);
  assertNoTrackingOrMutationHooks(sanitized);
  return sanitized;
}

function assertNoForbiddenLeaks(value: string) {
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
    assert.equal(value.includes(forbidden), false, `Validation package must not leak ${forbidden}.`);
  }
}

function assertNoTrackingOrMutationHooks(value: string) {
  assert.doesNotMatch(
    value,
    /<script|<form|localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|XMLHttpRequest|gtag|dataLayer|posthog|mixpanel|amplitude|plausible|trackEvent|logShare|auditShare/i,
    "Validation package must not contain tracking, browser storage, scripts, forms, or audit-share hooks.",
  );
  assert.doesNotMatch(
    value,
    /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN|DZN_LIVE_CHECKOUT_ENABLED\s*=\s*true|\bINSERT\s+INTO\b|\bUPDATE\b|\bDELETE\s+FROM\b|wrangler\s+secret|d1\s+execute/i,
    "Validation package must not contain write, checkout, live-service, or production-mutation hooks.",
  );
}

function stableJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
