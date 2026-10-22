import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleGamesCipherGrid } from "../functions/_lib/games-cipher-grid";
import { handleGamesCircuitForge } from "../functions/_lib/games-circuit-forge";
import { handleGamesEchoArray } from "../functions/_lib/games-echo-array";
import { handleGamesHideSeek } from "../functions/_lib/games-hide-seek";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { handleGamesNightRun } from "../functions/_lib/games-night-run";
import { handleGamesOutpostRun } from "../functions/_lib/games-outpost-run";
import { handleGamesRangerRange } from "../functions/_lib/games-ranger-range";
import { handleGamesRelayRush } from "../functions/_lib/games-relay-rush";
import { handleGamesSignalShift } from "../functions/_lib/games-signal-shift";
import { handleGamesTrivia } from "../functions/_lib/games-trivia";
import { handleGamesWordChain } from "../functions/_lib/games-word-chain";
import type { Env } from "../functions/_lib/types";
import { gamesFixture } from "./lib/games-hub-local";

const pageSource = readFileSync("app/games/page.tsx", "utf8");
const maintenanceSource = readFileSync("components/games/games-hub-maintenance.tsx", "utf8");
const updatesSource = readFileSync("lib/dzn-updates.ts", "utf8");
const productionConfig = readFileSync("wrangler.toml", "utf8");

assert.match(pageSource, /GamesHubMaintenance/, "The public Games route must render the maintenance state.");
assert.doesNotMatch(pageSource, /import\s+\{\s*GamesHub\s*\}/, "The public Games route must not mount the playable Games Hub during maintenance.");
assert.match(pageSource, /DZN Games Hub Maintenance/, "Maintenance metadata must accurately describe the public route.");

assert.match(maintenanceSource, /Games Hub is under maintenance\./, "Visitors need an unambiguous maintenance heading.");
assert.match(maintenanceSource, /Existing verified player records remain protected\./, "The maintenance notice must state that records are not being reset.");
assert.match(maintenanceSource, /href="\/community"/, "Maintenance visitors must have a direct Community route.");
assert.match(maintenanceSource, /href="\/updates"/, "Maintenance visitors must have a direct official-updates route.");
assert.doesNotMatch(maintenanceSource, /\/login\?returnTo=%2Fgames/, "Maintenance mode must not encourage visitors to sign in and play.");
assert.doesNotMatch(maintenanceSource, /game catalogue/i, "Maintenance mode must not display a playable-mode catalogue.");

assert.match(updatesSource, /games-hub-maintenance-window/, "The official update feed must record the Games Hub maintenance window.");
assert.match(updatesSource, /Games Hub is temporarily closed for maintenance/, "The official update feed must describe the public Games state accurately.");
assert.match(productionConfig, /DZN_GAMES_HUB_ENABLED = "false"/, "The production Games Hub gate must be off while the public maintenance page is active.");

type GameHandler = (request: Request, env: Env) => Promise<Response>;

async function verifyMaintenanceBlocksAllGameWrites() {
  const fixture = await gamesFixture();
  try {
    fixture.env.DZN_GAMES_HUB_ENABLED = "false";
    const handlers: Array<{ name: string; path: string; status: number; handler: GameHandler }> = [
      { name: "Games Hub", path: "hub", status: 503, handler: handleGamesHub },
      { name: "Trivia", path: "trivia", status: 404, handler: handleGamesTrivia },
      { name: "Word Chain", path: "word-chain", status: 404, handler: handleGamesWordChain },
      { name: "Signal Hunt", path: "hide-seek", status: 404, handler: handleGamesHideSeek },
      { name: "Relay Rush", path: "relay-rush", status: 404, handler: handleGamesRelayRush },
      { name: "Cipher Grid", path: "cipher-grid", status: 404, handler: handleGamesCipherGrid },
      { name: "Echo Array", path: "echo-array", status: 404, handler: handleGamesEchoArray },
      { name: "Outpost Run", path: "outpost-run", status: 404, handler: handleGamesOutpostRun },
      { name: "Signal Shift", path: "signal-shift", status: 404, handler: handleGamesSignalShift },
      { name: "Circuit Forge", path: "circuit-forge", status: 404, handler: handleGamesCircuitForge },
      { name: "Ranger Range", path: "ranger-range", status: 404, handler: handleGamesRangerRange },
      { name: "Night Run", path: "night-run", status: 404, handler: handleGamesNightRun },
    ];
    const before = fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM dzn_game_reward_ledger").get()?.count;

    for (const game of handlers) {
      const url = `https://local.test/api/games/${game.path}`;
      const read = await game.handler(new Request(url, { headers: { cookie: fixture.cookie } }), fixture.env);
      assert.equal(read.status, game.status, `${game.name} reads must remain closed during maintenance.`);

      const write = await game.handler(new Request(url, {
        method: "POST",
        headers: { cookie: fixture.cookie, origin: "https://local.test", "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      }), fixture.env);
      assert.equal(write.status, game.status, `${game.name} writes must remain closed during maintenance.`);
    }

    const after = fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM dzn_game_reward_ledger").get()?.count;
    assert.equal(after, before, "Maintenance requests must not award XP or parts.");
  } finally {
    fixture.db.sqlite.close();
  }
}

void verifyMaintenanceBlocksAllGameWrites()
  .then(() => console.log("Games Hub maintenance checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
