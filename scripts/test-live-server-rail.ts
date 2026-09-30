import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/public/server-rail";

void main();

async function main() {
const source = readFileSync("components/servers/live-server-rail.tsx", "utf8");

for (const fabricatedLabel of [
  "Servers joining beta now",
  "Compare Starter and Pro",
  "Pro adverts unlock visuals",
  "Beta onboarding",
]) {
  assert.equal(source.includes(fabricatedLabel), false, `Server rail must not render fabricated fallback content: ${fabricatedLabel}`);
}

assert.equal(source.includes('hasItems ? ('), true, "Real rail cards must require returned server items.");
assert.equal(source.includes('role="status"'), true, "Empty and loading states must be announced accessibly.");
assert.equal(source.includes("No public server listings are available right now"), true);
assert.equal(source.includes("Server listings are temporarily unavailable"), true, "Failed and stale responses need a distinct unavailable state.");
assert.equal(source.includes("setResponseStale(true)"), true, "Invalid and failed responses must not be presented as a successful empty result.");
assert.equal(source.includes('href="/servers"'), true, "The truthful empty state should link to the server directory.");
assert.equal(source.includes("[...items, ...items]"), false, "The animated rail must not clone visible server cards.");
assert.equal(source.includes("dedupeRailItems(items)"), true, "The client must defensively deduplicate server identities.");
assert.equal(source.includes('item.playerCountStatus !== "fresh"'), true, "Stale player counts must not be presented as live values.");

const missingDbResponse = await invokeRail({});
assert.equal(missingDbResponse.status, 200);
const missingDbPayload = await missingDbResponse.json() as { ok?: boolean; items?: unknown[]; generated_at?: string; stale?: boolean };
assert.equal(missingDbPayload.ok, true);
assert.deepEqual(missingDbPayload.items, []);
assert.equal(missingDbPayload.stale, true, "A missing D1 binding must be reported as unavailable rather than an empty network.");
assert.equal(Number.isNaN(Date.parse(missingDbPayload.generated_at ?? "")), false);

const duplicateRow = {
  id: "server-one",
  nitrado_service_id: "service-one",
  public_slug: "nuketown-deathmatch",
  server_name: "NukeTown DEATHMATCH",
  server_type: "Deathmatch",
  guild_icon_url: null,
  current_players: 7,
  max_players: 20,
  player_count_status: "fresh",
  average_rating: 4.8,
  review_count: 28,
  plan_key: "pro",
  subscription_status: "active",
  last_bumped_at: null,
};
const duplicateDbResponse = await invokeRail({
  DB: {
    prepare: () => ({
      all: async () => ({ results: [duplicateRow, { ...duplicateRow, id: "legacy-duplicate", public_slug: "legacy-nuketown" }] }),
    }),
  },
});
const duplicatePayload = await duplicateDbResponse.json() as { items?: Array<{ id: string; slug: string | null }> };
assert.deepEqual(duplicatePayload.items?.map(({ id, slug }) => ({ id, slug })), [
  { id: "server-one", slug: "nuketown-deathmatch" },
], "The public API must deduplicate canonical server identities.");

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
assert.equal(packageJson.scripts?.test?.includes("npm run test:live-server-rail"), true, "The main test suite must enforce the rail regression checks.");

const css = readFileSync("app/globals.css", "utf8");
assert.match(css, /\.dzn-live-server-rail__track\s*\{[\s\S]*animation:\s*dznLiveServerRail/, "The unique-card rail should retain motion.");
assert.equal(css.includes("@keyframes dznLiveServerRailSingle"), true, "A single real server should keep subtle movement without cloning.");

console.log("Live server rail truthfulness tests passed.");
}

function invokeRail(env: object) {
  return onRequest({
    request: new Request("https://dayz-network.com/api/public/server-rail"),
    env,
  } as unknown as Parameters<typeof onRequest>[0]);
}
