import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureAdmSyncSchema } from "../functions/_lib/adm-sync";
import { getServerAdvancedShowcasePayload, type ServerAdvancedShowcasePayload } from "../functions/_lib/advanced-leaderboards";
import { onRequest as boardsRoute } from "../functions/api/public/servers/[serverId]/leaderboards";
import { onRequest as explorationRoute } from "../functions/api/public/servers/[serverId]/exploration";
import { publicServerStatusPresentation } from "../lib/public-server-status";
import { getPublicServerLifecycleDisplay, getServerLifecycleDisplay } from "../lib/server-lifecycle";
import type { Env, PagesFunction } from "../functions/_lib/types";

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...values: unknown[]): Record<string, unknown> | undefined;
    all(...values: unknown[]): Record<string, unknown>[];
  };
  close(): void;
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (file: string) => Sqlite };

async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  let readOnly = false;
  const env = { DB: { prepare(sql: string) {
    if (readOnly) assert.match(sql, /^\s*(?:SELECT|WITH)\b/i, "Presentation reads must not write any account, gameplay or billing rows or schema");
    const statement = (values: unknown[]) => ({
      bind: (...bindings: unknown[]) => statement(bindings),
      all: async () => ({ results: sqlite.prepare(sql).all(...values), success: true }),
      first: async () => sqlite.prepare(sql).get(...values) ?? null,
      run: async () => ({ success: true, meta: sqlite.prepare(sql).run(...values) }),
    });
    return statement([]);
  } } } as unknown as Env;
  sqlite.exec(`
    CREATE TABLE linked_servers (
      id TEXT PRIMARY KEY, public_slug TEXT, nitrado_service_id TEXT, guild_id TEXT,
      display_name TEXT, hostname TEXT, server_name TEXT, nitrado_service_name TEXT,
      server_mode TEXT, server_type TEXT, map_name TEXT, mission TEXT, updated_at TEXT,
      status TEXT DEFAULT 'live', lifecycle_status TEXT DEFAULT 'active_live',
      listing_visibility TEXT DEFAULT 'public', merged_into_server_id TEXT
    );
    CREATE TABLE server_subscriptions (
      id TEXT PRIMARY KEY, guild_id TEXT, plan_key TEXT, status TEXT, updated_at TEXT, created_at TEXT
    );
    INSERT INTO linked_servers (id, public_slug, nitrado_service_id, guild_id, server_name, map_name)
      VALUES ('sample-server', 'sample-public', 'sample-service', 'sample-guild', 'Example server', 'chernarus');
    INSERT INTO server_subscriptions VALUES ('subscription', 'sample-guild', 'free', 'active', '2026-01-01', '2026-01-01');
  `);
  await ensureAdmSyncSchema(env);
  sqlite.exec(`
    INSERT INTO build_events (id, linked_server_id, nitrado_service_id, player_id, player_name, event_type, build_part, target_object, source_adm_file, source_line_number, occurred_at, raw_line)
      VALUES ('build', 'sample-server', 'sample-service', 'sample-player', 'Example explorer', 'built', 'wall_base', 'fence', 'sample.ADM', 1, '2026-01-01T10:00:00Z', 'synthetic');
    INSERT INTO kill_events (id, linked_server_id, killer_name, victim_name, distance, occurred_at)
      VALUES ('kill', 'sample-server', 'Example player', 'Example victim', 45, '2026-01-01T09:00:00Z');
    INSERT INTO player_profiles (id, linked_server_id, player_name) VALUES ('player', 'sample-server', 'Example player');
  `);
  for (let i = 0; i < 3; i++) sqlite.prepare(`INSERT INTO player_events
    (id, linked_server_id, player_id, player_name, event_type, position_x, position_y, occurred_at)
    VALUES (?, 'sample-server', 'sample-player', 'Example explorer', 'player_position', ?, ?, ?)`)
    .run(`position-${i}`, 1000 + i * 100, 1000 + i * 100, `2026-01-01T10:0${i}:00Z`);
  const setPlan = (plan: string, status: string) => sqlite.prepare("UPDATE server_subscriptions SET plan_key = ?, status = ?").run(plan, status);
  readOnly = true;
  return { env, sqlite, setPlan };
}

