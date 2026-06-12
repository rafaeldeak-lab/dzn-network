import { requireDb } from "./db";
import { computeServerWarScore, type ServerWarEventForScoring, type ServerWarScoreResult } from "./server-war-scoring";
import { ensureServerWarsSchema } from "./server-war-schema";
import type { Env } from "./types";

export type ServerWarSnapshotRow = {
  id: string;
  event_id: string;
  server_id: string;
  snapshot_at: string;
  score: number;
  rank: number | null;
  metric_breakdown: string;
  contributor_summary: string;
  data_window_start: string;
  data_window_end: string;
  computed_at: string;
  created_at: string;
  server_name: string | null;
  public_slug: string | null;
  server_category: string | null;
};

export type ServerWarStanding = {
  rank: number;
  serverId: string;
  serverName: string;
  serverSlug: string | null;
  category: string | null;
  score: number;
  metricBreakdown: Record<string, unknown>;
  contributorSummary: Record<string, unknown>;
  snapshotAt: string;
  computedAt: string;
};

export type ServerWarSnapshotRefreshResult = {
  ok: true;
  eventId: string;
  snapshotAt: string;
  standings: ServerWarStanding[];
};

type EventRow = ServerWarEventForScoring & {
  status: string;
};

type ParticipantRow = {
  server_id: string;
};

export async function refreshServerWarEventSnapshot(env: Env, eventId: string): Promise<ServerWarSnapshotRefreshResult> {
  await ensureServerWarsSchema(env);
  const db = requireDb(env);
  const event = await db
    .prepare(
      `SELECT id, scoring_ruleset_key, starts_at, ends_at, status
       FROM server_war_events
       WHERE id = ? OR slug = ?
       LIMIT 1`,
    )
    .bind(eventId, eventId)
    .first<EventRow>();
  if (!event) throw new Error("server_war_event_not_found");
  if (String(event.status).toLowerCase() === "cancelled") throw new Error("server_war_event_cancelled");

  const participants = await db
    .prepare(
      `SELECT server_id
       FROM server_war_participants
       WHERE event_id = ?
         AND status IN ('accepted', 'joined')
       ORDER BY accepted_at DESC, joined_at DESC, created_at ASC
       LIMIT 64`,
    )
    .bind(event.id)
    .all<ParticipantRow>();
  const scores: ServerWarScoreResult[] = [];
  for (const participant of participants.results ?? []) {
    scores.push(await computeServerWarScore(env, event, participant.server_id));
  }

  scores.sort((a, b) => b.score - a.score || a.serverId.localeCompare(b.serverId));
  const snapshotAt = new Date().toISOString();
  let rank = 1;
  for (const score of scores) {
    await db
      .prepare(
        `INSERT INTO server_war_score_snapshots (
          id, event_id, server_id, snapshot_at, score, rank, metric_breakdown,
          contributor_summary, data_window_start, data_window_end, computed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        score.eventId,
        score.serverId,
        snapshotAt,
        score.score,
        rank,
        JSON.stringify(score.metricBreakdown),
        JSON.stringify(score.contributorSummary),
        score.dataWindowStart,
        score.dataWindowEnd,
        score.computedAt,
        snapshotAt,
      )
      .run();
    rank += 1;
  }

  return {
    ok: true,
    eventId: event.id,
    snapshotAt,
    standings: await getLatestServerWarStandings(env, event.id),
  };
}

export async function getLatestServerWarStandings(env: Env, eventId: string, limit = 50): Promise<ServerWarStanding[]> {
  await ensureServerWarsSchema(env);
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const rows = await requireDb(env)
    .prepare(
      `WITH latest AS (
         SELECT MAX(snapshot_at) AS snapshot_at
         FROM server_war_score_snapshots
         WHERE event_id = ?
       )
       SELECT snapshots.*, 
              COALESCE(linked_servers.display_name, linked_servers.server_name, linked_servers.hostname, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
              linked_servers.public_slug,
              linked_servers.server_category
       FROM server_war_score_snapshots snapshots
       INNER JOIN latest ON latest.snapshot_at = snapshots.snapshot_at
       INNER JOIN linked_servers ON linked_servers.id = snapshots.server_id
       WHERE snapshots.event_id = ?
       ORDER BY snapshots.rank ASC, snapshots.score DESC
       LIMIT ${safeLimit}`,
    )
    .bind(eventId, eventId)
    .all<ServerWarSnapshotRow>();
  return (rows.results ?? []).map(snapshotToStanding);
}

export function snapshotToStanding(row: ServerWarSnapshotRow): ServerWarStanding {
  return {
    rank: Number(row.rank ?? 0),
    serverId: row.server_id,
    serverName: row.server_name ?? "DZN Server",
    serverSlug: row.public_slug,
    category: row.server_category,
    score: Number(row.score ?? 0),
    metricBreakdown: parseJsonObject(row.metric_breakdown),
    contributorSummary: parseJsonObject(row.contributor_summary),
    snapshotAt: row.snapshot_at,
    computedAt: row.computed_at,
  };
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
