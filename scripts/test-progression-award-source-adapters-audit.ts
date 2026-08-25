import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { MOCK_USER_ID } from "../functions/_lib/db";
import {
  collectVerifiedProgressionAwardSources,
  runPlayerProgressionAwardJob,
} from "../functions/_lib/player-progression";
import { listProgressionAwardAudit } from "../functions/_lib/player-progression-awards-audit";
import {
  onRequestDelete as awardAuditDelete,
  onRequestGet as awardAuditGet,
  onRequestPost as awardAuditPost,
} from "../functions/api/owner/progression/award-audit";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type FakeUser = {
  id: string;
  discord_id: string;
  username: string | null;
};

type FakeLinkedServer = {
  id: string;
  user_id: string;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  public_slug: string | null;
};

type FakePlayerProfile = {
  id: string;
  discord_id: string | null;
  player_name: string | null;
  player_id: string | null;
};

type FakePlayerEvent = {
  id: string;
  linked_server_id: string;
  player_profile_id: string | null;
  event_type: string;
  player_name: string | null;
  player_id: string | null;
  source_service_id: string | null;
  source_adm_file: string | null;
  source_line_number: number | null;
  occurred_at: string | null;
  created_at: string | null;
};

type FakeKillEvent = {
  id: string;
  linked_server_id: string;
  killer_profile_id: string | null;
  killer_name: string | null;
  killer_id: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  source_service_id: string | null;
  source_adm_file: string | null;
  source_line_number: number | null;
  occurred_at: string | null;
  created_at: string | null;
};

type FakeEventEntry = {
  id: string;
  event_id: string;
  linked_server_id: string;
  owner_user_id: string | null;
  status: string;
  entered_at: string | null;
  completed_at: string | null;
  created_at: string | null;
};

type FakeCompetitiveEvent = {
  id: string;
  slug: string | null;
  name: string | null;
};

