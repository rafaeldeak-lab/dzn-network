import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isCurrentTimeInGracePeriod,
  renderAsciiProgressBlocks,
} from "../functions/_lib/ctf-tournaments";
import { buildChallengePhaseTemplates, renderEventProgressBar } from "../functions/_lib/event-hub";

const migration = readFileSync("migrations/0030_ctf_bot_tournament_engine.sql", "utf8");
for (const snippet of [
  "ALTER TABLE linked_servers ADD COLUMN bot_access_token TEXT",
  "ALTER TABLE linked_servers ADD COLUMN tournament_channel_id TEXT",
  "ALTER TABLE linked_servers ADD COLUMN is_searching_for_match INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE kill_events ADD COLUMN event_hash TEXT",
  "ALTER TABLE player_events ADD COLUMN event_hash TEXT",
  "CREATE TABLE IF NOT EXISTS ctf_tournaments",
  "CREATE TABLE IF NOT EXISTS ctf_match_participants",
  "CREATE TABLE IF NOT EXISTS ctf_tournament_rosters",
  "CREATE TABLE IF NOT EXISTS server_activity_index",
  "CREATE TABLE IF NOT EXISTS server_discord_webhooks",
  "CREATE TABLE IF NOT EXISTS ctf_event_audit",
]) {
  assert.equal(migration.includes(snippet), true, `Missing migration snippet: ${snippet}`);
}

const ctfSource = readFileSync("functions/_lib/ctf-tournaments.ts", "utf8");
for (const snippet of [
  "processServerMatchmakingOptIn",
  "STRICT_MATCHMAKING_PLANS",
  "[\"pro\", \"premium\", \"network\", \"partner\"]",
  "dispatchUnifiedRegistrationEmbed",
  "Link Profile & Verify Entry",
  "Anti-alt roster lock",
  "Exact gamertag verification",
  "components: [{",
  "style: 5",
  "getActiveCtfCampaign",
  "shouldCountBattleActiveEvent",
  "player_not_on_locked_roster",
  "target_metric",
  "target_flag_points",
  "broadcast_interval_minutes",
  "renderAsciiProgressBlocks",
  "grace_period_freeze",
  "DZN CTF SCORECARD LOOP COMPLETE",
]) {
  assert.equal(ctfSource.includes(snippet), true, `Missing CTF engine snippet: ${snippet}`);
}

const eventHubSource = readFileSync("functions/_lib/event-hub.ts", "utf8");
for (const snippet of [
  "processDueEventScoring",
  "event_challenge_phases",
  "event_phase_scores",
  "event_discord_messages",
  "message_id",
  "last_payload_hash",
  "sendOrEditEventDiscordMessage",
  "PATCH",
  "phase_live",
  "phase_final",
  "pvp_headshot_count",
  "build_score",
  "calculatePhaseScore",
  "kill_events",
  "build_events",
]) {
  assert.equal(eventHubSource.includes(snippet), true, `Missing Event Hub tournament scoring snippet: ${snippet}`);
}
assert.equal(eventHubSource.includes("readNitrado"), false, "Event scoring must not read Nitrado directly.");
assert.equal(eventHubSource.includes("TOKEN_ENCRYPTION_KEY"), false, "Event scoring must not touch Nitrado token handling.");

assert.equal(renderAsciiProgressBlocks(0, 1000), "⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛");
assert.equal(renderAsciiProgressBlocks(500, 1000), "🟩🟩🟩🟩🟩⬛⬛⬛⬛⬛");
assert.equal(renderAsciiProgressBlocks(1000, 1000), "🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩");
assert.equal(isCurrentTimeInGracePeriod('{"start":"02:00","end":"06:00"}', new Date("2026-05-21T03:15:00Z")), true);
assert.equal(isCurrentTimeInGracePeriod('{"start":"22:00","end":"06:00"}', new Date("2026-05-21T23:15:00Z")), true);
assert.equal(isCurrentTimeInGracePeriod('{"start":"22:00","end":"06:00"}', new Date("2026-05-21T12:15:00Z")), false);
assert.equal(buildChallengePhaseTemplates("pvp_pve", "capture_the_flag").length, 6);
assert.equal(buildChallengePhaseTemplates("deathmatch", "capture_the_flag").every((phase) => phase.metricType.startsWith("pvp_")), true);
assert.equal(buildChallengePhaseTemplates("pve", "survival_challenge").some((phase) => phase.metricType === "build_score"), true);
assert.equal(renderEventProgressBar(145, 92).includes("🏳️"), true);

const onboardingSave = readFileSync("functions/api/onboarding/save.ts", "utf8");
assert.equal(onboardingSave.includes("saveBotOnboardingConfig"), true);
assert.equal(onboardingSave.includes("tournamentChannelId"), true);
assert.equal(onboardingSave.includes("botAccessToken"), true);

const workflow = readFileSync(".github/workflows/dzn-adm-sync.yml", "utf8");
assert.equal(workflow.includes("CTF scorecards: skipped; status=handled by CTF scorecard cadence outside ADM backup workflow"), true);
assert.equal(workflow.includes("/api/sync/ctf-scorecards/run"), false);

const packageSource = readFileSync("package.json", "utf8");
assert.equal(packageSource.includes("\"test:ctf-tournament-engine\": \"tsx scripts/test-ctf-tournament-engine.ts\""), true);

console.log("CTF tournament bot engine tests passed.");
