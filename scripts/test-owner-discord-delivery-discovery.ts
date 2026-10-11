import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { discoverOwnerDiscordDeliveryCandidates } from "../functions/_lib/owner-discord-delivery-discovery";
import { onRequestGet as candidateRoute } from "../functions/api/owner/discord/owner-access-delivery-candidates";
import type { Env } from "../functions/_lib/types";

const guildId = "900000000000000001";
const botId = "900000000000000002";
const botRoleId = "900000000000000003";
const verifiedOwnerRoleId = "900000000000000004";
const categoryId = "900000000000000005";
const privateInviteChannelId = "900000000000000006";
const publicChannelId = "900000000000000007";
const permissions = ((BigInt(1) << BigInt(28)) | (BigInt(1) << BigInt(10)) | (BigInt(1) << BigInt(0))).toString();
const viewChannel = (BigInt(1) << BigInt(10)).toString();

async function run() {
  const helper = readFileSync("functions/_lib/owner-discord-delivery-discovery.ts", "utf8");
  const route = readFileSync("functions/api/owner/discord/owner-access-delivery-candidates.ts", "utf8");
  assert.match(helper, /GET requests exclusively/);
  assert.doesNotMatch(helper, /\/invites|method:\s*["'](?:POST|PUT|DELETE)["']/);
  assert.match(route, /requirePlatformOwner/);
  assert.match(route, /privateNoStoreHeaders/);
  assert.match(route, /onRequestPost = methodNotAllowed/);

  const unauthorized = await candidateRoute({
    env: {} as Env,
    request: new Request(`https://dzn.test/api/owner/discord/owner-access-delivery-candidates?guild_id=${guildId}`),
    params: {},
    data: {},
    waitUntil() {},
    next: async () => new Response(null, { status: 204 }),
  });
  assert.equal(unauthorized.status, 401, "Candidate discovery must reject callers without a platform-owner session.");
  assert.equal(unauthorized.headers.get("cache-control"), "private, no-store, no-cache, must-revalidate");

  const env = {
    DISCORD_BOT_TOKEN: "bot-token-with-at-least-twenty-characters",
  } as Env;
  const calls: Array<{ path: string; method: string }> = [];
  const discordFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init.method ?? "GET" });
    if (url.pathname === "/api/v10/users/@me") return Response.json({ id: botId });
    if (url.pathname === `/api/v10/guilds/${guildId}/members/${botId}`) return Response.json({ roles: [botRoleId] });
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: "0" },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: "0", managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions, managed: true },
      ]);
    }
    if (url.pathname === `/api/v10/guilds/${guildId}/channels`) {
      return Response.json([
        { id: categoryId, type: 4, name: "Verified owners", permission_overwrites: [{ id: guildId, type: 0, deny: viewChannel, allow: "0" }] },
        { id: privateInviteChannelId, type: 0, name: "owner-invites", parent_id: categoryId, permission_overwrites: [] },
        { id: publicChannelId, type: 0, name: "general", permission_overwrites: [] },
      ]);
    }
    return new Response(null, { status: 404 });
  };

  const result = await discoverOwnerDiscordDeliveryCandidates(env, guildId, discordFetch);
  assert.equal(result.ok, true);
  assert.equal(result.status, "ready_to_configure");
  assert.equal(result.checks.botHasAdministrator, false);
  assert.equal(result.checks.canManageRoles, true);
  assert.deepEqual(result.verifiedOwnerRoleCandidates, [{ id: verifiedOwnerRoleId, name: "Verified Server Owner", assignable: true }]);
  assert.deepEqual(result.privateInviteChannelCandidates, [{
    id: privateInviteChannelId,
    name: "owner-invites",
    categoryName: "Verified owners",
    canView: true,
    canCreateInvite: true,
    privateToEveryone: true,
  }]);
  assert.equal(calls.every((call) => call.method === "GET"), true, "Discovery must never send a Discord mutation request.");
  assert.equal(JSON.stringify(result).includes(env.DISCORD_BOT_TOKEN ?? ""), false, "Discovery must not expose the private bot token.");

  const missingGuild = await discoverOwnerDiscordDeliveryCandidates(env, "invalid", discordFetch);
  assert.equal(missingGuild.status, "not_configured");
  assert.equal(missingGuild.checks.botIdentity, false);

  const botMissing = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async () => new Response(null, { status: 401 }));
  assert.equal(botMissing.status, "not_connected");
  assert.equal(botMissing.verifiedOwnerRoleCandidates.length, 0);

  console.log("Owner Discord delivery discovery checks passed.");
}

void run();
