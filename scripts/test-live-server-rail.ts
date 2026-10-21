import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRailLoader } from "../components/servers/live-server-rail";
import { onRequest } from "../functions/api/public/server-rail";
import { formatPublicServerName, formatPublicServerNameFromCandidates } from "../lib/public-display-text";

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
assert.equal(source.includes("SERVER_RAIL_REFRESH_MS = 30_000"), true, "The rail must refresh live server data without requiring a page reload.");
assert.equal(source.includes("SERVER_RAIL_INITIAL_RETRY_DELAY_MS = 1_500"), true, "An initial transient public-rail failure should receive one prompt bounded retry.");
assert.equal(source.includes("isStaleEmptyRailResponse(payload)"), true, "The retry must cover the public endpoint's stale-empty fallback response.");
assert.equal(source.includes('cache: initialRetryUsesFreshRequestRef.current ? "no-store" : "default"'), true, "The recovery request must bypass a stale browser cache.");
assert.equal(source.includes('document.visibilityState === "visible"'), true, "Background tabs must not keep polling the public rail.");
assert.equal(source.includes('document.addEventListener("visibilitychange"'), true, "Returning to the page must refresh the rail.");
assert.equal(source.includes("requestInFlight"), true, "Timed and visibility refreshes must not overlap requests.");
assert.equal(source.includes('!hasConfirmedResponseRef.current && initialFailureCountRef.current === 0'), true, "Only the first unresolved rail failure should retry before showing an outage state.");
assert.equal(source.includes('"Reconnecting live server listings"'), true, "A transient first failure must be described as reconnecting rather than unavailable.");
assert.match(source, /payload\.stale\s*===\s*true\s*&&\s*payload\.items\?\.length\s*===\s*0\s*&&\s*currentItems\.length\s*>\s*0/, "A stale empty refresh must preserve the last known-good server cards.");
assert.equal(source.includes("SERVER_RAIL_REQUEST_TIMEOUT_MS = 10_000"), true, "A stalled rail request must be bounded so later refreshes can recover.");
assert.match(source, /setTimeout\(\(\)\s*=>\s*requestController\.abort\(\),\s*timeoutMs\)/, "Each rail request must abort when its timeout expires.");
assert.match(source, /clearTimeout\(requestTimeout\)/, "Completed rail requests must clear their timeout.");
assert.equal(source.includes("formatPublicServerName(item.name)"), true, "The rail must defensively render a clean server name.");
assert.equal(formatPublicServerName("NUKETOWN DEATHMATCH- HTTPS://DAYZ-NETWORK.COM"), "NukeTown Deathmatch");
assert.equal(formatPublicServerName("NukeTown | discord.gg/dzn-network"), "NukeTown");
assert.equal(formatPublicServerName("DAYZ US 1PP HARDCORE RP"), "DayZ US 1PP HARDCORE RP");
assert.equal(formatPublicServerNameFromCandidates(["https://dayz-network.com", "NukeTown Deathmatch"], "DZN server"), "NukeTown Deathmatch", "A malformed preferred name must fall through to the next valid server identity.");

let stalledRequestCount = 0;
let unavailableCount = 0;
let settledCount = 0;
const recoveredPayloads: unknown[] = [];
const stalledLoader = createRailLoader({
  timeoutMs: 10,
  fetchRail: (signal) => {
    stalledRequestCount += 1;
    if (stalledRequestCount > 1) return Promise.resolve(Response.json({ ok: true, items: [{ id: "recovered" }] }));
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), { once: true }));
  },
  onPayload: (payload) => recoveredPayloads.push(payload),
  onUnavailable: () => { unavailableCount += 1; },
  onSettled: () => { settledCount += 1; },
});
await stalledLoader.load();
await stalledLoader.load();
assert.equal(stalledRequestCount, 2, "A timed-out request must release the in-flight guard for the next refresh.");
assert.equal(unavailableCount, 1, "The stalled request must produce one unavailable result.");
assert.equal(settledCount, 2, "Both the timed-out and recovered requests must settle.");
assert.deepEqual(recoveredPayloads, [{ ok: true, items: [{ id: "recovered" }] }], "The refresh after a timeout must publish its successful payload.");
stalledLoader.dispose();

const railRouteSource = readFileSync("functions/api/public/server-rail.ts", "utf8");
assert.doesNotMatch(railRouteSource, /LIMIT\s+96/i, "Canonical server selection must happen before the public rail limit.");
assert.match(railRouteSource, /readPublicServerCanonicalEvidence/, "Duplicate service records must use authoritative canonical evidence.");
assert.match(railRouteSource, /maxAge:\s*15,\s*staleWhileRevalidate:\s*45/, "Live player counts must not remain behind the five-minute stale rail cache.");

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
  server_name: "NUKETOWN DEATHMATCH- HTTPS://DAYZ-NETWORK.COM",
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
  updated_at: "2026-09-30T12:00:00.000Z",
  created_at: "2026-09-30T12:00:00.000Z",
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
const duplicatePayload = await duplicateDbResponse.json() as {
  items?: Array<{ id: string; slug: string | null; currentPlayers: number | null; name: string }>;
};
assert.equal(duplicatePayload.items?.length, 24, "Duplicate rows must not consume the 24 unique-server rail limit.");
const canonicalDuplicateItem = duplicatePayload.items?.find(({ id }) => id === "server-one");
assert.deepEqual(canonicalDuplicateItem && { id: canonicalDuplicateItem.id, slug: canonicalDuplicateItem.slug }, {
  id: "server-one",
  slug: "nuketown-deathmatch",
});
assert.equal(duplicatePayload.items?.some(({ id }) => id === "legacy-duplicate"), false, "The public API must deduplicate canonical server identities.");
assert.equal(canonicalDuplicateItem?.currentPlayers, 7, "Fresh zero and non-zero player counts must remain numeric in the public payload.");
assert.equal(canonicalDuplicateItem?.name, "NukeTown Deathmatch", "Public rail payloads must not expose pasted URLs in server names.");

