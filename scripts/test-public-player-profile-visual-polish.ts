import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const PUBLIC_PROFILE_COMPONENT = "components/player/public-player-profile-page.tsx";
const GLOBAL_STYLES = "app/globals.css";

main();

function main() {
  assertStaticContracts();
  assertVisualPolishContracts();
  assertPrivacyAndInfluenceIsolation();
  assertDocumentationContracts();
  console.log("Public player profile visual polish tests passed.");
}

function assertStaticContracts() {
  for (const path of [
    PUBLIC_PROFILE_COMPONENT,
    GLOBAL_STYLES,
    "functions/_lib/public-player-profile.ts",
    "functions/api/public/player-profiles/[handle].ts",
    "functions/players/[handle].ts",
    "app/players/[handle]/page.tsx",
    "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md",
    "docs/PUBLIC_ACCESS_POLICY.md",
    "docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md",
    "docs/PLAYER_PUBLIC_PROFILE_VISUAL_POLISH_HANDOFF.md",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertVisualPolishContracts() {
  const component = read(PUBLIC_PROFILE_COMPONENT);
  for (const snippet of [
    "dzn-public-profile-page",
    "dzn-public-profile-hero",
    "dzn-public-profile-bg-layer",
    "dzn-public-profile-survivor-layer",
    "dzn-public-profile-fog-layer",
    "dzn-public-profile-identity-card",
    "dzn-public-profile-avatar",
    "dzn-public-profile-panel",
    "dzn-public-profile-calling-card",
    "dzn-public-profile-challenge-card",
    "dzn-public-profile-timeline-row",
    "ProfileSignalPill",
    "ProfileSignalRail",
    "SignalTile",
    "IntelRow",
    "Survivor dossier",
    "DZN player identity",
    "Profile Signal",
    "Public view / presentation only",
    "sections visible",
    "Published XP",
    "Challenge clears",
    "Calling cards",
  ]) {
    assert.equal(component.includes(snippet), true, `Public profile component must include ${snippet}.`);
  }

  const styles = read(GLOBAL_STYLES);
  for (const snippet of [
    ".dzn-public-profile-page",
    ".dzn-public-profile-hero::before",
    ".dzn-public-profile-hero::after",
    ".dzn-public-profile-bg-layer",
    ".dzn-public-profile-survivor-layer",
    ".dzn-public-profile-fog-layer",
    ".dzn-public-profile-identity-card",
    ".dzn-public-profile-avatar",
    ".dzn-public-profile-panel",
    ".dzn-public-profile-calling-card",
    ".dzn-public-profile-challenge-card",
    ".dzn-public-profile-timeline-row",
    "@keyframes dzn-public-profile-bg-drift",
    "@keyframes dzn-public-profile-fog-drift",
    "@keyframes dzn-public-profile-grid-drift",
    "@keyframes dzn-public-profile-avatar-scan",
    "@media (prefers-reduced-motion: reduce)",
    "dzn-public-profile-bg-layer",
    "dzn-public-profile-fog-layer",
    "dzn-public-profile-avatar::after",
  ]) {
    assert.equal(styles.includes(snippet), true, `Global styles must include ${snippet}.`);
  }
}

function assertPrivacyAndInfluenceIsolation() {
  const component = read(PUBLIC_PROFILE_COMPONENT);
  for (const snippet of [
    "/api/public/player-profiles/",
    "Public DZN profile",
    "Public Visibility",
    "Private identifiers, raw award evidence, source IDs, Discord IDs, internal user IDs, and exact award timestamps are hidden",
    "Public profile visibility is presentation only. It does not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.",
    "Profile Not Public",
    "currentPublicProfileHandle",
    "window.location.pathname",
  ]) {
    assert.equal(component.includes(snippet), true, `Public profile component must preserve ${snippet}.`);
  }

  assert.match(
    component,
    /fetchJsonWithRetry<PublicPlayerProfilePayload>\(`\/api\/public\/player-profiles\/\$\{encodedHandle\}`/,
    "The public profile viewer must keep using the public read-only profile API.",
  );
  assert.doesNotMatch(
    component,
    /dangerouslySetInnerHTML|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i,
    "Visual profile polish must not add client-side mutation, payment, Nitrado, or Discord bot wiring.",
  );

  const componentImports = component.slice(0, component.indexOf("type PublicPlayerProfilePayload"));
  assert.doesNotMatch(
    componentImports,
    /from\s+["'][^"']*(billing|checkout|stripe|nitrado|server-ranking|public-leaderboards|server-visibility|server-reviews|badge-awards|badge-evaluation|dzn-seasons|server-war|xp-award|calling-card-award|ctf|events\/join|events\/matchmaking)[^"']*["']/i,
    "Public profile visual imports must not pull protected influence systems into the page.",
  );

  const publicProfileHelper = read("functions/_lib/public-player-profile.ts");
  assert.equal(publicProfileHelper.includes("playerProfilePrivacyFairness"), true);
  assert.doesNotMatch(
    publicProfileHelper,
    /dzn-public-profile-|ProfileSignalPill|ProfileSignalRail|SignalTile|IntelRow/i,
    "The public profile read model must not depend on visual-only components or classes.",
  );
  assertNoSqlWrites(publicProfileHelper, "Public profile visual polish must not add writes to the public profile read model.");

  const publicApi = read("functions/api/public/player-profiles/[handle].ts");
  assert.doesNotMatch(
    publicApi,
    /dzn-public-profile-|ProfileSignalPill|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|STRIPE_SECRET_KEY|NITRADO_TOKEN|DISCORD_BOT_TOKEN|INSERT|UPDATE|DELETE/i,
    "The public profile API must stay read-only and unaware of visual-only presentation classes.",
  );

  for (const file of protectedInfluenceFiles()) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /dzn-public-profile-|ProfileSignalPill|ProfileSignalRail|Profile Signal|Survivor dossier|DZN player identity|Public view \/ presentation only/i,
      `${file} must not depend on public profile visual polish.`,
    );
  }
}

function assertDocumentationContracts() {
  const docs = [
    read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"),
    read("docs/PUBLIC_ACCESS_POLICY.md"),
    read("docs/PUBLIC_PLAYER_PROFILE_VIEWER_HANDOFF.md"),
    read("docs/PLAYER_PUBLIC_PROFILE_VISUAL_POLISH_HANDOFF.md"),
  ].join("\n");

  for (const snippet of [
    "Player Public Profile Visual Polish Slice",
    "`/players/[handle]`",
    "DZN-branded",
    "presentation-only",
    "privacy controls",
    "Live checkout remains disabled",
    "Issue #49 remains reserved",
  ]) {
    assert.equal(docs.includes(snippet), true, `Docs must include ${snippet}.`);
  }

  assert.match(
    docs,
    /cannot affect billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, or competitive eligibility/i,
    "Docs must preserve the protected-system isolation statement.",
  );

  const packageJson = read("package.json");
  assert.equal(
    packageJson.includes("test:public-player-profile-visual-polish"),
    true,
    "Focused public player profile visual polish test must be wired into package scripts.",
  );
}

function protectedInfluenceFiles() {
  return [
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
  ];
}

function assertNoSqlWrites(source: string, message: string) {
  assert.doesNotMatch(source, /\bINSERT\s+INTO\b|\bUPDATE\b|\bDELETE\s+FROM\b|\bDROP\b|\bALTER\b|\bCREATE\s+(?:TABLE|INDEX)\b/i, message);
  assert.doesNotMatch(source, /\.run\(/, message);
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}