type FakeReview = {
  id: string;
  linked_server_id: string;
  reviewer_discord_id: string;
  rating: number;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_edited_at: string | null;
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
  linked_server_id: string | null;
  source_type: string;
  source_id: string;
  source_table: string | null;
  adapter_key: string | null;
  progress_value: number;
  verification_status: string;
  verified_at: string;
  evidence_json: string | null;
  processed_at: string | null;
  result_status: string;
  result_message: string | null;
  attempt_count: number;
  last_attempted_at: string | null;
  retry_count: number;
  last_retried_at: string | null;
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

const NOW = "2026-08-25T12:00:00.000Z";

const PLAYER_USER: SessionUser = {
  id: "player-user",
  discord_id: "player-discord",
  username: "DZN Player",
  avatar: null,
};

const OWNER_USER: SessionUser = {
  id: "owner-user",
  discord_id: "owner-discord",
  username: "DZN Owner",
  avatar: null,
};

const OTHER_OWNER_USER: SessionUser = {
  id: "other-owner",
  discord_id: "other-owner-discord",
  username: "Other Owner",
  avatar: null,
};

const ADMIN_USER: SessionUser = {
  id: "admin-user",
  discord_id: "admin-discord",
  username: "DZN Admin",
  avatar: null,
};

async function main() {
  assertStaticContracts();

  const collectDb = createFakeAdapterAuditDb();
  const collected = await collectVerifiedProgressionAwardSources({ DB: collectDb.db } as Env, {
    limit: 10,
    now: NOW,
  });
  assert.equal(collected.acceptedSources, 4, "Adapters should accept one trusted row from each source family.");
  assert.equal(collected.duplicateSources, 0);
  assert.equal(collected.failed.length, 0);
  assert.deepEqual(
    collectDb.awardSources.map((row) => `${row.adapter_key}:${row.source_table}:${row.source_type}`).sort(),
    [
      "adm_kill_event:kill_events:adm_gameplay",
      "adm_player_event:player_events:adm_gameplay",
      "approved_review:server_reviews:community_activity",
      "event_entry:server_event_entries:event_participation",
    ],
  );
  assert.equal(collectDb.xpAwards.length, 0, "Collecting sources must not award XP directly.");
  assert.equal(collectDb.callingCardAwards.length, 0, "Collecting sources must not award calling cards directly.");
  assertTrustedSourceReadsWereUsed(collectDb.operations);
  assertProgressionMutationsStayIsolated(collectDb.operations);

  const awardDb = createFakeAdapterAuditDb({
    joined: [
      [PLAYER_USER.id, "foundation-survivor-spark"],
      [PLAYER_USER.id, "foundation-arena-rookie"],
      [PLAYER_USER.id, "foundation-community-scout"],
      [OWNER_USER.id, "foundation-community-scout"],
    ],
  });
  const awardResult = await runPlayerProgressionAwardJob({ DB: awardDb.db } as Env, {
    collectSources: true,
    limit: 10,
    now: NOW,
    source: "adapter-test",
  });
  assert.equal(awardResult.ok, true);
  assert.equal(awardResult.collected_sources, 4);
  assert.equal(awardResult.accepted_sources, 4);
  assert.equal(awardResult.processed, 4);
  assert.equal(awardResult.completed_challenges, 4);
  assert.equal(awardResult.awarded_xp, 300);
  assert.equal(awardResult.awarded_cards, 4);
  assert.equal(awardDb.awardSources.every((row) => row.attempt_count === 1), true, "Processed sources should record an attempt.");
  assert.equal(awardDb.awardSources.every((row) => row.result_status === "awarded"), true);
  assertProgressionMutationsStayIsolated(awardDb.operations);

  const retryDb = createFakeAdapterAuditDb({
    joined: [[PLAYER_USER.id, "foundation-survivor-spark"]],
  });
  retryDb.awardSources.push(makeAwardSource({
    id: "failed-source",
    user_id: PLAYER_USER.id,
    challenge_id: "foundation-survivor-spark",
    linked_server_id: "server-owner",
    source_type: "adm_gameplay",
    source_id: "adm:player_events:retry-1",
    source_table: "player_events",
    adapter_key: "adm_player_event",
    result_status: "failed",
    result_message: "Transient database error.",
    processed_at: "2026-08-25T10:00:00.000Z",
  }));
  const retryResult = await runPlayerProgressionAwardJob({ DB: retryDb.db } as Env, {
    retryFailed: true,
    collectSources: false,
    limit: 10,
    now: NOW,
    source: "retry-test",
  });
  assert.equal(retryResult.ok, true);
  assert.equal(retryResult.retried_sources, 1);
  assert.equal(retryResult.processed, 1);
  assert.equal(retryDb.awardSources[0]?.retry_count, 1);
  assert.equal(retryDb.awardSources[0]?.last_retried_at, NOW);
  assert.equal(retryDb.awardSources[0]?.attempt_count, 1);
  assert.equal(retryDb.awardSources[0]?.result_status, "awarded");
  assertProgressionMutationsStayIsolated(retryDb.operations);

  const auditDb = createFakeAdapterAuditDb();
  seedAuditRows(auditDb);
  const ownerAudit = await listProgressionAwardAudit({ DB: auditDb.db } as Env, {
    user: OWNER_USER,
    role: "owner",
  }, { limit: 20 });
  assert.equal(ownerAudit.count, 2, "Default owner audit should include finished rows only.");
  assert.equal(ownerAudit.retry.available_failed_rows, 1);
  assert.equal(ownerAudit.awards.every((row) => row.linked_server_id === "server-owner"), true);
  assert.equal(ownerAudit.awards.some((row) => row.linked_server_id === "server-other"), false, "Owners must not see other owners' progression facts.");
  assert.equal(JSON.stringify(ownerAudit).includes("player-discord"), false, "Audit payload must not leak player Discord IDs.");
  assert.equal(JSON.stringify(ownerAudit).includes("other-owner-discord"), false, "Audit payload must not leak other owner Discord IDs.");

  const ownerAll = await listProgressionAwardAudit({ DB: auditDb.db } as Env, {
    user: OWNER_USER,
    role: "owner",
  }, { status: "all", limit: 20 });
  assert.equal(ownerAll.count, 3, "Explicit all filter should include pending owner rows.");
  assert.equal(ownerAll.counts.pending, 1);

  const adminAudit = await listProgressionAwardAudit({ DB: auditDb.db } as Env, {
    user: ADMIN_USER,
    role: "admin",
  }, { status: "all", limit: 20 });
  assert.equal(adminAudit.count, 5, "Admins should see owner-scoped and global progression audit rows.");
  assert.equal(adminAudit.awards.some((row) => row.linked_server_id === "server-other"), true);
  assert.equal(adminAudit.awards.some((row) => row.linked_server_id === null), true);

  const routeDb = createFakeAdapterAuditDb({ mockOwnerServer: true });
  routeDb.awardSources.push(makeAwardSource({
    id: "route-awarded",
    user_id: PLAYER_USER.id,
    challenge_id: "foundation-survivor-spark",
    linked_server_id: "server-mock",
    source_type: "adm_gameplay",
    source_id: "adm:player_events:route",
    source_table: "player_events",
    adapter_key: "adm_player_event",
    result_status: "awarded",
  }));
  const routeResponse = await awardAuditGet(context(
    new Request("https://dzn.example/api/owner/progression/award-audit?status=all"),
    { MOCK_AUTH: "true", DB: routeDb.db } as Env,
  )) as Response;
  assert.equal(routeResponse.status, 200);
  assert.equal(routeResponse.headers.get("cache-control")?.includes("private"), true);
  assert.equal(routeResponse.headers.get("cache-control")?.includes("no-store"), true);

  const routePost = await awardAuditPost() as Response;
  assert.equal(routePost.status, 405, "Award audit route must be read-only.");
  const routeDelete = await awardAuditDelete() as Response;
  assert.equal(routeDelete.status, 405, "Award audit route must not expose mutation verbs.");

  console.log("Progression award source adapter and audit tests passed.");
}

function assertStaticContracts() {
  assert.equal(existsSync("migrations/0064_progression_award_source_adapters_audit.sql"), true, "Adapter audit migration should exist.");
  assert.equal(existsSync("functions/api/owner/progression/award-audit.ts"), true, "Owner/admin award audit route should exist.");

  const progressionSource = read("functions/_lib/player-progression.ts");
  for (const snippet of [
    "TRUSTED_PROGRESSION_SOURCE_ADAPTERS",
    "adm_player_event",
    "adm_kill_event",
    "event_entry",
    "approved_review",
    "collectVerifiedProgressionAwardSources",
    "retryFailedProgressionAwardSources",
    "markProgressionAwardSourceAttempt",
    "player_events",
    "kill_events",
    "server_event_entries",
    "server_reviews",
    "source_table",
    "adapter_key",
    "attempt_count",
    "retry_count",
  ]) {
    assert.equal(progressionSource.includes(snippet), true, `Progression helper must include ${snippet}.`);
  }
  assert.doesNotMatch(progressionSource, externalOrLiveServicePattern());
  assertSourceDoesNotMutateProtectedSystems(progressionSource);

  const cronRoute = read("functions/api/cron/player-progression/awards.ts");
  assert.equal(cronRoute.includes("requireCronSecret"), true);
  assert.equal(cronRoute.includes("collectSources"), true);
  assert.equal(cronRoute.includes("retryFailed"), true);
  assert.equal(cronRoute.includes("normalizeAdapterList"), true);
  assert.doesNotMatch(cronRoute, /getRequestSessionUser|requireActiveOwnerEntitlement|ownerAccessErrorResponse/i);
  assert.doesNotMatch(cronRoute, externalOrLiveServicePattern());

  const auditHelper = read("functions/_lib/player-progression-awards-audit.ts");
  for (const snippet of [
    "requireActiveOwnerEntitlement",
    "isDznAdminDiscordId",
    "listProgressionAwardAudit",
    "linked_servers.user_id = ?",
    "result_status IN ('awarded', 'skipped', 'failed')",
    "retry_available",
  ]) {
    assert.equal(auditHelper.includes(snippet), true, `Audit helper must include ${snippet}.`);
  }
  assert.doesNotMatch(auditHelper, /\bevidence_json\b/, "Audit route must not expose raw evidence blobs.");
  assert.doesNotMatch(auditHelper, /runPlayerProgressionAwardJob|collectVerifiedProgressionAwardSources/i, "Audit helper must not trigger award processing.");
  assert.doesNotMatch(auditHelper, /\b(?:INSERT|UPDATE|DELETE)\b/i, "Audit helper must stay read-only.");
  assert.doesNotMatch(auditHelper, externalOrLiveServicePattern());

  const auditRoute = read("functions/api/owner/progression/award-audit.ts");
  assert.equal(auditRoute.includes("privateNoStoreHeaders"), true);
  assert.equal(auditRoute.includes("onRequestGet"), true);
  assert.equal(auditRoute.includes("methodNotAllowed"), true);
  assert.doesNotMatch(auditRoute, /\breadBoundedJson\b|\bfetch\s*\(|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED/i);

  const migration = stripSqlComments(read("migrations/0064_progression_award_source_adapters_audit.sql"));
  for (const snippet of [
    "ALTER TABLE player_progression_award_sources ADD COLUMN linked_server_id TEXT",
    "ALTER TABLE player_progression_award_sources ADD COLUMN source_table TEXT",
    "ALTER TABLE player_progression_award_sources ADD COLUMN adapter_key TEXT",
    "ALTER TABLE player_progression_award_sources ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE player_progression_award_sources ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
    "idx_player_progression_award_sources_server_status",
    "idx_player_progression_award_sources_adapter",
  ]) {
    assert.equal(migration.includes(snippet), true, `Adapter audit migration must include ${snippet}.`);
  }
  assert.doesNotMatch(migration, protectedMutationPattern(), "Adapter audit migration must not mutate billing or competitive surfaces.");

  const playerApi = read("functions/api/player/challenges.ts");
  assert.doesNotMatch(playerApi, /collectVerifiedProgressionAwardSources|runPlayerProgressionAwardJob|player_progression_award_sources/i);

  const publicServersApi = read("functions/api/public/servers.ts");
  assertFunctionDoesNotMention(publicServersApi, "sortPublicServersForDiscovery", /\bplayer_progression_award_sources\b|\bplayer_xp_ledger\b|\bplayer_calling_card_awards\b/i);
  assertFunctionDoesNotMention(publicServersApi, "applyPublicServerAccess", /\bplayer_progression_award_sources\b|\bplayer_xp_ledger\b|\bplayer_calling_card_awards\b/i);

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:progression-award-source-adapters-audit"), true, "New focused test must be wired into package scripts.");
}

function createFakeAdapterAuditDb(options: {
  joined?: Array<[string, string]>;
  mockOwnerServer?: boolean;
} = {}) {
  return new FakeAdapterAuditDb(options);
}

class FakeAdapterAuditDb {
  readonly operations: FakeOperation[] = [];
  readonly users: FakeUser[] = [
    { id: PLAYER_USER.id, discord_id: PLAYER_USER.discord_id, username: PLAYER_USER.username },
    { id: OWNER_USER.id, discord_id: OWNER_USER.discord_id, username: OWNER_USER.username },
    { id: OTHER_OWNER_USER.id, discord_id: OTHER_OWNER_USER.discord_id, username: OTHER_OWNER_USER.username },
    { id: ADMIN_USER.id, discord_id: ADMIN_USER.discord_id, username: ADMIN_USER.username },
    { id: MOCK_USER_ID, discord_id: "mock-discord-user", username: "Mock User" },
  ];
  readonly linkedServers: FakeLinkedServer[] = [
    serverRow("server-owner", OWNER_USER.id, "Owner Server", "owner-server"),
    serverRow("server-other", OTHER_OWNER_USER.id, "Other Server", "other-server"),
  ];
  readonly playerProfiles: FakePlayerProfile[] = [
    { id: "profile-player", discord_id: PLAYER_USER.discord_id, player_name: "Player One", player_id: "steam-player" },
    { id: "profile-unmapped", discord_id: null, player_name: "Unmapped Player", player_id: "steam-unmapped" },
  ];
  readonly playerEvents: FakePlayerEvent[] = [
    {
      id: "pe-1",
      linked_server_id: "server-owner",
      player_profile_id: "profile-player",
      event_type: "player_connected",
      player_name: "Player One",
      player_id: "steam-player",
      source_service_id: "service-owner",
      source_adm_file: "owner.ADM",
      source_line_number: 10,
      occurred_at: "2026-08-25T08:00:00.000Z",
      created_at: "2026-08-25T08:00:01.000Z",
    },
    {
      id: "pe-ignored",
      linked_server_id: "server-owner",
      player_profile_id: "profile-unmapped",
      event_type: "player_connected",
      player_name: "Unmapped Player",
      player_id: "steam-unmapped",
      source_service_id: "service-owner",
      source_adm_file: "owner.ADM",
      source_line_number: 11,
      occurred_at: "2026-08-25T08:01:00.000Z",
      created_at: "2026-08-25T08:01:01.000Z",
    },
  ];
  readonly killEvents: FakeKillEvent[] = [
    {
      id: "ke-1",
      linked_server_id: "server-owner",
      killer_profile_id: "profile-player",
      killer_name: "Player One",
      killer_id: "steam-player",
      victim_name: "Target",
      weapon: "M4A1",
      distance: 312,
      source_service_id: "service-owner",
      source_adm_file: "owner.ADM",
      source_line_number: 20,
      occurred_at: "2026-08-25T09:00:00.000Z",
      created_at: "2026-08-25T09:00:01.000Z",
    },
  ];
  readonly eventEntries: FakeEventEntry[] = [
    {
      id: "entry-1",
      event_id: "event-1",
      linked_server_id: "server-owner",
      owner_user_id: OWNER_USER.id,
      status: "completed",
      entered_at: "2026-08-25T07:00:00.000Z",
      completed_at: "2026-08-25T11:00:00.000Z",
      created_at: "2026-08-25T07:00:01.000Z",
    },
    {
      id: "entry-ignored",
      event_id: "event-1",
      linked_server_id: "server-other",
      owner_user_id: OTHER_OWNER_USER.id,
      status: "withdrawn",
      entered_at: "2026-08-25T07:00:00.000Z",
      completed_at: null,
      created_at: "2026-08-25T07:00:01.000Z",
    },
  ];
  readonly competitiveEvents: FakeCompetitiveEvent[] = [
    { id: "event-1", slug: "first-event", name: "First Event" },
  ];
  readonly reviews: FakeReview[] = [
    {
      id: "review-1",
      linked_server_id: "server-owner",
      reviewer_discord_id: PLAYER_USER.discord_id,
      rating: 5,
      title: "Good fights",
      status: "approved",
      created_at: "2026-08-25T06:00:00.000Z",
      updated_at: "2026-08-25T06:00:00.000Z",
      last_edited_at: null,
    },
    {
      id: "review-pending",
      linked_server_id: "server-owner",
      reviewer_discord_id: PLAYER_USER.discord_id,
      rating: 4,
      title: "Pending",
      status: "pending",
      created_at: "2026-08-25T06:05:00.000Z",
      updated_at: "2026-08-25T06:05:00.000Z",
      last_edited_at: null,
    },
  ];
  readonly challenges = new Map<string, FakeChallenge>();
  readonly participations = new Map<string, FakeParticipation>();
  readonly awardSources: FakeAwardSource[] = [];
  readonly xpAwards: FakeXpAward[] = [];
  readonly callingCardAwards: FakeCallingCardAward[] = [];
  readonly db: Env["DB"];

  constructor(options: { joined?: Array<[string, string]>; mockOwnerServer?: boolean } = {}) {
    for (const challenge of challengeRows()) this.challenges.set(challenge.id, challenge);
    if (options.mockOwnerServer) this.linkedServers.push(serverRow("server-mock", MOCK_USER_ID, "Mock Server", "mock-server"));
    for (const [userId, challengeId] of options.joined ?? []) this.join(userId, challengeId);
    this.db = {
      prepare: (sql: string) => ({
        bind: (...bindings: unknown[]) => new FakeAdapterAuditStatement(this, sql, bindings),
        all: <T>() => new FakeAdapterAuditStatement(this, sql, []).all<T>(),
        first: <T>() => new FakeAdapterAuditStatement(this, sql, []).first<T>(),
        run: <T>() => new FakeAdapterAuditStatement(this, sql, []).run<T>(),
      }),
      batch: async () => [],
      exec: async () => ({ success: true, meta: {} }),
    } as unknown as Env["DB"];
  }

  join(userId: string, challengeId: string) {
    const challenge = this.challenges.get(challengeId);
    assert.ok(challenge, `Unknown challenge fixture: ${challengeId}`);
    this.participations.set(`${userId}:${challengeId}`, {
      challenge_id: challengeId,
      status: "joined",
      progress_value: 0,
      target_value: challenge.target_value,
      xp_awarded: 0,
      calling_card_awarded: null,
      joined_at: NOW,
      completed_at: null,
      updated_at: NOW,
    });
  }
}

class FakeAdapterAuditStatement {
  constructor(
    private readonly db: FakeAdapterAuditDb,
    private readonly sql: string,
    private readonly bindings: unknown[],
  ) {}

  async all<T>() {
    this.db.operations.push({ kind: "all", sql: this.sql, bindings: this.bindings });
    const normalized = normalizeSql(this.sql);
    if (normalized.includes("from player_events")) return rows<T>(this.readPlayerEventCandidates());
    if (normalized.includes("from kill_events")) return rows<T>(this.readKillEventCandidates());
    if (normalized.includes("from server_event_entries")) return rows<T>(this.readEventEntryCandidates());
    if (normalized.includes("from server_reviews")) return rows<T>(this.readApprovedReviewCandidates());
    if (normalized.includes("count(*) as count") && normalized.includes("from player_progression_award_sources")) {
      return rows<T>(this.readAuditCounts());
    }
    if (normalized.includes("from player_progression_award_sources") && normalized.includes("left join users")) {
      return rows<T>(this.readAuditRows());
    }
    if (normalized.includes("from player_progression_award_sources")) {
      const limit = Number(this.bindings[this.bindings.length - 1] ?? 10);
      return rows<T>(this.db.awardSources
        .filter((row) => row.verification_status === "verified" && row.result_status === "pending")
        .slice(0, limit));
    }
    if (normalized.includes("from player_challenges")) {
      return rows<T>([...this.db.challenges.values()].filter((row) => row.status === "active").sort((a, b) => a.sort_order - b.sort_order));
    }
    throw new Error(`Unexpected all SQL: ${normalized}`);
  }

  async first<T>() {
    this.db.operations.push({ kind: "first", sql: this.sql, bindings: this.bindings });
    const normalized = normalizeSql(this.sql);
    if (normalized.includes("from player_challenges")) {
      const target = String(this.bindings[0] ?? "");
      return ([...this.db.challenges.values()].find((row) => row.id === target || row.slug.toLowerCase() === target.toLowerCase()) ?? null) as T | null;
    }
    if (normalized.includes("from player_challenge_participations")) {
      const userId = String(this.bindings[0] ?? "");
      const challengeId = String(this.bindings[1] ?? "");
      return (this.db.participations.get(`${userId}:${challengeId}`) ?? null) as T | null;
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
      if (normalized.includes("retry_count = coalesce")) {
        const [retriedAt, updatedAt] = this.bindings;
        let changed = 0;
        for (const row of this.db.awardSources.filter((item) => item.verification_status === "verified" && item.result_status === "failed")) {
          row.result_status = "pending";
          row.result_message = "Retry scheduled by protected progression award job.";
          row.processed_at = null;
          row.retry_count += 1;
          row.last_retried_at = String(retriedAt);
          row.updated_at = String(updatedAt);
          changed += 1;
        }
        return result<T>(changed);
      }
      if (normalized.includes("attempt_count = coalesce")) {
        const [attemptedAt, updatedAt, id] = this.bindings;
        const row = this.db.awardSources.find((item) => item.id === String(id) && item.result_status === "pending");
        if (row) {
          row.attempt_count += 1;
          row.last_attempted_at = String(attemptedAt);
          row.updated_at = String(updatedAt);
        }
        return result<T>(row ? 1 : 0);
      }
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
    throw new Error(`Unexpected run SQL: ${normalized}`);
  }

  private readPlayerEventCandidates() {
    const limit = Number(this.bindings[0] ?? 10);
    return this.db.playerEvents
      .filter((event) => ["player_connected", "playerlist_entry", "plain_player_state"].includes(event.event_type))
      .map((event) => {
        const profile = this.db.playerProfiles.find((row) => row.id === event.player_profile_id);
        const user = profile?.discord_id
          ? this.db.users.find((row) => row.discord_id === profile.discord_id)
          : null;
        if (!user) return null;
        return {
          user_id: user.id,
          source_row_id: event.id,
          linked_server_id: event.linked_server_id,
          event_type: event.event_type,
          player_name: event.player_name,
          player_id: event.player_id,
          source_service_id: event.source_service_id,
          source_adm_file: event.source_adm_file,
          source_line_number: event.source_line_number,
          occurred_at: event.occurred_at,
          created_at: event.created_at,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .slice(0, limit);
  }

  private readKillEventCandidates() {
    const limit = Number(this.bindings[0] ?? 10);
    return this.db.killEvents
      .map((event) => {
        const profile = this.db.playerProfiles.find((row) => row.id === event.killer_profile_id);
        const user = profile?.discord_id
          ? this.db.users.find((row) => row.discord_id === profile.discord_id)
          : null;
        if (!user) return null;
        return {
          user_id: user.id,
          source_row_id: event.id,
          linked_server_id: event.linked_server_id,
          killer_name: event.killer_name,
          killer_id: event.killer_id,
          victim_name: event.victim_name,
          weapon: event.weapon,
          distance: event.distance,
          source_service_id: event.source_service_id,
          source_adm_file: event.source_adm_file,
          source_line_number: event.source_line_number,
          occurred_at: event.occurred_at,
          created_at: event.created_at,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .slice(0, limit);
  }

  private readEventEntryCandidates() {
    const limit = Number(this.bindings[0] ?? 10);
    return this.db.eventEntries
      .filter((entry) => ["entered", "completed"].includes(entry.status) && Boolean(entry.owner_user_id))
      .map((entry) => {
        const user = this.db.users.find((row) => row.id === entry.owner_user_id);
        const event = this.db.competitiveEvents.find((row) => row.id === entry.event_id);
        if (!user) return null;
        return {
          user_id: user.id,
          source_row_id: entry.id,
          linked_server_id: entry.linked_server_id,
          event_id: entry.event_id,
          status: entry.status,
          entered_at: entry.entered_at,
          completed_at: entry.completed_at,
          event_slug: event?.slug ?? null,
          event_name: event?.name ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .slice(0, limit);
  }

  private readApprovedReviewCandidates() {
    const limit = Number(this.bindings[0] ?? 10);
    return this.db.reviews
      .filter((review) => review.status === "approved")
      .map((review) => {
        const user = this.db.users.find((row) => row.discord_id === review.reviewer_discord_id);
        if (!user) return null;
        return {
          user_id: user.id,
          source_row_id: review.id,
          linked_server_id: review.linked_server_id,
          rating: review.rating,
          title: review.title,
          created_at: review.created_at,
          updated_at: review.updated_at,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .slice(0, limit);
  }

  private readAuditRows() {
    const scopedRows = this.scopedAuditRows();
    const filteredRows = this.applyAuditStatusFilter(scopedRows);
    const limit = Number(this.bindings[this.bindings.length - 1] ?? 50);
    return filteredRows.slice(0, limit).map((row) => this.toAuditRow(row));
  }

  private readAuditCounts() {
    const counts = new Map<string, number>();
    for (const row of this.scopedAuditRows()) {
      counts.set(row.result_status, (counts.get(row.result_status) ?? 0) + 1);
    }
    return [...counts.entries()].map(([result_status, count]) => ({ result_status, count }));
  }

  private scopedAuditRows() {
    const normalized = normalizeSql(this.sql);
    if (!normalized.includes("linked_servers.user_id = ?")) {
      return this.db.awardSources.filter((row) => row.verification_status === "verified");
    }
    const ownerUserId = String(this.bindings[0] ?? "");
    return this.db.awardSources.filter((row) => {
      if (row.verification_status !== "verified" || !row.linked_server_id) return false;
      const server = this.db.linkedServers.find((item) => item.id === row.linked_server_id);
      return server?.user_id === ownerUserId;
    });
  }

  private applyAuditStatusFilter(rows: FakeAwardSource[]) {
    const normalized = normalizeSql(this.sql);
    if (normalized.includes("result_status in ('awarded', 'skipped', 'failed')")) {
      return rows.filter((row) => ["awarded", "skipped", "failed"].includes(row.result_status));
    }
    const match = normalized.match(/result_status = '(pending|progressed|awarded|duplicate|skipped|failed)'/);
    return match ? rows.filter((row) => row.result_status === match[1]) : rows;
  }

  private toAuditRow(row: FakeAwardSource) {
    const user = this.db.users.find((item) => item.id === row.user_id);
    const challenge = this.db.challenges.get(row.challenge_id);
    const server = row.linked_server_id
      ? this.db.linkedServers.find((item) => item.id === row.linked_server_id)
      : null;
    return {
      ...row,
      player_name: user?.username ?? null,
      challenge_slug: challenge?.slug ?? null,
      challenge_title: challenge?.title ?? null,
      owner_user_id: server?.user_id ?? null,
      server_name: server?.display_name ?? server?.hostname ?? server?.server_name ?? server?.nitrado_service_name ?? null,
      public_slug: server?.public_slug ?? null,
    };
  }
}

function seedAuditRows(db: FakeAdapterAuditDb) {
  db.awardSources.push(
    makeAwardSource({
      id: "audit-owner-awarded",
      user_id: PLAYER_USER.id,
      challenge_id: "foundation-survivor-spark",
      linked_server_id: "server-owner",
      source_type: "adm_gameplay",
      source_id: "adm:player_events:audit-owner-awarded",
      source_table: "player_events",
      adapter_key: "adm_player_event",
      result_status: "awarded",
      result_message: "Awarded owner server player activity.",
    }),
    makeAwardSource({
      id: "audit-owner-failed",
      user_id: PLAYER_USER.id,
      challenge_id: "foundation-arena-rookie",
      linked_server_id: "server-owner",
      source_type: "adm_gameplay",
      source_id: "adm:kill_events:audit-owner-failed",
      source_table: "kill_events",
      adapter_key: "adm_kill_event",
      result_status: "failed",
      result_message: "Temporary failure.",
    }),
    makeAwardSource({
      id: "audit-owner-pending",
      user_id: PLAYER_USER.id,
      challenge_id: "foundation-community-scout",
      linked_server_id: "server-owner",
      source_type: "community_activity",
      source_id: "community:server_reviews:audit-owner-pending",
      source_table: "server_reviews",
      adapter_key: "approved_review",
      result_status: "pending",
      result_message: null,
    }),
    makeAwardSource({
      id: "audit-other-owner-awarded",
      user_id: PLAYER_USER.id,
      challenge_id: "foundation-community-scout",
      linked_server_id: "server-other",
      source_type: "event_participation",
      source_id: "event:server_event_entries:audit-other",
      source_table: "server_event_entries",
      adapter_key: "event_entry",
      result_status: "awarded",
      result_message: "Other owner row.",
    }),
    makeAwardSource({
      id: "audit-global-skipped",
      user_id: PLAYER_USER.id,
      challenge_id: "foundation-community-scout",
      linked_server_id: null,
      source_type: "verified_activity",
      source_id: "manual:global",
      source_table: null,
      adapter_key: null,
      result_status: "skipped",
      result_message: "Global source without server scope.",
    }),
  );
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
      id: "foundation-arena-rookie",
      slug: "arena-rookie",
      title: "Arena Rookie",
      description: "Foundation combat track.",
      category: "combat",
      status: "active",
      reward_xp: 100,
      calling_card_code: "arena_rookie",
      calling_card_name: "Arena Rookie",
      calling_card_description: "Entered the player-side combat challenge queue.",
      calling_card_rarity: "foundation",
      target_value: 1,
      sort_order: 30,
      starts_at: null,
      ends_at: null,
    },
  ];
}

function makeAwardSource(input: Partial<FakeAwardSource> & {
  id: string;
  user_id: string;
  challenge_id: string;
  source_type: string;
  source_id: string;
  result_status: string;
}): FakeAwardSource {
  return {
    id: input.id,
    user_id: input.user_id,
    challenge_id: input.challenge_id,
    linked_server_id: input.linked_server_id ?? null,
    source_type: input.source_type,
    source_id: input.source_id,
    source_table: input.source_table ?? null,
    adapter_key: input.adapter_key ?? null,
    progress_value: input.progress_value ?? 1,
    verification_status: input.verification_status ?? "verified",
    verified_at: input.verified_at ?? NOW,
    evidence_json: input.evidence_json ?? null,
    processed_at: input.processed_at ?? (input.result_status === "pending" ? null : NOW),
    result_status: input.result_status,
    result_message: input.result_message ?? null,
    attempt_count: input.attempt_count ?? 0,
    last_attempted_at: input.last_attempted_at ?? null,
    retry_count: input.retry_count ?? 0,
    last_retried_at: input.last_retried_at ?? null,
    created_at: input.created_at ?? NOW,
    updated_at: input.updated_at ?? NOW,
  };
}

function sourceRowFromBindings(bindings: unknown[]): FakeAwardSource {
  const [
    id,
    userId,
    challengeId,
    linkedServerId,
    sourceType,
    sourceId,
    sourceTable,
    adapterKey,
    progressValue,
    verifiedAt,
    evidenceJson,
    createdAt,
    updatedAt,
  ] = bindings;
  return makeAwardSource({
    id: String(id),
    user_id: String(userId),
    challenge_id: String(challengeId),
    linked_server_id: linkedServerId === null || linkedServerId === undefined ? null : String(linkedServerId),
    source_type: String(sourceType),
    source_id: String(sourceId),
    source_table: sourceTable === null || sourceTable === undefined ? null : String(sourceTable),
    adapter_key: adapterKey === null || adapterKey === undefined ? null : String(adapterKey),
    progress_value: Number(progressValue),
    verified_at: String(verifiedAt),
    evidence_json: evidenceJson === null || evidenceJson === undefined ? null : String(evidenceJson),
    result_status: "pending",
    created_at: String(createdAt),
    updated_at: String(updatedAt),
  });
}

function serverRow(id: string, ownerId: string, name: string, slug: string): FakeLinkedServer {
  return {
    id,
    user_id: ownerId,
    display_name: name,
    hostname: null,
    server_name: name,
    nitrado_service_name: name,
    public_slug: slug,
  };
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

function assertTrustedSourceReadsWereUsed(operations: FakeOperation[]) {
  const readSql = operations.filter((operation) => operation.kind === "all").map((operation) => normalizeSql(operation.sql));
  for (const source of ["from player_events", "from kill_events", "from server_event_entries", "from server_reviews"]) {
    assert.equal(readSql.some((sql) => sql.includes(source)), true, `Adapter read should include ${source}.`);
  }
}

function assertProgressionMutationsStayIsolated(operations: FakeOperation[]) {
  const writeSql = operations.filter((operation) => operation.kind === "run").map((operation) => operation.sql);
  assert.ok(writeSql.length > 0, "Flow should perform progression mutations.");
  for (const sql of writeSql) {
    assert.match(
      sql,
      /\bplayer_progression_award_sources\b|\bplayer_challenge_participations\b|\bplayer_xp_ledger\b|\bplayer_calling_card_awards\b/i,
      `Unexpected mutation SQL: ${sql}`,
    );
    assert.doesNotMatch(sql, protectedMutationPattern(), "Progression adapter mutations must not touch protected systems.");
  }
}

function assertSourceDoesNotMutateProtectedSystems(source: string) {
  assert.doesNotMatch(source, protectedMutationPattern(), "Progression adapter source must not mutate protected systems.");
}

function assertFunctionDoesNotMention(source: string, functionName: string, pattern: RegExp) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist.`);
  const next = source.indexOf("\nfunction ", start + 1);
  const block = source.slice(start, next === -1 ? source.length : next);
  assert.doesNotMatch(block, pattern, `${functionName} must not consume progression award state.`);
}

function externalOrLiveServicePattern() {
  return /\bDZN_LIVE_CHECKOUT_ENABLED\b|\bcreateCheckoutSession\b|\bSTRIPE_SECRET_KEY\b|\bSTRIPE_WEBHOOK_SECRET\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bfetch\s*\(|api\.stripe\.com|api\.nitrado\.net|discord\.com\/api/i;
}

function protectedMutationPattern() {
  return /\b(?:UPDATE|INSERT\s+(?:OR\s+IGNORE\s+)?INTO|DELETE\s+FROM)\s+(?:owner_billing_accounts|server_subscriptions|owner_plan_entitlements|server_owners|linked_servers|server_reviews|server_review_reports|server_review_moderation_actions|server_rankings|leaderboards|discovery_score|badges|server_badge_awards|badge_unlock_progress|dzn_seasons|dzn_season_entries|dzn_season_awards|events|competitive_events|competitive_event_servers|competitive_event_matches|event_participants|server_event_entries|server_war_events|server_war_score_snapshots|server_war_results|player_profiles|kill_events|player_events|stripe)\b/i;
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

function rows<T>(results: unknown[]) {
  return { results: results as T[], success: true, meta: {} };
}

function result<T>(changes: number) {
  return { success: true, results: [] as T[], meta: { changes } };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
