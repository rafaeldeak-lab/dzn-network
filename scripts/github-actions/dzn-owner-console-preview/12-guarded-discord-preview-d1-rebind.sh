set -euo pipefail

if [ "${CONFIRM_PREVIEW_D1_REBIND}" != "APPROVE_PREVIEW_D1_REBIND" ]; then
  echo "::error::confirm_preview_d1_rebind must equal APPROVE_PREVIEW_D1_REBIND."
  exit 1
fi
case "${REBIND_ACTION}" in
  dry-run|apply) ;;
  *)
    echo "::error::rebind_action must be dry-run or apply."
    exit 1
    ;;
esac

node <<'NODE'
const fs = require("node:fs");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const githubToken = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const rebindAction = process.env.REBIND_ACTION || "dry-run";
const fixedProject = process.env.REBIND_PREVIEW_PROJECT_NAME;
const oldName = process.env.REBIND_OLD_PREVIEW_DB_NAME;
const expectedOldMask = process.env.REBIND_OLD_PREVIEW_DB_ID_MASK;
const replacementName = process.env.REBIND_REPLACEMENT_PREVIEW_DB_NAME;
const productionName = process.env.DETECTED_PRODUCTION_D1_DATABASE_NAME || process.env.PRODUCTION_D1_DATABASE_NAME;
const productionId = process.env.DETECTED_PRODUCTION_D1_DATABASE_ID || "";
const productionPagesProject = process.env.PRODUCTION_PAGES_PROJECT_NAME;
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const currentRunId = String(process.env.GITHUB_RUN_ID ?? "");
const tokenSources = [
  { name: "CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN", token: process.env.CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN || "" },
  { name: "CLOUDFLARE_PULSE_PREVIEW_TOKEN", token: process.env.CLOUDFLARE_PULSE_PREVIEW_TOKEN || "" },
  { name: "CLOUDFLARE_API_TOKEN", token: process.env.CLOUDFLARE_API_TOKEN || "" },
].filter((source) => source.token.length > 20);

function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}

