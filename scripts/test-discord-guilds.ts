import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { canManageDiscordGuild } from "../functions/_lib/discord";

assert.equal(canManageDiscordGuild({ owner: true, permissions: "0" }), true);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "8" }), true);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "1099511627784" }), true);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "0" }), false);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "not-a-number" }), false);

const botStatusSource = readFileSync("functions/api/discord/bot-status.ts", "utf8");
assert.equal(botStatusSource.includes("DISCORD_BOT_TOKEN"), true);
assert.equal(botStatusSource.includes("fetchDiscordPostingChannels"), true);
assert.equal(botStatusSource.includes("bot_not_in_guild"), true);
assert.equal(botStatusSource.includes("permissions\", \"8\""), true);
assert.equal(botStatusSource.includes("channels_fetched_count"), true);
assert.equal(botStatusSource.includes("postable_channels_count"), true);
assert.equal(botStatusSource.includes("canManageDiscordGuild"), true);

const setupWizardSource = readFileSync("components/onboarding/setup-wizard.tsx", "utf8");
assert.equal(setupWizardSource.includes("Add DZN Bot"), true);
assert.equal(setupWizardSource.includes("Verify Bot Connection"), true);
assert.equal(setupWizardSource.includes("Connecting a Discord server lets DZN know which server you own"), true);
assert.equal(setupWizardSource.includes("Installing the DZN bot lets DZN read channels"), true);
assert.equal(setupWizardSource.includes("discordBotConnected"), true);
assert.equal(setupWizardSource.includes("discordChannelsAvailable"), true);
assert.equal(setupWizardSource.includes("DZN Bot is not installed in this Discord server yet"), true);

console.log("Discord guild permission tests passed.");
