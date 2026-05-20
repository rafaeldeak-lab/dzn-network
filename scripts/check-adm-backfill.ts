import { execSync } from "node:child_process";
import { calculateServerScore } from "../functions/_lib/server-ranking";

type ServerRow = {
  id: string;
  guild_id: string | null;
  public_slug: string | null;
  nitrado_service_id: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  plan_key: string | null;
  subscription_status: string | null;
  newest_available_adm_filename: string | null;
  newest_readable_adm_filename: string | null;
  last_processed_adm_filename: string | null;
  next_adm_discovery_due_at: string | null;
  next_adm_pull_due_at: string | null;
};

type FileStateRow = {
  adm_file: string;
  status: string;
  line_count: number | null;
  retry_count: number | null;
  last_error: string | null;
  updated_at: string | null;
};

type JobRow = {
  id: string;
  filename: string;
  source: string;
  status: string;
  current_line: number | null;
  total_lines: number | null;
  chunks_processed: number | null;
  total_chunks: number | null;
  parsed_kills: number | null;
  written_kills: number | null;
  joins: number | null;
  disconnects: number | null;
  playerlist_snapshots: number | null;
  error_message: string | null;
  updated_at: string | null;
  completed_at: string | null;
};

type EventFileRow = {
  adm_file: string;
};

type StatsRow = {
  total_kills: number | null;
  total_deaths: number | null;
  total_joins: number | null;
  total_disconnects: number | null;
  unique_players: number | null;
  longest_kill: number | null;
};

const target = process.argv[2] ?? process.env.DZN_SERVER_SLUG ?? "pandora-dayz";

