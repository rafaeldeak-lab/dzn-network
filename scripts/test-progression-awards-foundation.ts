import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { onRequest as playerChallengesHandler } from "../functions/api/player/challenges";
import {
  onRequestGet as progressionAwardsGet,
  onRequestPost as progressionAwardsPost,
} from "../functions/api/cron/player-progression/awards";
import {
  getPlayerChallengesPayload,
  runPlayerProgressionAwardJob,
} from "../functions/_lib/player-progression";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type FakeChallenge = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  reward_xp: number;
  calling_card_code: string | null;
  calling_card_name: string | null;
  calling_card_description: string | null;
  calling_card_rarity: string | null;
  target_value: number;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
};

type FakeParticipation = {
  challenge_id: string;
  status: "joined" | "completed" | "abandoned";
  progress_value: number;
  target_value: number;
  xp_awarded: number;
  calling_card_awarded: string | null;
  joined_at: string;
  completed_at: string | null;
  updated_at: string;
};

type FakeAwardSource = {
  id: string;
  user_id: string;
  challenge_id: string;
  source_type: string;
  source_id: string;
  progress_value: number;
  verification_status: string;
  verified_at: string;
  evidence_json: string | null;
  processed_at: string | null;
  result_status: string;
  result_message: string | null;
  created_at: string;
  updated_at: string;
};

type FakeXpAward = {
  user_id: string;
  source_type: string;
  source_id: string;
  xp_amount: number;
};

type FakeCallingCardAward = {
  user_id: string;
  calling_card_code: string;
  source_type: string;
  source_id: string;
  awarded_at: string;
};

const TEST_USER: SessionUser = {
  id: "mock-user",
  discord_id: "mock-discord-user",
  username: "RafaelDeak",
  avatar: null,
};