function sanitize(value) {
  let text = String(value ?? "");
  for (const sensitive of [accountId, productionId]) {
    if (sensitive) text = text.split(sensitive).join("[redacted-id]");
  }
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted-token]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\b[0-9a-f]{32}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]")
    .replace(/(authorization|cookie|session|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
  return text.slice(0, 1000);
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

function firstCloudflareError(parsed) {
  const first = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
  return {
    code: first?.code ?? "unknown",
    message: sanitize(first?.message ?? "unknown"),
  };
}

function success(result) {
  return Boolean(result?.ok && result?.parsed?.success !== false);
}

async function cloudflare(source, endpointCategory, apiPath, init = {}, accountScoped = true) {
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

function printCloudflareDiagnostic(code, operationName, result, tokenSourceName) {
  const error = firstCloudflareError(result?.parsed);
  console.log(`${code}: operation=${operationName}`);
  console.log(`  endpoint_category=${result?.endpointCategory ?? "unknown"}`);
  console.log(`  http_status=${result?.status ?? "unavailable"}`);
  console.log(`  cloudflare_success=${String(result?.parsed?.success === true)}`);
  console.log(`  cloudflare_error_code=${sanitize(error.code)}`);
  console.log(`  sanitized_error=${error.message}`);
  console.log(`  token_source=${tokenSourceName}`);
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

async function listPaginated(source, endpointCategory, basePath, keys) {
  const items = [];
  const perPage = 50;
  let lastResult = null;
  for (let page = 1; page <= 50; page += 1) {
    const result = await cloudflare(source, endpointCategory, `${basePath}?per_page=${perPage}&page=${page}`);
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

async function listPagesProjects(source) {
  const items = [];
  const first = await cloudflare(source, "pages-project-list", "/pages/projects");
  if (!success(first)) return { ok: false, items, result: first };
  items.push(...itemsFromResult(first.parsed, ["projects"]));
  const info = resultInfo(first.parsed);
  const currentPage = Number(info.page ?? 1);
  const totalPages = Number(info.total_pages ?? 1);
  const returnedPerPage = Number(info.per_page ?? 0);
  const safePerPage = returnedPerPage > 0 && returnedPerPage <= 20 ? returnedPerPage : 20;
  for (let page = currentPage + 1; page <= totalPages && page <= 50; page += 1) {
    const result = await cloudflare(source, "pages-project-list", `/pages/projects?page=${page}&per_page=${safePerPage}`);
    if (!success(result)) return { ok: false, items, result };
    items.push(...itemsFromResult(result.parsed, ["projects"]));
  }
  return { ok: true, items, result: first };
}

async function testTokenSource(source) {
  const capability = { source, verify: false, d1Read: false, pagesList: false, pagesDetail: false, workerBindingRead: false, failures: [] };
  const verify = await cloudflare(source, "token-verify", "/user/tokens/verify", {}, false);
  capability.verify = success(verify);
  if (!capability.verify) {
    capability.failures.push(["token_verify", verify]);
    return capability;
  }
  const d1 = await cloudflare(source, "d1-database-list", "/d1/database?per_page=50&page=1");
  capability.d1Read = success(d1);
  if (!capability.d1Read) capability.failures.push(["d1_database_list", d1]);
  const pages = await cloudflare(source, "pages-project-list", "/pages/projects");
  capability.pagesList = success(pages);
  if (!capability.pagesList) {
    capability.failures.push(["pages_project_list", pages]);
  } else {
    const projects = itemsFromResult(pages.parsed, ["projects"]);
    const projectName = projects.find((project) => project?.name)?.name;
    const detail = projectName
      ? await cloudflare(source, "pages-project-detail", `/pages/projects/${encodeURIComponent(projectName)}`)
      : { ok: true, parsed: { success: true }, status: 200, endpointCategory: "pages-project-detail", contentType: "none", bodyLength: 0 };
    capability.pagesDetail = success(detail);
    if (!capability.pagesDetail) capability.failures.push(["pages_project_detail", detail]);
  }
  const workers = await cloudflare(source, "worker-script-list", "/workers/scripts?per_page=50&page=1");
  if (!success(workers)) {
    capability.failures.push(["worker_script_list", workers]);
  } else {
    const scripts = itemsFromResult(workers.parsed, ["scripts"]);
    const scriptName = scripts.find((script) => script?.id || script?.name)?.id ?? scripts.find((script) => script?.name)?.name;
    const settings = scriptName
      ? await cloudflare(source, "worker-script-settings", `/workers/scripts/${encodeURIComponent(scriptName)}/settings`)
      : { ok: true, parsed: { success: true }, status: 200, endpointCategory: "worker-script-settings", contentType: "none", bodyLength: 0 };
    capability.workerBindingRead = success(settings);
    if (!capability.workerBindingRead) capability.failures.push(["worker_script_settings", settings]);
  }
  return capability;
}

async function selectRebindToken() {
  if (tokenSources.length === 0) fail("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE: no Cloudflare token sources are configured for rebind mode.");
  const capabilities = [];
  for (const source of tokenSources) capabilities.push(await testTokenSource(source));
  console.log("Cloudflare preview D1 rebind token capability matrix");
  console.log("token source | verify | D1 read | Pages list | Pages detail | Worker binding read");
  for (const capability of capabilities) {
    console.log(`${capability.source.name} | ${capability.verify ? "yes" : "no"} | ${capability.d1Read ? "yes" : "no"} | ${capability.pagesList ? "yes" : "no"} | ${capability.pagesDetail ? "yes" : "no"} | ${capability.workerBindingRead ? "yes" : "no"}`);
    for (const [operation, result] of capability.failures) {
      printCloudflareDiagnostic("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE", operation, result, capability.source.name);
    }
  }
  const selected = capabilities.find((capability) => capability.verify && capability.d1Read && capability.pagesList && capability.pagesDetail && capability.workerBindingRead);
  if (!selected) fail("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE: no existing token has D1 read, Pages list/detail read, and Worker binding read.");
  console.log(`Selected rebind token source: ${selected.source.name}`);
  return selected.source;
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

async function auditPagesBindings(source, databasesById) {
  const projectsResult = await listPagesProjects(source);
  const bindings = [];
  const projects = [];
  const incomplete = [];
  if (!projectsResult.ok) {
    printCloudflareDiagnostic("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE", "pages_project_list", projectsResult.result, source.name);
    return { complete: false, projects, bindings, incomplete: ["pages_project_list"] };
  }
  for (const project of projectsResult.items) {
    const projectName = project?.name;
    if (!projectName) continue;
    const detail = await cloudflare(source, "pages-project-detail", `/pages/projects/${encodeURIComponent(projectName)}`);
    if (!success(detail)) {
      printCloudflareDiagnostic("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE", `pages_project_detail:${projectName}`, detail, source.name);
      incomplete.push(`pages_project_detail:${projectName}`);
      continue;
    }
    const fullProject = detail.parsed?.result ?? project;
    projects.push(fullProject);
    for (const binding of extractPagesD1Bindings(fullProject)) {
      const resolvedName = binding.name || databasesById.get(binding.id) || "unknown";
      bindings.push({ ...binding, resolvedName });
    }
  }
  return { complete: incomplete.length === 0, projects, bindings, incomplete };
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

function repositoryWranglerBindings() {
  const bindings = [];
  const files = fs.readdirSync(".").filter((name) => /^wrangler.*\.toml$/.test(name));
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/database_name\s*=\s*"([^"]+)"/g)) {
      bindings.push({ source: "repository-wrangler", project: file, environment: "config", binding: "database_name", id: "", name: match[1] });
    }
    for (const match of text.matchAll(/database_id\s*=\s*"([^"]+)"/g)) {
      bindings.push({ source: "repository-wrangler", project: file, environment: "config", binding: "database_id", id: match[1], name: "" });
    }
  }
  return bindings;
}

async function auditWorkerBindings(source, databasesById) {
  const deployed = [];
  const incomplete = [];
  const scriptsResult = await listPaginated(source, "worker-script-list", "/workers/scripts", ["scripts"]);
  if (!scriptsResult.ok) {
    printCloudflareDiagnostic("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE", "worker_script_list", scriptsResult.result, source.name);
    return { complete: false, deployed, repository: repositoryWranglerBindings(), incomplete: ["worker_script_list"] };
  }
  for (const script of scriptsResult.items) {
    const scriptName = script?.id ?? script?.name;
    if (!scriptName) continue;
    const settings = await cloudflare(source, "worker-script-settings", `/workers/scripts/${encodeURIComponent(scriptName)}/settings`);
    if (!success(settings)) {
      printCloudflareDiagnostic("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE", `worker_script_settings:${scriptName}`, settings, source.name);
      incomplete.push(`worker_script_settings:${scriptName}`);
      continue;
    }
    const bindings = extractWorkerBindingsFromValue(settings.parsed?.result ?? {}, { source: "worker", project: scriptName, environment: "deployed" });
    for (const binding of bindings) deployed.push({ ...binding, resolvedName: binding.name || databasesById.get(binding.id) || "unknown" });
  }
  const repository = repositoryWranglerBindings().map((binding) => ({
    ...binding,
    resolvedName: binding.name || databasesById.get(binding.id) || "unknown",
  }));
  return { complete: incomplete.length === 0, deployed, repository, incomplete };
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
  const statuses = ["queued", "in_progress"];
  const runs = [];
  for (const status of statuses) {
    const parsed = await github(`/actions/runs?status=${status}&per_page=100`);
    for (const run of parsed.workflow_runs ?? []) {
      if (String(run.id ?? "") === currentRunId) continue;
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
          event: run.event,
          branch: run.head_branch,
          url: run.html_url,
          created_at: run.created_at,
          usesOld: serialized.includes(oldName),
          usesReplacement: serialized.includes(replacementName),
          databaseUnknown: !serialized.includes(oldName) && !serialized.includes(replacementName),
        });
      }
    }
  }
  return runs;
}

