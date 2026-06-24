import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/servers/[serverId]/dashboard/live-stats";
import type { Env, PagesContext } from "../functions/_lib/types";

type ServerFixture = {
  id: string;
  userId: string;
  kills: number;
  deaths: number;
  joins: number;
  disconnects: number;
  uniquePlayers: number;
  longestKill: number;
  latestKillAt: string | null;
  latestPlayerAt: string | null;
};

const fixtures: Record<string, ServerFixture> = {
  nuketown: {
    id: "nuketown",
    userId: "owner-user",
    kills: 1657,
    deaths: 2449,
    joins: 2797,
    disconnects: 534,
    uniquePlayers: 443,
    longestKill: 84.6898,
    latestKillAt: "2026-06-24T06:47:00.000Z",
    latestPlayerAt: "2026-06-24T06:40:00.000Z",
  },
  pandora: {
    id: "pandora",
    userId: "owner-user",
    kills: 3,
    deaths: 9,
    joins: 195,
    disconnects: 0,
    uniquePlayers: 38,
    longestKill: 0,
    latestKillAt: "2026-06-23T10:00:00.000Z",
    latestPlayerAt: "2026-06-23T12:00:00.000Z",
  },
  warlords: {
    id: "warlords",
    userId: "owner-user",
    kills: 0,
    deaths: 0,
    joins: 0,
    disconnects: 0,
    uniquePlayers: 0,
    longestKill: 0,
    latestKillAt: null,
    latestPlayerAt: null,
  },
};

class MemoryD1 {
  constructor(private readonly userId = "owner-user") {}

  prepare(sql: string) {
    return new MemoryD1Statement(this, sql);
  }

  first(sql: string, bindings: unknown[]) {
    const normalized = sql.replace(/\s+/g, " ");
    const serverId = String(bindings.at(-1) ?? "");
    const server = fixtures[serverId];

    if (normalized.includes("FROM sessions") && normalized.includes("JOIN users")) {
      return { id: this.userId, discord_id: "owner-discord", username: "Owner", avatar: null };
    }

    if (normalized.includes("FROM linked_servers") && normalized.includes("user_id")) {
      return server ? { id: server.id, user_id: server.userId, guild_id: `${server.id}-guild` } : null;
    }

    if (normalized.includes("COUNT(*) AS kills") && normalized.includes("FROM kill_events")) {
      return {
        kills: server?.kills ?? 0,
        kill_deaths: server?.deaths ?? 0,
        longest_kill: server?.longestKill ?? 0,
      };
    }

    if (normalized.includes("event_type = 'player_connected'") && normalized.includes("other_deaths")) {
      return {
        joins: server?.joins ?? 0,
        disconnects: server?.disconnects ?? 0,
        other_deaths: 0,
        total: (server?.joins ?? 0) + (server?.disconnects ?? 0),
      };
    }

    if (normalized.includes("COUNT(*) AS total FROM player_profiles")) {
      return { total: server?.uniquePlayers ?? 0 };
    }

    if (normalized.includes("COUNT(*) AS total FROM build_events")) {
      return { total: 0 };
    }

    if (normalized.includes("MAX(COALESCE(occurred_at, created_at)) AS latest_at FROM kill_events")) {
      return { latest_at: server?.latestKillAt ?? null };
    }

    if (normalized.includes("MAX(COALESCE(occurred_at, created_at)) AS latest_at FROM player_events")) {
      return { latest_at: server?.latestPlayerAt ?? null };
    }

    if (normalized.includes("MAX(COALESCE(occurred_at, created_at)) AS latest_at FROM build_events")) {
      return { latest_at: null };
    }

    if (normalized.includes("END AS active")) {
      return { active: server && (server.kills || server.joins || server.uniquePlayers || server.latestKillAt || server.latestPlayerAt) ? 1 : 0 };
    }

    if (normalized.includes("WITH server_scope")) {
      const rank = rankFixtures().find((row) => row.id === serverId)?.rank ?? null;
      return { rank };
    }

    return null;
  }

