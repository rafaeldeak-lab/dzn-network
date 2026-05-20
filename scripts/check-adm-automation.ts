import { execSync } from "node:child_process";
import { calculateServerScore } from "../functions/_lib/server-ranking";
import { getAdmDiscoveryIntervalMinutes, getAdmPullInterval, getServerStatusInterval, normalizePlanKey } from "../functions/_lib/plans";

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
  last_successful_adm_sync_at: string | null;
  last_adm_discovery_check_at: string | null;
  next_adm_discovery_due_at: string | null;
  next_adm_pull_due_at: string | null;
  last_adm_error: string | null;
};

type CronRow = {
  source: string | null;
  job_type: string | null;
  status: string | null;
  created_at: string | null;
  error_message?: string | null;
  processed_count?: number | null;
  skipped_count?: number | null;
  failed_count?: number | null;
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

type StatsRow = {
  total_kills: number | null;
  total_deaths: number | null;
  total_joins: number | null;
  total_disconnects: number | null;
  unique_players: number | null;
  longest_kill: number | null;
};

type FileStateRow = {
  adm_file: string;
  status: string;
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

function ageMinutes(value: string | null | undefined) {
  if (!value) return null;
  const age = Date.now() - Date.parse(value);
  return Number.isFinite(age) ? Math.max(0, Math.round(age / 60000)) : null;
}

function formatCron(row: CronRow | null | undefined) {
  if (!row) return "none";
  const age = ageMinutes(row.created_at);
  const metrics = [
    row.processed_count !== null && row.processed_count !== undefined ? `processed=${row.processed_count}` : null,
    row.skipped_count !== null && row.skipped_count !== undefined ? `skipped=${row.skipped_count}` : null,
    row.failed_count !== null && row.failed_count !== undefined ? `failed=${row.failed_count}` : null,
  ].filter(Boolean).join(", ");
  return `${row.source ?? "unknown"} ${row.job_type ?? "unknown"} ${row.status ?? "unknown"} ${row.created_at ?? "unknown"} (${age ?? "?"}m ago${metrics ? `, ${metrics}` : ""})`;
}

function formatJob(job: JobRow | null | undefined) {
  if (!job) return "none";
  return `${job.filename} ${job.source} ${job.status} chunk ${numberOrZero(job.chunks_processed)}/${numberOrZero(job.total_chunks)} kills ${numberOrZero(job.written_kills)}/${numberOrZero(job.parsed_kills)} joins ${numberOrZero(job.joins)} disconnects ${numberOrZero(job.disconnects)} PlayerLists ${numberOrZero(job.playerlist_snapshots)} updated ${job.updated_at ?? "unknown"}`;
}

function printList(label: string, values: string[]) {
  console.log(`${label}: ${values.length ? values.join(", ") : "none"}`);
}

console.log("\nDZN ADM Automation Check");
console.log("========================");
console.log(`Target: ${target}`);

const server = runWranglerQuery<ServerRow>(
  `SELECT linked_servers.id, linked_servers.guild_id, linked_servers.public_slug,
          linked_servers.nitrado_service_id, linked_servers.display_name,
          linked_servers.hostname, linked_servers.server_name,
          server_subscriptions.plan_key, server_subscriptions.status AS subscription_status,
          server_sync_state.newest_available_adm_filename,
          server_sync_state.newest_readable_adm_filename,
          adm_sync_state.last_processed_file AS last_processed_adm_filename,
          adm_sync_state.last_sync_at AS last_successful_adm_sync_at,
          server_sync_state.last_adm_discovery_check_at,
          server_sync_state.next_adm_discovery_due_at,
          server_sync_state.next_adm_pull_due_at,
          COALESCE(server_sync_state.last_adm_discovery_error, adm_sync_state.last_sync_message) AS last_adm_error
   FROM linked_servers
   LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
   LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
   LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
   WHERE linked_servers.public_slug = ${sqlLiteral(target)}
      OR linked_servers.nitrado_service_id = ${sqlLiteral(target)}
      OR linked_servers.id = ${sqlLiteral(target)}
   ORDER BY server_subscriptions.updated_at DESC
   LIMIT 1`,
)[0];

if (!server) {
  console.log("FAIL No linked server matched the target.");
  process.exitCode = 1;
} else {
  const cronRows = runWranglerQuery<CronRow>(
    `SELECT source, job_type, status, created_at, error_message, processed_count, skipped_count, failed_count
     FROM automation_cron_runs
     ORDER BY created_at DESC
     LIMIT 40`,
  );
  const jobs = runWranglerQuery<JobRow>(
    `SELECT id, filename, source, status, current_line, total_lines, chunks_processed,
            total_chunks, parsed_kills, written_kills, joins, disconnects,
            playerlist_snapshots, error_message, updated_at, completed_at
     FROM adm_import_jobs
     WHERE server_id = ${sqlLiteral(server.id)}
     ORDER BY created_at ASC, updated_at ASC`,
  );
  const fileStates = runWranglerQuery<FileStateRow>(
    `SELECT adm_file, status
     FROM adm_sync_file_state
     WHERE linked_server_id = ${sqlLiteral(server.id)}
     ORDER BY adm_file ASC`,
  );
  const stats = runWranglerQuery<StatsRow>(
    `SELECT total_kills, total_deaths, total_joins, total_disconnects, unique_players,
            COALESCE((SELECT MAX(COALESCE(distance, 0)) FROM kill_events WHERE linked_server_id = ${sqlLiteral(server.id)}), 0) AS longest_kill
     FROM server_stats
     WHERE linked_server_id = ${sqlLiteral(server.id)}
     LIMIT 1`,
  )[0] ?? null;
  const recent = runWranglerQuery<{ count: number | null; latest_event_at: string | null }>(
    `SELECT COUNT(*) AS count, MAX(latest_at) AS latest_event_at
     FROM (
       SELECT COALESCE(occurred_at, created_at) AS latest_at FROM kill_events WHERE linked_server_id = ${sqlLiteral(server.id)}
       UNION ALL
       SELECT COALESCE(occurred_at, created_at) AS latest_at FROM player_events WHERE linked_server_id = ${sqlLiteral(server.id)}
     )`,
  )[0] ?? { count: 0, latest_event_at: null };

  const activeJobs = jobs.filter((job) => ["queued", "processing", "parsing", "writing", "rebuilding", "failed_retryable"].includes(job.status));
  const activeJob = activeJobs[0] ?? null;
  const completedJobs = jobs.filter((job) => ["completed", "completed_with_warnings"].includes(job.status));
  const completed = new Set(completedJobs.map((job) => job.filename));
  if (server.last_processed_adm_filename) completed.add(server.last_processed_adm_filename);
  const missingFiles = fileStates.filter((file) => !completed.has(file.adm_file) && ["discovered", "unreadable", "parser_error", "write_error", "partial"].includes(file.status));
  const latestCloudflare = cronRows.find((row) => row.source === "cloudflare") ?? null;
  const latestAdm = cronRows.find((row) => row.job_type === "adm") ?? null;
  const latestDiscord = cronRows.find((row) => row.job_type === "discord-posts") ?? null;
  const latestCloudflareAdm = cronRows.find((row) => row.source === "cloudflare" && row.job_type === "adm") ?? null;
  const cronHealthy = Boolean(latestCloudflare && ageMinutes(latestCloudflare.created_at) !== null && ageMinutes(latestCloudflare.created_at)! <= 5 && latestCloudflareAdm);
  const planKey = normalizePlanKey(server.plan_key);
  const flags = [
    cronHealthy ? "cron_healthy" : "cron_stale",
    activeJob ? "adm_job_processing" : null,
    activeJob?.updated_at && ageMinutes(activeJob.updated_at) !== null && ageMinutes(activeJob.updated_at)! > 5 ? "adm_job_stale" : null,
    missingFiles.length ? "adm_backfill_missing" : null,
    server.newest_available_adm_filename && server.newest_available_adm_filename !== server.newest_readable_adm_filename ? "nitrado_read_waiting" : null,
    ["active", "trialing"].includes((server.subscription_status ?? "").toLowerCase()) ? null : "subscription_not_active",
  ].filter((flag): flag is string => Boolean(flag));
  const score = calculateServerScore({
    kills: stats?.total_kills ?? 0,
    deaths: stats?.total_deaths ?? 0,
    uniquePlayers: stats?.unique_players ?? 0,
    joins: stats?.total_joins ?? 0,
    longestKill: stats?.longest_kill ?? 0,
    statsSyncActive: Boolean(server.last_processed_adm_filename || completedJobs.length || activeJob),
  });
  const nextAction = activeJob
    ? `continue ${activeJob.filename} chunk ${numberOrZero(activeJob.chunks_processed)}/${numberOrZero(activeJob.total_chunks)}`
    : missingFiles.length
      ? `queue/import oldest missing ADM file ${missingFiles[0].adm_file}`
      : "ADM automation caught up";

  console.log(`\nServer: ${server.display_name || server.hostname || server.server_name || server.public_slug || server.id}`);
  console.log(`server id: ${server.id}`);
  console.log(`service id: ${server.nitrado_service_id ?? "missing"}`);
  console.log(`plan/subscription: ${planKey} / ${server.subscription_status ?? "unknown"}`);
  console.log(`intervals: status ${getServerStatusInterval(planKey)}m / ADM discovery ${getAdmDiscoveryIntervalMinutes(planKey)}m / ADM processing ${getAdmPullInterval(planKey)}m`);
  console.log(`cloudflare cron: ${formatCron(latestCloudflare)}`);
  console.log(`ADM cron: ${formatCron(latestAdm)}`);
  console.log(`Discord post cron: ${formatCron(latestDiscord)}`);
  console.log(`newest ADM: ${server.newest_available_adm_filename ?? "unknown"}`);
  console.log(`newest readable ADM: ${server.newest_readable_adm_filename ?? "unknown"}`);
  console.log(`last processed ADM: ${server.last_processed_adm_filename ?? "unknown"}`);
  console.log(`last successful ADM sync: ${server.last_successful_adm_sync_at ?? "unknown"}`);
  console.log(`last ADM discovery: ${server.last_adm_discovery_check_at ?? "unknown"}`);
  console.log(`next ADM discovery: ${server.next_adm_discovery_due_at ?? "now"}`);
  console.log(`next ADM processing: ${server.next_adm_pull_due_at ?? "now"}`);
  console.log(`last ADM error: ${server.last_adm_error ?? "none"}`);
  console.log(`active job: ${formatJob(activeJob)}`);
  console.log(`latest completed job: ${formatJob(completedJobs.at(-1) ?? completedJobs[0])}`);
  printList("queued jobs", activeJobs.map(formatJob));
  printList("completed/imported files", [...completed]);
  printList("missing files", missingFiles.map((file) => `${file.adm_file}(${file.status})`));
  console.log(`current stats: kills=${numberOrZero(stats?.total_kills)} deaths=${numberOrZero(stats?.total_deaths)} joins=${numberOrZero(stats?.total_joins)} disconnects=${numberOrZero(stats?.total_disconnects)} unique=${numberOrZero(stats?.unique_players)} score=${score}`);
  console.log(`recent events: count=${numberOrZero(recent.count)} latest=${recent.latest_event_at ?? "none"}`);
  printList("problem flags", flags);
  console.log(`next action: ${nextAction}`);
}
