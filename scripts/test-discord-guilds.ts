import assert from "node:assert/strict";

import { canManageDiscordGuild } from "../functions/_lib/discord";

assert.equal(canManageDiscordGuild({ owner: true, permissions: "0" }), true);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "8" }), true);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "1099511627784" }), true);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "0" }), false);
assert.equal(canManageDiscordGuild({ owner: false, permissions: "not-a-number" }), false);

console.log("Discord guild permission tests passed.");
