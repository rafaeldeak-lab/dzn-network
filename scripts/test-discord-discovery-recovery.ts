import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { discordSetupEvidence, isCurrentDiscordCache, verifiedDiscordCache } from "../components/onboarding/dashboard-discord-state";
import { getDiscordBotStatus, getDiscordPostingChannels } from "../components/onboarding/api";
import type { DiscordChannelsResponse, DiscordPostingChannel } from "../components/onboarding/types";

const now = Date.parse("2026-09-13T11:00:00Z");
const channel = { channel_id: "channel", can_post: true } as DiscordPostingChannel;
const response: DiscordChannelsResponse = { ok: true, bot_connected: true, channels: [channel], manual_fallback: false,
  fetched_at: new Date(now).toISOString(), selected_server_id: "server", selected_guild_id: "guild" };
const cache = verifiedDiscordCache(response, "server", "guild", now)!;
assert.ok(cache);
assert.equal(isCurrentDiscordCache(cache, "server", "guild", now), true);
assert.equal(isCurrentDiscordCache(cache, "other", "guild", now), false);
assert.equal(isCurrentDiscordCache(cache, "server", "other", now), false);
assert.equal(isCurrentDiscordCache({ ...cache, guild_id: undefined! }, "server", "guild", now), false);
assert.equal(isCurrentDiscordCache(cache, "server", "guild", now + 300000), false);
assert.equal(isCurrentDiscordCache(cache, "server", "guild", now - 1), false);
assert.equal(isCurrentDiscordCache({ ...cache, verification_received_at: NaN }, "server", "guild", now), false);
assert.equal(isCurrentDiscordCache({ ...cache, verification_received_at: undefined! }, "server", "guild", now), false);
for (const skew of [-60000, 30000, 3600000]) {
  const skewed = { ...response, fetched_at: new Date(now + skew).toISOString() };
  const received = verifiedDiscordCache(skewed, "server", "guild", now)!;
  assert.equal(received.last_channel_fetch_success_at, skewed.fetched_at, "Preserve the provider timestamp for diagnostics.");
  assert.equal(discordSetupEvidence(skewed, received, "server", "guild", false, now).connected, true, "API clock skew must not invalidate a fresh response.");
  assert.equal(isCurrentDiscordCache(received, "server", "guild", now + 300000), false, "API clock skew must not extend cache lifetime.");
}
const evidence = (r: DiscordChannelsResponse | null, failed = false) => discordSetupEvidence(r, cache, "server", "guild", failed, now);
assert.equal(evidence(response).connected, true);
assert.equal(evidence(response).count, 1);
assert.equal(evidence(response).channelsDiscovered, true);
assert.equal(discordSetupEvidence(null, null, "server", "guild").botLabel, "Not checked yet");
assert.equal(evidence({ ...response, ok: false, bot_connected: false, error_code: "bot_not_in_guild" }).connected, false);
assert.equal(evidence({ ...response, ok: false, bot_connected: false, error_code: "bot_not_in_guild" }).botLabel, "Not installed");
assert.equal(evidence({ ...response, ok: false, bot_connected: null, error_code: "missing_bot_token" }).botLabel, "Not configured");
assert.equal(evidence(response, true).connected, false);
assert.equal(evidence({ ...response, ok: false, error_code: "channel_fetch_unavailable" }).connected, false);
assert.equal(verifiedDiscordCache({ ...response, ok: false }, "server", "guild"), null);
assert.equal(verifiedDiscordCache(response, "other", "guild"), null);
assert.equal(verifiedDiscordCache(response, "server", "other"), null);
const saved = { ...response, bot_connected: null, diagnostics: { using_cached_channel_state: true } } as DiscordChannelsResponse;
assert.equal(verifiedDiscordCache(saved, "server", "guild"), null);
assert.equal(evidence(saved).connected, true, "Saved destinations must not erase a recent verification.");
assert.equal(discordSetupEvidence(saved, null, "server", "guild", false, now).connected, false, "Saved destinations alone are not bot evidence.");
const empty = { ...response, channels: [] };
assert.equal(discordSetupEvidence(empty, verifiedDiscordCache(empty, "server", "guild", now), "server", "guild", false, now).connected, true);
assert.equal(discordSetupEvidence(empty, verifiedDiscordCache(empty, "server", "guild", now), "server", "guild", false, now).channelsDiscovered, false);

const originalFetch = globalThis.fetch;
const requests: Array<{ url: string; init?: RequestInit }> = [];
async function testClient() {
try {
  globalThis.fetch = async (input, init) => { requests.push({ url: String(input), init }); return Response.json(response); };
  await getDiscordPostingChannels("server");
  await getDiscordPostingChannels("server", { refresh: true });
  await getDiscordBotStatus("guild");
  assert.equal(requests[0].url.endsWith("/discord-channels"), true);
  assert.equal(requests[1].url.endsWith("/discord-channels?refresh=1"), true);
  for (const request of requests) {
    assert.equal(request.init?.method ?? "GET", "GET");
    assert.equal(request.init?.cache, "no-store");
    assert.ok(request.init?.signal, "Verification must have a deadline.");
    assert.equal(request.init?.body, undefined);
  }
  globalThis.fetch = async () => Response.json({ unexpected: true });
  await assert.rejects(getDiscordPostingChannels("server"), /unavailable/);
  globalThis.fetch = async () => Response.json({ error: "Unauthorized" }, { status: 401 });
  await assert.rejects(getDiscordPostingChannels("server"), /Unauthorized/);
} finally { globalThis.fetch = originalFetch; }
}

const dashboard = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.match(dashboard, /Verify Discord Connection/);
assert.match(dashboard, /Recheck Channels/);
assert.doesNotMatch(dashboard, /retryableChannelFetch \?/);
assert.match(dashboard, /requestId !== discordRequestIdRef\.current/);
assert.match(dashboard, /!discordVerificationInFlightRef\.current/);
assert.match(dashboard, /saveDiscordChannelCache\(requestServerId, null\)/);
assert.match(dashboard, /discordSetupEvidence\(/);
testClient().then(() => console.log("Discord discovery recovery tests passed (cache provenance, stale/failure precedence, bounded reads, reachable verification).")).catch(error => { console.error(error); process.exitCode = 1; });