async function main() {
  assertStaticContract();

  const routeGet = await progressionAwardsGet(context(new Request("https://dzn.example/api/cron/player-progression/awards"), cronEnv(createFakeProgressionDb().db)));
  assert.equal(routeGet.status, 405, "Progression award cron route must be POST-only.");

  const unauthorized = await callProgressionAwards(createFakeProgressionDb(), {}, { verified_sources: [] });
  assert.equal(unauthorized.status, 401, "Progression award cron route must require the shared cron secret.");

  const unverifiedDb = createFakeProgressionDb();
  const unverified = await runPlayerProgressionAwardJob({ DB: unverifiedDb.db } as Env, {
    sources: [{
      source_type: "adm_gameplay",
      source_id: "adm:source-1",
      user_id: TEST_USER.id,
      challenge_slug: "survivor-spark",
      progress_value: 1,
      verified: false,
    }],
  });
  assert.equal(unverified.accepted_sources, 0);
  assert.equal(unverified.skipped[0]?.message.includes("explicitly verified"), true);
  assert.equal(unverifiedDb.xpAwards.length, 0, "Unverified sources must not award XP.");
  assert.equal(unverifiedDb.callingCardAwards.length, 0, "Unverified sources must not award calling cards.");

  const playerSelfAwardDb = createFakeProgressionDb({ joinedChallengeIds: ["foundation-survivor-spark"] });
  const selfAward = await callPlayerChallenges("POST", { MOCK_AUTH: "true", DB: playerSelfAwardDb.db } as Env, {
    action: "complete",
    challenge_slug: "survivor-spark",
  });
  assert.equal(selfAward.status, 400, "Player challenge API must still reject completion/self-award actions.");
  assert.equal(playerSelfAwardDb.xpAwards.length, 0);
  assert.equal(playerSelfAwardDb.callingCardAwards.length, 0);

  const awardDb = createFakeProgressionDb({ joinedChallengeIds: ["foundation-survivor-spark"] });
  const awardResponse = await callProgressionAwards(awardDb, cronEnv(awardDb.db), {
    source: "unit-test",
    verified_sources: [{
      source_type: "adm_gameplay",
      source_id: "adm:source-1",
      user_id: TEST_USER.id,
      challenge_slug: "survivor-spark",
      progress_value: 1,
      verified: true,
      evidence: { source: "unit", verified_line_hash: "hash-1" },
    }],
  });
  assert.equal(awardResponse.status, 200);
  const awardJson = await awardResponse.json() as {
    accepted_sources: number;
    processed: number;
    awarded_xp: number;
    awarded_cards: number;
    completed_challenges: number;
  };
  assert.equal(awardJson.accepted_sources, 1);
  assert.equal(awardJson.processed, 1);
  assert.equal(awardJson.awarded_xp, 50);
  assert.equal(awardJson.awarded_cards, 1);
  assert.equal(awardJson.completed_challenges, 1);
  assert.equal(awardDb.xpAwards.length, 1);
  assert.equal(awardDb.callingCardAwards.length, 1);
  assert.equal(awardDb.participations.get(`${TEST_USER.id}:foundation-survivor-spark`)?.status, "completed");
  assertProgressionAwardOperationsStayIsolated(awardDb.operations);

  const payload = await getPlayerChallengesPayload({ DB: awardDb.db } as Env, TEST_USER);
  assert.equal(payload.player_progress.total_xp, 50);
  assert.equal(payload.player_progress.completed_challenges, 1);
  assert.equal(payload.player_progress.calling_cards[0]?.code, "survivor_spark");
  assert.equal(payload.challenges[0]?.player_state.status, "completed");

  const duplicateSource = await runPlayerProgressionAwardJob({ DB: awardDb.db } as Env, {
    sources: [{
      source_type: "adm_gameplay",
      source_id: "adm:source-1",
      user_id: TEST_USER.id,
      challenge_slug: "survivor-spark",
      progress_value: 1,
      verified: true,
    }],
  });
  assert.equal(duplicateSource.duplicate_sources, 1);
  assert.equal(duplicateSource.processed, 0);
  assert.equal(awardDb.xpAwards.length, 1, "Repeated source must not duplicate XP.");
  assert.equal(awardDb.callingCardAwards.length, 1, "Repeated source must not duplicate calling cards.");

  const secondSourceSameChallenge = await runPlayerProgressionAwardJob({ DB: awardDb.db } as Env, {
    sources: [{
      source_type: "verified_activity",
      source_id: "activity:source-2",
      user_id: TEST_USER.id,
      challenge_id: "foundation-survivor-spark",
      progress_value: 1,
      verified: true,
    }],
  });
  assert.equal(secondSourceSameChallenge.accepted_sources, 1);
  assert.equal(secondSourceSameChallenge.processed, 1);
  assert.equal(secondSourceSameChallenge.awarded_xp, 0, "Repeated challenge completion must not duplicate XP.");
  assert.equal(secondSourceSameChallenge.awarded_cards, 0, "Repeated challenge completion must not duplicate cards.");
  assert.equal(secondSourceSameChallenge.skipped.some((item) => item.status === "duplicate"), true);
  assert.equal(awardDb.xpAwards.length, 1);
  assert.equal(awardDb.callingCardAwards.length, 1);

  const notJoinedDb = createFakeProgressionDb();
  const notJoined = await runPlayerProgressionAwardJob({ DB: notJoinedDb.db } as Env, {
    sources: [{
      source_type: "community_activity",
      source_id: "community:source-1",
      user_id: TEST_USER.id,
      challenge_slug: "community-scout",
      progress_value: 1,
      verified: true,
    }],
  });
  assert.equal(notJoined.accepted_sources, 1);
  assert.equal(notJoined.processed, 1);
  assert.equal(notJoined.skipped[0]?.message, "Player has not joined this challenge.");
  assert.equal(notJoinedDb.xpAwards.length, 0);
  assert.equal(notJoinedDb.callingCardAwards.length, 0);

  const progressOnlyDb = createFakeProgressionDb({ joinedChallengeIds: ["foundation-long-road"] });
  const progressOnly = await runPlayerProgressionAwardJob({ DB: progressOnlyDb.db } as Env, {
    sources: [{
      source_type: "event_participation",
      source_id: "event:source-1",
      user_id: TEST_USER.id,
      challenge_slug: "long-road",
      progress_value: 2,
      verified: true,
    }],
  });
  assert.equal(progressOnly.progressed, 1);
  assert.equal(progressOnly.awarded_xp, 0);
  assert.equal(progressOnly.awarded_cards, 0);
  assert.equal(progressOnlyDb.participations.get(`${TEST_USER.id}:foundation-long-road`)?.progress_value, 2);

  console.log("Progression awards foundation tests passed.");
}