  all() {
    return [];
  }
}

class MemoryD1Statement {
  private bindings: unknown[] = [];

  constructor(private readonly db: MemoryD1, private readonly sql: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async first<T>() {
    return this.db.first(this.sql, this.bindings) as T | null;
  }

  async all<T>() {
    return { results: this.db.all() as T[] };
  }

  async run() {
    return { success: true };
  }
}

function score(server: ServerFixture) {
  const syncBonus = server.kills || server.joins || server.uniquePlayers ? 25 : 0;
  return Math.max(0, (server.kills * 10) + (server.uniquePlayers * 5) + (server.joins * 2) + Math.round(server.longestKill) + syncBonus - (server.deaths * 2));
}

function rankFixtures() {
  return Object.values(fixtures)
    .map((server) => ({ ...server, score: score(server) }))
    .sort((a, b) => b.score - a.score || b.kills - a.kills)
    .map((server, index) => ({ id: server.id, rank: index + 1 }));
}

function makeContext(serverId: string, db: MemoryD1, cookie = "dzn_session=test-session"): PagesContext {
  return {
    request: new Request(`https://dzn.test/api/servers/${serverId}/dashboard/live-stats`, {
      headers: cookie ? { cookie } : undefined,
    }),
    env: {
      DB: db,
      SESSION_SECRET: "unit-test-secret",
    } as unknown as Env,
    params: { serverId },
    waitUntil: () => undefined,
    next: () => Promise.resolve(new Response(null)),
    data: {},
  };
}

async function readJson(response: Response) {
  return await response.json() as {
    ok: boolean;
    server_id?: string;
    source?: string;
    generated_at?: string;
    latest_event_at?: string | null;
    stats?: {
      kills: number;
      deaths: number;
      joins: number;
      disconnects: number;
      unique_players: number;
      longest_kill: number;
      total_events_tracked: number;
      score: number;
      score_label: string;
      rank: number | null;
    };
    error_code?: string;
  };
}

async function main() {
  const unauthenticated = await onRequestGet(makeContext("nuketown", new MemoryD1(), ""));
  assert.equal(unauthenticated.status, 403, "Live stats must reject unauthenticated requests.");

  const crossOwner = await onRequestGet(makeContext("nuketown", new MemoryD1("other-user")));
  assert.equal(crossOwner.status, 403, "Live stats must reject cross-owner requests.");

  for (const serverId of ["nuketown", "pandora", "warlords"] as const) {
    const response = await onRequestGet(makeContext(serverId, new MemoryD1()));
    assert.equal(response.status, 200, `${serverId} owner request should succeed.`);
    assert.match(response.headers.get("cache-control") ?? "", /private, no-store, no-cache, must-revalidate/);

    const body = await readJson(response);
    const expected = fixtures[serverId];
    assert.equal(body.ok, true);
    assert.equal(body.server_id, serverId);
    assert.equal(body.source, "canonical-adm-events");
    assert.equal(typeof body.generated_at, "string");
    assert.equal(body.latest_event_at, [expected.latestKillAt, expected.latestPlayerAt].filter(Boolean).sort().at(-1) ?? null);
    assert.equal(body.stats?.kills, expected.kills);
    assert.equal(body.stats?.deaths, expected.deaths);
    assert.equal(body.stats?.joins, expected.joins);
    assert.equal(body.stats?.disconnects, expected.disconnects);
    assert.equal(body.stats?.unique_players, expected.uniquePlayers);
    assert.equal(body.stats?.longest_kill, expected.longestKill);
    assert.equal(body.stats?.total_events_tracked, expected.kills + expected.joins + expected.disconnects);
    assert.equal(body.stats?.score, score(expected));
    assert.equal(body.stats?.score_label, String(score(expected)));
    assert.equal(body.stats?.rank, rankFixtures().find((row) => row.id === serverId)?.rank ?? null);
  }

  console.log("Dashboard live-stats endpoint tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