function assertLocked(payload: ServerAdvancedShowcasePayload) {
  assert.equal(payload.access.publicServerTop15, false);
  for (const key of ["buildScore", "structuresBuilt", "raidScore", "totalDistanceM", "onFootDistanceM", "fastTravelEstimatedDistanceM", "explorationPercent"] as const) assert.equal(payload.summary[key], 0, key);
  assert.ok(payload.boards.every(board => board.locked && board.rows.length === 0));
  assert.equal(payload.exploration.explorationPercent, 0);
  assert.equal(payload.exploration.exploredCellsCount, 0);
  assert.equal(payload.exploration.activeExplorersCount, 0);
  assert.equal(payload.exploration.topExplorerName, null);
  assert.equal(payload.exploration.topExplorerCells, 0);
  assert.equal(payload.exploration.lastExplorationUpdateAt, null);
  assert.deepEqual(payload.exploration.overlayCells, []);
  assert.doesNotMatch(JSON.stringify(payload), /Example explorer|sample-player|sample\.ADM|synthetic/);
}

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No provider/network calls permitted"); };
  const { env, sqlite, setPlan } = await fixture();
  const snapshot = () => JSON.stringify(["linked_servers", "kill_events", "build_events", "player_events", "player_profiles"]
    .map(table => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
  const before = snapshot();
  const requestRoute = async (route: PagesFunction, serverId = "sample-server", method = "GET") => {
    const response = await route({ request: new Request(`https://local.invalid/api/public/servers/${serverId}/leaderboards?plan=pro&ownerScoped=true`, { method }), env, params: { serverId }, waitUntil: () => {}, next: async () => new Response(), data: {} });
    return response;
  };
  try {
    for (const [plan, status] of [["free", "active"], ["free", "inactive"], ["starter", "trialing"], ["starter", "active"], ["pro", "canceled"], ["pro", "past_due"], ["pro", "expired"], ["pro", "active"], ["premium", "trialing"], ["network", "active"], ["partner", "active"]]) {
      setPlan(plan, status);
      const response = await requestRoute(boardsRoute);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      const payload = await response.json() as ServerAdvancedShowcasePayload;
      if (process.env.DZN_SERVER_SAFETY_QA_OUTPUT && ["free", "pro"].includes(plan) && status === "active") {
        const directory = path.resolve(process.env.DZN_SERVER_SAFETY_QA_OUTPUT);
        mkdirSync(directory, { recursive: true });
        writeFileSync(path.join(directory, `${plan}-summary.json`), JSON.stringify(payload, null, 2));
      }
      assert.equal(payload.summary.kills, 1);
      assert.equal(payload.summary.deaths, 1);
      assert.equal(payload.summary.uniquePlayers, 1);
      const unlocked = ["pro", "premium", "network", "partner"].includes(plan) && ["active", "trialing"].includes(status);
      if (unlocked) {
        assert.ok(payload.summary.buildScore > 0);
        assert.ok(payload.summary.totalDistanceM > 0);
        assert.ok(payload.exploration.explorationPercent > 0);
        assert.equal(payload.exploration.topExplorerName, "Example explorer");
        assert.ok(payload.boards.some(board => board.rows.length > 0));
      } else {
        assertLocked(payload);
        assertLocked((await getServerAdvancedShowcasePayload(env, "sample-server", { ownerScoped: true }))!);
      }
      const exploration = await requestRoute(explorationRoute);
      assert.match(exploration.headers.get("cache-control") ?? "", /no-store/);
      assert.deepEqual((await exploration.json() as { exploration: unknown }).exploration, payload.exploration);
    }
    setPlan("pro", "active");
    await requestRoute(boardsRoute);
    await requestRoute(explorationRoute);
    setPlan("free", "inactive");
    for (const alias of ["sample-server", "sample-public", "sample-service"]) assertLocked(await (await requestRoute(boardsRoute, alias)).json() as ServerAdvancedShowcasePayload);
    const downgraded = await (await requestRoute(explorationRoute)).json() as { exploration: { topExplorerName: string | null } };
    assert.equal(downgraded.exploration.topExplorerName, null);
    setPlan("pro", "active");
    await requestRoute(boardsRoute);
    sqlite.exec("UPDATE linked_servers SET listing_visibility = 'hidden'");
    assert.equal((await requestRoute(boardsRoute)).status, 404, "Hiding a cached Pro profile must take effect immediately");
    assert.equal((await requestRoute(explorationRoute)).status, 404);
    sqlite.exec("UPDATE linked_servers SET listing_visibility = 'public'");
    assert.equal((await requestRoute(boardsRoute, "absent")).status, 404);
    assert.equal((await requestRoute(boardsRoute, "sample-server", "POST")).status, 405);
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const route of [boardsRoute, explorationRoute]) {
        const unavailableEnv = { DB: { prepare() { throw new Error("Synthetic unavailable database"); } } } as unknown as Env;
        const unavailable = await route({ request: new Request("https://local.invalid/api/public/servers/sample-server/leaderboards"), env: unavailableEnv, params: { serverId: "sample-server" }, waitUntil: () => {}, next: async () => new Response(), data: {} });
        assert.equal(unavailable.status, 200);
        assert.match(unavailable.headers.get("cache-control") ?? "", /no-store/);
        const payload = await unavailable.json() as { available: boolean; summary?: unknown };
        assert.equal(payload.available, false);
        assert.equal(payload.summary, undefined);
        assert.doesNotMatch(JSON.stringify(payload), /Example explorer|buildScore|totalDistanceM/);
      }
    } finally { console.warn = warn; }
    assert.equal(snapshot(), before, "Presentation must preserve imported stats, identity, ownership and server settings");
    const second = await fixture();
    try { assertLocked((await getServerAdvancedShowcasePayload(second.env, "sample-server"))!); }
    finally { second.sqlite.close(); }
    const pending = { status: "pending", is_online: true, metadata_last_checked_at: null };
    assert.equal(publicServerStatusPresentation(pending).label, "Setup incomplete");
    assert.equal(publicServerStatusPresentation({ ...pending, status: "live" }).label, "Status not checked");
    assert.equal(publicServerStatusPresentation({ ...pending, status: "live", metadata_last_checked_at: "invalid" }).label, "Status not checked");
    for (const is_online of [true, false]) {
      for (const player_count_source of ["nitrado", "adm_playerlist", null]) {
        for (const player_count_status of ["fresh", "stale", "unavailable", null]) {
          const checked = { ...pending, status: "live", is_online, player_count_source, player_count_status,
            metadata_last_checked_at: "2026-01-01T10:00:00Z", player_count_last_checked_at: "2026-01-01T10:00:00Z" };
          assert.deepEqual(publicServerStatusPresentation(checked), { label: "Status unavailable", tone: "zinc" },
            "Failures, ADM fallbacks and Nitrado player-count-only refreshes cannot confirm retained online state");
        }
      }
    }
    assert.equal(publicServerStatusPresentation({ ...pending, lifecycle: { historical: true, label: "Legacy / Offline" } }).label, "Legacy / Offline");
    assert.equal(getPublicServerLifecycleDisplay("active_live", "pending").label, "Setup incomplete");
    assert.doesNotMatch(getServerLifecycleDisplay("active_live").message, /Full sync is enabled/);
    const ui = readFileSync("components/network/public-network.tsx", "utf8");
    assert.doesNotMatch(ui, /label="(?:Verified Owner|DZN Verified|Live)"|Network online/);
    assert.equal((ui.match(/<StatusPill \{\.\.\.publicServerStatusPresentation\(server\)\}/g) ?? []).length, 2);
    console.log("Public server package safety: real SQLite routes, 11 plan states, basic-stat parity, owner/query bypass denial, downgrade/hidden/DB cache isolation and truthful status passed.");
  } finally { sqlite.close(); globalThis.fetch = originalFetch; }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