function assertStaticContract() {
  assert.equal(existsSync("functions/api/cron/player-progression/awards.ts"), true, "Protected progression award route should exist.");
  assert.equal(existsSync("migrations/0063_player_progression_award_sources.sql"), true, "Progression award source migration should exist.");

  const routeSource = read("functions/api/cron/player-progression/awards.ts");
  assert.match(routeSource, /requireCronSecret/, "Award route must require the shared cron secret.");
  assert.match(routeSource, /onRequestPost/, "Award route should run only on POST.");
  assert.match(routeSource, /readBoundedJson/, "Award route body must be bounded.");
  assert.doesNotMatch(routeSource, /getRequestSessionUser|requireOwnerRequestAccess|requireActiveOwnerEntitlement|ownerAccessErrorResponse/);
  assert.doesNotMatch(routeSource, externalOrBillingPattern());

  const progressionSource = read("functions/_lib/player-progression.ts");
  for (const snippet of [
    "runPlayerProgressionAwardJob",
    "TRUSTED_PROGRESSION_SOURCE_TYPES",
    "player_progression_award_sources",
    "input.verified !== true",
    "INSERT OR IGNORE INTO player_xp_ledger",
    "INSERT OR IGNORE INTO player_calling_card_awards",
    "UPDATE player_challenge_participations",
    "challenge_completion",
    "Player has not joined this challenge.",
  ]) {
    assert.equal(progressionSource.includes(snippet), true, `Progression helper must include ${snippet}`);
  }
  assert.doesNotMatch(progressionSource, /\brequireOwnerRequestAccess\b|\brequireActiveOwnerEntitlement\b|\bownerAccessErrorResponse\b/);
  assert.doesNotMatch(progressionSource, externalOrBillingPattern());

  const playerApiSource = read("functions/api/player/challenges.ts");
  assert.doesNotMatch(playerApiSource, /runPlayerProgressionAwardJob|player_progression_award_sources|INSERT\s+OR\s+IGNORE\s+INTO\s+player_xp_ledger|INSERT\s+OR\s+IGNORE\s+INTO\s+player_calling_card_awards/i);

  const migration = stripSqlComments(read("migrations/0063_player_progression_award_sources.sql"));
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS player_progression_award_sources",
    "UNIQUE(user_id, source_type, source_id)",
    "'adm_gameplay'",
    "'challenge_rule'",
    "'community_activity'",
    "'event_participation'",
    "'verified_activity'",
    "'pending'",
    "'awarded'",
    "'duplicate'",
  ]) {
    assert.equal(migration.includes(snippet), true, `Progression award migration must include ${snippet}`);
  }
  assert.doesNotMatch(migration, protectedSurfaceMutationPattern(), "Award migration must not mutate protected competitive/billing surfaces.");

  const publicServersApi = read("functions/api/public/servers.ts");
  assertFunctionDoesNotMention(publicServersApi, "sortPublicServersForDiscovery", /\bplayer_progression_award_sources\b|\bplayer_xp_ledger\b|\bplayer_calling_card_awards\b/i);
  assertFunctionDoesNotMention(publicServersApi, "applyPublicServerAccess", /\bplayer_progression_award_sources\b|\bplayer_xp_ledger\b|\bplayer_calling_card_awards\b/i);

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  assert.equal(platformSpec.includes("Authoritative Progression Awards Slice"), true);
  assert.equal(platformSpec.includes("`/api/cron/player-progression/awards`"), true);
  assert.equal(platformSpec.includes("Cron secret only, verified award facts"), true);

  const publicPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  assert.equal(publicPolicy.includes("`/api/cron/player-progression/awards` is not a public or player endpoint"), true);

  const handoff = read("docs/PROGRESSION_AWARDS_FOUNDATION_HANDOFF.md");
  assert.equal(handoff.includes("Production merge/deploy/migration application: not included."), true);
  assert.equal(handoff.includes("Issue #49 remains reserved for final live checkout activation."), true);
}

async function callPlayerChallenges(method: string, env: Env, body?: unknown) {
  return playerChallengesHandler(context(new Request("https://dzn.example/api/player/challenges", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }), env)) as Promise<Response>;
}

async function callProgressionAwards(db: FakeProgressionDb, env: Partial<Env>, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.DZN_CRON_SECRET) headers["x-dzn-cron-secret"] = env.DZN_CRON_SECRET;
  return progressionAwardsPost(context(new Request("https://dzn.example/api/cron/player-progression/awards", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }), { DB: db.db, ...env } as Env)) as Promise<Response>;
}

function context(request: Request, env: Env): PagesContext {
  return {
    request,
    env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  };
}

function cronEnv(db: Env["DB"]) {
  return { DB: db, DZN_CRON_SECRET: "unit-test-secret" } as Env;
}

