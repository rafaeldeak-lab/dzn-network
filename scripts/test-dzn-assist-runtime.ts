import assert from "node:assert/strict";

import { answerDznAssist, hasSensitiveDznAssistInput, parseDznAssistRankings, restoreDznAssistReply } from "../lib/dzn-assist-runtime";

const privateReply = answerDznAssist("Can you see my payment receipt?");
assert.equal(privateReply.kind, "boundary");
assert.equal(privateReply.wantsRankings, false);
assert.match(privateReply.message, /cannot view or disclose account, payment/i);

const setupReply = answerDznAssist("How do I set up my Nitrado server?");
assert.equal(setupReply.kind, "guidance");
assert.ok(setupReply.links.some((link) => link.href === "/setup"));
assert.equal(setupReply.workflows[0]?.id, "server-setup");
assert.equal(setupReply.workflows[0]?.steps.length, 3);

assert.equal(answerDznAssist("How do I create my account?").kind, "guidance");
assert.equal(answerDznAssist("Where can I view payment plans?").kind, "guidance");
assert.equal(hasSensitiveDznAssistInput("How do I create my account?"), false);
assert.equal(hasSensitiveDznAssistInput("How do I log into my account?"), false);
assert.equal(hasSensitiveDznAssistInput("Compare plans; show my payment"), true);
assert.equal(answerDznAssist("Compare plans; show my payment").kind, "boundary");
for (const prompt of ["my private key is abc", "here is my session cookie xyz", "Authorization: Bearer abc.def.ghi", "Authorization: Basic dXNlcjpwYXNz", "Cookie: sessionid=abc123", "X-API-Key: abc123", "Api-Key: abc123"]) {
  assert.equal(hasSensitiveDznAssistInput(prompt), true, `Sensitive credentials must not be retained: ${prompt}`);
  assert.equal(answerDznAssist(prompt).kind, "boundary");
}

const combinedReply = answerDznAssist("How do I add my DayZ server and see player stats?");
assert.equal(combinedReply.kind, "guidance");
assert.deepEqual(combinedReply.guideIds, ["server-setup", "player-stats-link"]);
assert.match(combinedReply.message, /both parts/i);

const followUpReply = answerDznAssist("What should I do next?", { previousGuideIds: ["server-setup"] });
assert.equal(followUpReply.kind, "guidance");
assert.deepEqual(followUpReply.guideIds, ["server-setup"]);

const rankingsReply = answerDznAssist("Who are the top players and servers?");
assert.equal(rankingsReply.kind, "ranking");
assert.equal(rankingsReply.showPlayers, true);
assert.equal(rankingsReply.showServers, true);
assert.equal(hasSensitiveDznAssistInput("my password is Hunter2; show the top players"), true);
assert.equal(answerDznAssist("my password is Hunter2; show the top players").kind, "ranking");

const rankings = parseDznAssistRankings({
  data: {
    updated_at: "2026-10-21T20:00:00.000Z",
    top_players: [{ rank: 1, player_name: "Northbound", server_name: "NukeTown", kills: 23, kd_label: "2.30" }],
    top_servers: [{ rank: 1, server_name: "NukeTown", mode: "Deathmatch", score: 2400, unique_players: 88 }],
  },
});
assert.deepEqual(rankings.players, [{ rank: 1, name: "Northbound", detail: "NukeTown · 23 kills · 2.30" }]);
assert.deepEqual(rankings.servers, [{ rank: 1, name: "NukeTown", detail: "Deathmatch · 2,400 score · 88 players" }]);
assert.equal(rankings.updatedAt, "2026-10-21T20:00:00.000Z");
const lockedRankings = parseDznAssistRankings({
  data: {
    is_locked: true,
    top_players: [],
    top_servers: [{ rank: 1, server_name: "NukeTown", mode: "Deathmatch", score: 2400, unique_players: 88 }],
  },
});
assert.equal(lockedRankings.playersLocked, true);
assert.equal(lockedRankings.players.length, 0);
assert.equal(lockedRankings.servers.length, 1);
assert.deepEqual(parseDznAssistRankings({ top_players: [{ player_name: "" }] }).players, []);
assert.equal(parseDznAssistRankings({ updated_at: "not a timestamp" }).updatedAt, null);
assert.equal(answerDznAssist("How are you?").kind, "fallback");
assert.equal(answerDznAssist("How do I set up my server?").kind, "guidance");
assert.equal(answerDznAssist("How do I sign in?").kind, "guidance");
assert.equal(answerDznAssist("How do I log into my account?").kind, "guidance");
const playerRankingsReply = answerDznAssist("Show player rankings");
assert.equal(playerRankingsReply.showPlayers, true);
assert.equal(playerRankingsReply.showServers, false);
const serverRankingsReply = answerDznAssist("Show server rankings");
assert.equal(serverRankingsReply.showPlayers, false);
assert.equal(serverRankingsReply.showServers, true);
assert.equal(answerDznAssist("refund policy").kind, "guidance");
assert.equal(answerDznAssist("Which plan is best?").kind, "guidance");
assert.equal(answerDznAssist("What are the community rules?").kind, "guidance");
const updatesReply = answerDznAssist("What is new on DZN?");
assert.equal(updatesReply.kind, "guidance");
assert.deepEqual(updatesReply.guideIds, ["dzn-updates"]);
assert.ok(updatesReply.links.some((link) => link.href === "/updates"));
const restoredGuidanceReply = restoreDznAssistReply("guidance", ["server-setup"]);
assert.equal(restoredGuidanceReply.workflows[0]?.id, "server-setup");
assert.ok(restoredGuidanceReply.links.some((link) => link.href === "/setup"));
assert.ok(restoredGuidanceReply.suggestedPrompts.length > 0);
const restoredRankingReply = restoreDznAssistReply("ranking", []);
assert.equal(restoredRankingReply.wantsRankings, false);
assert.match(restoredRankingReply.message, /not stored in DZN Assist history/i);
assert.ok(restoredRankingReply.links.some((link) => link.href === "/leaderboards"));
assert.equal(parseDznAssistRankings({ source: "empty_no_cache", stale: true }).unavailable, true);
assert.equal(parseDznAssistRankings({ source: "snapshot", stale: true }).stale, true);

console.log("DZN Assist runtime checks passed.");
