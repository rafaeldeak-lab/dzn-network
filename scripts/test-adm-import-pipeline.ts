import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  importReadableAdmLinesIntoDatabase,
  type AdmSyncContext,
} from "../functions/_lib/adm-sync";
import type { Env } from "../functions/_lib/types";

const fixtureName = "DayZServer_PS4_x64_2026-05-19_16-01-55.ADM";
const fixtureLines = readFileSync(`scripts/fixtures/${fixtureName}`, "utf8").split(/\r?\n/).filter(Boolean);
const linkedServerId = "fixture-linked-server";
const guildId = "fixture-guild";
const nitradoServiceId = "fixture-service";
const context: AdmSyncContext = {
  linkedServerId,
  nitradoServiceId,
  serverName: "Fixture Server",
  admFileName: fixtureName,
  syncRunId: "fixture-sync-run",
};

async function main() {
  const successDb = new MemoryD1();
  const successResult = await importReadableAdmLinesIntoDatabase(makeEnv(successDb), {
    context,
    lines: fixtureLines,
    guildId,
    planKey: "partner",
    publicServerName: "Fixture Server",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });

  assert.equal(successResult.status, "completed");
  assert.equal(successDb.killEvents.length, 10);
  assert.equal(successDb.playerEvents.filter((event) => event.event_type === "player_suicide").length, 2);
  assert.equal(successDb.playerEvents.filter((event) => event.event_type === "player_died_stats").length, 1);
  assert.equal(successDb.playerEvents.filter((event) => event.event_type === "player_hit").length, 3);
  assert.equal(successDb.playerEvents.filter((event) => event.event_type === "player_hit").every((event) => event.player_name !== null), true);
  assert.deepEqual(countBy(successDb.killEvents, "killer_name"), {
    mustard_coffer74: 5,
    Uractuallybadzzz: 4,
    "xAKA-MINI_KickAs": 1,
  });
  assert.deepEqual(countBy(successDb.killEvents, "victim_name"), {
    mustard_coffer74: 4,
    Uractuallybadzzz: 5,
    "xAKA-MINI_KickAs": 1,
  });
  const longestKill = successDb.killEvents.reduce((best, row) => (Number(row.distance) > Number(best.distance) ? row : best), successDb.killEvents[0]);
  assert.equal(longestKill.killer_name, "mustard_coffer74");
  assert.equal(longestKill.victim_name, "Uractuallybadzzz");
  assert.equal(longestKill.distance, 48.5404);
  assert.equal(successDb.serverStats.get(linkedServerId)?.total_kills, 10);
  assert.equal(successDb.serverStats.get(linkedServerId)?.total_deaths, 13);
  assert.equal(successResult.cursorBefore, 0);
  assert.equal(successResult.cursorAfter, 25);
  assert.equal(successDb.admSyncState.get(linkedServerId)?.last_processed_line, 25);
  assert.equal(successResult.report.rawKilledByLinesFound, 10);
  assert.equal(successResult.report.parsedPvpKills, 10);
  assert.equal(successResult.report.writtenKills, 10);
  assert.equal(successResult.report.duplicateSkips, 0);
  assert.equal(successResult.report.skippedDeadHitLines, 3);
  assert.equal(successResult.report.publicCacheUpdated, true);
  assert.equal(successResult.report.discordQueuesCreated > 0, true);
  assert.equal(successDb.serverPublicCache.get(guildId)?.last_adm_update_at !== null, true);
  assert.equal(successDb.automationJobs.length > 0, true);

  const clusteredMustardKills = successDb.killEvents.filter((event) =>
    event.killer_name === "mustard_coffer74" &&
    event.victim_name === "Uractuallybadzzz" &&
    event.weapon === "M4-A1"
  );
  assert.equal(clusteredMustardKills.length, 5);
  assert.deepEqual(clusteredMustardKills.map((event) => event.occurred_at), [
    "2026-05-19T16:07:39.000Z",
    "2026-05-19T16:08:39.000Z",
    "2026-05-19T16:09:25.000Z",
    "2026-05-19T16:10:33.000Z",
    "2026-05-19T16:13:04.000Z",
  ]);

  const retryResult = await importReadableAdmLinesIntoDatabase(makeEnv(successDb), {
    context: { ...context, syncRunId: "fixture-sync-run-retry" },
    lines: fixtureLines,
    guildId,
    planKey: "partner",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });
  assert.equal(retryResult.status, "completed");
  assert.equal(successDb.killEvents.length, 10);
  assert.equal(retryResult.report.parsedPvpKills, 0);
  assert.equal(retryResult.report.cursorBefore, 25);
  assert.equal(retryResult.report.cursorAfter, 25);

  const failingDb = new MemoryD1({ failKillInsertAfter: 5 });
  const failingResult = await importReadableAdmLinesIntoDatabase(makeEnv(failingDb), {
    context: { ...context, syncRunId: "fixture-sync-run-fail" },
    lines: fixtureLines,
    guildId,
    planKey: "partner",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });
  assert.equal(failingResult.status, "dzn_write_error");
  assert.equal(failingResult.report.failedWrites, 1);
  assert.equal(failingResult.report.cursorBefore, 0);
  assert.equal(failingResult.report.cursorAfter, 0);
  assert.equal(failingResult.report.cursorAdvanced, false);
  assert.equal(failingDb.admSyncState.get(linkedServerId)?.last_processed_line, 0);

  failingDb.failKillInsertAfter = null;
  const recoveredResult = await importReadableAdmLinesIntoDatabase(makeEnv(failingDb), {
    context: { ...context, syncRunId: "fixture-sync-run-recovered" },
    lines: fixtureLines,
    guildId,
    planKey: "partner",
    publicServerName: "Fixture Server",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });
  assert.equal(recoveredResult.status, "completed");
  assert.equal(failingDb.killEvents.length, 10);
  assert.equal(failingDb.admSyncState.get(linkedServerId)?.last_processed_line, 25);
  assert.equal(failingDb.serverStats.get(linkedServerId)?.total_kills, 10);
  assert.equal(failingDb.serverStats.get(linkedServerId)?.total_deaths, 13);

  console.log("ADM import pipeline fixture regression passed.", {
    fixtureDbKills: successDb.killEvents.length,
    fixtureSuicides: successDb.playerEvents.filter((event) => event.event_type === "player_suicide").length,
    fixtureUncreditedDeaths: successDb.playerEvents.filter((event) => event.event_type === "player_died_stats").length,
    cursorFailurePreserved: failingResult.report.cursorAdvanced === false,
    repeatedPairKillsStored: clusteredMustardKills.length,
    dashboardStatsKills: successDb.serverStats.get(linkedServerId)?.total_kills,
    publicCacheUpdated: successResult.report.publicCacheUpdated,
    discordQueuesCreated: successResult.report.discordQueuesCreated,
  });
}

