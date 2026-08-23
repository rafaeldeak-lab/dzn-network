set -euo pipefail

if [ "${CONFIRM_PREVIEW_DB_CLEANUP}" != "APPROVE_STALE_PREVIEW_D1_CLEANUP" ]; then
  echo "::error::confirm_preview_db_cleanup must equal APPROVE_STALE_PREVIEW_D1_CLEANUP."
  exit 1
fi
if [ "${PREVIEW_DB_NAME_TO_DELETE}" = "${PRODUCTION_D1_DATABASE_NAME}" ]; then
  echo "::error::Refusing cleanup for production D1 database name."
  exit 1
fi
if [ "${PREVIEW_DB_NAME_TO_DELETE}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME}" ]; then
  echo "::error::Refusing cleanup for detected production D1 database name."
  exit 1
fi
case "${PREVIEW_DB_NAME_TO_DELETE}" in
  dzn_network_db_owner_console_preview_*|dzn_network_db_discord_announcements_preview_*|dzn_network_db_discord_control_preview|dzn_network_db_discord_phase_2a_preview|dzn_network_db_server_lifecycle_preview|dzn_network_db_server_advertising_preview|dzn_network_db_dzn_pulse_preview) ;;
  *)
    echo "::error::Refusing cleanup for database name without an approved DZN preview prefix."
    exit 1
    ;;
esac
case "${PREVIEW_DB_NAME_TO_DELETE}" in
  *"*"*|*"?"*|*"["*|*"]"*|*" "*|*,*)
    echo "::error::Refusing wildcard, pattern, list, or space-containing cleanup target."
    exit 1
    ;;
esac

git fetch origin "main:refs/remotes/origin/main" "${CANDIDATE_BRANCH}:refs/remotes/origin/${CANDIDATE_BRANCH}" --depth=1
CHECKED_OUT_HEAD="$(git rev-parse HEAD)"
REMOTE_FEATURE_HEAD="$(git rev-parse "origin/${CANDIDATE_BRANCH}")"
if [ "${CHECKED_OUT_HEAD}" != "${REMOTE_FEATURE_HEAD}" ]; then
  echo "::error::Checked-out cleanup branch is not the current remote feature branch head."
  exit 1
fi

node <<'NODE'
const fs = require("node:fs");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const githubToken = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const targetName = process.env.PREVIEW_DB_NAME_TO_DELETE;
const cleanupAction = process.env.CLEANUP_ACTION || "dry-run";
const reviewedMask = process.env.REVIEWED_PREVIEW_DB_ID_MASK || "";
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
  if (accountId) text = text.split(accountId).join("[redacted-account]");
  if (productionId) text = text.split(productionId).join("[redacted-id]");
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

