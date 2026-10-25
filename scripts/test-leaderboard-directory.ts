import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizePublicLeaderboardOptions,
  PUBLIC_LEADERBOARD_DIRECTORY_CAP,
} from "../functions/_lib/public-leaderboards";

const directoryOptions = normalizePublicLeaderboardOptions({
  directory: "players",
  page: 99,
  pageSize: 999,
});
assert.equal(PUBLIC_LEADERBOARD_DIRECTORY_CAP, 250, "The public directory cap should keep browsing bounded.");
assert.equal(directoryOptions.full, true, "Directory requests must use the complete bounded result path.");
assert.equal(directoryOptions.directory, "players");
assert.equal(directoryOptions.page, 1, "Directory results are a single stable ranking snapshot.");
assert.equal(directoryOptions.pageSize, 250, "The directory should return the full bounded ranking in one request.");
assert.equal(normalizePublicLeaderboardOptions({ directory: "unknown" }).directory, null, "Unknown directory scopes must fail closed.");

const apiRoute = readFileSync("functions/api/public/leaderboards.ts", "utf8");
const library = readFileSync("functions/_lib/public-leaderboards.ts", "utf8");
const page = readFileSync("app/leaderboards/page.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

assert.match(apiRoute, /normalizePublicLeaderboardDirectory/, "The public route must validate directory scopes.");
assert.match(apiRoute, /directory:\$\{leaderboardOptions\.directory\}/, "Directory snapshots must not collide with the Top 10 cache.");
assert.match(library, /getPublicLeaderboardDirectoryPayload/, "Directory data must bypass unrelated advanced-board work.");
assert.match(library, /getRankedPublicServers\(env, PUBLIC_LEADERBOARD_DIRECTORY_CAP, options\.mode\)/, "Server directory ranks must use the canonical ranking source.");
assert.match(library, /getTopPlayers\(env, PUBLIC_LEADERBOARD_DIRECTORY_CAP\)/, "Player directory ranks must use the canonical ranking source.");
assert.match(page, /directory,\s*\n\s*full: "true"/, "The browser must request the bounded directory scope.");
assert.match(page, /initialError \|\| payload\.is_locked/, "Locked leaderboard previews must not fetch the private directory.");
assert.match(page, /Full Server Ranking/, "The server browse panel must be visible.");
assert.match(page, /Full Player Ranking/, "The player browse panel must be visible.");
assert.match(page, /Search a server or mode/, "Server search should be discoverable.");
assert.match(page, /Search a player or server/, "Player search should be discoverable.");
assert.match(page, /Show \{Math\.min\(DIRECTORY_VISIBLE_STEP/, "Long lists must reveal progressively.");
assert.match(styles, /\.leaderboard-ref-directory-scroll/, "Long rankings must have a contained, usable scroll area.");
assert.match(styles, /@media \(max-width: 760px\)/, "The established mobile table treatment must continue to apply.");

console.log("Leaderboard directory contract tests passed.");
