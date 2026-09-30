type CanonicalEvidenceRow = {
  linked_server_id: string;
  evidence_count: number | null;
};

export type PublicServerCanonicalEvidence = {
  totalKills: number;
  uniquePlayers: number;
};

const EVIDENCE_QUERY_CHUNK_SIZE = 75;

export async function readPublicServerCanonicalEvidence(
  db: D1Database,
  linkedServerIds: string[],
) {
  const evidence = new Map<string, PublicServerCanonicalEvidence>();
  const uniqueIds = [...new Set(linkedServerIds.filter(Boolean))];

  for (let offset = 0; offset < uniqueIds.length; offset += EVIDENCE_QUERY_CHUNK_SIZE) {
    const ids = uniqueIds.slice(offset, offset + EVIDENCE_QUERY_CHUNK_SIZE);
    const placeholders = ids.map(() => "?").join(", ");
    const [killResult, playerResult] = await Promise.all([
      db.prepare(
        `SELECT linked_server_id, COUNT(*) AS evidence_count
         FROM kill_events
         WHERE linked_server_id IN (${placeholders})
         GROUP BY linked_server_id`,
      ).bind(...ids).all<CanonicalEvidenceRow>(),
      db.prepare(
        `SELECT linked_server_id, COUNT(*) AS evidence_count
         FROM player_profiles
         WHERE linked_server_id IN (${placeholders})
         GROUP BY linked_server_id`,
      ).bind(...ids).all<CanonicalEvidenceRow>(),
    ]);

    for (const id of ids) evidence.set(id, { totalKills: 0, uniquePlayers: 0 });
    for (const row of killResult.results ?? []) {
      const current = evidence.get(row.linked_server_id);
      if (current) current.totalKills = numberOrZero(row.evidence_count);
    }
    for (const row of playerResult.results ?? []) {
      const current = evidence.get(row.linked_server_id);
      if (current) current.uniquePlayers = numberOrZero(row.evidence_count);
    }
  }

  return evidence;
}

function numberOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
