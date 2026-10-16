import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { discoverOwnerDiscordDeliveryCandidates } from "../functions/_lib/owner-discord-delivery-discovery";
import { getOwnerDiscordAccessRoleRejection } from "../functions/_lib/owner-discord-role-safety";
import { onRequestGet as candidateRoute } from "../functions/api/owner/discord/owner-access-delivery-candidates";
import type { Env } from "../functions/_lib/types";

const guildId = "900000000000000001";
const botId = "900000000000000002";
const botRoleId = "900000000000000003";
const verifiedOwnerRoleId = "900000000000000004";
const decoratedVerifiedOwnerRoleId = "900000000000000015";
const emojiContinuationOwnerRoleId = "900000000000000017";
const nonLatinPrefixedOwnerRoleId = "900000000000000016";
const administratorVerifiedOwnerRoleId = "900000000000000009";
const manageRolesVerifiedOwnerRoleId = "900000000000000011";
const viewChannelVerifiedOwnerRoleId = "900000000000000012";
const malformedVerifiedOwnerRoleId = "900000000000000013";
const missingPermissionVerifiedOwnerRoleId = "900000000000000014";
const categoryId = "900000000000000005";
const privateInviteChannelId = "900000000000000006";
const publicChannelId = "900000000000000007";
const unsyncedChannelId = "900000000000000008";
const privateGuildChannelId = "900000000000000010";
const botPermissions = (BigInt(1) << BigInt(28)).toString();
const privateInviteChannelPermissions = ((BigInt(1) << BigInt(10)) | (BigInt(1) << BigInt(0))).toString();
const viewChannel = (BigInt(1) << BigInt(10)).toString();
const administrator = (BigInt(1) << BigInt(3)).toString();
const manageRoles = (BigInt(1) << BigInt(28)).toString();
const manageChannels = (BigInt(1) << BigInt(4)).toString();
const sendMessages = (BigInt(1) << BigInt(11)).toString();
const pinMessages = (BigInt(1) << BigInt(51)).toString();

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
  assert.equal(
    getOwnerDiscordAccessRoleRejection({ id: verifiedOwnerRoleId, permissions: "0", managed: true }, guildId),
    "managed_role",
    "Managed roles must not become owner-access candidates even when they have no permissions.",
  );
  assert.equal(
    getOwnerDiscordAccessRoleRejection({ id: guildId, permissions: "0", managed: false }, guildId),
    "server_default_role",
    "The @everyone role must never become an owner-access candidate.",
  );
  const calls: Array<{ path: string; method: string }> = [];
  const discordFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init.method ?? "GET" });
    if (url.pathname === "/api/v10/users/@me") return Response.json({ id: botId });
    if (url.pathname === `/api/v10/guilds/${guildId}/members/${botId}`) return Response.json({ roles: [botRoleId] });
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: (BigInt(viewChannel) | BigInt(sendMessages)).toString() },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: 0, managed: false },
        { id: decoratedVerifiedOwnerRoleId, name: "\u{1f3c6} Verified Server Owner", position: 4, permissions: 0, managed: false },
        { id: emojiContinuationOwnerRoleId, name: "\u{1f6e1}\ufe0f Verified Server Owner", position: 3, permissions: 0, managed: false },
        { id: nonLatinPrefixedOwnerRoleId, name: "\u{7ba1}\u{7406}\u{8005} Verified Server Owner", position: 3, permissions: 0, managed: false },
        { id: administratorVerifiedOwnerRoleId, name: "Verified Server Owner", position: 6, permissions: administrator, managed: false },
        { id: manageRolesVerifiedOwnerRoleId, name: "Verified Server Owner", position: 7, permissions: manageRoles, managed: false },
        { id: viewChannelVerifiedOwnerRoleId, name: "Verified Server Owner", position: 8, permissions: viewChannel, managed: false },
        { id: malformedVerifiedOwnerRoleId, name: "Verified Server Owner", position: 8, permissions: "not-a-number", managed: false },
        { id: missingPermissionVerifiedOwnerRoleId, name: "Verified Server Owner", position: 8, managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: botPermissions, managed: true },
      ]);
    }
    if (url.pathname === `/api/v10/guilds/${guildId}/channels`) {
      return Response.json([
        { id: categoryId, type: 4, name: "Verified owners", permission_overwrites: [{ id: guildId, type: 0, deny: viewChannel, allow: "0" }] },
        {
          id: privateInviteChannelId,
          type: 0,
          name: "owner-invites",
          parent_id: categoryId,
          permission_overwrites: [
            { id: guildId, type: 0, deny: viewChannel, allow: "0" },
            { id: botRoleId, type: 0, deny: "0", allow: privateInviteChannelPermissions },
          ],
        },
        { id: unsyncedChannelId, type: 0, name: "unsynced-public", parent_id: categoryId, permission_overwrites: [] },
        { id: publicChannelId, type: 0, name: "general", permission_overwrites: [] },
      ]);
    }
    return new Response(null, { status: 404 });
  };

  const result = await discoverOwnerDiscordDeliveryCandidates(env, guildId, discordFetch);
  assert.equal(result.ok, true);
  assert.equal(result.status, "ready_to_configure");
  assert.equal(result.checks.botHasAdministrator, false);
  assert.equal(result.checks.botHasUnexpectedGuildPermissions, false);
  assert.equal(result.checks.canManageRoles, true);
  assert.deepEqual(result.verifiedOwnerRoleCandidates, [
    { id: verifiedOwnerRoleId, name: "Verified Server Owner", assignable: true },
    { id: decoratedVerifiedOwnerRoleId, name: "\u{1f3c6} Verified Server Owner", assignable: true },
    { id: emojiContinuationOwnerRoleId, name: "\u{1f6e1}\ufe0f Verified Server Owner", assignable: true },
  ]);
  assert.equal(result.verifiedOwnerRoleCandidates.every((role) => role.id === verifiedOwnerRoleId || role.id === decoratedVerifiedOwnerRoleId || role.id === emojiContinuationOwnerRoleId), true, "Only a valid zero-permission owner role may be returned as a candidate.");
  assert.equal(result.verifiedOwnerRoleCandidates.some((role) => role.id === nonLatinPrefixedOwnerRoleId), false, "A non-decorative role-name prefix must not be stripped into the owner-access role name.");
  assert.deepEqual(result.rejectedVerifiedOwnerRoles, [
    { id: administratorVerifiedOwnerRoleId, name: "Verified Server Owner", reason: "guild_permissions" },
    { id: manageRolesVerifiedOwnerRoleId, name: "Verified Server Owner", reason: "guild_permissions" },
    { id: viewChannelVerifiedOwnerRoleId, name: "Verified Server Owner", reason: "guild_permissions" },
    { id: malformedVerifiedOwnerRoleId, name: "Verified Server Owner", reason: "invalid_permissions" },
    { id: missingPermissionVerifiedOwnerRoleId, name: "Verified Server Owner", reason: "invalid_permissions" },
  ], "Named owner roles must explain their rejection without becoming configuration candidates.");
  assert.deepEqual(result.privateInviteChannelCandidates, [{
    id: privateInviteChannelId,
    name: "owner-invites",
    categoryName: "Verified owners",
    canView: true,
    canCreateInvite: true,
    privateToEveryone: true,
  }]);
  assert.equal(result.privateInviteChannelCandidates.some((channel) => channel.id === unsyncedChannelId), false, "A child channel without its own @everyone deny must not inherit privacy from a category.");
  assert.equal(calls.every((call) => call.method === "GET"), true, "Discovery must never send a Discord mutation request.");
  assert.equal(JSON.stringify(result).includes(env.DISCORD_BOT_TOKEN ?? ""), false, "Discovery must not expose the private bot token.");

  const administratorBot = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: viewChannel },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: "0", managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: administrator, managed: true },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(administratorBot.ok, false, "Discovery must not report the central Discord as ready while the bot has Administrator.");
  assert.equal(administratorBot.status, "candidates_incomplete");
  assert.equal(administratorBot.checks.botHasAdministrator, true);
  assert.equal(administratorBot.checks.canManageRoles, false, "Administrator must not stand in for the explicit Manage Roles permission.");
  assert.match(administratorBot.message, /removal of the Administrator permission/, "Discovery must require the broad permission to be removed before configuration.");

  const extraPermissionBot = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: viewChannel },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: "0", managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: (BigInt(botPermissions) | BigInt(manageChannels)).toString(), managed: true },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(extraPermissionBot.ok, false, "Discovery must not report the central Discord as ready while the bot retains extra guild permissions.");
  assert.equal(extraPermissionBot.status, "candidates_incomplete");
  assert.equal(extraPermissionBot.checks.botHasUnexpectedGuildPermissions, true);
  assert.match(extraPermissionBot.message, /owner-delivery allowlist/, "Discovery must explain that extra bot guild permissions must be removed.");

  const guildScopedChannelPermissionBot = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: viewChannel },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: "0", managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: (BigInt(botPermissions) | BigInt(viewChannel)).toString(), managed: true },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(guildScopedChannelPermissionBot.ok, false, "View Channel must not be accepted through a bot's guild role.");
  assert.equal(guildScopedChannelPermissionBot.checks.botHasUnexpectedGuildPermissions, true);

  const inheritedAdministratorBot = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: administrator },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: "0", managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: botPermissions, managed: true },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(inheritedAdministratorBot.ok, false, "Inherited @everyone Administrator must block discovery.");
  assert.equal(inheritedAdministratorBot.checks.botHasAdministrator, true);

  const inheritedExtraPermissionBot = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: manageChannels },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: "0", managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: botPermissions, managed: true },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(inheritedExtraPermissionBot.ok, false, "Inherited @everyone management permissions must block discovery.");
  assert.equal(inheritedExtraPermissionBot.checks.botHasUnexpectedGuildPermissions, true);

  const inheritedPinMessagesBot = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: pinMessages },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: "0", managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: botPermissions, managed: true },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(inheritedPinMessagesBot.ok, false, "Inherited @everyone Pin Messages must block discovery.");
  assert.equal(inheritedPinMessagesBot.checks.botHasUnexpectedGuildPermissions, true);

  const overlappingManageRolesBot = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: manageRoles },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: "0", managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: botPermissions, managed: true },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(overlappingManageRolesBot.ok, false, "Inherited @everyone Manage Roles must block discovery even when the bot role also grants it.");
  assert.equal(overlappingManageRolesBot.checks.botHasUnexpectedGuildPermissions, true);

  const administratorRoleOnly = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: viewChannel },
        { id: administratorVerifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: administrator, managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: botPermissions, managed: true },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(administratorRoleOnly.status, "candidates_incomplete", "A Verified Server Owner role with Administrator must never be configurable.");
  assert.equal(administratorRoleOnly.verifiedOwnerRoleCandidates.length, 0, "Administrator roles must not be returned as owner-role candidates.");
  assert.deepEqual(administratorRoleOnly.rejectedVerifiedOwnerRoles, [{
    id: administratorVerifiedOwnerRoleId,
    name: "Verified Server Owner",
    reason: "guild_permissions",
  }]);

  const manageRolesRoleOnly = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: viewChannel },
        { id: manageRolesVerifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: manageRoles, managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: botPermissions, managed: true },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(manageRolesRoleOnly.status, "candidates_incomplete", "A Verified Server Owner role with Manage Roles must never be configurable.");
  assert.equal(manageRolesRoleOnly.verifiedOwnerRoleCandidates.length, 0, "Roles with guild-wide permissions must not be returned as owner-role candidates.");
  assert.deepEqual(manageRolesRoleOnly.rejectedVerifiedOwnerRoles, [{
    id: manageRolesVerifiedOwnerRoleId,
    name: "Verified Server Owner",
    reason: "guild_permissions",
  }]);

  const mixedBlockers = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: viewChannel },
        { id: administratorVerifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: administrator, managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: viewChannel, managed: true },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(mixedBlockers.checks.canManageRoles, false, "The fixture must prove the bot role-management blocker.");
  assert.match(mixedBlockers.message, /normal zero-permission Discord role/, "The message must retain the role-safety guidance.");
  assert.match(mixedBlockers.message, /explicit Manage Roles permission/, "The message must retain every independent prerequisite.");

  const privateGuildResult = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: "0" },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: "0", managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: botPermissions, managed: true },
      ]);
    }
    if (url.pathname === `/api/v10/guilds/${guildId}/channels`) {
      return Response.json([{
        id: privateGuildChannelId,
        type: 0,
        name: "private-invites",
        permission_overwrites: [{ id: botRoleId, type: 0, deny: "0", allow: privateInviteChannelPermissions }],
      }]);
    }
    return discordFetch(input, init);
  });
  assert.equal(privateGuildResult.status, "ready_to_configure", "A channel hidden by the guild's base @everyone permissions must be a valid private candidate.");
  assert.deepEqual(privateGuildResult.privateInviteChannelCandidates, [{
    id: privateGuildChannelId,
    name: "private-invites",
    categoryName: null,
    canView: true,
    canCreateInvite: true,
    privateToEveryone: true,
  }]);

  const unscopedPrivateGuildResult = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/roles`) {
      return Response.json([
        { id: guildId, name: "@everyone", position: 0, permissions: "0" },
        { id: verifiedOwnerRoleId, name: "Verified Server Owner", position: 5, permissions: "0", managed: false },
        { id: botRoleId, name: "DZN Bot", position: 10, permissions: botPermissions, managed: true },
      ]);
    }
    if (url.pathname === `/api/v10/guilds/${guildId}/channels`) {
      return Response.json([{
        id: privateGuildChannelId,
        type: 0,
        name: "private-invites",
        permission_overwrites: [],
      }]);
    }
    return discordFetch(input, init);
  });
  assert.equal(unscopedPrivateGuildResult.status, "candidates_incomplete", "A private channel still needs the explicit bot-channel overwrite.");
  assert.equal(unscopedPrivateGuildResult.privateInviteChannelCandidates.length, 0);

  const unsafeChannelOverwrites = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/v10/guilds/${guildId}/channels`) {
      return Response.json([
        {
          id: privateInviteChannelId,
          type: 0,
          name: "unsafe-role-overwrite",
          permission_overwrites: [
            { id: guildId, type: 0, deny: viewChannel, allow: "0" },
            { id: botRoleId, type: 0, deny: "0", allow: (BigInt(privateInviteChannelPermissions) | BigInt(manageChannels)).toString() },
          ],
        },
        {
          id: privateGuildChannelId,
          type: 0,
          name: "unsafe-member-overwrite",
          permission_overwrites: [
            { id: guildId, type: 0, deny: viewChannel, allow: "0" },
            { id: botRoleId, type: 0, deny: "0", allow: privateInviteChannelPermissions },
            { id: botId, type: 1, deny: "0", allow: manageChannels },
          ],
        },
        {
          id: unsyncedChannelId,
          type: 0,
          name: "unsafe-everyone-overwrite",
          permission_overwrites: [
            { id: guildId, type: 0, deny: viewChannel, allow: manageChannels },
            { id: botRoleId, type: 0, deny: "0", allow: privateInviteChannelPermissions },
          ],
        },
      ]);
    }
    return discordFetch(input, init);
  });
  assert.equal(unsafeChannelOverwrites.status, "candidates_incomplete", "Discovery must not offer private invite channels whose bot overwrites grant extra permissions.");
  assert.equal(unsafeChannelOverwrites.privateInviteChannelCandidates.length, 0, "Unsafe role, member, and @everyone overwrites must be excluded from configuration candidates.");

  const missingGuild = await discoverOwnerDiscordDeliveryCandidates(env, "invalid", discordFetch);
  assert.equal(missingGuild.status, "not_configured");
  assert.equal(missingGuild.checks.botIdentity, false);

  const botMissing = await discoverOwnerDiscordDeliveryCandidates(env, guildId, async () => new Response(null, { status: 401 }));
  assert.equal(botMissing.status, "not_connected");
  assert.equal(botMissing.verifiedOwnerRoleCandidates.length, 0);

  console.log("Owner Discord delivery discovery checks passed.");
}

void run();