function isApprovedPreviewName(name) {
  return /^dzn_network_db_owner_console_preview_/.test(name)
    || /^dzn_network_db_discord_announcements_preview_/.test(name)
    || name === "dzn_network_db_discord_announcements_preview"
    || name === "dzn_network_db_discord_control_preview"
    || name === "dzn_network_db_discord_phase_2a_preview"
    || name === "dzn_network_db_server_lifecycle_preview"
    || name === "dzn_network_db_server_advertising_preview"
    || name === "dzn_network_db_dzn_pulse_preview";
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

function classifyCloudflareFailure(operationName, result) {
  const error = firstCloudflareError(result?.parsed);
  if (result?.status === 400 && String(error.code) === "8000024") {
    return "PREVIEW_D1_API_REQUEST_INVALID";
  }
  if (operationName.startsWith("pages") && (result?.status === 401 || result?.status === 403)) {
    return "PREVIEW_D1_PAGES_PERMISSION_MISSING";
  }
  if (operationName.startsWith("pages")) {
    return "PREVIEW_D1_PAGES_INVENTORY_UNAVAILABLE";
  }
  if (operationName.startsWith("worker")) {
    return "PREVIEW_D1_WORKER_BINDING_AUDIT_UNAVAILABLE";
  }
  return "PREVIEW_D1_BINDING_AUDIT_INCOMPLETE";
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
  return {
    ok: response.ok,
    status: response.status,
    parsed,
    endpointCategory,
    contentType,
    bodyLength: text.length,
  };
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
  if (totalPages > currentPage) {
    for (let page = currentPage + 1; page <= totalPages && page <= 50; page += 1) {
      const result = await cloudflare(source, "pages-project-list", `/pages/projects?page=${page}&per_page=${safePerPage}`);
      if (!success(result)) return { ok: false, items, result };
      items.push(...itemsFromResult(result.parsed, ["projects"]));
    }
  }
  return { ok: true, items, result: first };
}

async function testTokenSource(source) {
  const capability = {
    source,
    verify: false,
    d1Read: false,
    pagesList: false,
    pagesDetail: false,
    workerBindingRead: false,
    d1DeleteEligible: source.name === "CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN",
    failures: [],
  };

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
    if (projects.length === 0) {
      capability.pagesDetail = true;
    } else {
      const projectName = projects.find((project) => project?.name)?.name;
      const detail = projectName
        ? await cloudflare(source, "pages-project-detail", `/pages/projects/${encodeURIComponent(projectName)}`)
        : { ok: true, parsed: { success: true }, status: 200, endpointCategory: "pages-project-detail", contentType: "none", bodyLength: 0 };
      capability.pagesDetail = success(detail);
      if (!capability.pagesDetail) capability.failures.push(["pages_project_detail", detail]);
    }
  }

  const workers = await cloudflare(source, "worker-script-list", "/workers/scripts?per_page=50&page=1");
  const workerListOk = success(workers);
  if (!workerListOk) {
    capability.failures.push(["worker_script_list", workers]);
  } else {
    const scripts = itemsFromResult(workers.parsed, ["scripts"]);
    if (scripts.length === 0) {
      capability.workerBindingRead = true;
    } else {
      const scriptName = scripts.find((script) => script?.id || script?.name)?.id ?? scripts.find((script) => script?.name)?.name;
      const settings = scriptName
        ? await cloudflare(source, "worker-script-settings", `/workers/scripts/${encodeURIComponent(scriptName)}/settings`)
        : { ok: true, parsed: { success: true }, status: 200, endpointCategory: "worker-script-settings", contentType: "none", bodyLength: 0 };
      capability.workerBindingRead = success(settings);
      if (!capability.workerBindingRead) capability.failures.push(["worker_script_settings", settings]);
    }
  }

  return capability;
}

async function selectCleanupToken() {
  if (tokenSources.length === 0) {
    fail("PREVIEW_D1_BINDING_AUDIT_INCOMPLETE: no Cloudflare token sources are configured for cleanup mode.");
  }
  const capabilities = [];
  for (const source of tokenSources) {
    capabilities.push(await testTokenSource(source));
  }
  console.log("Cloudflare cleanup token capability matrix");
  console.log("token source | verify | D1 read | Pages list | Pages detail | Worker binding read | D1 delete eligible source");
  const diagnosticCodes = new Set();
  for (const capability of capabilities) {
    console.log(`${capability.source.name} | ${capability.verify ? "yes" : "no"} | ${capability.d1Read ? "yes" : "no"} | ${capability.pagesList ? "yes" : "no"} | ${capability.pagesDetail ? "yes" : "no"} | ${capability.workerBindingRead ? "yes" : "no"} | ${capability.d1DeleteEligible ? "yes" : "no"}`);
    for (const [operation, result] of capability.failures) {
      const diagnosticCode = classifyCloudflareFailure(operation, result);
      diagnosticCodes.add(diagnosticCode);
      printCloudflareDiagnostic(diagnosticCode, operation, result, capability.source.name);
    }
  }
  const selected = capabilities.find((capability) => (
    capability.verify
    && capability.d1Read
    && capability.pagesList
    && capability.pagesDetail
    && capability.workerBindingRead
  ));
  if (!selected) {
    if (diagnosticCodes.has("PREVIEW_D1_API_REQUEST_INVALID")) {
      fail("PREVIEW_D1_API_REQUEST_INVALID: Cloudflare rejected a cleanup audit request as invalid. Fix the workflow request before changing token permissions.");
    }
    if (diagnosticCodes.has("PREVIEW_D1_PAGES_PERMISSION_MISSING")) {
      fail("PREVIEW_D1_PAGES_PERMISSION_MISSING: corrected Pages read request returned 401/403 for all existing token sources.");
    }
    fail("PREVIEW_D1_BINDING_AUDIT_INCOMPLETE: no existing Cloudflare token source has D1 read, Pages list/detail read, and Worker binding read. Configure CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN with the missing read capabilities before rerunning.");
  }
  if (cleanupAction === "delete" && !selected.d1DeleteEligible) {
    fail("PREVIEW_D1_BINDING_AUDIT_INCOMPLETE: delete mode requires CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN so D1 delete permission is explicit and reviewable.");
  }
  console.log(`Selected cleanup token source: ${selected.source.name}`);
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
      continue;
    }
    if (value && typeof value === "object") {
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
    printCloudflareDiagnostic(classifyCloudflareFailure("pages_project_list", projectsResult.result), "pages_project_list", projectsResult.result, source.name);
    return { complete: false, projects, bindings, incomplete: ["pages_project_list"] };
  }
  for (const project of projectsResult.items) {
    const projectName = project?.name;
    if (!projectName) continue;
    const detail = await cloudflare(source, "pages-project-detail", `/pages/projects/${encodeURIComponent(projectName)}`);
    if (!success(detail)) {
      printCloudflareDiagnostic(classifyCloudflareFailure("pages_project_detail", detail), `pages_project_detail:${projectName}`, detail, source.name);
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
    if (child && typeof child === "object") {
      extractWorkerBindingsFromValue(child, context, output, [...path, key]);
    }
  }
  return output;
}

