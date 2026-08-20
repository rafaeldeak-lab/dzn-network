set -euo pipefail

node <<'NODE'
const fs = require("node:fs");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.OWNER_CONSOLE_CF_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const githubToken = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const projectName = process.env.ACTIVATE_PREVIEW_PROJECT_NAME;
const oldName = process.env.ACTIVATE_OLD_PREVIEW_DB_NAME;
const oldExpectedMask = process.env.ACTIVATE_OLD_PREVIEW_DB_ID_MASK;
const replacementName = process.env.ACTIVATE_REPLACEMENT_PREVIEW_DB_NAME;
const productionName = process.env.DETECTED_PRODUCTION_D1_DATABASE_NAME || process.env.PRODUCTION_D1_DATABASE_NAME;
const productionId = process.env.DETECTED_PRODUCTION_D1_DATABASE_ID || "";
const productionPagesProject = process.env.PRODUCTION_PAGES_PROJECT_NAME;
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const currentRunId = String(process.env.GITHUB_RUN_ID ?? "");

const source = { name: "OWNER_CONSOLE_CF_TOKEN", token };
if (!source.token || source.token.length <= 20) {
  throw new Error("Missing Cloudflare preview token for activation mode.");
}

function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}

function sanitize(value) {
  let text = String(value ?? "");
  for (const sensitive of [accountId, productionId, source.token]) {
    if (sensitive) text = text.split(sensitive).join("[redacted]");
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted-token]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\b[0-9a-f]{32}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]")
    .replace(/(authorization|cookie|session|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1000);
}

function fail(message) {
  console.error(sanitize(message));
  process.exit(1);
}

function appendSummary(lines) {
  if (summaryPath) fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);
}

function databaseId(database) {
  return String(database?.uuid ?? database?.id ?? database?.database_id ?? "");
}

function success(result) {
  return Boolean(result?.ok && result?.parsed?.success !== false);
}

function firstCloudflareError(parsed) {
  const first = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
  return {
    code: first?.code ?? "unknown",
    message: sanitize(first?.message ?? "unknown"),
  };
}

