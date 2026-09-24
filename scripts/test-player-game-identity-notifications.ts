import assert from "node:assert/strict";
import { dispatchPlayerGameIdentityDecisionDiscord, type PlayerGameIdentityDecisionDelivery } from "../functions/_lib/player-game-identity-notifications";
import type { Env } from "../functions/_lib/types";

const delivery: PlayerGameIdentityDecisionDelivery = {
  claimId: "claim-a",
  userId: "player-a",
  discordId: "831243159785701398",
  action: "approved",
  serverName: "[NukeTown](https://phishing.example)",
  playerName: "xAKA_*MINI* www.phishing.example",
};

function preferenceDb(discordEnabled: number | null) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => discordEnabled === null ? null : { discord_enabled: discordEnabled },
      }),
    }),
  };
}

export async function testPlayerGameIdentityNotifications() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    if (url.endsWith("/users/@me/channels")) return Response.json({ id: "998877665544332211" });
    return Response.json({ id: "message-a" });
  }) as typeof fetch;
  try {
    const disabled = await dispatchPlayerGameIdentityDecisionDiscord({ DZN_DISCORD_NOTIFICATIONS_ENABLED: "false" } as Env, delivery);
    assert.equal(disabled.reason, "discord_notifications_disabled");
    assert.equal(calls.length, 0, "Disabled Discord notifications must not call Discord.");

    const optedOut = await dispatchPlayerGameIdentityDecisionDiscord({
      DZN_DISCORD_NOTIFICATIONS_ENABLED: "true",
      DISCORD_BOT_TOKEN: "test-token-with-enough-length",
      DB: preferenceDb(0),
    } as unknown as Env, delivery);
    assert.equal(optedOut.reason, "discord_notifications_not_enabled_by_player");
    assert.equal(calls.length, 0, "Defaulted or opted-out players must not receive Discord DMs.");

    const noPreference = await dispatchPlayerGameIdentityDecisionDiscord({
      DZN_DISCORD_NOTIFICATIONS_ENABLED: "true",
      DISCORD_BOT_TOKEN: "test-token-with-enough-length",
      DB: preferenceDb(null),
    } as unknown as Env, delivery);
    assert.equal(noPreference.reason, "discord_notifications_not_enabled_by_player");
    assert.equal(calls.length, 0, "A missing preference row must remain opted out.");

    const sent = await dispatchPlayerGameIdentityDecisionDiscord({
      DZN_DISCORD_NOTIFICATIONS_ENABLED: "true",
      DISCORD_BOT_TOKEN: "test-token-with-enough-length",
      DB: preferenceDb(1),
    } as unknown as Env, delivery);
    assert.equal(sent.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://discord.com/api/v10/users/@me/channels");
    assert.equal(calls[0].body.recipient_id, delivery.discordId);
    assert.match(calls[1].url, /\/channels\/998877665544332211\/messages$/);
    assert.deepEqual(calls[1].body.allowed_mentions, { parse: [] });
    assert.equal(String(calls[1].body.content).includes("xAKA_*MINI*"), false, "Decision DMs must neutralize stored Markdown formatting.");
    assert.equal(String(calls[1].body.content).includes("https://"), false, "Decision DMs must remove stored URLs.");
    assert.equal(String(calls[1].body.content).includes("www."), false, "Decision DMs must neutralize auto-linked domains.");
    assert.equal(String(calls[1].body.content).includes("]("), false, "Decision DMs must neutralize Markdown links.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