function repositoryWranglerBindings() {
  const bindings = [];
  const files = fs.readdirSync(".").filter((name) => /^wrangler.*\.toml$/.test(name));
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const databaseNames = [...text.matchAll(/database_name\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
    const databaseIds = [...text.matchAll(/database_id\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
    for (const name of databaseNames) {
      bindings.push({ source: "repository-wrangler", project: file, environment: "config", binding: "database_name", id: "", name });
    }
    for (const id of databaseIds) {
      bindings.push({ source: "repository-wrangler", project: file, environment: "config", binding: "database_id", id, name: "" });
    }
  }
  return bindings;
}

async function auditWorkerBindings(source, databasesById) {
  const deployed = [];
  const incomplete = [];
  const scriptsResult = await listPaginated(source, "worker-script-list", "/workers/scripts", ["scripts"]);
  if (!scriptsResult.ok) {
    printCloudflareDiagnostic("PREVIEW_D1_WORKER_BINDING_AUDIT_UNAVAILABLE", "worker_script_list", scriptsResult.result, source.name);
    return {
      complete: false,
      deployed,
      repository: repositoryWranglerBindings(),
      incomplete: ["worker_script_list"],
    };
  }
  for (const script of scriptsResult.items) {
    const scriptName = script?.id ?? script?.name;
    if (!scriptName) continue;
    const settings = await cloudflare(source, "worker-script-settings", `/workers/scripts/${encodeURIComponent(scriptName)}/settings`);
    if (!success(settings)) {
      printCloudflareDiagnostic("PREVIEW_D1_WORKER_BINDING_AUDIT_UNAVAILABLE", `worker_script_settings:${scriptName}`, settings, source.name);
      incomplete.push(`worker_script_settings:${scriptName}`);
      continue;
    }
    const bindings = extractWorkerBindingsFromValue(settings.parsed?.result ?? {}, {
      source: "worker",
      project: scriptName,
      environment: "deployed",
    });
    for (const binding of bindings) {
      deployed.push({ ...binding, resolvedName: binding.name || databasesById.get(binding.id) || "unknown" });
    }
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
      if (
        name === "DZN Owner Console Preview"
        || name === "DZN Discord Server Announcements Preview"
        || name === "DZN Production Read-Only Diagnostics"
        || /Preview/i.test(name)
      ) {
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
          definitelyUsesTarget: serialized.includes(targetName),
          databaseUnknown: !serialized.includes(targetName),
        });
      }
    }
  }
  return runs;
}

function bindingMatchesTarget(binding, targetId) {
  return binding.id === targetId || binding.name === targetName || binding.resolvedName === targetName;
}

function bindingMatchesDatabase(binding, databaseName, databaseIdValue) {
  return binding.id === databaseIdValue || binding.name === databaseName || binding.resolvedName === databaseName;
}

function bindingLabel(binding) {
  const id = binding.id ? maskId(binding.id) : "unavailable";
  return `source=${binding.source} project=${binding.project} environment=${binding.environment} binding=${binding.binding} database=${binding.resolvedName || binding.name || "unknown"} id=${id}`;
}