function makeEnv(db: MemoryD1): Env {
  return { DB: db as unknown as D1Database } as Env;
}

function countBy(rows: Array<Record<string, unknown>>, key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row[key] ?? "");
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

type RunResult = { meta: { changes: number } };
type MemoryValue = string | number | boolean | null | undefined;
type MemoryRow = Record<string, MemoryValue>;

class MemoryD1 {
  admRawEvents: MemoryRow[] = [];
  playerProfiles: MemoryRow[] = [];
  playerEvents: MemoryRow[] = [];
  killEvents: MemoryRow[] = [];
  buildEvents: MemoryRow[] = [];
  serverStats = new Map<string, MemoryRow>();
  serverBuildStats = new Map<string, MemoryRow>();
  syncRuns: MemoryRow[] = [];
  admSyncState = new Map<string, MemoryRow>();
  serverPublicCache = new Map<string, MemoryRow>();
  automationJobs: MemoryRow[] = [];
  linkedServers = new Map<string, MemoryRow>([[linkedServerId, { id: linkedServerId, nitrado_service_id: nitradoServiceId }]]);
  failKillInsertAfter: number | null;
  killInsertAttempts = 0;

  constructor(options: { failKillInsertAfter?: number | null } = {}) {
    this.failKillInsertAfter = options.failKillInsertAfter ?? null;
  }

  prepare(query: string) {
    return new MemoryStatement(this, query);
  }
}

class MemoryStatement {
  private values: MemoryValue[] = [];

  constructor(private db: MemoryD1, private query: string) {}

  bind(...values: MemoryValue[]) {
    this.values = values;
    return this;
  }

