import assert from "node:assert/strict";

import { answerDznAssist, parseDznAssistRankings } from "../lib/dzn-assist-runtime";

const privateReply = answerDznAssist("Can you see my payment receipt?");
assert.equal(privateReply.kind, "boundary");
assert.equal(privateReply.wantsRankings, false);
assert.match(privateReply.message, /cannot view or disclose account, payment/i);

const setupReply = answerDznAssist("How do I set up my Nitrado server?");
assert.equal(setupReply.kind, "guide");
assert.ok(setupReply.links.some((link) => link.href === "/setup"));

const rankingsReply = answerDznAssist("Who are the top players and servers?");
assert.equal(rankingsReply.kind, "ranking");
assert.equal(rankingsReply.showPlayers, true);
assert.equal(rankingsReply.showServers, true);

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
assert.deepEqual(parseDznAssistRankings({ top_players: [{ player_name: "" }] }).players, []);
assert.equal(parseDznAssistRankings({ updated_at: "not a timestamp" }).updatedAt, null);
assert.equal(answerDznAssist("How are you?").kind, "fallback");
assert.equal(answerDznAssist("How do I set up my server?").kind, "guide");
assert.equal(answerDznAssist("How do I sign in?").kind, "guide");
assert.equal(answerDznAssist("refund policy").kind, "guide");
assert.equal(answerDznAssist("Which plan is best?").kind, "guide");
assert.equal(answerDznAssist("What are the community rules?").kind, "guide");
assert.equal(parseDznAssistRankings({ source: "empty_no_cache", stale: true }).unavailable, true);
assert.equal(parseDznAssistRankings({ source: "snapshot", stale: true }).stale, true);

console.log("DZN Assist runtime checks passed.");