function createFakeProgressionDb(options: { joinedChallengeIds?: string[] } = {}) {
  return new FakeProgressionDb(options);
}

class FakeProgressionDb {
  readonly operations: FakeOperation[] = [];
  readonly challenges = new Map<string, FakeChallenge>();
  readonly participations = new Map<string, FakeParticipation>();
  readonly awardSources: FakeAwardSource[] = [];
  readonly xpAwards: FakeXpAward[] = [];
  readonly callingCardAwards: FakeCallingCardAward[] = [];
  readonly db: Env["DB"];

  constructor(options: { joinedChallengeIds?: string[] } = {}) {
    for (const challenge of challengeRows()) this.challenges.set(challenge.id, challenge);
    for (const challengeId of options.joinedChallengeIds ?? []) this.join(TEST_USER.id, challengeId);
    this.db = {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => new FakeProgressionStatement(this, sql, bindings),
        all: <T>() => new FakeProgressionStatement(this, sql, []).all<T>(),
        first: <T>() => new FakeProgressionStatement(this, sql, []).first<T>(),
        run: <T>() => new FakeProgressionStatement(this, sql, []).run<T>(),
      }),
      batch: async () => [],
      exec: async () => ({ success: true, meta: {} }),
    } as unknown as Env["DB"];
  }

  join(userId: string, challengeId: string) {
    const challenge = this.challenges.get(challengeId);
    assert.ok(challenge, `Unknown challenge fixture: ${challengeId}`);
    const now = "2026-08-25T12:00:00.000Z";
    this.participations.set(`${userId}:${challengeId}`, {
      challenge_id: challengeId,
      status: "joined",
      progress_value: 0,
      target_value: challenge.target_value,
      xp_awarded: 0,
      calling_card_awarded: null,
      joined_at: now,
      completed_at: null,
      updated_at: now,
    });
  }
}

class FakeProgressionStatement {
  constructor(
    private readonly db: FakeProgressionDb,
    private readonly sql: string,
    private readonly bindings: unknown[],
  ) {}

  async all<T>() {
    this.db.operations.push({ kind: "all", sql: this.sql, bindings: this.bindings });
    const normalized = normalizeSql(this.sql);
    if (/FROM player_progression_award_sources/i.test(this.sql)) {
      return { results: this.db.awardSources.filter((row) => row.verification_status === "verified" && row.result_status === "pending") as T[], success: true, meta: {} };
    }
    if (/FROM player_challenges/i.test(this.sql)) {
      return { results: [...this.db.challenges.values()].filter((row) => row.status === "active").sort((a, b) => a.sort_order - b.sort_order) as T[], success: true, meta: {} };
    }
    if (/FROM player_challenge_participations/i.test(this.sql)) {
      const userId = String(this.bindings[0] ?? "");
      return { results: [...this.db.participations.entries()].filter(([key]) => key.startsWith(`${userId}:`)).map(([, row]) => row) as T[], success: true, meta: {} };
    }
    if (/FROM player_calling_card_awards/i.test(this.sql)) {
      const userId = String(this.bindings[0] ?? "");
      return {
        results: this.db.callingCardAwards
          .filter((row) => row.user_id === userId)
          .map((row) => {
            const challenge = [...this.db.challenges.values()].find((item) => item.calling_card_code === row.calling_card_code);
            return {
              calling_card_code: row.calling_card_code,
              calling_card_name: challenge?.calling_card_name ?? null,
              calling_card_description: challenge?.calling_card_description ?? null,
              calling_card_rarity: challenge?.calling_card_rarity ?? null,
              awarded_at: row.awarded_at,
            };
          }) as T[],
        success: true,
        meta: {},
      };
    }
    throw new Error(`Unexpected all SQL: ${normalized}`);
  }

  async first<T>() {
    this.db.operations.push({ kind: "first", sql: this.sql, bindings: this.bindings });
    const normalized = normalizeSql(this.sql);
    if (/FROM player_challenges/i.test(this.sql)) {
      const firstBinding = String(this.bindings[0] ?? "");
      return ([...this.db.challenges.values()].find((row) => row.id === firstBinding || row.slug.toLowerCase() === firstBinding.toLowerCase()) ?? null) as T | null;
    }
    if (/FROM player_challenge_participations/i.test(this.sql)) {
      const userId = String(this.bindings[0] ?? "");
      const challengeId = String(this.bindings[1] ?? "");
      return (this.db.participations.get(`${userId}:${challengeId}`) ?? null) as T | null;
    }
    if (/SUM\(xp_amount\)/i.test(this.sql)) {
      const userId = String(this.bindings[0] ?? "");
      const total = this.db.xpAwards.filter((row) => row.user_id === userId).reduce((sum, row) => sum + row.xp_amount, 0);
      return { total_xp: total } as T;
    }
    throw new Error(`Unexpected first SQL: ${normalized}`);
  }