async function cloudflare(endpointCategory, apiPath, init = {}, accountScoped = true) {
  const base = accountScoped
    ? `https://api.cloudflare.com/client/v4/accounts/${accountId}`
    : "https://api.cloudflare.com/client/v4";
  const response = await fetch(`${base}${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${source.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") || "unknown";
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { success: false, errors: [{ code: `http_${response.status}`, message: "non_json_response" }] };
  }
  return { ok: response.ok, status: response.status, parsed, endpointCategory, contentType, bodyLength: text.length };
}

function printCloudflareDiagnostic(operationName, result) {
  const error = firstCloudflareError(result?.parsed);
  console.log(`ACTIVATE_REBOUND_DISCORD_PREVIEW_AUDIT_FAILED: operation=${operationName}`);
  console.log(`  endpoint_category=${result?.endpointCategory ?? "unknown"}`);
  console.log(`  http_status=${result?.status ?? "unavailable"}`);
  console.log(`  cloudflare_error_code=${sanitize(error.code)}`);
  console.log(`  sanitized_error=${error.message}`);
  console.log(`  response_content_type=${sanitize(result?.contentType ?? "unknown")}`);
  console.log(`  response_body_length=${Number(result?.bodyLength ?? 0)}`);
}

function itemsFromResult(parsed, keys) {
  const result = parsed?.result;
  if (Array.isArray(result)) return result;
  for (const key of keys) {
    if (Array.isArray(result?.[key])) return result[key];
    if (Array.isArray(parsed?.[key])) return parsed[key];
  }
  return [];
}

function resultInfo(parsed) {
  return parsed?.result_info ?? parsed?.result?.result_info ?? {};
}

async function listPaginated(endpointCategory, basePath, keys) {
  const items = [];
  const perPage = 50;
  let lastResult = null;
  for (let page = 1; page <= 50; page += 1) {
    const result = await cloudflare(endpointCategory, `${basePath}?per_page=${perPage}&page=${page}`);
    lastResult = result;
    if (!success(result)) return { ok: false, items, result };
    const pageItems = itemsFromResult(result.parsed, keys);
    items.push(...pageItems);
    const info = resultInfo(result.parsed);
    const totalPages = Number(info.total_pages ?? 0);
    if (totalPages > 0 && page >= totalPages) break;
    if (pageItems.length < perPage) break;
  }
  return { ok: true, items, result: lastResult };
}

async function listPagesProjects() {
  const items = [];
  const first = await cloudflare("pages-project-list", "/pages/projects");
  if (!success(first)) return { ok: false, items, result: first };
  items.push(...itemsFromResult(first.parsed, ["projects"]));
  const info = resultInfo(first.parsed);
  const currentPage = Number(info.page ?? 1);
  const totalPages = Number(info.total_pages ?? 1);
  const returnedPerPage = Number(info.per_page ?? 0);
  const safePerPage = returnedPerPage > 0 && returnedPerPage <= 20 ? returnedPerPage : 20;
  for (let page = currentPage + 1; page <= totalPages && page <= 50; page += 1) {
    const result = await cloudflare("pages-project-list", `/pages/projects?page=${page}&per_page=${safePerPage}`);
    if (!success(result)) return { ok: false, items, result };
    items.push(...itemsFromResult(result.parsed, ["projects"]));
  }
  return { ok: true, items, result: first };
}

function collectD1Bindings(configValue, context) {
  const bindings = [];
  if (!configValue || typeof configValue !== "object") return bindings;
  if (Array.isArray(configValue)) {
    for (const value of configValue) {
      const bindingName = value?.binding ?? value?.name ?? "unnamed";
      const id = String(value?.id ?? value?.database_id ?? "");
      const name = String(value?.database_name ?? value?.name ?? "");
      if (id || name) bindings.push({ ...context, binding: bindingName, id, name });
    }
    return bindings;
  }
  for (const [binding, value] of Object.entries(configValue)) {
    if (typeof value === "string") {
      bindings.push({ ...context, binding, id: value, name: "" });
    } else if (value && typeof value === "object") {
      bindings.push({
        ...context,
        binding,
        id: String(value.id ?? value.database_id ?? ""),
        name: String(value.database_name ?? value.name ?? ""),
      });
    }
  }
  return bindings.filter((binding) => binding.id || binding.name);
}

function extractPagesD1Bindings(project) {
  const bindings = [];
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    bindings.push(...collectD1Bindings(config.d1_databases, {
      source: "pages",
      project: project?.name ?? "unknown",
      environment,
    }));
  }
  return bindings;
}

function extractWorkerBindingsFromValue(value, context, output = [], path = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => extractWorkerBindingsFromValue(item, context, output, [...path, String(index)]));
    return output;
  }
  const type = String(value.type ?? value.binding_type ?? "").toLowerCase();
  const pathText = path.join(".").toLowerCase();
  const hasD1Signal = type.includes("d1")
    || pathText.includes("d1")
    || Object.prototype.hasOwnProperty.call(value, "database_id")
    || Object.prototype.hasOwnProperty.call(value, "database_name");
  if (hasD1Signal) {
    const id = String(value.database_id ?? value.id ?? "");
    const name = String(value.database_name ?? value.name ?? "");
    const binding = String(value.binding ?? value.name ?? path[path.length - 1] ?? "unnamed");
    if (id || name) output.push({ ...context, binding, id, name });
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") extractWorkerBindingsFromValue(child, context, output, [...path, key]);
  }
  return output;
}

async function auditWorkerBindings(databasesById) {
  const deployed = [];
  const scriptsResult = await listPaginated("worker-script-list", "/workers/scripts", ["scripts"]);
  if (!scriptsResult.ok) {
    printCloudflareDiagnostic("worker_script_list", scriptsResult.result);
    return { complete: false, deployed };
  }
  for (const script of scriptsResult.items) {
    const scriptName = script?.id ?? script?.name;
    if (!scriptName) continue;
    const settings = await cloudflare("worker-script-settings", `/workers/scripts/${encodeURIComponent(scriptName)}/settings`);
    if (!success(settings)) {
      printCloudflareDiagnostic(`worker_script_settings:${scriptName}`, settings);
      return { complete: false, deployed };
    }
    const bindings = extractWorkerBindingsFromValue(settings.parsed?.result ?? {}, {
      source: "worker",
      project: scriptName,
      environment: "deployed",
    });
    for (const binding of bindings) deployed.push({ ...binding, resolvedName: binding.name || databasesById.get(binding.id) || "unknown" });
  }
  return { complete: true, deployed };
}

function bindingMatchesDatabase(binding, databaseName, databaseIdValue) {
  return binding.id === databaseIdValue || binding.name === databaseName || binding.resolvedName === databaseName;
}

function envValue(config, key) {
  const value = config?.env_vars?.[key];
  if (value && typeof value === "object") return String(value.value ?? "");
  return String(value ?? "");
}

async function d1Query(databaseIdValue, sql) {
  if (!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) fail("Refusing non-read-only D1 query in activation audit.");
  const result = await cloudflare("d1-database-query", `/d1/database/${encodeURIComponent(databaseIdValue)}/query`, {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
  if (!success(result)) {
    printCloudflareDiagnostic("d1_database_query", result);
    throw new Error("Read-only replacement D1 query failed.");
  }
  const payload = Array.isArray(result.parsed?.result) ? result.parsed.result : [result.parsed?.result];
  return payload.flatMap((item) => item?.results ?? []);
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (!response.ok) fail(`GitHub active-run check failed with HTTP ${response.status}.`);
  return parsed;
}

async function activePreviewRuns() {
  const runs = [];
  for (const status of ["queued", "in_progress"]) {
    const parsed = await github(`/actions/runs?status=${status}&per_page=100`);
    for (const run of parsed.workflow_runs ?? []) {
      if (String(run.id ?? "") === String(process.env.GITHUB_RUN_ID ?? "")) continue;
      const name = String(run.name ?? "");
      if (name === "DZN Owner Console Preview" || name === "DZN Discord Server Announcements Preview" || /Preview/i.test(name)) {
        const serialized = JSON.stringify({
          name,
          display_title: run.display_title,
          head_branch: run.head_branch,
          path: run.path,
          event: run.event,
        });
        runs.push({
          name,
          status: run.status,
          branch: run.head_branch,
          url: run.html_url,
          created_at: run.created_at,
          usesOld: serialized.includes(oldName),
          databaseUnknown: !serialized.includes(oldName) && !serialized.includes(replacementName),
        });
      }
    }
  }
  return runs;
}

async function auditReplacementSchema(replacementId) {
  const localMigrations = fs.readdirSync("runtime-main/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const requiredTables = [
    "sessions",
    "users",
    "linked_servers",
    "discord_guilds",
    "server_subscriptions",
    "competitive_events",
    "discord_announcement_posts",
  ];
  const requiredColumns = [
    "id",
    "server_id",
    "event_type",
    "channel_id",
    "message_id",
    "thread_id",
    "dedupe_key",
    "status",
    "failure_reason",
    "created_at",
    "updated_at",
  ];
  const requiredIndexes = [
    "idx_discord_announcement_posts_server_event_created",
    "idx_discord_announcement_posts_event_status_created",
    "idx_discord_announcement_posts_status_updated",
  ];
  const blocked = [];
  const migrations = (await d1Query(replacementId, "SELECT name FROM d1_migrations ORDER BY id;")).map((row) => String(row.name ?? "")).filter(Boolean);
  const pending = localMigrations.filter((name) => !migrations.includes(name));
  if (pending.length > 0) blocked.push(`required migrations pending: ${pending.join(", ")}`);
  if (!migrations.includes("0056_discord_server_announcements.sql")) blocked.push("migration 0056 is not applied");
  const tableRows = await d1Query(replacementId, `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables.map((name) => `'${name}'`).join(", ")});`);
  const tables = new Set(tableRows.map((row) => String(row.name ?? "")));
  const missingTables = requiredTables.filter((name) => !tables.has(name));
  if (missingTables.length > 0) blocked.push(`missing required tables: ${missingTables.join(", ")}`);
  const columnRows = await d1Query(replacementId, "PRAGMA table_info(discord_announcement_posts);");
  const columns = new Set(columnRows.map((row) => String(row.name ?? "")));
  const missingColumns = requiredColumns.filter((name) => !columns.has(name));
  if (missingColumns.length > 0) blocked.push(`discord_announcement_posts missing columns: ${missingColumns.join(", ")}`);
  const indexRows = await d1Query(replacementId, "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_discord_announcement_posts_%' ORDER BY name;");
  const indexes = indexRows.map((row) => String(row.name ?? "")).filter(Boolean);
  const missingIndexes = requiredIndexes.filter((name) => !indexes.includes(name));
  if (missingIndexes.length > 0) blocked.push(`discord_announcement_posts missing indexes: ${missingIndexes.join(", ")}`);
  const rowCountRows = await d1Query(replacementId, "SELECT COUNT(*) AS row_count FROM discord_announcement_posts;");
  const rowCount = Number(rowCountRows[0]?.row_count ?? NaN);
  if (!Number.isFinite(rowCount)) blocked.push("discord_announcement_posts row count could not be read");
  if (Number.isFinite(rowCount) && rowCount !== 0) blocked.push(`discord_announcement_posts row count is ${rowCount}, expected 0`);
  const foreignKeyRows = await d1Query(replacementId, "PRAGMA foreign_key_check;");
  if (foreignKeyRows.length > 0) blocked.push(`foreign_key_check returned ${foreignKeyRows.length} rows`);
  return { blocked, migrations, pending, tables: [...tables], columns: [...columns], indexes, rowCount, foreignKeyRows };
}

void (async () => {
  if (projectName !== "dzn-network-discord-announcements-preview") fail("Activation preview project constant mismatch.");
  if (projectName === productionPagesProject) fail("Refusing activation against production Pages project.");
  if (oldName === productionName || replacementName === productionName) fail("Refusing activation against production D1 name.");
  const verify = await cloudflare("token-verify", "/user/tokens/verify", {}, false);
  if (!success(verify)) {
    printCloudflareDiagnostic("token_verify", verify);
    fail("Cloudflare preview token failed verification.");
  }
  const d1List = await listPaginated("d1-database-list", "/d1/database", ["databases"]);
  if (!d1List.ok) {
    printCloudflareDiagnostic("d1_database_list", d1List.result);
    fail("Could not list D1 databases before activation.");
  }
  const databases = d1List.items;
  const databasesById = new Map(databases.map((database) => [databaseId(database), String(database?.name ?? "unnamed")]));
  const oldDatabase = databases.find((database) => database?.name === oldName);
  const replacementDatabase = databases.find((database) => database?.name === replacementName);
  if (!oldDatabase) fail("Former stale preview D1 was not found.");
  if (!replacementDatabase) fail("Replacement preview D1 was not found.");
  const oldId = databaseId(oldDatabase);
  const replacementId = databaseId(replacementDatabase);
  const oldMask = maskId(oldId);
  const replacementMask = maskId(replacementId);
  if (oldMask !== oldExpectedMask) fail(`Old preview D1 masked ID changed; expected ${oldExpectedMask}, got ${oldMask}.`);
  if (oldId === productionId || replacementId === productionId) fail("Production D1 ID detected in activation path.");

  const projectDetail = await cloudflare("pages-project-detail", `/pages/projects/${encodeURIComponent(projectName)}`);
  if (!success(projectDetail)) {
    printCloudflareDiagnostic("pages_project_detail", projectDetail);
    fail("Could not read Discord preview Pages project before activation.");
  }
  const project = projectDetail.parsed?.result;
  if (project?.name !== projectName) fail("Resolved Pages project name mismatch.");
  if (projectName === productionPagesProject) fail("Resolved Pages project is production.");
  const productionBranch = String(project?.production_branch ?? "");
  if (!productionBranch) fail("Discord preview Pages project production_branch is not configured.");
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    if (envValue(config, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED") !== "false") fail(`Server announcements flag is not false in ${environment}.`);
    if (envValue(config, "DZN_DISCORD_NOTIFICATIONS_ENABLED") !== "false") fail(`Discord notifications flag is not false in ${environment}.`);
    const db = config?.d1_databases?.DB;
    const dbId = String(db?.id ?? db?.database_id ?? db ?? "");
    if (dbId !== replacementId) fail(`${environment} DB binding does not point to replacement preview D1.`);
  }

  const pagesProjects = await listPagesProjects();
  if (!pagesProjects.ok) {
    printCloudflareDiagnostic("pages_project_list", pagesProjects.result);
    fail("Could not complete Pages inventory before activation.");
  }
  const pagesBindings = [];
  for (const item of pagesProjects.items) {
    const name = item?.name;
    if (!name) continue;
    const detail = await cloudflare("pages-project-detail", `/pages/projects/${encodeURIComponent(name)}`);
    if (!success(detail)) {
      printCloudflareDiagnostic(`pages_project_detail:${name}`, detail);
      fail("Could not complete Pages binding audit before activation.");
    }
    const fullProject = detail.parsed?.result ?? item;
    for (const binding of extractPagesD1Bindings(fullProject)) {
      pagesBindings.push({ ...binding, resolvedName: binding.name || databasesById.get(binding.id) || "unknown" });
    }
  }
  const oldPagesBindings = pagesBindings.filter((binding) => bindingMatchesDatabase(binding, oldName, oldId));
  const replacementPagesBindings = pagesBindings.filter((binding) => bindingMatchesDatabase(binding, replacementName, replacementId));
  if (oldPagesBindings.length !== 0) fail(`Old preview D1 still has ${oldPagesBindings.length} Pages project-configuration bindings.`);
  if (replacementPagesBindings.filter((binding) => binding.project === projectName && binding.binding === "DB").length !== 2) {
    fail("Replacement preview D1 does not have exactly two DB bindings on the Discord preview Pages project.");
  }
  if (replacementPagesBindings.some((binding) => binding.project === productionPagesProject)) {
    fail("Replacement preview D1 is bound to the real production Pages project.");
  }

  const workerAudit = await auditWorkerBindings(databasesById);
  if (!workerAudit.complete) fail("Worker binding audit incomplete before activation.");
  const oldWorkerBindings = workerAudit.deployed.filter((binding) => bindingMatchesDatabase(binding, oldName, oldId));
  const replacementWorkerBindings = workerAudit.deployed.filter((binding) => bindingMatchesDatabase(binding, replacementName, replacementId));
  if (oldWorkerBindings.length > 0) fail("Old preview D1 has deployed Worker bindings before activation.");
  if (replacementWorkerBindings.length > 0) fail("Replacement preview D1 has deployed Worker bindings.");
  const activeRuns = await activePreviewRuns();
  const activeOldRuns = activeRuns.filter((run) => run.usesOld);
  const uncertainRuns = activeRuns.filter((run) => run.databaseUnknown);
  if (activeOldRuns.length > 0) fail("Active preview workflow is using the old stale preview D1.");
  if (uncertainRuns.length > 0) fail("Active preview workflow database use is uncertain.");

  const schema = await auditReplacementSchema(replacementId);
  if (schema.blocked.length > 0) fail(`Replacement preview D1 schema is not activation-ready: ${schema.blocked.join("; ")}.`);

  fs.appendFileSync(process.env.GITHUB_ENV, `ACTIVATE_REPLACEMENT_D1_DATABASE_ID=${replacementId}\n`);
  fs.appendFileSync(process.env.GITHUB_ENV, `ACTIVATE_PREVIEW_PROJECT_BRANCH=${productionBranch}\n`);
  fs.appendFileSync(process.env.GITHUB_ENV, `ACTIVATE_STABLE_URL=https://${projectName}.pages.dev\n`);
  console.log(`Activation preflight project: ${projectName}`);
  console.log(`Activation preview project branch: ${productionBranch}`);
  console.log(`Former preview D1: ${oldName} id=${oldMask}`);
  console.log(`Replacement preview D1: ${replacementName} id=${replacementMask}`);
  console.log(`Replacement migrations applied: ${schema.migrations.length}`);
  console.log(`Replacement pending migrations: ${schema.pending.length}`);
  console.log(`Replacement discord_announcement_posts row count: ${schema.rowCount}`);
  console.log(`Replacement foreign_key_check rows: ${schema.foreignKeyRows.length}`);
  appendSummary([
    "",
    "## Rebound Discord Preview Activation Preflight",
    "",
    `- Preview Pages project: ${projectName}`,
    `- Preview project production branch: ${productionBranch}`,
    `- Runtime source SHA: ${process.env.APPROVED_MAIN_RUNTIME_SHA}`,
    `- Replacement D1: ${replacementName}`,
    `- Replacement D1 ID: ${replacementMask}`,
    `- Old D1 project-config bindings: ${oldPagesBindings.length}`,
    `- Replacement D1 project-config bindings: ${replacementPagesBindings.length}`,
    `- Replacement migration 0056 applied: ${schema.migrations.includes("0056_discord_server_announcements.sql") ? "yes" : "no"}`,
    `- Replacement announcement row count: ${schema.rowCount}`,
    "- Discord flags false before deploy: yes",
    "- Activation preflight status: passed",
  ]);
})().catch((error) => fail(error instanceof Error ? error.message : String(error)));
NODE
