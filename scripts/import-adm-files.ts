import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { parseAdmLines, type ParsedAdmEvent } from "../functions/_lib/adm-parser";
import { calculateServerScore } from "../functions/_lib/server-ranking";

const DATABASE_NAME = "dzn_network_db";
const DEFAULT_PUBLIC_BASE_URL = "https://dzn-network.pages.dev";
const DISCORD_POST_TYPES = [
  "leaderboard_embed",
  "daily_summary_embed",
  "event_leaderboard_embed",
  "network_ranking_embed",
  "server_vs_server_embed",
  "killfeed_embed",
  "pve_feed_embed",
  "hit_feed_embed",
  "connection_feed_embed",
  "build_feed_embed",
  "admin_alerts_embed",
  "admin_logs_embed",
];

type Mode = "dry-run" | "apply";

type LinkedServerRow = {
  id: string;
  user_id: string;
  guild_id: string | null;
  nitrado_service_id: string | number | null;
  display_name: string | null;
  server_name: string | null;
  hostname: string | null;
  nitrado_service_name: string | null;
  public_slug: string | null;
  current_players: number | null;
  max_players: number | null;
  player_slots: number | null;
  is_online: number | null;
  server_status: string | null;
  metadata_last_checked_at: string | null;
  player_count_last_checked_at: string | null;
};

type PlanRow = {
  plan_key: string | null;
  status: string | null;
};

type ProfileRow = {
  id: string;
  player_name: string;
  player_id: string | null;
};

type ServerTotals = {
  kills: number;
  deaths: number;
  joins: number;
  disconnects: number;
  uniquePlayers: number;
  longestKill: number;
  lastEventAt: string | null;
  score: number;
};

type FileCounts = {
  lines: number;
  rawKillLines: number;
  parsedKills: number;
  connected: number;
  connecting: number;
  disconnects: number;
  playerlistSnapshots: number;
  hitLines: number;
  deadHitLines: number;
  suicides: number;
  uncreditedDeaths: number;
};

type PlannedFileImport = {
  path: string;
  filename: string;
  rawText: string;
  lines: string[];
  parsed: ParsedAdmEvent[];
  syncRunId: string;
  importJobId: string;
  counts: FileCounts;
  rawEvents: PlannedRawEvent[];
  playerEvents: PlannedPlayerEvent[];
  killEvents: PlannedKillEvent[];
};

type PlannedRawEvent = {
  id: string;
  lineNumber: number;
  event: ParsedAdmEvent;
};

type PlannedPlayerEvent = {
  id: string;
  lineNumber: number;
  event: ParsedAdmEvent;
  profileId: string | null;
};

type PlannedKillEvent = {
  id: string;
  lineNumber: number;
  event: ParsedAdmEvent;
  killerProfileId: string | null;
  victimProfileId: string | null;
};

type ProfilePlan = {
  inserts: ProfileRow[];
  byKey: Map<string, ProfileRow>;
};

type WrittenCounts = {
  rawEvents: number;
  playerEvents: number;
  killEvents: number;
  duplicateSkips: number;
  finalFileKills: number;
  finalFilePlayerEvents: number;
};

const args = parseArgs(process.argv.slice(2));
const mode: Mode = args.flags.has("apply") ? "apply" : "dry-run";
const production = args.flags.has("production");
const serverArg = firstArg(args, "server");
const serviceIdArg = firstArg(args, "service-id");
const fileArgs = args.multi.get("files") ?? [];
const baseUrl = firstArg(args, "base-url") ?? DEFAULT_PUBLIC_BASE_URL;

if (!production) fail("Refusing to continue without --production. This script writes to the remote D1 database when --apply is set.");
if (!serverArg && !serviceIdArg) fail("Missing --server or --service-id.");
if (!fileArgs.length) fail("Missing --files. Pass one or more ADM file paths after --files.");