  async run<T>() {
    this.db.operations.push({ kind: "run", sql: this.sql, bindings: this.bindings });
    const normalized = normalizeSql(this.sql);
    if (normalized.startsWith("insert or ignore into player_progression_award_sources")) {
      const row = sourceRowFromBindings(this.bindings);
      const duplicate = this.db.awardSources.some((existing) =>
        existing.user_id === row.user_id &&
        existing.source_type === row.source_type &&
        existing.source_id === row.source_id
      );
      if (!duplicate) this.db.awardSources.push(row);
      return result<T>(duplicate ? 0 : 1);
    }
    if (normalized.startsWith("update player_progression_award_sources")) {
      const [status, message, processedAt, updatedAt, id] = this.bindings;
      const row = this.db.awardSources.find((item) => item.id === String(id));
      if (row) {
        row.result_status = String(status);
        row.result_message = String(message);
        row.processed_at = String(processedAt);
        row.updated_at = String(updatedAt);
      }
      return result<T>(row ? 1 : 0);
    }
    if (normalized.startsWith("insert or ignore into player_xp_ledger")) {
      const [, userId, sourceType, sourceId, xpAmount] = this.bindings;
      const duplicate = this.db.xpAwards.some((row) =>
        row.user_id === String(userId) &&
        row.source_type === String(sourceType) &&
        row.source_id === String(sourceId)
      );
      if (!duplicate) {
        this.db.xpAwards.push({
          user_id: String(userId),
          source_type: String(sourceType),
          source_id: String(sourceId),
          xp_amount: Number(xpAmount),
        });
      }
      return result<T>(duplicate ? 0 : 1);
    }
    if (normalized.startsWith("insert or ignore into player_calling_card_awards")) {
      const [, userId, callingCardCode, sourceType, sourceId, awardedAt] = this.bindings;
      const duplicate = this.db.callingCardAwards.some((row) =>
        row.user_id === String(userId) &&
        (row.calling_card_code === String(callingCardCode) ||
          (row.source_type === String(sourceType) && row.source_id === String(sourceId)))
      );
      if (!duplicate) {
        this.db.callingCardAwards.push({
          user_id: String(userId),
          calling_card_code: String(callingCardCode),
          source_type: String(sourceType),
          source_id: String(sourceId),
          awarded_at: String(awardedAt),
        });
      }
      return result<T>(duplicate ? 0 : 1);
    }
    if (normalized.startsWith("update player_challenge_participations")) {
      const [status, progressValue, targetValue, xpAwarded, callingCardAwarded, completedAt, updatedAt, userId, challengeId] = this.bindings;
      const row = this.db.participations.get(`${String(userId)}:${String(challengeId)}`);
      if (row && row.status !== "abandoned") {
        row.status = status as FakeParticipation["status"];
        row.progress_value = Number(progressValue);
        row.target_value = Number(targetValue);
        row.xp_awarded = Number(xpAwarded);
        row.calling_card_awarded = callingCardAwarded === null || callingCardAwarded === undefined ? null : String(callingCardAwarded);
        row.completed_at = completedAt === null || completedAt === undefined ? null : String(completedAt);
        row.updated_at = String(updatedAt);
      }
      return result<T>(row ? 1 : 0);
    }
    if (normalized.startsWith("insert or ignore into player_challenge_participations")) {
      const [, userId, challengeId, targetValue, joinedAt, updatedAt] = this.bindings;
      const key = `${String(userId)}:${String(challengeId)}`;
      if (!this.db.participations.has(key)) {
        this.db.participations.set(key, {
          challenge_id: String(challengeId),
          status: "joined",
          progress_value: 0,
          target_value: Number(targetValue),
          xp_awarded: 0,
          calling_card_awarded: null,
          joined_at: String(joinedAt),
          completed_at: null,
          updated_at: String(updatedAt),
        });
        return result<T>(1);
      }
      return result<T>(0);
    }
    throw new Error(`Unexpected run SQL: ${normalized}`);
  }
}