const zeroPlayerResponse = await invokeRail({
  DB: createRailDb([{ ...duplicateRow, current_players: 0, max_players: 10 }]),
});
const zeroPlayerPayload = await zeroPlayerResponse.json() as { items?: Array<{ currentPlayers: number | null; maxPlayers: number | null; playerCountStatus?: string }> };
assert.deepEqual(zeroPlayerPayload.items?.map(({ currentPlayers, maxPlayers, playerCountStatus }) => ({ currentPlayers, maxPlayers, playerCountStatus })), [
  { currentPlayers: 0, maxPlayers: 10, playerCountStatus: "fresh" },
], "Zero online players is valid live data and must not be converted into a syncing state.");

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

const equalScoreTieResponse = await invokeRail({
  DB: createRailDb([
          {
            ...duplicateRow,
            id: "older-paid-duplicate",
            nitrado_service_id: "equal-score-service",
            public_slug: "older-paid-duplicate",
            updated_at: "2026-09-30T00:00:00.000Z",
            created_at: "2026-01-01T00:00:00.000Z",
          },
          {
            ...duplicateRow,
            id: "newer-replacement",
            nitrado_service_id: "equal-score-service",
            public_slug: "newer-replacement",
            plan_key: "free",
            subscription_status: null,
            rail_priority_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-09-30T00:00:00.000Z",
            created_at: "2026-09-30T00:00:00.000Z",
          },
        ]),
});
const equalScoreTiePayload = await equalScoreTieResponse.json() as { items?: Array<{ id: string }> };
assert.deepEqual(equalScoreTiePayload.items?.map(({ id }) => id), ["newer-replacement"], "Equal-score duplicates with matching update times must use the directory's creation-time tie-breaker.");

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
assert.equal(packageJson.scripts?.test?.includes("npm run test:live-server-rail"), true, "The main test suite must enforce the rail regression checks.");

const css = readFileSync("app/globals.css", "utf8");
assert.match(css, /\.dzn-live-server-rail__track\s*\{[\s\S]*animation:\s*dznLiveServerRail/, "The unique-card rail should retain motion.");
assert.equal(css.includes("@keyframes dznLiveServerRailSingle"), true, "A single real server should keep subtle movement without cloning.");
assert.match(css, /\.dzn-live-server-card__title\s*\{[\s\S]*white-space:\s*nowrap/, "Live rail names must stay on one compact line.");

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes('formatPublicServerNameFromCandidates'), true, "Owner dashboard labels must use the shared public server-name formatter.");
assert.equal(dashboardSource.includes('const serverDisplayName = formatPublicServerNameFromCandidates('), true, "The selected dashboard server name must not expose pasted URLs.");
assert.equal(dashboardSource.includes('formatPublicServerNameFromCandidates([item.display_name, item.hostname, item.server_name, item.nitrado_service_name], "DZN server")'), true, "The server selector must not expose pasted URLs.");
assert.equal(dashboardSource.includes('const selectedServerLabel = serverDisplayName;'), true, "The selected-server card must retain the DayZ server name rather than substituting the Discord guild name.");
assert.equal(dashboardSource.includes('connectedServerName={formatPublicServerName(server.guild_name, serverDisplayName)}'), true, "The Discord panel must retain the sanitized Discord guild name while channel data is loading.");
assert.equal(dashboardSource.includes('value={formatPublicServerName(channelsResponse?.guild_name ?? connectedServerName, "Unknown")}'), true, "Discord response labels must be sanitized at the render boundary.");
assert.equal(dashboardSource.includes('statusLabel: "Checking checkout"'), true, "The billing panel must not show an unconfigured error while live plan configuration is still loading.");
assert.equal(dashboardSource.includes('Type the exact public server name'), false, "Server deletion must not accept a display-only name that the protected API will reject.");
assert.equal(dashboardSource.includes('confirmationText.trim() === requiredText'), true, "Server deletion must use the stable DELETE SERVER confirmation accepted by the protected API.");
const dashboardApiSource = readFileSync("components/onboarding/api.ts", "utf8");
assert.equal(dashboardApiSource.includes('return request<{ plans: BillingPlanSummary[] }>("/api/billing/plans", { cache: "no-store" });'), true, "Dashboard billing plans must bypass stale browser responses.");

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
