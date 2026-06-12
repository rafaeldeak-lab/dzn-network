import { requireDb } from "./db";
import { getServerWarRuleset } from "./server-war-categories";
import { getLatestServerWarStandings, refreshServerWarEventSnapshot } from "./server-war-snapshots";
import { ensureServerWarsSchema } from "./server-war-schema";
import type { Env } from "./types";

export type ServerWarFinalizeResult = {
  ok: true;
  eventId: string;
  finalizedAt: string;
  alreadyFinalized: boolean;
  resultsWritten: number;
  winnerServerId: string | null;
};

type EventRow = {
  id: string;
  status: string;
  title: string;
  category: string | null;
  scoring_ruleset_key: string;
  ends_at: string;
  finalized_at: string | null;
};

export async function finalizeServerWarEvent(env: Env, eventIdOrSlug: string): Promise<ServerWarFinalizeResult> {
  await ensureServerWarsSchema(env);
  const db = requireDb(env);
  const event = await db
    .prepare(
      `SELECT id, status, title, category, scoring_ruleset_key, ends_at, finalized_at
       FROM server_war_events
       WHERE id = ? OR slug = ?
       LIMIT 1`,
    )
    .bind(eventIdOrSlug, eventIdOrSlug)
    .first<EventRow>();
  if (!event) throw new Error("server_war_event_not_found");
  const status = String(event.status ?? "").toLowerCase();
  if (status === "cancelled") throw new Error("server_war_event_cancelled");

  if (status === "completed" && event.finalized_at) {
    const existing = await db
      .prepare("SELECT COUNT(*) AS count FROM server_war_results WHERE event_id = ?")
      .bind(event.id)
      .first<{ count: number | null }>();
    const winner = await db
      .prepare("SELECT server_id FROM server_war_results WHERE event_id = ? AND final_rank = 1 LIMIT 1")
      .bind(event.id)
      .first<{ server_id: string | null }>();
    return {
      ok: true,
      eventId: event.id,
      finalizedAt: event.finalized_at,
      alreadyFinalized: true,
      resultsWritten: Number(existing?.count ?? 0),
      winnerServerId: winner?.server_id ?? null,
    };
  }

  if (Date.parse(event.ends_at) > Date.now()) {
    throw new Error("server_war_event_not_ended");
  }

  let standings = await getLatestServerWarStandings(env, event.id);
  if (!standings.length) {
    standings = (await refreshServerWarEventSnapshot(env, event.id)).standings;
  }

  const finalizedAt = new Date().toISOString();
  for (const standing of standings) {
    await db
      .prepare(
        `INSERT INTO server_war_results (
          id, event_id, server_id, final_rank, final_score, metric_breakdown, top_contributors, finalized_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id, server_id) DO UPDATE SET
          final_rank = excluded.final_rank,
          final_score = excluded.final_score,
          metric_breakdown = excluded.metric_breakdown,
          top_contributors = excluded.top_contributors,
          finalized_at = excluded.finalized_at`,
      )
      .bind(
        crypto.randomUUID(),
        event.id,
        standing.serverId,
        standing.rank,
        standing.score,
        JSON.stringify(standing.metricBreakdown),
        JSON.stringify(standing.contributorSummary),
        finalizedAt,
        finalizedAt,
      )
      .run();
    await db
      .prepare(
        `UPDATE server_war_participants
         SET final_rank = ?, final_score = ?, updated_at = ?
         WHERE event_id = ? AND server_id = ?`,
      )
      .bind(standing.rank, standing.score, finalizedAt, event.id, standing.serverId)
      .run();
  }

  const winner = standings.find((standing) => standing.rank === 1) ?? standings[0] ?? null;
  if (winner) {
    await awardServerWarTrophy(env, {
      eventId: event.id,
      serverId: winner.serverId,
      title: `${getServerWarRuleset(event.scoring_ruleset_key).title} Champion`,
      eventTitle: event.title,
      category: event.category,
      awardedAt: finalizedAt,
      metadata: {
        finalScore: winner.score,
        finalRank: winner.rank,
      },
    });
  }

  await db
    .prepare("UPDATE server_war_events SET status = 'completed', finalized_at = ?, updated_at = ? WHERE id = ?")
    .bind(finalizedAt, finalizedAt, event.id)
    .run();

  return {
    ok: true,
    eventId: event.id,
    finalizedAt,
    alreadyFinalized: false,
    resultsWritten: standings.length,
    winnerServerId: winner?.serverId ?? null,
  };
}

async function awardServerWarTrophy(
  env: Env,
  input: {
    eventId: string;
    serverId: string;
    title: string;
    eventTitle: string;
    category: string | null;
    awardedAt: string;
    metadata: Record<string, unknown>;
  },
) {
  const db = requireDb(env);
  const trophyKey = `server_wars:${input.category ?? "overall"}:champion`;
  const titleKey = `current:${input.category ?? "overall"}:champion`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO server_trophies (
        id, server_id, event_id, trophy_key, title, description, category, reward_type,
        awarded_at, expires_at, is_current_title, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'permanent', ?, NULL, 0, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.serverId,
      input.eventId,
      trophyKey,
      input.title,
      `Won ${input.eventTitle}.`,
      input.category,
      input.awardedAt,
      JSON.stringify(input.metadata),
      input.awardedAt,
    )
    .run();

  await db
    .prepare(
      `UPDATE server_champion_titles
       SET active = 0, updated_at = ?
       WHERE category IS ?
         AND title_key = ?
         AND active = 1
         AND event_id != ?`,
    )
    .bind(input.awardedAt, input.category, titleKey, input.eventId)
    .run();

  await db
    .prepare(
      `INSERT INTO server_champion_titles (
        id, server_id, event_id, title_key, title, category, awarded_at, expires_at, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
      ON CONFLICT(event_id, title_key) DO UPDATE SET
        server_id = excluded.server_id,
        title = excluded.title,
        category = excluded.category,
        awarded_at = excluded.awarded_at,
        active = 1,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.serverId,
      input.eventId,
      titleKey,
      input.title,
      input.category,
      input.awardedAt,
      input.awardedAt,
      input.awardedAt,
    )
    .run();
}
