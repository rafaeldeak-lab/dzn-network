import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("functions/api/public/servers.ts", "utf8");

assert.equal(source.includes("live_query_failed_using_snapshot"), true, "Public servers should use last-good snapshots when available.");
assert.equal(source.includes("live_query_failed_no_snapshot"), true, "Public servers should report no-snapshot fallback state.");
assert.equal(source.includes("status: 200"), true, "No-snapshot public servers fallback should return controlled 200.");
assert.equal(source.includes("servers: []"), true, "No-snapshot public servers fallback should provide an empty safe server list.");
assert.equal(source.includes("server: slug ? null : undefined"), true, "No-snapshot public server profile fallback should not throw.");

console.log("Public servers fallback tests passed.");