  async run(): Promise<RunResult> {
    const q = normalizeSql(this.query);
    if (isSchemaQuery(q)) return changed(0);
    if (q.startsWith("update adm_raw_events") || q.startsWith("update player_events") || q.startsWith("update kill_events") || q.startsWith("update player_profiles") || q.startsWith("update server_stats") || q.startsWith("update adm_sync_state") || q.startsWith("update sync_runs")) return changed(0);
    if (q.includes("insert or ignore into adm_raw_events")) return this.insertIgnore(this.db.admRawEvents, {
      id: this.values[0],
      linked_server_id: this.values[1],
      source_service_id: this.values[2],
      adm_file: this.values[3],
      source_adm_file: this.values[4],
      line_number: this.values[5],
      source_line_number: this.values[6],
      raw_line: this.values[8],
      event_type: this.values[9],
    });
    if (q.includes("insert into player_profiles")) {
      this.db.playerProfiles.push({
        id: this.values[0],
        linked_server_id: this.values[1],
        source_service_id: this.values[2],
        player_name: this.values[3],
        player_id: this.values[4],
        kills: 0,
        deaths: 0,
        suicides: 0,
        longest_kill_distance: 0,
        last_seen_at: this.values[5],
      });
      return changed(1);
    }
    if (q.startsWith("update player_profiles set player_name")) {
      const row = this.db.playerProfiles.find((profile) => profile.id === this.values[4]);
      if (!row) return changed(0);
      row.player_name = this.values[0];
      row.player_id = this.values[1] ?? row.player_id;
      row.source_service_id = row.source_service_id ?? this.values[2];
      row.last_seen_at = this.values[3] ?? row.last_seen_at;
      return changed(1);
    }
    if (q.startsWith("update player_profiles set kills")) {
      const row = this.db.playerProfiles.find((profile) => profile.id === this.values[1]);
      if (!row) return changed(0);
      row.kills = Number(row.kills ?? 0) + 1;
      row.longest_kill_distance = Math.max(Number(row.longest_kill_distance ?? 0), Number(this.values[0] ?? 0));
      return changed(1);
    }
    if (q.startsWith("update player_profiles set deaths")) {
      const row = this.db.playerProfiles.find((profile) => profile.id === this.values[1]);
      if (!row) return changed(0);
      row.deaths = Number(row.deaths ?? 0) + 1;
      row.suicides = Number(row.suicides ?? 0) + Number(this.values[0] ?? 0);
      return changed(1);
    }
    if (q.includes("insert or ignore into player_events")) return this.insertIgnore(this.db.playerEvents, {
      id: this.values[0],
      linked_server_id: this.values[1],
      source_service_id: this.values[2],
      player_profile_id: this.values[4],
      player_name: this.values[5],
      player_id: this.values[6],
      event_type: this.values[7],
      adm_file: this.values[11],
      source_adm_file: this.values[12],
      line_number: this.values[13],
      source_line_number: this.values[14],
      occurred_at: this.values[15],
      raw_line: this.values[16],
    });
    if (q.includes("insert or ignore into build_events")) return this.insertIgnore(this.db.buildEvents, {
      id: this.values[0],
      linked_server_id: this.values[1],
      nitrado_service_id: this.values[2],
      player_id: this.values[3],
      player_name: this.values[4],
      event_type: this.values[5],
      source_adm_file: this.values[14],
      source_line_number: this.values[15],
      occurred_at: this.values[16],
      raw_line: this.values[17],
    });
    if (q.includes("insert or ignore into kill_events")) {
      this.db.killInsertAttempts += 1;
      if (this.db.failKillInsertAfter !== null && this.db.killInsertAttempts > this.db.failKillInsertAfter) {
        throw new Error("simulated kill_events write failure");
      }
      return this.insertIgnore(this.db.killEvents, {
        id: this.values[0],
        linked_server_id: this.values[1],
        source_service_id: this.values[2],
        killer_profile_id: this.values[4],
        victim_profile_id: this.values[5],
        killer_name: this.values[6],
        victim_name: this.values[7],
        killer_id: this.values[8],
        victim_id: this.values[9],
        weapon: this.values[10],
        distance: Number(this.values[11]),
        adm_file: this.values[15],
        source_adm_file: this.values[16],
        line_number: this.values[17],
        source_line_number: this.values[18],
        occurred_at: this.values[19],
        raw_line: this.values[20],
      });
    }
    if (q.includes("insert into server_stats")) {
      const linked = String(this.values[1]);
      const existing = this.db.serverStats.get(linked);
      const row = {
        linked_server_id: linked,
        source_service_id: this.values[2],
        total_kills: Number(this.values[3] ?? 0),
        total_deaths: Number(this.values[4] ?? 0),
        total_joins: Number(this.values[5] ?? 0),
        total_disconnects: Number(this.values[6] ?? 0),
        unique_players: Number(this.values[7] ?? 0),
        last_event_at: this.values[8] ?? null,
      };
      if (existing && q.includes("total_kills = total_kills +")) {
        existing.total_kills = Number(existing.total_kills ?? 0) + Number(row.total_kills ?? 0);
        existing.total_deaths = Number(existing.total_deaths ?? 0) + Number(row.total_deaths ?? 0);
        existing.total_joins = Number(existing.total_joins ?? 0) + Number(row.total_joins ?? 0);
        existing.total_disconnects = Number(existing.total_disconnects ?? 0) + Number(row.total_disconnects ?? 0);
        existing.unique_players = row.unique_players;
        existing.last_event_at = row.last_event_at ?? existing.last_event_at;
      } else {
        this.db.serverStats.set(linked, row);
      }
      return changed(1);
    }
    if (q.includes("insert into server_build_stats")) {
      this.db.serverBuildStats.set(String(this.values[0]), { linked_server_id: this.values[0] });
      return changed(1);
    }
    if (q.includes("insert into adm_sync_state")) {
      const linked = String(this.values[1]);
      this.db.admSyncState.set(linked, {
        linked_server_id: linked,
        latest_adm_file: this.values[3],
        latest_adm_path: this.values[4],
        last_processed_file: this.values[5],
        last_processed_line: Number(this.values[6] ?? 0),
        last_processed_offset: Number(this.values[7] ?? 0),
        last_sync_status: this.values[8],
        last_sync_message: this.values[9],
        last_sync_at: this.values[10],
        last_lines_read: Number(this.values[11] ?? 0),
        last_lines_processed: Number(this.values[12] ?? 0),
        last_raw_events_stored: Number(this.values[13] ?? 0),
        last_player_events_stored: Number(this.values[14] ?? 0),
        last_kill_events_stored: Number(this.values[15] ?? 0),
        last_events_created: Number(this.values[16] ?? 0),
        last_kills_created: Number(this.values[17] ?? 0),
        last_unknown_lines: Number(this.values[18] ?? 0),
        last_duplicate_lines: Number(this.values[19] ?? 0),
        last_import_report_json: this.values[27],
      });
      return changed(1);
    }
    if (q.includes("update adm_sync_state set last_import_report_json")) {
      const row = this.db.admSyncState.get(String(this.values[1]));
      if (!row) return changed(0);
      row.last_import_report_json = this.values[0];
      return changed(1);
    }
    if (q.includes("insert into sync_runs")) {
      this.db.syncRuns.push({
        id: this.values[0],
        linked_server_id: this.values[1],
        source_service_id: this.values[2],
        trigger_type: this.values[3],
        status: this.values[4],
        message: this.values[5],
        lines_read: this.values[6],
        lines_processed: this.values[7],
        events_created: this.values[8],
        kills_created: this.values[9],
      });
      return changed(1);
    }
    if (q.includes("insert into server_public_cache")) {
      this.db.serverPublicCache.set(String(this.values[1]), {
        guild_id: this.values[1],
        plan_key: this.values[2],
        public_server_name: this.values[3],
        last_status_update_at: this.values[12],
        last_adm_update_at: this.values[13],
      });
      return changed(1);
    }
    if (q.startsWith("update automation_jobs set")) return changed(0);
    if (q.includes("insert or ignore into automation_jobs")) return this.insertIgnore(this.db.automationJobs, {
      id: this.values[0],
      guild_id: this.values[1],
      post_type: this.values[2],
      status: "queued",
      last_error: this.values[3],
    }, (row) => row.guild_id === this.values[1] && row.post_type === this.values[2]);
    return changed(0);
  }