function challengeRows(): FakeChallenge[] {
  return [
    {
      id: "foundation-survivor-spark",
      slug: "survivor-spark",
      title: "Survivor Spark",
      description: "Foundation survival track.",
      category: "survival",
      status: "active",
      reward_xp: 50,
      calling_card_code: "survivor_spark",
      calling_card_name: "Survivor Spark",
      calling_card_description: "Joined the first DZN player challenge track.",
      calling_card_rarity: "foundation",
      target_value: 1,
      sort_order: 10,
      starts_at: null,
      ends_at: null,
    },
    {
      id: "foundation-community-scout",
      slug: "community-scout",
      title: "Community Scout",
      description: "Foundation community track.",
      category: "community",
      status: "active",
      reward_xp: 75,
      calling_card_code: "community_scout",
      calling_card_name: "Community Scout",
      calling_card_description: "Started exploring DZN-connected communities.",
      calling_card_rarity: "foundation",
      target_value: 1,
      sort_order: 20,
      starts_at: null,
      ends_at: null,
    },
    {
      id: "foundation-long-road",
      slug: "long-road",
      title: "Long Road",
      description: "Multi-step verified activity challenge.",
      category: "survival",
      status: "active",
      reward_xp: 150,
      calling_card_code: "long_road",
      calling_card_name: "Long Road",
      calling_card_description: "Completed a multi-step progression track.",
      calling_card_rarity: "earned",
      target_value: 3,
      sort_order: 30,
      starts_at: null,
      ends_at: null,
    },
  ];
}

function sourceRowFromBindings(bindings: unknown[]): FakeAwardSource {
  const [id, userId, challengeId, sourceType, sourceId, progressValue, verifiedAt, evidenceJson, createdAt, updatedAt] = bindings;
  return {
    id: String(id),
    user_id: String(userId),
    challenge_id: String(challengeId),
    source_type: String(sourceType),
    source_id: String(sourceId),
    progress_value: Number(progressValue),
    verification_status: "verified",
    verified_at: String(verifiedAt),
    evidence_json: evidenceJson === null || evidenceJson === undefined ? null : String(evidenceJson),
    processed_at: null,
    result_status: "pending",
    result_message: null,
    created_at: String(createdAt),
    updated_at: String(updatedAt),
  };
}

function assertProgressionAwardOperationsStayIsolated(operations: FakeOperation[]) {
  const mutationSql = operations.filter((operation) => operation.kind === "run").map((operation) => operation.sql);
  assert.ok(mutationSql.length > 0, "Award flow should perform progression mutations.");
  for (const sql of mutationSql) {
    assert.match(
      sql,
      /\bplayer_progression_award_sources\b|\bplayer_challenge_participations\b|\bplayer_xp_ledger\b|\bplayer_calling_card_awards\b/i,
      `Unexpected progression award mutation SQL: ${sql}`,
    );
    assert.doesNotMatch(sql, protectedSurfaceMutationPattern(), "Progression award mutations must stay out of protected systems.");
  }
}

function assertFunctionDoesNotMention(source: string, functionName: string, pattern: RegExp) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist.`);
  const next = source.indexOf("\nfunction ", start + 1);
  const block = source.slice(start, next === -1 ? source.length : next);
  assert.doesNotMatch(block, pattern, `${functionName} must not consume player progression award state.`);
}

function externalOrBillingPattern() {
  return /\bDZN_LIVE_CHECKOUT_ENABLED\b|\bcreateCheckoutSession\b|\bSTRIPE_SECRET_KEY\b|\bSTRIPE_WEBHOOK_SECRET\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bfetch\s*\(|api\.stripe\.com/i;
}

function protectedSurfaceMutationPattern() {
  return /\b(?:owner_billing_accounts|server_subscriptions|owner_plan_entitlements|server_owners|linked_servers|server_reviews|server_review_reports|server_review_moderation_actions|server_rankings|leaderboards|discovery_score|badges|server_badge_awards|badge_unlock_progress|dzn_seasons|dzn_season_entries|dzn_season_awards|events|competitive_events|event_participants|server_war_events|server_war_score_snapshots|server_war_results|player_profiles|kill_events|player_events|stripe)\b/i;
}

function read(path: string) {
  return readFileSync(path, "utf8");
}

function stripSqlComments(sql: string) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function result<T>(changes: number) {
  return { success: true, results: [] as T[], meta: { changes } };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