void (async () => {
  if (cleanupAction !== "dry-run" && cleanupAction !== "delete") {
    fail("cleanup_action must be dry-run or delete.");
  }
  if (targetName === productionName) fail("Refusing to delete production D1 database by name.");
  if (!isApprovedPreviewName(targetName)) fail("Refusing cleanup for non-preview D1 database name.");

  const selectedSource = await selectCleanupToken();
  const d1List = await listPaginated(selectedSource, "d1-database-list", "/d1/database", ["databases"]);
  if (!d1List.ok) {
    printCloudflareDiagnostic("PREVIEW_D1_BINDING_AUDIT_INCOMPLETE", "d1_database_list", d1List.result, selectedSource.name);
    fail("PREVIEW_D1_BINDING_AUDIT_INCOMPLETE: could not list D1 databases before cleanup.");
  }
  const databases = d1List.items;
  const databasesById = new Map(databases.map((database) => [databaseId(database), String(database?.name ?? "unnamed")]));
  const pagesAudit = await auditPagesBindings(selectedSource, databasesById);
  const workerAudit = await auditWorkerBindings(selectedSource, databasesById);
  const allBindings = [...pagesAudit.bindings, ...workerAudit.deployed, ...workerAudit.repository];

  console.log(`D1 inventory count: ${databases.length}`);
  for (const database of databases) {
    const name = String(database?.name ?? "unnamed");
    const id = databaseId(database);
    const masked = maskId(id);
    const classification = name === productionName || id === productionId
      ? "production-protected"
      : isApprovedPreviewName(name)
        ? "preview-candidate"
        : "unknown-retain";
    const created = database?.created_at ?? database?.created_on ?? "unknown";
    const modified = database?.modified_at ?? database?.modified_on ?? "unknown";
    const bindings = allBindings
      .filter((binding) => bindingMatchesDatabase(binding, name, id))
      .map((binding) => `${binding.source}:${binding.project}/${binding.environment}/${binding.binding}`)
      .join(", ") || "none";
    console.log(`D1 inventory: name=${name} id=${masked} classification=${classification} created=${created} modified=${modified} pages_bindings=${bindings}`);
  }

  console.log(`Pages projects inventoried: ${pagesAudit.projects.length}`);
  for (const binding of pagesAudit.bindings) {
    console.log(`Pages D1 binding: ${bindingLabel(binding)}`);
  }
  console.log(`Deployed Worker D1 bindings inventoried: ${workerAudit.deployed.length}`);
  for (const binding of workerAudit.deployed) {
    console.log(`Worker D1 binding: ${bindingLabel(binding)}`);
  }
  console.log(`Repository Wrangler D1 bindings inventoried: ${workerAudit.repository.length}`);
  for (const binding of workerAudit.repository) {
    console.log(`Repository Wrangler D1 binding: ${bindingLabel(binding)}`);
  }

  const target = databases.find((database) => database?.name === targetName);
  if (!target) {
    console.log(`Preview D1 cleanup target not found: ${targetName}`);
    if (cleanupAction === "delete") fail("Cannot delete a preview D1 database that no longer exists.");
    appendSummary([
      "## Preview D1 Cleanup Dry Run",
      "",
      `- Target: ${targetName}`,
      "- Exists: no",
      "- Deleted: no",
      "- Binding audit completed: yes",
    ]);
    return;
  }

  const targetId = databaseId(target);
  const targetMask = maskId(targetId);
  if (!targetId) fail("Cleanup target has no resolvable D1 database ID.");
  if (targetId === productionId) fail("Refusing to delete production D1 database by ID.");
  if (targetName === productionName) fail("Refusing to delete production D1 database by detected name.");
  if (cleanupAction === "delete" && reviewedMask !== targetMask) {
    fail("reviewed_preview_db_id_mask does not match the current cleanup target ID mask.");
  }

  const targetPagesBindings = pagesAudit.bindings.filter((binding) => bindingMatchesTarget(binding, targetId));
  const targetWorkerBindings = workerAudit.deployed.filter((binding) => bindingMatchesTarget(binding, targetId));
  const targetRepositoryBindings = workerAudit.repository.filter((binding) => bindingMatchesTarget(binding, targetId));
  const productionBindings = targetPagesBindings.filter((binding) => binding.project === productionPagesProject || binding.environment === "production");
  const activeRuns = await activePreviewRuns();
  const activeTargetRuns = activeRuns.filter((run) => run.definitelyUsesTarget);
  const uncertainActivePreviewRuns = activeRuns.filter((run) => run.databaseUnknown);
  const blockedReasons = [];
  if (!pagesAudit.complete) blockedReasons.push("Pages binding audit incomplete");
  if (!workerAudit.complete) blockedReasons.push("Worker binding audit incomplete");
  if (productionBindings.length > 0) blockedReasons.push("target is bound to the production Pages project");
  if (targetPagesBindings.length > 0) blockedReasons.push("target remains bound to Pages");
  if (targetWorkerBindings.length > 0) blockedReasons.push("target remains bound to a deployed Worker");
  if (targetRepositoryBindings.length > 0) blockedReasons.push("target remains referenced by repository Wrangler config");
  if (activeTargetRuns.length > 0) blockedReasons.push("active preview workflow is definitely using target");
  if (uncertainActivePreviewRuns.length > 0) blockedReasons.push("active preview workflow database use is uncertain");

  console.log(`Preview D1 cleanup target: ${targetName} id=${targetMask}`);
  console.log(`Cleanup action: ${cleanupAction}`);
  console.log(`Target exists: yes`);
  console.log(`Target created: ${target.created_at ?? target.created_on ?? "unknown"}`);
  console.log(`Target modified: ${target.modified_at ?? target.modified_on ?? "unknown"}`);
  console.log(`Associated completed preview: ${targetName.endsWith("_alignment_ee8c812") ? "main-runtime alignment preview ee8c812" : "unknown"}`);
  console.log(`Pages bindings for target: ${targetPagesBindings.length}`);
  for (const binding of targetPagesBindings) console.log(`Target Pages binding: ${bindingLabel(binding)}`);
  console.log(`Worker bindings for target: ${targetWorkerBindings.length}`);
  for (const binding of targetWorkerBindings) console.log(`Target Worker binding: ${bindingLabel(binding)}`);
  console.log(`Repository Wrangler references for target: ${targetRepositoryBindings.length}`);
  for (const binding of targetRepositoryBindings) console.log(`Target repository Wrangler reference: ${bindingLabel(binding)}`);
  console.log(`Active preview workflow runs: ${activeRuns.length}`);
  console.log(`Active runs definitely using target: ${activeTargetRuns.length}`);
  console.log(`Active runs with unknown preview database: ${uncertainActivePreviewRuns.length}`);
  for (const run of activeRuns.slice(0, 10)) {
    console.log(`Active preview run: ${run.name} status=${run.status} branch=${run.branch ?? "unknown"} target=${run.definitelyUsesTarget ? "definite" : "unknown"} created=${run.created_at ?? "unknown"} url=${run.url ?? "unknown"}`);
  }

  const deletionStatus = blockedReasons.length > 0
    ? `BLOCKED FOR DELETION: ${blockedReasons.join("; ")}`
    : "ELIGIBLE FOR EXPLICIT DELETION APPROVAL: no bindings and no active use detected";
  console.log(deletionStatus);
  appendSummary([
    "## Preview D1 Cleanup",
    "",
    `- Target database: ${targetName}`,
    `- Target database ID: ${targetMask}`,
    `- Cleanup action: ${cleanupAction}`,
    `- Selected token source: ${selectedSource.name}`,
    `- Target exists: yes`,
    `- Production name check: passed`,
    `- Production ID check: passed`,
    `- Pages audit complete: ${pagesAudit.complete ? "yes" : "no"}`,
    `- Worker audit complete: ${workerAudit.complete ? "yes" : "no"}`,
    `- Pages bindings for target: ${targetPagesBindings.length}`,
    `- Worker bindings for target: ${targetWorkerBindings.length}`,
    `- Repository Wrangler references for target: ${targetRepositoryBindings.length}`,
    `- Active preview runs definitely using target: ${activeTargetRuns.length}`,
    `- Active preview runs with unknown database: ${uncertainActivePreviewRuns.length}`,
    `- Deletion status: ${deletionStatus}`,
    "- Dry-run deletes databases: no",
    "- Pages binding changes: not performed",
    "- Full D1 IDs and tokens printed: no",
  ]);

  if (cleanupAction === "dry-run") {
    console.log("Preview D1 cleanup dry-run completed. No database was deleted.");
    return;
  }

  if (blockedReasons.length > 0) {
    fail(`PREVIEW_D1_BINDING_AUDIT_INCOMPLETE: delete mode blocked: ${blockedReasons.join("; ")}.`);
  }
  console.log(`Final sanitized deletion summary: database=${targetName} id=${targetMask} token_source=${selectedSource.name}`);
  const deleted = await cloudflare(selectedSource, "d1-database-delete", `/d1/database/${encodeURIComponent(targetId)}`, { method: "DELETE" });
  if (!success(deleted)) {
    printCloudflareDiagnostic("PREVIEW_D1_BINDING_AUDIT_INCOMPLETE", "d1_database_delete", deleted, selectedSource.name);
    fail("Cloudflare preview D1 deletion failed.");
  }
  console.log(`Preview D1 deletion result: success database=${targetName} id=${targetMask}`);
  appendSummary(["", "- Deletion result: success"]);
})().catch((error) => fail(error instanceof Error ? error.message : String(error)));
NODE