  async first<T>(): Promise<T | null> {
    const q = normalizeSql(this.query);
    if (q.includes("from adm_sync_state") && q.includes("select *")) return (this.db.admSyncState.get(String(this.values[0])) ?? null) as T | null;
    if (q.includes("select last_import_report_json from adm_sync_state")) return ({ last_import_report_json: this.db.admSyncState.get(String(this.values[0]))?.last_import_report_json ?? null } as T);
    if (q.includes("select nitrado_service_id from linked_servers")) return (this.db.linkedServers.get(String(this.values[0])) ?? { nitrado_service_id: null }) as T;
    if (q.includes("from player_profiles") && q.includes("player_id = ?")) {
      return (this.db.playerProfiles.find((profile) => profile.linked_server_id === this.values[0] && profile.player_id === this.values[1]) ?? null) as T | null;
    }
    if (q.includes("from player_profiles") && q.includes("lower(player_name)")) {
      return (this.db.playerProfiles.find((profile) => profile.linked_server_id === this.values[0] && String(profile.player_name).toLowerCase() === String(this.values[1]).toLowerCase()) ?? null) as T | null;
    }
    if (q.includes("from player_events") && q.includes("source_line_number")) {
      return (this.db.playerEvents.find((event) =>
        event.linked_server_id === this.values[0] &&
        event.source_service_id === this.values[2] &&
        event.source_adm_file === this.values[3] &&
        Number(event.source_line_number) === Number(this.values[4])
      ) ?? null) as T | null;
    }
    if (q.includes("from kill_events") && q.includes("coalesce(occurred_at")) {
      return (this.db.killEvents.find((event) =>
        event.linked_server_id === this.values[0] &&
        event.source_service_id === this.values[2] &&
        event.occurred_at === this.values[3] &&
        (event.killer_id ?? event.killer_name) === this.values[4] &&
        (event.victim_id ?? event.victim_name) === this.values[5] &&
        event.weapon === this.values[6] &&
        Math.abs(Number(event.distance ?? -9999999) - Number(this.values[8] ?? -9999999)) < 0.0001
      ) ?? null) as T | null;
    }
    if (q.includes("count(*) as count from player_profiles")) return ({ count: this.db.playerProfiles.filter((row) => row.linked_server_id === this.values[0]).length } as T);
    if (q.includes("count(*) as count from adm_raw_events")) return ({ count: this.db.admRawEvents.filter((row) => row.linked_server_id === this.values[0]).length } as T);
    if (q.includes("count(*) as count from player_events") && q.includes("event_type in")) {
      const deathTypes = new Set(["player_suicide", "player_killed_environment", "player_died_stats"]);
      return ({ count: this.db.playerEvents.filter((row) => row.linked_server_id === this.values[0] && deathTypes.has(String(row.event_type))).length } as T);
    }
    if (q.includes("count(*) as count from player_events") && q.includes("event_type = 'player_connected'")) return ({ count: this.db.playerEvents.filter((row) => row.linked_server_id === this.values[0] && row.event_type === "player_connected").length } as T);
    if (q.includes("count(*) as count from player_events") && q.includes("event_type = 'player_disconnected'")) return ({ count: this.db.playerEvents.filter((row) => row.linked_server_id === this.values[0] && row.event_type === "player_disconnected").length } as T);
    if (q.includes("count(*) as count from player_events")) return ({ count: this.db.playerEvents.filter((row) => row.linked_server_id === this.values[0]).length } as T);
    if (q.includes("count(*) as count from build_events")) return ({ count: this.db.buildEvents.filter((row) => row.linked_server_id === this.values[0]).length } as T);
    if (q.includes("count(*) as count from kill_events") && q.includes("victim_name is not null")) return ({ count: this.db.killEvents.filter((row) => row.linked_server_id === this.values[0] && row.victim_name).length } as T);
    if (q.includes("count(*) as count from kill_events")) return ({ count: this.db.killEvents.filter((row) => row.linked_server_id === this.values[0]).length } as T);
    if (q.includes("max(coalesce(distance")) return ({ distance: maxNumber(this.db.killEvents.filter((row) => row.linked_server_id === this.values[0]).map((row) => Number(row.distance ?? 0))) } as T);
    if (q.includes("select max(coalesce(occurred_at")) return ({ last_event_at: latestTime([...this.db.playerEvents, ...this.db.killEvents, ...this.db.buildEvents].filter((row) => row.linked_server_id === this.values[0] || row.linked_server_id === this.values[1] || row.linked_server_id === this.values[2])) } as T);
    if (q.includes("sum(case when event_type")) return ({ structures_built: 0, build_items_placed: 0, storage_items_placed: 0, traps_placed: 0, build_score: 0, last_build_at: null } as T);
    if (q.includes("select player_name, count(*) as count") && q.includes("from build_events")) return null;
    if (q.includes("from adm_sync_file_state")) return ({ count: 0 } as T);
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const q = normalizeSql(this.query);
    if (q.startsWith("pragma table_info")) return { results: [] };
    return { results: [] };
  }

  private insertIgnore(rows: MemoryRow[], row: MemoryRow, predicate: (row: MemoryRow) => boolean = (existing) => existing.id === row.id): RunResult {
    if (rows.some(predicate)) return changed(0);
    rows.push(row);
    return changed(1);
  }
}

function normalizeSql(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isSchemaQuery(query: string) {
  return query.startsWith("create ") || query.startsWith("alter table") || query.startsWith("pragma ") || query.startsWith("create unique index") || query.startsWith("create index");
}

function changed(changes: number): RunResult {
  return { meta: { changes } };
}

function maxNumber(values: number[]) {
  return values.length ? Math.max(...values) : null;
}

function latestTime(rows: MemoryRow[]) {
  const values = rows.map((row) => row.occurred_at ?? row.created_at).filter(Boolean).sort();
  return values.at(-1) ?? null;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
