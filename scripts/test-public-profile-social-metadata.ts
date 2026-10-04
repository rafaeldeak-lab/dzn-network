import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPublicProfileSocialMetadata,
  injectPublicProfileSocialMetadata,
  withoutContentLength,
} from "../functions/_lib/public-profile-social-metadata";
import type { PublicPlayerProfilePayload } from "../functions/_lib/player-public-profiles";

const route = readFileSync("functions/players/[handle].ts", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const image = readFileSync("public/media/dzn-cinematic-survivor.png");

const profile = publicProfile();
const published = buildPublicProfileSocialMetadata("https://dayz-network.com/players/tara-w-123abc?ref=share", profile);
assert.equal(published.source, "public_profile");
assert.equal(published.title, "Tara & <W> | DZN Player Profile");
assert.equal(published.canonical, "https://dayz-network.com/players/tara-w-123abc");
assert.equal(published.image, "https://dayz-network.com/media/dzn-cinematic-survivor.png");
assert.equal(published.robots, "index,follow");
assert.equal(published.openGraphType, "profile");
assert.match(published.description, /128 confirmed kills/);
assert.match(published.description, /featured on NukeTown Deathmatch/);
assert.match(published.description, /Discord identity connected/);
assert.doesNotMatch(published.description, /discord-user-id|raw-player-id|secret-value/);

const fallback = buildPublicProfileSocialMetadata("https://dayz-network.com/players/private-player?x=1", null);
assert.equal(fallback.source, "generic_fallback");
assert.equal(fallback.robots, "noindex,nofollow");
assert.equal(fallback.openGraphType, "website");
assert.equal(fallback.canonical, "https://dayz-network.com/players/private-player");
assert.doesNotMatch(JSON.stringify(fallback), /tara|nuketown|128/i);
assert.doesNotMatch(JSON.stringify(published), /api\/public\/players|avatar|secret-value|raw-player-id|discord-user-id/i);

const hostileHost = buildPublicProfileSocialMetadata("https://attacker.example/players/tara-w-123abc?next=secret", profile);
assert.equal(hostileHost.canonical, "https://dayz-network.com/players/tara-w-123abc");
assert.equal(hostileHost.image, "https://dayz-network.com/media/dzn-cinematic-survivor.png");
assert.doesNotMatch(JSON.stringify(hostileHost), /attacker\.example|next=secret/);

const shell = '<!doctype html><html><head><title>Old</title><meta name="description" content="Old"><meta property="og:title" content="Old"><link rel="canonical" href="https://old.test"></head><body>Profile</body></html>';
const rendered = injectPublicProfileSocialMetadata(shell, published);
assert.equal((rendered.match(/<title>/g) ?? []).length, 1);
assert.equal((rendered.match(/rel="canonical"/g) ?? []).length, 1);
assert.match(rendered, /Tara &amp; &lt;W&gt; \| DZN Player Profile/);
assert.match(rendered, /twitter:card" content="summary_large_image/);
assert.match(rendered, /dzn:profile-preview-source" content="public_profile/);
assert.match(rendered, /property="og:type" content="profile/);
assert.doesNotMatch(rendered, /https:\/\/old\.test|content="Old"/);

const headers = withoutContentLength(new Headers({ "content-length": "123", etag: "profile-shell", "x-test": "yes" }));
assert.equal(headers.has("content-length"), false);
assert.equal(headers.get("etag"), "profile-shell");
assert.equal(headers.get("x-test"), "yes");

assert.deepEqual([...image.subarray(1, 4)], [80, 78, 71]);
assert.ok(image.readUInt32BE(16) >= 1200, "Social preview artwork must remain at least 1200px wide.");
assert.ok(image.readUInt32BE(20) >= 630, "Social preview artwork must remain at least 630px high.");

assert.match(route, /readPublicPlayerProfileByHandle\(env, params\.handle\)/);
assert.match(route, /\.catch\(\(\) => null\)/, "Profile read failures must fall back to generic noindex metadata.");
assert.match(route, /withoutContentLength\(shellResponse\.headers\)/);
assert.match(route, /cache-control", "no-store"/);
assert.match(route, /injectPublicProfileSocialMetadata\(await shellResponse\.text\(\), metadata\)/);
assert.doesNotMatch(route, /discord_id|user_id|player_id|analytics|tracking/i);
assert.match(packageJson, /"test:public-profile-social-metadata": "tsx scripts\/test-public-profile-social-metadata\.ts"/);
assert.match(packageJson, /test:public-player-profile-viewer && npm run test:public-profile-social-metadata && npm run test:public-profile-owner-preview-share-polish/);

console.log("Public profile social metadata and crawler fallback checks passed.");

function publicProfile(): PublicPlayerProfilePayload {
  return {
    ok: true,
    handle: "tara-w-123abc",
    href: "/players/tara-w-123abc",
    display_name: "Tara & <W>",
    discord_profile: { visible: true, connected: true, avatar_url: "/api/public/players/tara-w-123abc/avatar" },
    published_at: "2026-10-01T12:00:00.000Z",
    updated_at: "2026-10-03T12:00:00.000Z",
    sections: {
      display_name: { visible: true, value: "Tara & <W>" },
      gameplay_summary: { visible: true, totals: { kills: 128, deaths: 32, suicides: 2, longest_kill_distance: 412, linked_public_servers: 1 }, last_seen_at: "2026-10-03T12:00:00.000Z" },
      featured_server: { visible: true, server: { public_slug: "nuketown", href: "/servers/profile?slug=nuketown", server_name: "NukeTown Deathmatch", server_type: "DEATHMATCH", platform: "PlayStation", map_name: "Chernarus", kills: 128, deaths: 32, longest_kill_distance: 412, last_seen_at: "2026-10-03T12:00:00.000Z" } },
      xp_progress: { visible: false, status: "hidden", message: "secret-value" },
      challenge_progress: { visible: false, status: "hidden", message: "raw-player-id" },
      calling_cards: { visible: false, status: "hidden", message: "discord-user-id", items: [] },
      award_dates: { visible: false, status: "hidden", message: "secret-value" },
    },
    privacy: { public_profile_enabled: true, visible_sections: ["display_name", "discord_identity", "gameplay_summary", "featured_server"] },
    safety: { public_safe: true, read_only: true, presentation_only: true, private_identifiers_exposed: false, raw_award_evidence_exposed: false },
    fairness_boundary: [],
  };
}