function runWranglerQuery<T>(sql: string): T[] {
  const compactSql = sql.replace(/\s+/g, " ").trim();
  const output = execSync(`npx wrangler d1 execute dzn_network_db --remote --json --command "${compactSql.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output) as Array<{ results?: T[] }>;
  return parsed.flatMap((item) => item.results ?? []);
}

function sqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function numberOrZero(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function printList(label: string, values: string[]) {
  console.log(`${label}: ${values.length ? values.join(", ") : "none"}`);
}

const servers = runWranglerQuery<ServerRow>(
  `SELECT linked_servers.id, linked_servers.guild_id, linked_servers.public_slug,
          linked_servers.nitrado_service_id, linked_servers.display_name,
          linked_servers.hostname, linked_servers.server_name,
          server_subscriptions.plan_key, server_subscriptions.status AS subscription_status,
          server_sync_state.newest_available_adm_filename,
          server_sync_state.newest_readable_adm_filename,
          server_sync_state.last_processed_adm_filename,
          server_sync_state.next_adm_discovery_due_at,
          server_sync_state.next_adm_pull_due_at
   FROM linked_servers
   LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
   LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
   WHERE linked_servers.public_slug = ${sqlLiteral(target)}
      OR linked_servers.nitrado_service_id = ${sqlLiteral(target)}
      OR linked_servers.id = ${sqlLiteral(target)}
   ORDER BY server_subscriptions.updated_at DESC
   LIMIT 1`,
);

console.log("\nDZN ADM Backfill Check");
console.log("======================");
console.log(`Target: ${target}`);

if (!servers.length) {
  console.log("FAIL No linked server matched the target.");
  process.exitCode = 1;
} else {
  const server = servers[0];
  const serverName = server.display_name || server.hostname || server.server_name || server.public_slug || server.id;
  const files = runWranglerQuery<FileStateRow>(
    `SELECT adm_file, status, line_count, retry_count, last_error, updated_at
     FROM adm_sync_file_state
     WHERE linked_server_id = ${sqlLiteral(server.id)}
     ORDER BY adm_file ASC`,
  );
  const jobs = runWranglerQuery<JobRow>(
    `SELECT id, filename, source, status, current_line, total_lines, chunks_processed,
            total_chunks, parsed_kills, written_kills, joins, disconnects,
            playerlist_snapshots, error_message, updated_at, completed_at
     FROM adm_import_jobs
     WHERE server_id = ${sqlLiteral(server.id)}
     ORDER BY created_at ASC, updated_at ASC`,
  );
  const eventFiles = runWranglerQuery<EventFileRow>(
    `SELECT DISTINCT adm_file FROM kill_events
     WHERE linked_server_id = ${sqlLiteral(server.id)} AND adm_file IS NOT NULL AND adm_file != ''
     UNION
     SELECT DISTINCT adm_file FROM player_events
     WHERE linked_server_id = ${sqlLiteral(server.id)} AND adm_file IS NOT NULL AND adm_file != ''
     UNION
     SELECT DISTINCT adm_file FROM adm_raw_events
     WHERE linked_server_id = ${sqlLiteral(server.id)} AND adm_file IS NOT NULL AND adm_file != ''
     ORDER BY adm_file ASC`,
  );
  const stats = runWranglerQuery<StatsRow>(
    `SELECT total_kills, total_deaths, total_joins, total_disconnects, unique_players,
            COALESCE((
              SELECT MAX(COALESCE(distance, 0))
              FROM kill_events
              WHERE kill_events.linked_server_id = server_stats.linked_server_id
            ), 0) AS longest_kill
     FROM server_stats
     WHERE linked_server_id = ${sqlLiteral(server.id)}
     LIMIT 1`,
  )[0] ?? null;

  const completed = new Set<string>();
  for (const file of files) if (file.status === "processed") completed.add(file.adm_file);
  for (const job of jobs) if (["completed", "completed_with_warnings"].includes(job.status)) completed.add(job.filename);
  for (const file of eventFiles) completed.add(file.adm_file);
  if (server.last_processed_adm_filename) completed.add(server.last_processed_adm_filename);
  const score = calculateServerScore({
    kills: stats?.total_kills ?? 0,
    deaths: stats?.total_deaths ?? 0,
    uniquePlayers: stats?.unique_players ?? 0,
    joins: stats?.total_joins ?? 0,
    longestKill: stats?.longest_kill ?? 0,
    statsSyncActive: Boolean(server.last_processed_adm_filename || completed.size || jobs.length),
  });
  const queued = jobs.filter((job) => job.source === "scheduled_nitrado" && ["queued", "processing", "parsing", "writing", "rebuilding", "failed_retryable"].includes(job.status));
  const active = queued[0] ?? null;
  const failedRetryable = jobs.filter((job) => job.status === "failed_retryable");
  const missing = files
    .filter((file) => !completed.has(file.adm_file) && ["discovered", "unreadable", "parser_error", "write_error", "partial"].includes(file.status))
    .map((file) => file.adm_file);
  const nextAction = active
    ? `continue ${active.filename} chunk ${numberOrZero(active.chunks_processed)}/${numberOrZero(active.total_chunks)}`
    : missing.length
      ? `queue/import oldest missing file ${missing[0]}`
      : "backfill caught up";

  console.log(`\nServer: ${serverName}`);
  console.log(`server id: ${server.id}`);
  console.log(`guild id: ${server.guild_id ?? "missing"}`);
  console.log(`public slug: ${server.public_slug ?? "missing"}`);
  console.log(`service id: ${server.nitrado_service_id ?? "missing"}`);
  console.log(`plan/subscription: ${server.plan_key ?? "unknown"} / ${server.subscription_status ?? "unknown"}`);
  console.log(`newest ADM: ${server.newest_available_adm_filename ?? "unknown"}`);
  console.log(`newest readable ADM: ${server.newest_readable_adm_filename ?? "unknown"}`);
  console.log(`last processed ADM: ${server.last_processed_adm_filename ?? "unknown"}`);
  console.log(`next discovery due: ${server.next_adm_discovery_due_at ?? "now"}`);
  console.log(`next processing due: ${server.next_adm_pull_due_at ?? "now"}`);

  printList("all discovered ADM files", files.map((file) => `${file.adm_file}(${file.status})`));
  printList("completed/imported files", [...completed]);
  printList("missing files", missing);
  printList("queued jobs", queued.map((job) => `${job.filename}(${job.status})`));
  console.log(`active job: ${active ? `${active.filename} ${active.status} chunk ${numberOrZero(active.chunks_processed)}/${numberOrZero(active.total_chunks)}` : "none"}`);
  printList("failed_retryable jobs", failedRetryable.map((job) => `${job.filename}: ${job.error_message ?? "retryable"}`));
  console.log(`current stats: kills=${numberOrZero(stats?.total_kills)} deaths=${numberOrZero(stats?.total_deaths)} joins=${numberOrZero(stats?.total_joins)} disconnects=${numberOrZero(stats?.total_disconnects)} unique=${numberOrZero(stats?.unique_players)} score=${score}`);
  console.log(`next action: ${nextAction}`);
}
