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

const railRouteSource = readFileSync("functions/api/public/server-rail.ts", "utf8");
assert.doesNotMatch(railRouteSource, /LIMIT\s+96/i, "Canonical server selection must happen before the public rail limit.");
assert.match(railRouteSource, /readPublicServerCanonicalEvidence/, "Duplicate service records must use authoritative canonical evidence.");

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
  rail_priority_at: "2026-09-30T12:00:00.000Z",
  adm_logs_found: 1,
  adm_sync_status: "completed",
  total_kills: 5,
  unique_players: 3,
  latest_success_sync_status: "completed",
};
const duplicateDbResponse = await invokeRail({
  DB: createRailDb([
          { ...duplicateRow, id: "legacy-duplicate", public_slug: "legacy-nuketown", total_kills: 500, unique_players: 500, adm_logs_found: 0, adm_sync_status: null, latest_success_sync_status: null },
          duplicateRow,
          ...Array.from({ length: 24 }, (_, index) => ({
            ...duplicateRow,
            id: `server-${index + 2}`,
            nitrado_service_id: `service-${index + 2}`,
            public_slug: `server-${index + 2}`,
            rail_priority_at: "2026-09-29T12:00:00.000Z",
          })),
        ], {
          kills: { "legacy-duplicate": 0, "server-one": 5 },
          players: { "legacy-duplicate": 0, "server-one": 3 },
        }),
});
const duplicatePayload = await duplicateDbResponse.json() as { items?: Array<{ id: string; slug: string | null }> };
assert.equal(duplicatePayload.items?.length, 24, "Duplicate rows must not consume the 24 unique-server rail limit.");
const canonicalDuplicateItem = duplicatePayload.items?.find(({ id }) => id === "server-one");
assert.deepEqual(canonicalDuplicateItem && { id: canonicalDuplicateItem.id, slug: canonicalDuplicateItem.slug }, {
  id: "server-one",
  slug: "nuketown-deathmatch",
});
assert.equal(duplicatePayload.items?.some(({ id }) => id === "legacy-duplicate"), false, "The public API must deduplicate canonical server identities.");

const namespaceCollisionResponse = await invokeRail({
  DB: createRailDb([
          { ...duplicateRow, id: "service-owner", nitrado_service_id: "12345", public_slug: "service-owner" },
          { ...duplicateRow, id: "numeric-slug", nitrado_service_id: null, public_slug: "12345" },
        ]),
});
const namespaceCollisionPayload = await namespaceCollisionResponse.json() as { items?: Array<{ id: string }> };
assert.equal(namespaceCollisionPayload.items?.length, 2, "Service IDs and public slugs must use separate identity namespaces.");

const priorityOrderingResponse = await invokeRail({
  DB: createRailDb([
          { ...duplicateRow, id: "stale-paid", nitrado_service_id: "shared-service", total_kills: 0, unique_players: 0 },
          ...Array.from({ length: 24 }, (_, index) => ({
            ...duplicateRow,
            id: `paid-${index + 1}`,
            nitrado_service_id: `paid-${index + 1}`,
            public_slug: `paid-${index + 1}`,
          })),
          {
            ...duplicateRow,
            id: "canonical-free",
            nitrado_service_id: "shared-service",
            public_slug: "canonical-free",
            plan_key: "free",
            subscription_status: null,
            rail_priority_at: "2026-01-01T00:00:00.000Z",
            total_kills: 50,
          },
        ], {
          kills: { "stale-paid": 0, "canonical-free": 50 },
          players: { "stale-paid": 0, "canonical-free": 3 },
        }),
});
const priorityOrderingPayload = await priorityOrderingResponse.json() as { items?: Array<{ id: string }> };
assert.equal(priorityOrderingPayload.items?.length, 24);
assert.equal(priorityOrderingPayload.items?.some(({ id }) => id === "canonical-free"), false, "A free canonical replacement must not inherit a stale paid row's rail position.");
assert.equal(priorityOrderingPayload.items?.every(({ id }) => id.startsWith("paid-")), true, "Paid rail priority must be reapplied after canonical selection.");

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

function createRailDb(
  candidates: Array<Record<string, unknown>>,
  evidence: { kills?: Record<string, number>; players?: Record<string, number> } = {},
) {
  return {
    prepare: (query: string) => {
      if (query.includes("FROM linked_servers")) {
        return { all: async () => ({ results: candidates }) };
      }
      const values = query.includes("FROM kill_events") ? evidence.kills : evidence.players;
      return {
        bind: (...ids: string[]) => ({
          all: async () => ({
            results: ids
              .filter((id) => values?.[id] !== undefined)
              .map((id) => ({ linked_server_id: id, evidence_count: values?.[id] ?? 0 })),
          }),
        }),
      };
    },
  };
}