function bindingMatchesDatabase(binding, databaseName, databaseIdValue) {
  return binding.id === databaseIdValue || binding.name === databaseName || binding.resolvedName === databaseName;
}

function bindingLabel(binding) {
  const id = binding.id ? maskId(binding.id) : "unavailable";
  return `source=${binding.source} project=${binding.project} environment=${binding.environment} binding=${binding.binding} database=${binding.resolvedName || binding.name || "unknown"} id=${id}`;
}

async function d1Query(source, databaseIdValue, sql) {
  if (!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) fail("Refusing non-read-only D1 query in rebind audit.");
  const result = await cloudflare(source, "d1-database-query", `/d1/database/${encodeURIComponent(databaseIdValue)}/query`, {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
  if (!success(result)) {
    printCloudflareDiagnostic("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE", "d1_database_query", result, source.name);
    throw new Error("Read-only replacement D1 schema query failed.");
  }
  const payload = Array.isArray(result.parsed?.result) ? result.parsed.result : [result.parsed?.result];
  return payload.flatMap((item) => item?.results ?? []);
}

async function auditReplacementSchema(source, replacementId) {
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
  let migrations = [];
  try {
    migrations = (await d1Query(source, replacementId, "SELECT name FROM d1_migrations ORDER BY id;")).map((row) => String(row.name ?? "")).filter(Boolean);
  } catch (error) {
    blocked.push("d1_migrations table could not be queried");
  }
  const migration0056Applied = migrations.includes("0056_discord_server_announcements.sql");
  if (!migration0056Applied) blocked.push("migration 0056 is not applied");

  const tableRows = await d1Query(source, replacementId, "PRAGMA table_info(discord_announcement_posts);");
  const columns = new Set(tableRows.map((row) => String(row.name ?? "")).filter(Boolean));
  const missingColumns = requiredColumns.filter((column) => !columns.has(column));
  if (missingColumns.length > 0) blocked.push(`discord_announcement_posts missing columns: ${missingColumns.join(", ")}`);

  let indexes = [];
  let rowCount = null;
  if (missingColumns.length === 0) {
    indexes = (await d1Query(source, replacementId, "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_discord_announcement_posts_%' ORDER BY name;")).map((row) => String(row.name ?? "")).filter(Boolean);
    const missingIndexes = requiredIndexes.filter((indexName) => !indexes.includes(indexName));
    if (missingIndexes.length > 0) blocked.push(`discord_announcement_posts missing indexes: ${missingIndexes.join(", ")}`);
    const rowCountRows = await d1Query(source, replacementId, "SELECT COUNT(*) AS row_count FROM discord_announcement_posts;");
    rowCount = Number(rowCountRows[0]?.row_count ?? NaN);
    if (!Number.isFinite(rowCount)) blocked.push("discord_announcement_posts row count could not be read");
    if (Number.isFinite(rowCount) && rowCount !== 0) blocked.push(`discord_announcement_posts row count is ${rowCount}, expected 0`);
  }
  const foreignKeyRows = await d1Query(source, replacementId, "PRAGMA foreign_key_check;");
  if (foreignKeyRows.length > 0) blocked.push(`foreign_key_check returned ${foreignKeyRows.length} rows`);
  return {
    healthy: blocked.length === 0,
    blocked,
    migrations,
    migration0056Applied,
    columns: [...columns],
    indexes,
    rowCount,
    foreignKeyRows,
    requiredIndexes,
  };
}

function envValue(config, key) {
  const value = config?.env_vars?.[key];
  if (value && typeof value === "object") return String(value.value ?? "");
  return String(value ?? "");
}

function assertDiscordFlagsFalse(project) {
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    if (envValue(config, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED") !== "false") {
      fail(`Discord server announcements flag is not false in ${fixedProject}/${environment}.`);
    }
    if (envValue(config, "DZN_DISCORD_NOTIFICATIONS_ENABLED") !== "false") {
      fail(`Discord notifications flag is not false in ${fixedProject}/${environment}.`);
    }
  }
}

function mergeD1BindingOnly(config, replacementId) {
  const currentD1 = config?.d1_databases && typeof config.d1_databases === "object" ? config.d1_databases : {};
  return {
    ...config,
    d1_databases: {
      ...currentD1,
      DB: { id: replacementId },
    },
  };
}

function projectD1Bindings(project) {
  return extractPagesD1Bindings(project).map((binding) => ({
    ...binding,
    resolvedName: binding.name,
  }));
}

void (async () => {
  if (rebindAction !== "dry-run" && rebindAction !== "apply") fail("rebind_action must be dry-run or apply.");
  if (fixedProject !== "dzn-network-discord-announcements-preview") fail("Rebind project constant mismatch.");
  if (oldName !== "dzn_network_db_discord_announcements_preview_alignment_ee8c812") fail("Old preview database constant mismatch.");
  if (replacementName !== "dzn_network_db_discord_announcements_preview") fail("Replacement preview database constant mismatch.");
  if (fixedProject === productionPagesProject) fail("Refusing to rebind production Pages project.");
  if (oldName === productionName || replacementName === productionName) fail("Refusing to rebind a production D1 database name.");

  const selectedSource = await selectRebindToken();
  const d1List = await listPaginated(selectedSource, "d1-database-list", "/d1/database", ["databases"]);
  if (!d1List.ok) {
    printCloudflareDiagnostic("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE", "d1_database_list", d1List.result, selectedSource.name);
    fail("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE: could not list D1 databases before rebind.");
  }
  const databases = d1List.items;
  const databasesById = new Map(databases.map((database) => [databaseId(database), String(database?.name ?? "unnamed")]));
  const oldDatabase = databases.find((database) => database?.name === oldName);
  const replacementDatabase = databases.find((database) => database?.name === replacementName);
  if (!oldDatabase) fail("BLOCKED FOR PREVIEW D1 REBIND: old stale preview database no longer exists.");
  if (!replacementDatabase) fail("BLOCKED FOR PREVIEW D1 REBIND: replacement preview database does not exist.");
  const oldId = databaseId(oldDatabase);
  const replacementId = databaseId(replacementDatabase);
  const oldMask = maskId(oldId);
  const replacementMask = maskId(replacementId);
  if (oldMask !== expectedOldMask) fail(`BLOCKED FOR PREVIEW D1 REBIND: old database masked ID changed; expected ${expectedOldMask}, got ${oldMask}.`);
  if (oldId === productionId || replacementId === productionId) fail("BLOCKED FOR PREVIEW D1 REBIND: production D1 ID detected.");

  const pagesAudit = await auditPagesBindings(selectedSource, databasesById);
  const workerAudit = await auditWorkerBindings(selectedSource, databasesById);
  const fixedProjectRecord = pagesAudit.projects.find((project) => project?.name === fixedProject);
  if (!fixedProjectRecord) fail("BLOCKED FOR PREVIEW D1 REBIND: fixed preview Pages project was not found.");
  assertDiscordFlagsFalse(fixedProjectRecord);

  const oldPagesBindings = pagesAudit.bindings.filter((binding) => bindingMatchesDatabase(binding, oldName, oldId));
  const replacementPagesBindings = pagesAudit.bindings.filter((binding) => bindingMatchesDatabase(binding, replacementName, replacementId));
  const oldWorkerBindings = workerAudit.deployed.filter((binding) => bindingMatchesDatabase(binding, oldName, oldId));
  const replacementWorkerBindings = workerAudit.deployed.filter((binding) => bindingMatchesDatabase(binding, replacementName, replacementId));
  const oldRepositoryBindings = workerAudit.repository.filter((binding) => bindingMatchesDatabase(binding, oldName, oldId));
  const replacementRepositoryBindings = workerAudit.repository.filter((binding) => bindingMatchesDatabase(binding, replacementName, replacementId));
  const activeRuns = await activePreviewRuns();
  const activeOldRuns = activeRuns.filter((run) => run.usesOld);
  const activeReplacementRuns = activeRuns.filter((run) => run.usesReplacement);
  const uncertainActiveRuns = activeRuns.filter((run) => run.databaseUnknown);
  const schema = await auditReplacementSchema(selectedSource, replacementId);

  const oldProductionBinding = oldPagesBindings.find((binding) => binding.project === fixedProject && binding.environment === "production" && binding.binding === "DB");
  const oldPreviewBinding = oldPagesBindings.find((binding) => binding.project === fixedProject && binding.environment === "preview" && binding.binding === "DB");
  const blockedReasons = [];
  if (!pagesAudit.complete) blockedReasons.push("Pages binding audit incomplete");
  if (!workerAudit.complete) blockedReasons.push("Worker binding audit incomplete");
  if (oldPagesBindings.length !== 2) blockedReasons.push(`old database Pages binding count is ${oldPagesBindings.length}, expected 2`);
  if (!oldProductionBinding) blockedReasons.push("old database production environment DB binding missing on preview project");
  if (!oldPreviewBinding) blockedReasons.push("old database preview environment DB binding missing on preview project");
  if (oldPagesBindings.some((binding) => binding.project !== fixedProject)) blockedReasons.push("old database is bound outside the fixed preview project");
  if (oldPagesBindings.some((binding) => binding.project === productionPagesProject)) blockedReasons.push("old database is bound to real production Pages project");
  if (replacementPagesBindings.some((binding) => binding.project === productionPagesProject)) blockedReasons.push("replacement database is bound to real production Pages project");
  if (replacementPagesBindings.length > 0) blockedReasons.push(`replacement database already has ${replacementPagesBindings.length} Pages bindings`);
  if (oldWorkerBindings.length > 0) blockedReasons.push("old database has deployed Worker bindings");
  if (replacementWorkerBindings.length > 0) blockedReasons.push("replacement database has deployed Worker bindings");
  if (oldRepositoryBindings.length > 0) blockedReasons.push("old database has repository Wrangler references");
  if (replacementRepositoryBindings.length > 0) blockedReasons.push("replacement database has repository Wrangler references");
  if (activeOldRuns.length > 0) blockedReasons.push("active workflow uses old database");
  if (activeReplacementRuns.length > 0) blockedReasons.push("active workflow uses replacement database");
  if (uncertainActiveRuns.length > 0) blockedReasons.push("active preview workflow database use is uncertain");
  if (!schema.healthy) blockedReasons.push(...schema.blocked);

  console.log(`Preview D1 rebind action: ${rebindAction}`);
  console.log(`Preview D1 rebind project: ${fixedProject}`);
  console.log(`Old preview D1: ${oldName} id=${oldMask}`);
  console.log(`Replacement preview D1: ${replacementName} id=${replacementMask}`);
  console.log(`Pages deployment required after config patch: yes`);
  console.log(`Old database Pages bindings: ${oldPagesBindings.length}`);
  for (const binding of oldPagesBindings) console.log(`Old database Pages binding: ${bindingLabel(binding)}`);
  console.log(`Replacement database Pages bindings: ${replacementPagesBindings.length}`);
  for (const binding of replacementPagesBindings) console.log(`Replacement database Pages binding: ${bindingLabel(binding)}`);
  console.log(`Old database Worker bindings: ${oldWorkerBindings.length}`);
  console.log(`Replacement database Worker bindings: ${replacementWorkerBindings.length}`);
  console.log(`Old database repository Wrangler references: ${oldRepositoryBindings.length}`);
  console.log(`Replacement database repository Wrangler references: ${replacementRepositoryBindings.length}`);
  console.log(`Active preview runs definitely using old database: ${activeOldRuns.length}`);
  console.log(`Active preview runs definitely using replacement database: ${activeReplacementRuns.length}`);
  console.log(`Active preview runs with unknown database: ${uncertainActiveRuns.length}`);
  console.log(`Replacement migration 0056 applied: ${schema.migration0056Applied ? "yes" : "no"}`);
  console.log(`Replacement discord_announcement_posts columns: ${schema.columns.join(", ") || "none"}`);
  console.log(`Replacement required indexes: ${schema.requiredIndexes.join(", ")}`);
  console.log(`Replacement indexes present: ${schema.indexes.join(", ") || "none"}`);
  console.log(`Replacement discord_announcement_posts row count: ${schema.rowCount ?? "unavailable"}`);
  console.log(`Replacement foreign_key_check rows: ${schema.foreignKeyRows.length}`);

  const rebindStatus = blockedReasons.length > 0
    ? `BLOCKED FOR PREVIEW D1 REBIND: ${blockedReasons.join("; ")}`
    : "ELIGIBLE FOR EXPLICIT PREVIEW D1 REBIND APPROVAL";
  console.log(rebindStatus);
  appendSummary([
    "## Preview D1 Rebind",
    "",
    `- Preview Pages project: ${fixedProject}`,
    `- Rebind action: ${rebindAction}`,
    `- Old database: ${oldName}`,
    `- Old database ID: ${oldMask}`,
    `- Replacement database: ${replacementName}`,
    `- Replacement database ID: ${replacementMask}`,
    `- Old production config DB binding: ${oldProductionBinding ? "verified" : "missing"}`,
    `- Old preview config DB binding: ${oldPreviewBinding ? "verified" : "missing"}`,
    `- Replacement migration 0056 applied: ${schema.migration0056Applied ? "yes" : "no"}`,
    `- Replacement announcement row count: ${schema.rowCount ?? "unavailable"}`,
    `- Pages deployment required after config patch: yes`,
    `- Worker audit complete: ${workerAudit.complete ? "yes" : "no"}`,
    `- Active preview runs using old/replacement: ${activeOldRuns.length + activeReplacementRuns.length}`,
    `- Rebind status: ${rebindStatus}`,
    "- Dry-run patches Pages: no",
    "- Dry-run creates/deletes D1: no",
    "- Dry-run deploys Pages: no",
    "- Discord messages sent: false",
  ]);

  if (rebindAction === "dry-run") {
    console.log("Preview D1 rebind dry-run completed. No Pages binding changed.");
    return;
  }

  if (blockedReasons.length > 0) fail(`PREVIEW_D1_REBIND_AUDIT_INCOMPLETE: apply blocked: ${blockedReasons.join("; ")}.`);
  const patchedProductionConfig = mergeD1BindingOnly(fixedProjectRecord.deployment_configs?.production ?? {}, replacementId);
  const patchedPreviewConfig = mergeD1BindingOnly(fixedProjectRecord.deployment_configs?.preview ?? {}, replacementId);
  const patchPayload = {
    deployment_configs: {
      production: patchedProductionConfig,
      preview: patchedPreviewConfig,
    },
  };
  console.log(`Applying preview-only Pages D1 rebind: project=${fixedProject} old=${oldMask} replacement=${replacementMask}`);
  const patchResult = await cloudflare(selectedSource, "pages-project-patch", `/pages/projects/${encodeURIComponent(fixedProject)}`, {
    method: "PATCH",
    body: JSON.stringify(patchPayload),
  });
  if (!success(patchResult)) {
    printCloudflareDiagnostic("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE", "pages_project_patch", patchResult, selectedSource.name);
    fail("Preview-only Pages D1 rebind patch failed.");
  }
  const afterDetail = await cloudflare(selectedSource, "pages-project-detail", `/pages/projects/${encodeURIComponent(fixedProject)}`);
  if (!success(afterDetail)) {
    printCloudflareDiagnostic("PREVIEW_D1_REBIND_AUDIT_INCOMPLETE", "pages_project_detail_after_rebind", afterDetail, selectedSource.name);
    fail("Could not verify preview Pages project after rebind.");
  }
  const afterProject = afterDetail.parsed?.result;
  const afterBindings = projectD1Bindings(afterProject);
  const afterOldBindings = afterBindings.filter((binding) => bindingMatchesDatabase({ ...binding, resolvedName: databasesById.get(binding.id) || binding.name }, oldName, oldId));
  const afterReplacementBindings = afterBindings.filter((binding) => bindingMatchesDatabase({ ...binding, resolvedName: databasesById.get(binding.id) || binding.name }, replacementName, replacementId));
  if (afterOldBindings.length !== 0) fail("Old stale preview D1 still has bindings on the preview project after rebind.");
  if (afterReplacementBindings.length !== 2) fail(`Replacement preview D1 should have 2 bindings after rebind, got ${afterReplacementBindings.length}.`);
  console.log("Preview-only Pages D1 rebind applied and verified. Pages deployment is still required for active runtime binding changes.");
  appendSummary(["", "- Rebind apply result: success", "- Active runtime deployment required: yes"]);
})().catch((error) => fail(error instanceof Error ? error.message : String(error)));
NODE