main().catch((error) => {
  console.error("ADM file production import failed.");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

async function main() {
  const startedAt = Date.now();
  const server = await findLinkedServer();
  const serviceId = String(server.nitrado_service_id ?? serviceIdArg ?? "");
  const plan = await getPlan(server);
  const serverName = firstString(server.display_name, server.hostname, server.server_name, server.nitrado_service_name) ?? server.id;
  const beforeTotals = await getServerTotals(server.id);
  const existingProfiles = await getProfiles(server.id);
  const profilePlan = buildProfilePlan(existingProfiles);
  const files = fileArgs.map((file) => planFileImport(resolve(file), server.id, serviceId, profilePlan));

  printPlan({ mode, server, serverName, serviceId, plan, beforeTotals, files });

  if (mode === "dry-run") {
    console.log("");
    console.log("No database changes made. Re-run with --apply to import the files.");
    return;
  }

  const discordJobsBefore = await getQueuedDiscordJobsCount(server.guild_id);
  const statements = buildApplyStatements(server, serviceId, plan, files, profilePlan);
  await applyStatements(statements);
  await applyStatements(buildRebuildStatements(server.id, serviceId));

  const afterRebuildTotals = await getServerTotals(server.id);
  const cacheStatements = await buildPublicCacheStatements(server, plan, afterRebuildTotals);
  await applyStatements(cacheStatements);

  const afterTotals = await getServerTotals(server.id);
  const writtenByFile = new Map<string, WrittenCounts>();
  for (const file of files) {
    writtenByFile.set(file.filename, await getWrittenCounts(server.id, file));
  }
  const discordJobsAfter = await getQueuedDiscordJobsCount(server.guild_id);
  const endpointResults = await refreshPublicEndpoints(baseUrl, server.public_slug);

  printResult({
    server,
    serverName,
    serviceId,
    plan,
    beforeTotals,
    afterTotals,
    files,
    writtenByFile,
    discordJobsQueued: Math.max(0, discordJobsAfter - discordJobsBefore),
    endpointResults,
    durationMs: Date.now() - startedAt,
  });
}

function planFileImport(filePath: string, linkedServerId: string, serviceId: string, profilePlan: ProfilePlan): PlannedFileImport {
  if (!existsSync(filePath)) fail(`ADM file does not exist: ${filePath}`);
  const filename = basename(filePath);
  const rawText = readFileSync(filePath, "utf8");
  const lines = splitAdmText(rawText);
  const parsed = parseAdmLines(lines, { admDate: extractAdmDate(filename) ?? undefined });
  const syncRunId = `sync-run:${createHash("sha256").update(`${linkedServerId}:${filename}:${Date.now()}:${randomUUID()}`).digest("hex").slice(0, 48)}`;
  const importJobId = `adm-job:${createHash("sha256").update(`${linkedServerId}:${filename}:production-import`).digest("hex").slice(0, 48)}`;
  const counts = countParsedEvents(lines, parsed);
  const rawEvents: PlannedRawEvent[] = [];
  const playerEvents: PlannedPlayerEvent[] = [];
  const killEvents: PlannedKillEvent[] = [];

  parsed.forEach((event, index) => {
    const lineNumber = index + 1;
    if (!isHitEvent(event)) {
      rawEvents.push({
        id: stableSyncId("raw", linkedServerId, filename, lineNumber),
        lineNumber,
        event,
      });
    }

    if (isCreditedKill(event)) {
      const killerProfileId = resolveProfile(profilePlan, event.killerName ?? event.playerName, event.killerId ?? event.playerId);
      const victimProfileId = resolveProfile(profilePlan, event.victimName, event.victimId);
      killEvents.push({
        id: stableSyncId("kill-event", linkedServerId, filename, lineNumber),
        lineNumber,
        event,
        killerProfileId,
        victimProfileId,
      });
      return;
    }

    if (shouldPersistPlayerEvent(event)) {
      const player = getPlayerForPlayerEvent(event);
      const profileId = resolveProfile(profilePlan, player.name, player.id);
      playerEvents.push({
        id: stableSyncId("player-event", linkedServerId, filename, lineNumber, event.eventType),
        lineNumber,
        event,
        profileId,
      });
    }
  });

  if (counts.rawKillLines > 0 && counts.parsedKills === 0) {
    fail(`Parser error: ${filename} contains ${counts.rawKillLines} raw killed-by-player lines but parser matched zero kills.`);
  }

  return {
    path: filePath,
    filename,
    rawText,
    lines,
    parsed,
    syncRunId,
    importJobId,
    counts,
    rawEvents,
    playerEvents,
    killEvents,
  };
}

function buildProfilePlan(existingProfiles: ProfileRow[]): ProfilePlan {
  const byKey = new Map<string, ProfileRow>();
  for (const profile of existingProfiles) {
    if (profile.player_id) byKey.set(profileKey(profile.player_name, profile.player_id), profile);
    byKey.set(profileKey(profile.player_name, null), profile);
  }
  return { inserts: [], byKey };
}

function resolveProfile(plan: ProfilePlan, name: string | null | undefined, playerId: string | null | undefined) {
  if (!name) return null;
  const existing = playerId ? plan.byKey.get(profileKey(name, playerId)) : plan.byKey.get(profileKey(name, null));
  if (existing) return existing.id;
  const fallback = plan.byKey.get(profileKey(name, null));
  if (fallback) return fallback.id;
  const profile: ProfileRow = {
    id: randomUUID(),
    player_name: name,
    player_id: playerId ?? null,
  };
  if (profile.player_id) plan.byKey.set(profileKey(profile.player_name, profile.player_id), profile);
  plan.byKey.set(profileKey(profile.player_name, null), profile);
  plan.inserts.push(profile);
  return profile.id;
}

function buildApplyStatements(server: LinkedServerRow, serviceId: string, plan: PlanRow | null, files: PlannedFileImport[], profilePlan: ProfilePlan) {
  const now = new Date().toISOString();
  const statements: string[] = [];

  for (const profile of profilePlan.inserts) {
    statements.push(
      `INSERT INTO player_profiles (
        id, linked_server_id, source_service_id, player_name, player_id, first_seen_at, last_seen_at, created_at, updated_at
      )
      SELECT ${sql(profile.id)}, ${sql(server.id)}, ${sql(serviceId)}, ${sql(profile.player_name)}, ${sql(profile.player_id)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1 FROM player_profiles
        WHERE linked_server_id = ${sql(server.id)}
          AND (
            (${sql(profile.player_id)} IS NOT NULL AND player_id = ${sql(profile.player_id)})
            OR lower(player_name) = lower(${sql(profile.player_name)})
          )
      )`,
    );
  }

  for (const file of files) {
    const startedAt = now;
    const finishedAt = new Date().toISOString();
    const durationMs = Math.max(1, Date.now() - new Date(startedAt).getTime());
    const totalEventsPlanned = file.killEvents.length + file.playerEvents.length;
    statements.push(
      `INSERT INTO sync_runs (
        id, linked_server_id, source_service_id, trigger_type, status, message, lines_read,
        lines_processed, events_created, kills_created, started_at, finished_at, duration_ms, created_at
      ) VALUES (
        ${sql(file.syncRunId)}, ${sql(server.id)}, ${sql(serviceId)}, 'manual_production_import', 'completed',
        ${sql(`Imported ${file.filename} through production ADM importer`)},
        ${file.lines.length}, ${file.lines.length}, ${totalEventsPlanned}, ${file.killEvents.length},
        ${sql(startedAt)}, ${sql(finishedAt)}, ${durationMs}, CURRENT_TIMESTAMP
      )
      ON CONFLICT(id) DO NOTHING`,
    );

    for (const raw of file.rawEvents) statements.push(rawEventInsertSql(server.id, serviceId, file, raw));
    for (const player of file.playerEvents) statements.push(playerEventInsertSql(server.id, serviceId, file, player));
    for (const kill of file.killEvents) statements.push(killEventInsertSql(server.id, serviceId, file, kill));

    const report = buildImportReport(file);
    const chunkSize = 10;
    const totalChunks = Math.max(1, Math.ceil(file.lines.length / chunkSize));
    statements.push(
      `INSERT INTO adm_import_jobs (
        id, server_id, source_service_id, filename, source, status, adm_text, total_lines,
        current_line, chunk_size, total_chunks, chunks_processed, parsed_kills, written_kills,
        duplicate_skips, joins, disconnects, playerlist_snapshots, deaths, suicides,
        uncredited_deaths, hit_lines, raw_events, player_events, failed_writes,
        public_cache_updated, discord_jobs_queued, warnings_json, error_message, result_json,
        created_at, updated_at, completed_at, import_hit_lines, raw_kill_lines_found,
        last_chunk_index, failed_chunk_index
      ) VALUES (
        ${sql(file.importJobId)}, ${sql(server.id)}, ${sql(serviceId)}, ${sql(file.filename)},
        'manual_file_upload', 'completed', ${sql("[production import script: source file retained outside DB]")},
        ${file.lines.length}, ${file.lines.length}, ${chunkSize}, ${totalChunks}, ${totalChunks},
        ${file.counts.parsedKills}, ${file.counts.parsedKills}, 0, ${file.counts.connected}, ${file.counts.disconnects},
        ${file.counts.playerlistSnapshots}, ${file.counts.parsedKills + file.counts.suicides + file.counts.uncreditedDeaths},
        ${file.counts.suicides}, ${file.counts.uncreditedDeaths}, ${file.counts.hitLines},
        ${file.rawEvents.length}, ${file.playerEvents.length}, 0, 1, 0, ${sql(JSON.stringify([]))}, NULL, ${sql(JSON.stringify(report))},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, ${file.counts.rawKillLines},
        ${totalChunks - 1}, NULL
      )
      ON CONFLICT(id) DO UPDATE SET
        source_service_id = excluded.source_service_id,
        source = excluded.source,
        status = 'completed',
        total_lines = excluded.total_lines,
        current_line = excluded.current_line,
        chunk_size = excluded.chunk_size,
        total_chunks = excluded.total_chunks,
        chunks_processed = excluded.chunks_processed,
        parsed_kills = excluded.parsed_kills,
        joins = excluded.joins,
        disconnects = excluded.disconnects,
        playerlist_snapshots = excluded.playerlist_snapshots,
        deaths = excluded.deaths,
        suicides = excluded.suicides,
        uncredited_deaths = excluded.uncredited_deaths,
        hit_lines = excluded.hit_lines,
        public_cache_updated = 1,
        result_json = excluded.result_json,
        updated_at = CURRENT_TIMESTAMP,
        completed_at = CURRENT_TIMESTAMP,
        import_hit_lines = 0,
        raw_kill_lines_found = excluded.raw_kill_lines_found,
        last_chunk_index = excluded.last_chunk_index,
        failed_chunk_index = NULL`,
    );

    statements.push(
      `INSERT INTO adm_sync_file_state (
        id, linked_server_id, source_service_id, adm_file, adm_path, status, first_seen_at,
        last_checked_at, last_readable_at, processed_at, line_count, last_line_processed,
        raw_kill_lines_found, parsed_kill_lines_found, inserted_kills, parser_skipped_lines,
        retry_count, last_error, updated_at
      ) VALUES (
        ${sql(stableSyncId("adm-file", server.id, file.filename, 0))}, ${sql(server.id)}, ${sql(serviceId)},
        ${sql(file.filename)}, ${sql(file.path)}, 'processed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${file.lines.length}, ${file.lines.length},
        ${file.counts.rawKillLines}, ${file.counts.parsedKills}, ${file.counts.parsedKills}, ${Math.max(0, file.counts.rawKillLines - file.counts.parsedKills)},
        0, NULL, CURRENT_TIMESTAMP
      )
      ON CONFLICT(linked_server_id, source_service_id, adm_file) DO UPDATE SET
        source_service_id = excluded.source_service_id,
        adm_path = excluded.adm_path,
        status = 'processed',
        last_checked_at = CURRENT_TIMESTAMP,
        last_readable_at = CURRENT_TIMESTAMP,
        processed_at = CURRENT_TIMESTAMP,
        line_count = excluded.line_count,
        last_line_processed = excluded.last_line_processed,
        raw_kill_lines_found = excluded.raw_kill_lines_found,
        parsed_kill_lines_found = excluded.parsed_kill_lines_found,
        inserted_kills = excluded.inserted_kills,
        parser_skipped_lines = excluded.parser_skipped_lines,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP`,
    );
  }

  const latest = files[files.length - 1];
  const latestReport = buildImportReport(latest);
  statements.push(
    `INSERT INTO adm_sync_state (
      id, linked_server_id, latest_adm_file, latest_adm_path, last_processed_file,
      last_processed_line, last_processed_offset, last_sync_status, last_sync_message,
      last_sync_at, created_at, updated_at, last_lines_read, last_lines_processed,
      last_raw_events_stored, last_player_events_stored, last_kill_events_stored,
      last_events_created, last_kills_created, last_unknown_lines, last_duplicate_lines,
      last_sync_duration_ms, last_readable_route, source_service_id,
      last_raw_kill_lines_found, last_parsed_kill_lines_found, last_parser_skipped_lines,
      last_unreadable_files_queued, last_newest_unprocessed_adm_file, last_import_report_json,
      last_processed_adm_line_hash, last_processed_adm_line_text_preview,
      last_cursor_validation_status, last_cursor_validation_error, last_cursor_validation_at,
      cursor_recovery_strategy, cursor_recovery_reason
    ) VALUES (
      ${sql(randomUUID())}, ${sql(server.id)}, ${sql(latest.filename)}, ${sql(latest.path)}, ${sql(latest.filename)},
      ${latest.lines.length}, ${latest.rawText.length}, 'success', ${sql(`Imported ${files.length} ADM file(s) through production importer`)},
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${latest.lines.length}, ${latest.lines.length},
      0, 0, 0, 0, 0, ${latest.parsed.filter((event) => event.eventType === "unknown").length}, 0,
      0, 'production_import_local_file', ${sql(serviceId)}, ${latest.counts.rawKillLines},
      ${latest.counts.parsedKills}, ${Math.max(0, latest.counts.rawKillLines - latest.counts.parsedKills)},
      0, NULL, ${sql(JSON.stringify(latestReport))},
      ${sql(hashText(latest.lines[latest.lines.length - 1] ?? ""))},
      ${sql((latest.lines[latest.lines.length - 1] ?? "").slice(0, 160))},
      'ok', NULL, CURRENT_TIMESTAMP, 'production_import', 'manual_missing_adm_recovery'
    )
    ON CONFLICT(linked_server_id) DO UPDATE SET
      latest_adm_file = excluded.latest_adm_file,
      latest_adm_path = excluded.latest_adm_path,
      last_processed_file = excluded.last_processed_file,
      last_processed_line = excluded.last_processed_line,
      last_processed_offset = excluded.last_processed_offset,
      last_sync_status = excluded.last_sync_status,
      last_sync_message = excluded.last_sync_message,
      last_sync_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP,
      last_lines_read = excluded.last_lines_read,
      last_lines_processed = excluded.last_lines_processed,
      last_raw_kill_lines_found = excluded.last_raw_kill_lines_found,
      last_parsed_kill_lines_found = excluded.last_parsed_kill_lines_found,
      last_parser_skipped_lines = excluded.last_parser_skipped_lines,
      last_unreadable_files_queued = 0,
      last_newest_unprocessed_adm_file = NULL,
      last_import_report_json = excluded.last_import_report_json,
      last_processed_adm_line_hash = excluded.last_processed_adm_line_hash,
      last_processed_adm_line_text_preview = excluded.last_processed_adm_line_text_preview,
      last_cursor_validation_status = 'ok',
      last_cursor_validation_error = NULL,
      last_cursor_validation_at = CURRENT_TIMESTAMP,
      cursor_recovery_strategy = 'production_import',
      cursor_recovery_reason = 'manual_missing_adm_recovery',
      source_service_id = excluded.source_service_id`,
  );

  if (server.guild_id) {
    const allowedPostTypes = plan?.plan_key === "partner" ? DISCORD_POST_TYPES : DISCORD_POST_TYPES.filter((type) => type !== "hit_feed_embed");
    for (const postType of allowedPostTypes) {
      statements.push(
        `INSERT INTO automation_jobs (
          id, guild_id, job_type, post_type, status, attempts, max_attempts, last_error, run_after, created_at, updated_at
        )
        SELECT ${sql(randomUUID())}, ${sql(server.guild_id)}, 'discord-post-update', ${sql(postType)}, 'queued', 0, 5, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE NOT EXISTS (
          SELECT 1 FROM automation_jobs
          WHERE guild_id = ${sql(server.guild_id)}
            AND job_type = 'discord-post-update'
            AND COALESCE(post_type, '') = ${sql(postType)}
            AND status IN ('queued', 'running')
        )`,
      );
    }
  }

  return statements;
}

function rawEventInsertSql(linkedServerId: string, serviceId: string, file: PlannedFileImport, raw: PlannedRawEvent) {
  const event = raw.event;
  return `INSERT INTO adm_raw_events (
    id, linked_server_id, source_service_id, source_adm_file, source_line_number,
    source_sync_run_id, adm_file, line_number, raw_line, event_type, parsed, created_at
  )
  SELECT ${sql(raw.id)}, ${sql(linkedServerId)}, ${sql(serviceId)}, ${sql(file.filename)}, ${raw.lineNumber},
    ${sql(file.syncRunId)}, ${sql(file.filename)}, ${raw.lineNumber}, ${sql(event.rawLine)},
    ${sql(event.eventType)}, ${event.eventType === "unknown" ? 0 : 1}, CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 FROM adm_raw_events
    WHERE linked_server_id = ${sql(linkedServerId)}
      AND COALESCE(source_service_id, ${sql(serviceId)}) = ${sql(serviceId)}
      AND COALESCE(source_adm_file, adm_file, '') = ${sql(file.filename)}
      AND COALESCE(source_line_number, line_number) = ${raw.lineNumber}
  )`;
}

function playerEventInsertSql(linkedServerId: string, serviceId: string, file: PlannedFileImport, player: PlannedPlayerEvent) {
  const event = player.event;
  const position = event.position ?? event.victimPosition ?? event.attackerPosition ?? event.killerPosition;
  const playerIdentity = getPlayerForPlayerEvent(event);
  return `INSERT INTO player_events (
    id, linked_server_id, source_service_id, source_sync_run_id, player_profile_id,
    player_name, player_id, event_type, position_x, position_y, position_z,
    adm_file, source_adm_file, line_number, source_line_number, occurred_at, raw_line, created_at
  )
  SELECT ${sql(player.id)}, ${sql(linkedServerId)}, ${sql(serviceId)}, ${sql(file.syncRunId)}, ${sql(player.profileId)},
    ${sql(playerIdentity.name ?? event.playerName)}, ${sql(playerIdentity.id ?? event.playerId)}, ${sql(event.eventType)},
    ${sqlNumber(position?.x)}, ${sqlNumber(position?.y)}, ${sqlNumber(position?.z)},
    ${sql(file.filename)}, ${sql(file.filename)}, ${player.lineNumber}, ${player.lineNumber},
    ${sql(event.occurredAt)}, ${sql(event.rawLine)}, CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 FROM player_events
    WHERE linked_server_id = ${sql(linkedServerId)}
      AND COALESCE(source_service_id, ${sql(serviceId)}) = ${sql(serviceId)}
      AND COALESCE(source_adm_file, adm_file, '') = ${sql(file.filename)}
      AND COALESCE(source_line_number, line_number) = ${player.lineNumber}
  )`;
}

function killEventInsertSql(linkedServerId: string, serviceId: string, file: PlannedFileImport, kill: PlannedKillEvent) {
  const event = kill.event;
  const killerIdentity = event.killerId ?? event.killerName ?? event.playerId ?? event.playerName ?? "";
  const victimIdentity = event.victimId ?? event.victimName ?? "";
  return `INSERT INTO kill_events (
    id, linked_server_id, source_service_id, source_sync_run_id, killer_profile_id,
    victim_profile_id, killer_name, victim_name, killer_id, victim_id, weapon,
    distance, position_x, position_y, position_z, adm_file, source_adm_file,
    line_number, source_line_number, occurred_at, raw_line, created_at
  )
  SELECT ${sql(kill.id)}, ${sql(linkedServerId)}, ${sql(serviceId)}, ${sql(file.syncRunId)},
    ${sql(kill.killerProfileId)}, ${sql(kill.victimProfileId)}, ${sql(event.killerName ?? event.playerName)},
    ${sql(event.victimName)}, ${sql(event.killerId ?? event.playerId)}, ${sql(event.victimId)},
    ${sql(event.weapon)}, ${sqlNumber(event.distance)},
    ${sqlNumber(event.killerPosition?.x ?? event.position?.x)}, ${sqlNumber(event.killerPosition?.y ?? event.position?.y)},
    ${sqlNumber(event.killerPosition?.z ?? event.position?.z)}, ${sql(file.filename)}, ${sql(file.filename)},
    ${kill.lineNumber}, ${kill.lineNumber}, ${sql(event.occurredAt)}, ${sql(event.rawLine)}, CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 FROM kill_events
    WHERE linked_server_id = ${sql(linkedServerId)}
      AND COALESCE(source_service_id, ${sql(serviceId)}) = ${sql(serviceId)}
      AND COALESCE(source_adm_file, adm_file, '') = ${sql(file.filename)}
      AND COALESCE(source_line_number, line_number) = ${kill.lineNumber}
  )
  AND NOT EXISTS (
    SELECT 1 FROM kill_events
    WHERE linked_server_id = ${sql(linkedServerId)}
      AND COALESCE(source_service_id, ${sql(serviceId)}) = ${sql(serviceId)}
      AND COALESCE(occurred_at, '') = COALESCE(${sql(event.occurredAt)}, '')
      AND COALESCE(killer_id, killer_name, '') = ${sql(killerIdentity)}
      AND COALESCE(victim_id, victim_name, '') = ${sql(victimIdentity)}
      AND COALESCE(weapon, '') = COALESCE(${sql(event.weapon)}, '')
      AND (
        (${sqlNumber(event.distance)} IS NULL AND distance IS NULL)
        OR ABS(COALESCE(distance, -9999999) - COALESCE(${sqlNumber(event.distance)}, -9999999)) < 0.0001
      )
  )`;
}

function buildRebuildStatements(linkedServerId: string, serviceId: string) {
  return [
    `UPDATE player_profiles
     SET
       kills = COALESCE((SELECT COUNT(*) FROM kill_events WHERE killer_profile_id = player_profiles.id), 0),
       deaths = COALESCE((SELECT COUNT(*) FROM kill_events WHERE victim_profile_id = player_profiles.id), 0)
         + COALESCE((SELECT COUNT(*) FROM player_events WHERE player_profile_id = player_profiles.id AND event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')), 0),
       suicides = COALESCE((SELECT COUNT(*) FROM player_events WHERE player_profile_id = player_profiles.id AND event_type = 'player_suicide'), 0),
       longest_kill_distance = COALESCE((SELECT MAX(COALESCE(distance, 0)) FROM kill_events WHERE killer_profile_id = player_profiles.id), 0),
       last_seen_at = COALESCE((
         SELECT MAX(seen_at) FROM (
           SELECT COALESCE(occurred_at, created_at) AS seen_at FROM player_events WHERE player_profile_id = player_profiles.id
           UNION ALL
           SELECT COALESCE(occurred_at, created_at) AS seen_at FROM kill_events WHERE killer_profile_id = player_profiles.id OR victim_profile_id = player_profiles.id
         )
       ), last_seen_at),
       updated_at = CURRENT_TIMESTAMP
     WHERE linked_server_id = ${sql(linkedServerId)}`,
    `INSERT INTO server_stats (
       id, linked_server_id, source_service_id, total_kills, total_deaths, total_joins,
       total_disconnects, unique_players, last_event_at, updated_at
     ) VALUES (
       ${sql(randomUUID())}, ${sql(linkedServerId)}, ${sql(serviceId)},
       (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ${sql(linkedServerId)}),
       (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ${sql(linkedServerId)} AND victim_name IS NOT NULL)
         + (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sql(linkedServerId)} AND event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')),
       (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sql(linkedServerId)} AND event_type = 'player_connected'),
       (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sql(linkedServerId)} AND event_type = 'player_disconnected'),
       (SELECT COUNT(*) FROM player_profiles WHERE linked_server_id = ${sql(linkedServerId)}),
       (
         SELECT MAX(COALESCE(occurred_at, created_at)) FROM (
           SELECT occurred_at, created_at FROM player_events WHERE linked_server_id = ${sql(linkedServerId)}
           UNION ALL
           SELECT occurred_at, created_at FROM kill_events WHERE linked_server_id = ${sql(linkedServerId)}
           UNION ALL
           SELECT occurred_at, created_at FROM build_events WHERE linked_server_id = ${sql(linkedServerId)}
         )
       ),
       CURRENT_TIMESTAMP
     )
     ON CONFLICT(linked_server_id) DO UPDATE SET
       source_service_id = excluded.source_service_id,
       total_kills = excluded.total_kills,
       total_deaths = excluded.total_deaths,
       total_joins = excluded.total_joins,
       total_disconnects = excluded.total_disconnects,
       unique_players = excluded.unique_players,
       last_event_at = excluded.last_event_at,
       updated_at = CURRENT_TIMESTAMP`,
  ];
}

async function buildPublicCacheStatements(server: LinkedServerRow, plan: PlanRow | null, totals: ServerTotals) {
  const leaderboard = await d1Query<Record<string, unknown>>(
    `SELECT player_name, player_id, kills, deaths, suicides, longest_kill_distance
     FROM player_profiles
     WHERE linked_server_id = ${sql(server.id)}
     ORDER BY kills DESC, longest_kill_distance DESC, deaths ASC, player_name ASC
     LIMIT 20`,
  );
  const events = await d1Query<Record<string, unknown>>(
    `SELECT source, event_type, player_name, killer_name, victim_name, weapon, distance, occurred_at, created_at, raw_line
     FROM (
       SELECT 'kill' AS source, 'player_killed' AS event_type, NULL AS player_name, killer_name, victim_name, weapon, distance, occurred_at, created_at, raw_line
       FROM kill_events
       WHERE linked_server_id = ${sql(server.id)}
       UNION ALL
       SELECT 'player' AS source, event_type, player_name, NULL AS killer_name, NULL AS victim_name, NULL AS weapon, NULL AS distance, occurred_at, created_at, raw_line
       FROM player_events
       WHERE linked_server_id = ${sql(server.id)} AND event_type NOT LIKE 'player_hit%'
     )
     ORDER BY COALESCE(occurred_at, created_at) DESC
     LIMIT 30`,
  );
  const planKey = plan?.plan_key ?? "starter";
  return [
    `INSERT INTO server_public_cache (
      id, guild_id, plan_key, public_server_name, current_player_count, max_player_count,
      server_online, server_status, leaderboard_snapshot_json, event_snapshot_json,
      network_rank, partner_featured, last_status_update_at, last_adm_update_at, updated_at
    ) VALUES (
      ${sql(randomUUID())}, ${sql(server.guild_id)}, ${sql(planKey)},
      ${sql(firstString(server.display_name, server.hostname, server.server_name, server.nitrado_service_name))},
      ${sqlNumber(server.current_players)}, ${sqlNumber(server.max_players ?? server.player_slots)},
      ${server.is_online ? 1 : 0}, ${sql(server.server_status)},
      ${sql(JSON.stringify(leaderboard))}, ${sql(JSON.stringify(events))},
      NULL, ${planKey === "partner" ? 1 : 0}, ${sql(server.metadata_last_checked_at ?? server.player_count_last_checked_at)},
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(guild_id) DO UPDATE SET
      plan_key = excluded.plan_key,
      public_server_name = excluded.public_server_name,
      current_player_count = COALESCE(excluded.current_player_count, server_public_cache.current_player_count),
      max_player_count = COALESCE(excluded.max_player_count, server_public_cache.max_player_count),
      server_online = excluded.server_online,
      server_status = COALESCE(excluded.server_status, server_public_cache.server_status),
      leaderboard_snapshot_json = excluded.leaderboard_snapshot_json,
      event_snapshot_json = excluded.event_snapshot_json,
      partner_featured = excluded.partner_featured,
      last_status_update_at = COALESCE(excluded.last_status_update_at, server_public_cache.last_status_update_at),
      last_adm_update_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP`,
    `INSERT INTO public_stats_snapshots (
      id, snapshot_key, payload_json, generated_at, source, stale_allowed_until, created_at, updated_at
    ) VALUES (
      ${sql(randomUUID())}, ${sql(`server:${server.public_slug ?? server.id}:latest_totals`)},
      ${sql(JSON.stringify({ ok: true, totals, server_id: server.id, generated_at: new Date().toISOString() }))},
      CURRENT_TIMESTAMP, 'production_adm_import', datetime('now', '+7 days'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(snapshot_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      generated_at = excluded.generated_at,
      source = excluded.source,
      stale_allowed_until = excluded.stale_allowed_until,
      updated_at = CURRENT_TIMESTAMP`,
  ];
}

async function findLinkedServer(): Promise<LinkedServerRow> {
  const whereParts: string[] = [];
  if (serviceIdArg) whereParts.push(`CAST(nitrado_service_id AS TEXT) = ${sql(serviceIdArg)}`);
  if (serverArg) {
    whereParts.push(`lower(COALESCE(public_slug, '')) = lower(${sql(serverArg)})`);
    whereParts.push(`lower(COALESCE(display_name, '')) = lower(${sql(serverArg)})`);
    whereParts.push(`lower(COALESCE(server_name, '')) = lower(${sql(serverArg)})`);
    whereParts.push(`lower(COALESCE(hostname, '')) = lower(${sql(serverArg)})`);
  }
  const rows = await d1Query<LinkedServerRow>(
    `SELECT *
     FROM linked_servers
     WHERE ${whereParts.join(" OR ")}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row?.id) fail(`No linked server found for ${serviceIdArg ?? serverArg}.`);
  return row;
}

async function getPlan(server: LinkedServerRow) {
  if (!server.guild_id) return null;
  const rows = await d1Query<PlanRow>(
    `SELECT plan_key, status
     FROM server_subscriptions
     WHERE guild_id = ${sql(server.guild_id)}
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

async function getProfiles(linkedServerId: string) {
  return d1Query<ProfileRow>(
    `SELECT id, player_name, player_id
     FROM player_profiles
     WHERE linked_server_id = ${sql(linkedServerId)}`,
  );
}

async function getServerTotals(linkedServerId: string): Promise<ServerTotals> {
  const rows = await d1Query<{
    total_kills: number | null;
    total_deaths: number | null;
    total_joins: number | null;
    total_disconnects: number | null;
    unique_players: number | null;
    last_event_at: string | null;
    longest_kill: number | null;
  }>(
    `SELECT
       server_stats.total_kills,
       server_stats.total_deaths,
       server_stats.total_joins,
       server_stats.total_disconnects,
       server_stats.unique_players,
       server_stats.last_event_at,
       (SELECT MAX(COALESCE(distance, 0)) FROM kill_events WHERE linked_server_id = ${sql(linkedServerId)}) AS longest_kill
     FROM server_stats
     WHERE linked_server_id = ${sql(linkedServerId)}
     LIMIT 1`,
  );
  const row = rows[0] ?? {
    total_kills: 0,
    total_deaths: 0,
    total_joins: 0,
    total_disconnects: 0,
    unique_players: 0,
    last_event_at: null,
    longest_kill: 0,
  };
  const totals = {
    kills: numberOrZero(row.total_kills),
    deaths: numberOrZero(row.total_deaths),
    joins: numberOrZero(row.total_joins),
    disconnects: numberOrZero(row.total_disconnects),
    uniquePlayers: numberOrZero(row.unique_players),
    longestKill: numberOrZero(row.longest_kill),
    lastEventAt: row.last_event_at ?? null,
    score: 0,
  };
  totals.score = calculateServerScore({
    kills: totals.kills,
    deaths: totals.deaths,
    joins: totals.joins,
    uniquePlayers: totals.uniquePlayers,
    longestKill: totals.longestKill,
    statsSyncActive: true,
  });
  return totals;
}

async function getWrittenCounts(linkedServerId: string, file: PlannedFileImport): Promise<WrittenCounts> {
  const [raw, player, kill, finalKills, finalPlayers] = await Promise.all([
    d1Query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM adm_raw_events WHERE linked_server_id = ${sql(linkedServerId)} AND source_sync_run_id = ${sql(file.syncRunId)}`,
    ),
    d1Query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM player_events WHERE linked_server_id = ${sql(linkedServerId)} AND source_sync_run_id = ${sql(file.syncRunId)}`,
    ),
    d1Query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id = ${sql(linkedServerId)} AND source_sync_run_id = ${sql(file.syncRunId)}`,
    ),
    d1Query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id = ${sql(linkedServerId)} AND COALESCE(source_adm_file, adm_file, '') = ${sql(file.filename)}`,
    ),
    d1Query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM player_events WHERE linked_server_id = ${sql(linkedServerId)} AND COALESCE(source_adm_file, adm_file, '') = ${sql(file.filename)}`,
    ),
  ]);
  const rawEvents = numberOrZero(raw[0]?.count);
  const playerEvents = numberOrZero(player[0]?.count);
  const killEvents = numberOrZero(kill[0]?.count);
  const planned = file.rawEvents.length + file.playerEvents.length + file.killEvents.length;
  return {
    rawEvents,
    playerEvents,
    killEvents,
    duplicateSkips: Math.max(0, planned - rawEvents - playerEvents - killEvents),
    finalFileKills: numberOrZero(finalKills[0]?.count),
    finalFilePlayerEvents: numberOrZero(finalPlayers[0]?.count),
  };
}

async function getQueuedDiscordJobsCount(guildId: string | null) {
  if (!guildId) return 0;
  const rows = await d1Query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM automation_jobs
     WHERE guild_id = ${sql(guildId)}
       AND job_type = 'discord-post-update'
       AND status IN ('queued', 'running')`,
  );
  return numberOrZero(rows[0]?.count);
}

async function refreshPublicEndpoints(base: string, publicSlug: string | null) {
  const urls = [
    "/api/public/home-stats",
    "/api/public/leaderboards",
    publicSlug ? `/api/public/servers?slug=${encodeURIComponent(publicSlug)}` : null,
  ].filter(Boolean) as string[];
  const results: Array<{ url: string; status: number | null; ok: boolean; error?: string }> = [];
  for (const path of urls) {
    const url = `${base.replace(/\/$/, "")}${path}`;
    try {
      const response = await fetch(url, { method: "GET", headers: { "cache-control": "no-cache" } });
      results.push({ url, status: response.status, ok: response.ok });
    } catch (error) {
      results.push({ url, status: null, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

async function applyStatements(statements: string[]) {
  const compact = statements.map((statement) => statement.trim()).filter(Boolean);
  if (!compact.length) return;
  const chunks: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const statement of compact) {
    const size = Buffer.byteLength(statement, "utf8");
    if (current.length && (current.length >= 160 || bytes + size > 450_000)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(statement);
    bytes += size;
  }
  if (current.length) chunks.push(current);

  for (let index = 0; index < chunks.length; index += 1) {
    const dir = mkdtempSync(join(tmpdir(), "dzn-adm-import-"));
    const file = join(dir, "apply.sql");
    try {
      writeFileSync(file, ensureSqlFile(chunks[index].join(";\n")), "utf8");
      runWrangler(["d1", "execute", DATABASE_NAME, "--remote", `--file=${file}`]);
      process.stdout.write(`Applied SQL chunk ${index + 1}/${chunks.length}\r`);
    } catch (error) {
      console.error(`\nD1 apply failed on SQL chunk ${index + 1}/${chunks.length}. SQL file retained at ${file}`);
      const commandError = error as { stdout?: unknown; stderr?: unknown; message?: string };
      console.error(normalizeCommandOutput(commandError.stdout));
      console.error(normalizeCommandOutput(commandError.stderr) || commandError.message);
      process.exit(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  process.stdout.write("\n");
}

async function d1Query<T>(sqlCommand: string): Promise<T[]> {
  const output = runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--yes", "--command", sqlCommand]);
  const payload = parseWranglerJson(output);
  const first = payload[0];
  if (!first?.success) fail(`D1 query failed: ${sqlCommand}`);
  return (first.results ?? []) as T[];
}

function runWrangler(argsValue: string[]) {
  return runWranglerNode(argsValue, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
}

function runWranglerNode(argsValue: string[], options: ExecFileSyncOptionsWithStringEncoding) {
  const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerBin)) fail("Wrangler is not installed locally. Run npm install, then try again.");
  return execFileSync(process.execPath, [wranglerBin, ...argsValue], {
    ...options,
    encoding: "utf8",
  });
}

function parseWranglerJson(output: string): Array<{ success: boolean; results?: unknown[] }> {
  const jsonStart = output.indexOf("[");
  if (jsonStart < 0) fail("Wrangler did not return JSON output.");
  return JSON.parse(output.slice(jsonStart));
}

function parseArgs(values: string[]) {
  const flags = new Set<string>();
  const single = new Map<string, string>();
  const multi = new Map<string, string[]>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (key === "files") {
      const files: string[] = [];
      while (values[index + 1] && !values[index + 1].startsWith("--")) {
        files.push(values[index + 1]);
        index += 1;
      }
      multi.set(key, files);
      continue;
    }
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      single.set(key, next);
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return { flags, single, multi };
}

function firstArg(parsed: ReturnType<typeof parseArgs>, key: string) {
  const value = parsed.single.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function splitAdmText(text: string) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function countParsedEvents(lines: string[], parsed: ParsedAdmEvent[]): FileCounts {
  return {
    lines: lines.length,
    rawKillLines: lines.filter((line) => /\bkilled by\s+Player\s+"/i.test(line)).length,
    parsedKills: parsed.filter(isCreditedKill).length,
    connected: parsed.filter((event) => event.eventType === "player_connected").length,
    connecting: parsed.filter((event) => event.eventType === "player_connecting").length,
    disconnects: parsed.filter((event) => event.eventType === "player_disconnected").length,
    playerlistSnapshots: parsed.filter((event) => event.eventType === "playerlist_snapshot").length,
    hitLines: parsed.filter(isHitEvent).length,
    deadHitLines: parsed.filter((event) => event.eventType === "player_hit" && event.victimDead && !event.isCreditedKill).length,
    suicides: parsed.filter((event) => event.eventType === "player_suicide").length,
    uncreditedDeaths: parsed.filter((event) => event.eventType === "player_died_stats" || event.eventType === "player_killed_environment").length,
  };
}

function isCreditedKill(event: ParsedAdmEvent) {
  return event.eventType === "player_killed" && event.isCreditedKill && /\bkilled by\s+Player\s+"/i.test(event.rawLine);
}

function isHitEvent(event: ParsedAdmEvent) {
  return event.eventType === "player_hit" ||
    event.eventType === "player_hit_explosion" ||
    event.eventType === "player_hit_unknown_attacker";
}

function shouldPersistPlayerEvent(event: ParsedAdmEvent) {
  if (
    event.eventType === "admin_log_started" ||
    event.eventType === "playerlist_snapshot" ||
    event.eventType === "playerlist_delimiter" ||
    event.eventType === "unknown"
  ) return false;
  if (isHitEvent(event)) return false;
  if (event.eventType === "player_killed" && event.isCreditedKill) return false;
  if (
    event.eventType === "player_built_structure" ||
    event.eventType === "player_dismantled_structure" ||
    event.eventType === "player_folded_structure" ||
    event.eventType === "player_placed_object" ||
    event.eventType === "territory_flag_raised" ||
    event.eventType === "territory_flag_lowered"
  ) {
    return false;
  }
  return true;
}

function getPlayerForPlayerEvent(event: ParsedAdmEvent) {
  if (event.playerName || event.playerId) return { name: event.playerName, id: event.playerId };
  if (event.victimName || event.victimId) return { name: event.victimName, id: event.victimId };
  if (event.attackerName || event.attackerId) return { name: event.attackerName, id: event.attackerId };
  if (event.killerName || event.killerId) return { name: event.killerName, id: event.killerId };
  return { name: null, id: null };
}

function buildImportReport(file: PlannedFileImport) {
  return {
    filename: file.filename,
    source: "manual_production_import",
    total_lines: file.lines.length,
    raw_kill_lines_found: file.counts.rawKillLines,
    parsed_kills: file.counts.parsedKills,
    connected: file.counts.connected,
    connecting: file.counts.connecting,
    disconnects: file.counts.disconnects,
    playerlist_snapshots: file.counts.playerlistSnapshots,
    hit_lines_skipped: file.counts.hitLines,
    dead_hit_lines_skipped: file.counts.deadHitLines,
    suicides: file.counts.suicides,
    uncredited_deaths: file.counts.uncreditedDeaths,
    generated_at: new Date().toISOString(),
  };
}

function printPlan(values: {
  mode: Mode;
  server: LinkedServerRow;
  serverName: string;
  serviceId: string;
  plan: PlanRow | null;
  beforeTotals: ServerTotals;
  files: PlannedFileImport[];
}) {
  console.log(values.mode === "apply" ? "DZN ADM production import apply plan." : "DZN ADM production import dry run.");
  console.log("");
  console.log(`Server: ${values.serverName}`);
  console.log(`Linked server ID: ${values.server.id}`);
  console.log(`Nitrado service ID: ${values.serviceId}`);
  console.log(`Plan/status: ${values.plan?.plan_key ?? "unknown"}/${values.plan?.status ?? "unknown"}`);
  console.log(`Before totals: kills=${values.beforeTotals.kills}, deaths=${values.beforeTotals.deaths}, joins=${values.beforeTotals.joins}, disconnects=${values.beforeTotals.disconnects}, unique=${values.beforeTotals.uniquePlayers}, score=${values.beforeTotals.score}`);
  for (const file of values.files) {
    console.log("");
    console.log(`File: ${file.filename}`);
    console.log(`Path: ${file.path}`);
    console.log(`Lines: ${file.counts.lines}`);
    console.log(`Parsed kills: ${file.counts.parsedKills} / raw killed-by lines: ${file.counts.rawKillLines}`);
    console.log(`Connects: connected=${file.counts.connected}, connecting=${file.counts.connecting}`);
    console.log(`Disconnects: ${file.counts.disconnects}`);
    console.log(`PlayerList snapshots: ${file.counts.playerlistSnapshots}`);
    console.log(`Suicides: ${file.counts.suicides}, uncredited deaths: ${file.counts.uncreditedDeaths}`);
    console.log(`Hit lines skipped by default: ${file.counts.hitLines} (dead hit lines: ${file.counts.deadHitLines})`);
    console.log(`Planned writes: raw=${file.rawEvents.length}, player_events=${file.playerEvents.length}, kill_events=${file.killEvents.length}`);
  }
}

function printResult(values: {
  server: LinkedServerRow;
  serverName: string;
  serviceId: string;
  plan: PlanRow | null;
  beforeTotals: ServerTotals;
  afterTotals: ServerTotals;
  files: PlannedFileImport[];
  writtenByFile: Map<string, WrittenCounts>;
  discordJobsQueued: number;
  endpointResults: Array<{ url: string; status: number | null; ok: boolean; error?: string }>;
  durationMs: number;
}) {
  console.log("");
  console.log("DZN ADM production import completed.");
  console.log(`Duration: ${Math.round(values.durationMs / 1000)}s`);
  console.log("");
  console.log(`Server: ${values.serverName}`);
  console.log(`Nitrado service ID: ${values.serviceId}`);
  console.log(`Plan/status: ${values.plan?.plan_key ?? "unknown"}/${values.plan?.status ?? "unknown"}`);
  console.log("");
  console.log(`Before totals: kills=${values.beforeTotals.kills}, deaths=${values.beforeTotals.deaths}, joins=${values.beforeTotals.joins}, disconnects=${values.beforeTotals.disconnects}, unique=${values.beforeTotals.uniquePlayers}, score=${values.beforeTotals.score}`);
  console.log(`After totals: kills=${values.afterTotals.kills}, deaths=${values.afterTotals.deaths}, joins=${values.afterTotals.joins}, disconnects=${values.afterTotals.disconnects}, unique=${values.afterTotals.uniquePlayers}, score=${values.afterTotals.score}`);
  console.log("");
  for (const file of values.files) {
    const written = values.writtenByFile.get(file.filename);
    console.log(`File result: ${file.filename}`);
    console.log(`  parsed: kills=${file.counts.parsedKills}, connected=${file.counts.connected}, connecting=${file.counts.connecting}, disconnects=${file.counts.disconnects}, playerlists=${file.counts.playerlistSnapshots}, suicides=${file.counts.suicides}, uncredited=${file.counts.uncreditedDeaths}, hit_lines_skipped=${file.counts.hitLines}`);
    console.log(`  written this run: kills=${written?.killEvents ?? 0}, player_events=${written?.playerEvents ?? 0}, raw_events=${written?.rawEvents ?? 0}`);
    console.log(`  duplicate skips: ${written?.duplicateSkips ?? 0}`);
    console.log(`  final source-file rows: kills=${written?.finalFileKills ?? 0}, player_events=${written?.finalFilePlayerEvents ?? 0}`);
  }
  console.log("");
  console.log(`Discord post jobs queued/refreshed: ${values.discordJobsQueued}`);
  console.log("Public endpoint refresh:");
  for (const result of values.endpointResults) {
    console.log(`  ${result.ok ? "ok" : "failed"} ${result.status ?? "n/a"} ${result.url}${result.error ? ` (${result.error})` : ""}`);
  }
}

function profileKey(name: string, playerId: string | null) {
  return playerId ? `id:${playerId}` : `name:${name.toLowerCase()}`;
}

function stableSyncId(prefix: string, linkedServerId: string, admFile: string | null, lineNumber: number, suffix = "") {
  const input = `${prefix}:${linkedServerId}:${admFile ?? "unknown-adm"}:${lineNumber}:${suffix}`;
  return `${prefix}:${createHash("sha256").update(input).digest("hex").slice(0, 48)}`;
}

function extractAdmDate(fileName: string | null) {
  return fileName ? /(\d{4}-\d{2}-\d{2})/.exec(fileName)?.[1] ?? null : null;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sql(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "NULL";
}

function ensureSqlFile(sqlCommand: string) {
  const trimmed = sqlCommand.trim();
  return trimmed.endsWith(";") ? `${trimmed}\n` : `${trimmed};\n`;
}

function normalizeCommandOutput(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value instanceof Buffer) return value.toString("utf8").trim();
  return "";
}

function firstString(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
