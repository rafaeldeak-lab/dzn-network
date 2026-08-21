set -euo pipefail

if [ "${MODE:-}" != "audit-preview-d1-capacity" ]; then
  echo "::error::MODE must equal audit-preview-d1-capacity."
  exit 1
fi
if [ "${CONFIRM_PREVIEW_ONLY:-}" != "PREVIEW_ONLY" ]; then
  echo "::error::CONFIRM_PREVIEW_ONLY must equal PREVIEW_ONLY."
  exit 1
fi
if [ "${CONFIRM_D1_CAPACITY_AUDIT:-}" != "APPROVE_D1_CAPACITY_AUDIT" ]; then
  echo "::error::CONFIRM_D1_CAPACITY_AUDIT must equal APPROVE_D1_CAPACITY_AUDIT."
  exit 1
fi

AUDIT_TMP_DIR="$(mktemp -d)"
cleanup_audit_tmp() {
  rm -rf "${AUDIT_TMP_DIR}"
}
trap cleanup_audit_tmp EXIT
export AUDIT_TMP_DIR

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const startedAt = new Date().toISOString();
const artifactDir = "dzn-preview-d1-capacity-audit";
const repository = requiredEnv("GITHUB_REPOSITORY");
const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
const cloudflareToken = requiredEnv("OWNER_CONSOLE_CF_TOKEN");
const githubToken = requiredEnv("GITHUB_TOKEN");
const candidateBranch = requiredEnv("CANDIDATE_BRANCH");
const candidateRef = requiredEnv("CANDIDATE_REF");
const candidateSha = requiredEnv("CANDIDATE_SHA");
const currentRunId = String(process.env.GITHUB_RUN_ID ?? "");
const now = Date.now();
const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

const knownDatabaseNames = [
  "dzn_network_db",
  "dzn_network_db_owner_console_preview_creator_governance_0919c46",
  "dzn_network_db_owner_console_preview_creator_governance_51815be",
  "dzn_network_db_discord_announcements_preview",
  "dzn_network_db_discord_phase_2a_preview",
  "dzn_network_db_discord_control_preview",
  "dzn_network_db_owner_console_preview",
  "dzn_network_db_server_lifecycle_preview",
  "dzn_network_db_server_advertising_preview",
  "dzn_network_db_dzn_pulse_preview",
  "dzn_network_db_owner_console_preview_billing_phase_1_17b9535",
];

const automaticallyProtectedNames = new Set([
  "dzn_network_db",
  "dzn_network_db_owner_console_preview_creator_governance_0919c46",
  "dzn_network_db_discord_announcements_preview",
  "dzn_network_db_owner_console_preview_billing_phase_1_17b9535",
]);

const artifactFiles = [
  "summary.md",
  "audit-metadata.json",
  "d1-inventory.json",
  "pages-bindings.json",
  "workflow-reference-summary.json",
  "protected-resources.json",
  "cleanup-candidate.json",
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment value: ${name}`);
  }
  return value;
}

function maskId(id) {
  const text = String(id ?? "");
  return text.length > 12 ? `${text.slice(0, 8)}...${text.slice(-4)}` : "unavailable";
}

function safeDate(value) {
  const text = String(value ?? "");
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function maxIsoDate(values) {
  const dates = values
    .map((value) => safeDate(value))
    .filter(Boolean)
    .sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

function sanitizeText(value) {
  let text = String(value ?? "");
  text = text
    .replace(new RegExp(accountId, "g"), "[redacted-account]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\b[0-9a-f]{32}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted]");
  return text.slice(0, 1200);
}

function cloudflareHeaders() {
  return {
    Authorization: `Bearer ${cloudflareToken}`,
    Accept: "application/json",
  };
}

function githubHeaders(accept = "application/vnd.github+json") {
  return {
    Authorization: `Bearer ${githubToken}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function getJson(url, headers, label) {
  const response = await fetch(url, { method: "GET", headers });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-json response status=${response.status}`);
  }
  if (!response.ok || parsed?.success === false) {
    const first = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
    throw new Error(`${label} failed status=${response.status} code=${sanitizeText(first?.code ?? "unknown")} message=${sanitizeText(first?.message ?? "unknown")}`);
  }
  return parsed;
}

async function getText(url, headers, label) {
  const response = await fetch(url, { method: "GET", headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed status=${response.status}`);
  }
  return text;
}

function cloudflareUrl(apiPath) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}${apiPath}`;
}

function githubUrl(apiPath) {
  return `https://api.github.com/repos/${repository}${apiPath}`;
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

async function listCloudflarePaginated(apiPath, keys, label, perPage = 100, maxPages = 50) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = apiPath.includes("?") ? "&" : "?";
    const parsed = await getJson(cloudflareUrl(`${apiPath}${separator}per_page=${perPage}&page=${page}`), cloudflareHeaders(), `${label} page ${page}`);
    const pageItems = itemsFromResult(parsed, keys);
    items.push(...pageItems);
    const info = resultInfo(parsed);
    const totalPages = Number(info.total_pages ?? 0);
    if (totalPages > 0 && page >= totalPages) break;
    if (pageItems.length < perPage) break;
  }
  return items;
}

async function listPagesProjects() {
  const first = await getJson(cloudflareUrl("/pages/projects"), cloudflareHeaders(), "cloudflare pages projects");
  const items = itemsFromResult(first, ["projects"]);
  const info = resultInfo(first);
  const currentPage = Number(info.page ?? 1);
  const totalPages = Number(info.total_pages ?? 1);
  const returnedPerPage = Number(info.per_page ?? 0);
  const safePerPage = returnedPerPage > 0 && returnedPerPage <= 20 ? returnedPerPage : 20;
  if (totalPages > currentPage) {
    for (let page = currentPage + 1; page <= totalPages && page <= 50; page += 1) {
      const parsed = await getJson(cloudflareUrl(`/pages/projects?page=${page}&per_page=${safePerPage}`), cloudflareHeaders(), `cloudflare pages projects page ${page}`);
      items.push(...itemsFromResult(parsed, ["projects"]));
    }
  }
  return items;
}

async function listGithubPaginated(apiPath, key, label, maxPages = 10) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = apiPath.includes("?") ? "&" : "?";
    const parsed = await getJson(githubUrl(`${apiPath}${separator}per_page=100&page=${page}`), githubHeaders(), `${label} page ${page}`);
    const pageItems = Array.isArray(parsed?.[key]) ? parsed[key] : [];
    items.push(...pageItems);
    if (pageItems.length < 100) break;
  }
  return items;
}

function databaseId(database) {
  return String(database?.uuid ?? database?.id ?? database?.database_id ?? "");
}

function approvedPreviewDatabaseName(name) {
  return /^dzn_network_db_owner_console_preview_/.test(name)
    || /^dzn_network_db_discord_announcements_preview_/.test(name)
    || name === "dzn_network_db_discord_announcements_preview"
    || name === "dzn_network_db_discord_control_preview"
    || name === "dzn_network_db_discord_phase_2a_preview"
    || name === "dzn_network_db_server_lifecycle_preview"
    || name === "dzn_network_db_server_advertising_preview"
    || name === "dzn_network_db_dzn_pulse_preview";
}

function collectD1Bindings(value, context, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const binding = String(entry?.binding ?? entry?.name ?? "unnamed");
      const id = String(entry?.database_id ?? entry?.id ?? "");
      const name = String(entry?.database_name ?? entry?.databaseName ?? "");
      if (id || name) output.push({ ...context, binding, id, name });
    }
    return output;
  }
  for (const [binding, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      output.push({ ...context, binding, id: entry, name: "" });
      continue;
    }
    if (entry && typeof entry === "object") {
      const id = String(entry.database_id ?? entry.id ?? "");
      const name = String(entry.database_name ?? entry.databaseName ?? "");
      if (id || name) output.push({ ...context, binding, id, name });
    }
  }
  return output;
}

function extractProjectD1Bindings(project, databaseNameById, databaseIdByName) {
  const bindings = [];
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    collectD1Bindings(config.d1_databases, {
      project_name: String(project?.name ?? "unknown"),
      production_branch: String(project?.production_branch ?? ""),
      environment,
    }, bindings);
  }
  return bindings.map((binding) => {
    const resolvedName = binding.name || databaseNameById.get(binding.id) || "unknown";
    const resolvedId = binding.id || databaseIdByName.get(resolvedName) || "";
    return {
      project_name: binding.project_name,
      production_branch: binding.production_branch || null,
      environment: binding.environment,
      binding_name: binding.binding,
      d1_database_name: resolvedName,
      masked_d1_id: maskId(resolvedId),
      active_binding: true,
    };
  });
}

function deploymentTimestamp(deployment) {
  return safeDate(deployment?.created_on)
    ?? safeDate(deployment?.created_at)
    ?? safeDate(deployment?.modified_on)
    ?? safeDate(deployment?.modified_at);
}

function deploymentSucceeded(deployment) {
  const status = String(deployment?.latest_stage?.status ?? deployment?.status ?? "").toLowerCase();
  return status === "success" || status === "succeeded";
}

async function loadD1Inventory() {
  const databases = await listCloudflarePaginated("/d1/database", ["databases"], "cloudflare d1 inventory");
  return databases.map((database) => {
    const id = databaseId(database);
    return {
      name: String(database?.name ?? "unnamed"),
      full_id: id,
      masked_id: maskId(id),
      created_at: safeDate(database?.created_at ?? database?.created_on),
      database_version: database?.version ?? database?.database_version ?? null,
    };
  });
}

async function loadPagesInventory(databaseNameById, databaseIdByName) {
  const projects = await listPagesProjects();
  const projectSummaries = [];
  const allBindings = [];
  for (const project of projects) {
    const projectName = String(project?.name ?? "");
    if (!projectName) continue;
    const detail = await getJson(cloudflareUrl(`/pages/projects/${encodeURIComponent(projectName)}`), cloudflareHeaders(), `cloudflare pages project ${projectName}`);
    const fullProject = detail?.result ?? project;
    const deployments = await listCloudflarePaginated(`/pages/projects/${encodeURIComponent(projectName)}/deployments`, ["deployments"], `cloudflare pages deployments ${projectName}`, 25, 2);
    const latestDeploymentDate = maxIsoDate(deployments.map(deploymentTimestamp));
    const latestSuccessfulDeploymentDate = maxIsoDate(deployments.filter(deploymentSucceeded).map(deploymentTimestamp));
    const bindings = extractProjectD1Bindings(fullProject, databaseNameById, databaseIdByName);
    allBindings.push(...bindings.map((binding) => ({
      ...binding,
      latest_deployment_at: latestDeploymentDate,
      latest_successful_deployment_at: latestSuccessfulDeploymentDate,
    })));
    projectSummaries.push({
      project_name: projectName,
      production_branch: fullProject?.production_branch ?? null,
      latest_deployment_at: latestDeploymentDate,
      latest_successful_deployment_at: latestSuccessfulDeploymentDate,
      d1_bindings: bindings,
    });
  }
  return { projects: projectSummaries, bindings: allBindings };
}

function relevantWorkflow(workflow) {
  const text = `${workflow?.name ?? ""} ${workflow?.path ?? ""}`.toLowerCase();
  return text.includes("owner console preview")
    || text.includes("creator")
    || (text.includes("discord") && text.includes("preview"))
    || text.includes("server-lifecycle-preview")
    || text.includes("server advertising")
    || text.includes("server-advertising-preview")
    || text.includes("pulse-preview")
    || text.includes("billing");
}

function relevantRun(run, relevantWorkflowIds) {
  const text = `${run?.name ?? ""} ${run?.path ?? ""} ${run?.display_title ?? ""}`.toLowerCase();
  return relevantWorkflowIds.has(Number(run?.workflow_id))
    || text.includes("owner console preview")
    || text.includes("creator")
    || (text.includes("discord") && text.includes("preview"))
    || text.includes("server lifecycle")
    || text.includes("server advertising")
    || text.includes("pulse")
    || text.includes("billing");
}

function extractDatabaseNames(text) {
  const found = new Set();
  for (const name of knownDatabaseNames) {
    if (text.includes(name)) found.add(name);
  }
  const patterns = [
    /\bdzn_network_db_owner_console_preview_[a-z0-9_]+\b/g,
    /\bdzn_network_db_discord_announcements_preview(?:_[a-z0-9_]+)?\b/g,
    /\bdzn_network_db_discord_control_preview\b/g,
    /\bdzn_network_db_discord_phase_2a_preview\b/g,
    /\bdzn_network_db_server_lifecycle_preview\b/g,
    /\bdzn_network_db_server_advertising_preview\b/g,
    /\bdzn_network_db_dzn_pulse_preview\b/g,
    /\bdzn_network_db\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[0];
      if (name === "dzn_network_db" || approvedPreviewDatabaseName(name) || knownDatabaseNames.includes(name)) {
        found.add(name);
      }
    }
  }
  return [...found].sort();
}

async function loadWorkflowReferences() {
  const workflows = await listGithubPaginated("/actions/workflows?", "workflows", "github workflows", 2);
  const relevantWorkflows = workflows.filter(relevantWorkflow);
  const relevantWorkflowIds = new Set(relevantWorkflows.map((workflow) => Number(workflow.id)));
  const allRuns = await listGithubPaginated("/actions/runs?", "workflow_runs", "github workflow runs", 10);
  const relevantRuns = allRuns
    .filter((run) => relevantRun(run, relevantWorkflowIds))
    .filter((run) => String(run?.id ?? "") !== currentRunId)
    .slice(0, 100);
  const runSummaries = [];
  const databaseToRuns = new Map();
  for (const run of relevantRuns) {
    const jobs = await listGithubPaginated(`/actions/runs/${run.id}/jobs?`, "jobs", `github jobs ${run.id}`, 2);
    const jobStepEvidence = [];
    const foundDatabases = new Set(extractDatabaseNames(JSON.stringify({
      name: run.name,
      path: run.path,
      display_title: run.display_title,
      head_branch: run.head_branch,
      head_sha: run.head_sha,
      status: run.status,
      conclusion: run.conclusion,
    })));
    for (const job of jobs) {
      const steps = Array.isArray(job.steps) ? job.steps : [];
      for (const step of steps) {
        jobStepEvidence.push({
          job_name: job.name ?? null,
          step_name: step.name ?? null,
          status: step.status ?? null,
          conclusion: step.conclusion ?? null,
        });
      }
      const metadataNames = extractDatabaseNames(JSON.stringify({
        job_name: job.name,
        steps,
      }));
      for (const name of metadataNames) foundDatabases.add(name);
      const logText = await getText(githubUrl(`/actions/jobs/${job.id}/logs`), githubHeaders("text/plain"), `github job log ${job.id}`);
      for (const name of extractDatabaseNames(logText)) foundDatabases.add(name);
    }
    const databaseNames = [...foundDatabases].sort();
    const summary = {
      workflow_name: run.name ?? "unknown",
      workflow_id: run.workflow_id ?? null,
      run_id: run.id,
      run_url: run.html_url,
      branch: run.head_branch ?? null,
      candidate_sha: run.head_sha ?? null,
      event: run.event ?? null,
      status: run.status ?? null,
      conclusion: run.conclusion ?? null,
      created_at: safeDate(run.created_at),
      updated_at: safeDate(run.updated_at),
      database_names_referenced: databaseNames,
      queued_or_running: ["queued", "in_progress", "waiting", "requested"].includes(String(run.status ?? "")),
      recent_successful_preview: run.conclusion === "success" && Date.parse(run.created_at ?? "") >= thirtyDaysAgo,
      failed_or_unresolved: run.conclusion && run.conclusion !== "success",
      step_summary: jobStepEvidence,
    };
    runSummaries.push(summary);
    for (const name of databaseNames) {
      if (!databaseToRuns.has(name)) databaseToRuns.set(name, []);
      databaseToRuns.get(name).push({
        workflow_name: summary.workflow_name,
        run_id: summary.run_id,
        run_url: summary.run_url,
        branch: summary.branch,
        candidate_sha: summary.candidate_sha,
        event: summary.event,
        status: summary.status,
        conclusion: summary.conclusion,
        created_at: summary.created_at,
        updated_at: summary.updated_at,
        queued_or_running: summary.queued_or_running,
        recent_successful_preview: summary.recent_successful_preview,
        failed_or_unresolved: summary.failed_or_unresolved,
      });
    }
  }
  return {
    workflows_searched: relevantWorkflows.map((workflow) => ({
      name: workflow.name,
      id: workflow.id,
      path: workflow.path,
      state: workflow.state,
    })),
    runs_scanned: runSummaries,
    database_to_runs: Object.fromEntries([...databaseToRuns.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function loadProductionD1FromWrangler() {
  const source = fs.readFileSync("wrangler.toml", "utf8");
  const name = source.match(/database_name\s*=\s*"([^"]+)"/)?.[1] ?? "";
  const id = source.match(/database_id\s*=\s*"([^"]+)"/)?.[1] ?? "";
  return { name, id };
}

function headingForOffset(source, offset) {
  const before = source.slice(0, offset);
  const headings = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)];
  return headings.length > 0 ? headings[headings.length - 1][1].trim() : "document";
}

function loadHandoffReferences(databaseNames) {
  const files = ["DZN_MASTER_HANDOFF.md", "DZN_BILLING_PHASE_1_HANDOFF.md"];
  const byName = new Map();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const name of databaseNames) {
      let offset = source.indexOf(name);
      while (offset !== -1) {
        const context = source.slice(Math.max(0, offset - 240), Math.min(source.length, offset + name.length + 240));
        const protective = /\b(active|retained|unresolved|required|evidence|blocked|incomplete|not complete|frozen|preserved|candidate-specific|not created)\b/i.test(context);
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push({
          file,
          section: headingForOffset(source, offset),
          protective_reference: protective,
          reason: protective ? "current handoff records active, retained, unresolved, blocked, or evidence context" : "current handoff references this database",
        });
        offset = source.indexOf(name, offset + name.length);
      }
    }
  }
  return byName;
}

function latestUseFor(databaseName, pageBindings, workflowReferences) {
  const pageDates = pageBindings.flatMap((binding) => [
    binding.latest_deployment_at,
    binding.latest_successful_deployment_at,
  ]);
  const workflowDates = workflowReferences.flatMap((run) => [run.updated_at, run.created_at]);
  return maxIsoDate([...pageDates, ...workflowDates]);
}

function supersessionEvidence(database, d1Records, workflowReferences) {
  const name = database.name;
  const match = name.match(/^(.+_)([a-f0-9]{7})$/);
  if (!match) return null;
  const prefix = match[1];
  const createdAt = Date.parse(database.created_at ?? "");
  const newerSamePrefix = d1Records
    .filter((record) => record.name.startsWith(prefix) && record.name !== name)
    .filter((record) => {
      const otherCreated = Date.parse(record.created_at ?? "");
      return Number.isFinite(createdAt) && Number.isFinite(otherCreated) && otherCreated > createdAt;
    })
    .map((record) => record.name);
  if (newerSamePrefix.length > 0) {
    return `newer same-prefix preview exists: ${newerSamePrefix.slice(0, 3).join(", ")}`;
  }
  const laterSuccessful = workflowReferences
    .filter((run) => run.recent_successful_preview && run.candidate_sha && !name.endsWith(String(run.candidate_sha).slice(0, 7)))
    .map((run) => `${run.workflow_name} run ${run.run_id}`);
  if (laterSuccessful.length > 0) {
    return `later successful workflow evidence exists: ${laterSuccessful.slice(0, 3).join(", ")}`;
  }
  return null;
}

function classifyDatabase({ database, production, pageBindings, workflowReferences, handoffReferences, d1Records }) {
  const latestUseAt = latestUseFor(database.name, pageBindings, workflowReferences);
  const isProduction = database.name === production.name || (production.id && database.full_id === production.id);
  const approvedPreview = approvedPreviewDatabaseName(database.name);
  const queuedOrRunning = workflowReferences.some((run) => run.queued_or_running);
  const recentSuccessful = workflowReferences.some((run) => run.recent_successful_preview);
  const failedOrUnresolved = workflowReferences.some((run) => run.failed_or_unresolved);
  const handoffProtected = handoffReferences.some((ref) => ref.protective_reference) || handoffReferences.length > 0;
  const origin = workflowReferences.find((run) => run.run_id) ?? null;
  const superseded = supersessionEvidence(database, d1Records, workflowReferences);

  if (isProduction) {
    return {
      classification: "PRODUCTION_PROTECTED",
      latest_use_at: latestUseAt,
      reason: "production D1 protected by configured name or ID",
    };
  }
  if (pageBindings.length > 0) {
    return {
      classification: "ACTIVE_PAGES_BINDING",
      latest_use_at: latestUseAt,
      reason: `bound to Pages project(s): ${[...new Set(pageBindings.map((binding) => binding.project_name))].join(", ")}`,
    };
  }
  if (queuedOrRunning) {
    return {
      classification: "CURRENT_WORKFLOW_PROTECTED",
      latest_use_at: latestUseAt,
      reason: "referenced by a queued or running preview workflow",
    };
  }
  if (recentSuccessful || automaticallyProtectedNames.has(database.name)) {
    return {
      classification: "RECENT_PREVIEW_PROTECTED",
      latest_use_at: latestUseAt,
      reason: automaticallyProtectedNames.has(database.name)
        ? "explicitly retained preview resource in audit protection list"
        : "referenced by a successful preview workflow within the last 30 days",
    };
  }
  if (handoffProtected) {
    return {
      classification: "HANDOFF_REFERENCED_PROTECTED",
      latest_use_at: latestUseAt,
      reason: "referenced by current DZN handoffs as retained, unresolved, blocked, or evidence-relevant",
    };
  }
  if (!approvedPreview) {
    return {
      classification: "UNKNOWN_PROTECTED",
      latest_use_at: latestUseAt,
      reason: "database name is not in the existing approved DZN preview cleanup prefix set",
    };
  }
  if (!database.created_at) {
    return {
      classification: "UNKNOWN_PROTECTED",
      latest_use_at: latestUseAt,
      reason: "creation timestamp is unavailable",
    };
  }
  if (!latestUseAt) {
    return {
      classification: "UNKNOWN_PROTECTED",
      latest_use_at: latestUseAt,
      reason: "latest use timestamp cannot be defensibly established",
    };
  }
  if (!origin) {
    return {
      classification: "UNKNOWN_PROTECTED",
      latest_use_at: latestUseAt,
      reason: "originating workflow could not be identified",
    };
  }
  if (failedOrUnresolved && !superseded) {
    return {
      classification: "UNKNOWN_PROTECTED",
      latest_use_at: latestUseAt,
      reason: "failed or unresolved workflow evidence is not sufficient to prove staleness",
    };
  }
  if (!superseded) {
    return {
      classification: "UNKNOWN_PROTECTED",
      latest_use_at: latestUseAt,
      reason: "no supersession or abandonment evidence was found",
    };
  }
  return {
    classification: "STALE_PREVIEW_CANDIDATE",
    latest_use_at: latestUseAt,
    reason: `unbound approved preview database with identified origin and supersession evidence: ${superseded}`,
  };
}

function writeJson(file, value) {
  fs.writeFileSync(path.join(artifactDir, file), `${JSON.stringify(value, null, 2)}\n`);
}

function writeSummary({ metadata, d1Inventory, pageProjects, workflowSummary, selectedCandidate }) {
  const lines = [
    "# DZN Preview D1 Capacity Audit",
    "",
    `- Result: ${selectedCandidate ? "one stale preview candidate identified" : "no provably safe cleanup candidate"}`,
    `- Candidate branch: ${metadata.branch}`,
    `- Candidate SHA: ${metadata.candidate_sha}`,
    `- D1 databases inventoried: ${metadata.d1_database_count}`,
    `- Pages projects checked: ${metadata.pages_project_count}`,
    `- Workflow runs scanned: ${metadata.workflow_runs_scanned}`,
    `- Resource mutation performed: false`,
    "",
    "## D1 Classifications",
    "",
    "| Database | Masked ID | Classification | Pages Binding | Reason |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const database of d1Inventory) {
    const pages = database.pages_binding_status;
    lines.push(`| ${database.name} | ${database.masked_id} | ${database.classification} | ${pages} | ${database.classification_reason.replace(/\|/g, "/")} |`);
  }
  lines.push("", "## Pages Projects", "");
  for (const project of pageProjects) {
    const bindingNames = project.d1_bindings.map((binding) => `${binding.environment}:${binding.binding_name}:${binding.d1_database_name}`).join(", ") || "none";
    lines.push(`- ${project.project_name}: branch=${project.production_branch ?? "unknown"} latest_success=${project.latest_successful_deployment_at ?? "unknown"} bindings=${bindingNames}`);
  }
  lines.push("", "## Workflow Cross-Reference", "");
  lines.push(`- Workflows searched: ${workflowSummary.workflows_searched.map((workflow) => workflow.name).join(", ") || "none"}`);
  lines.push(`- Database mappings found: ${Object.keys(workflowSummary.database_to_runs).length}`);
  lines.push("", "## Candidate", "");
  if (selectedCandidate) {
    lines.push(`- Selected: ${selectedCandidate.name} (${selectedCandidate.masked_id})`);
    lines.push(`- Safety justification: ${selectedCandidate.safety_justification}`);
  } else {
    lines.push("- candidate_selected=false");
    lines.push("- No database satisfied every stale-candidate rule.");
  }
  fs.writeFileSync(path.join(artifactDir, "summary.md"), `${lines.join("\n")}\n`);
}

function scanArtifacts() {
  const allowed = new Set(artifactFiles);
  const actualFiles = fs.readdirSync(artifactDir).sort();
  const unexpected = actualFiles.filter((file) => !allowed.has(file));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected artifact files: ${unexpected.join(", ")}`);
  }
  const checks = [
    ["complete_uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
    ["complete_hex_identifier", /\b[0-9a-f]{32}\b/i],
    ["bearer_value", /Bearer\s+[A-Za-z0-9._~+/=-]+/i],
    ["authorization_header", /Authorization\s*[:=]/i],
    ["cookie_value", /Cookie\s*[:=]/i],
    ["secret_field", /\b(TOKEN_ENCRYPTION_KEY|SESSION_SECRET|DISCORD_CLIENT_SECRET|DISCORD_BOT_TOKEN|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|encrypted_token|token_iv|token_auth_tag)\b/i],
    ["session_token", /\b(session_token|dzn_session)\b/i],
    ["cloudflare_or_github_token", /\b(CLOUDFLARE_[A-Z0-9_]*TOKEN|GITHUB_TOKEN|GH_TOKEN)\b/i],
    ["nitrado_token", /\bNITRADO_[A-Z0-9_]*TOKEN\b/i],
  ];
  for (const file of actualFiles) {
    const source = fs.readFileSync(path.join(artifactDir, file), "utf8");
    for (const [label, pattern] of checks) {
      if (pattern.test(source)) {
        throw new Error(`Artifact security scan failed: ${label} in ${file}`);
      }
    }
  }
}

function appendStepSummary(metadata, selectedCandidate) {
  const lines = [
    "## Preview D1 Capacity Audit",
    "",
    `- Candidate branch: ${metadata.branch}`,
    `- Candidate SHA: ${metadata.candidate_sha}`,
    `- D1 databases inventoried: ${metadata.d1_database_count}`,
    `- Pages projects checked: ${metadata.pages_project_count}`,
    `- Workflow runs scanned: ${metadata.workflow_runs_scanned}`,
    `- Candidate selected: ${selectedCandidate ? "true" : "false"}`,
    "- Resource mutation performed: false",
    "- Artifact security scan: passed",
  ];
  if (selectedCandidate) {
    lines.push(`- Selected candidate: ${selectedCandidate.name} (${selectedCandidate.masked_id})`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
}

async function main() {
  if (candidateRef !== "refs/heads/feature/event-platform-performance-foundation" || candidateBranch !== "feature/event-platform-performance-foundation") {
    throw new Error("Audit branch guard failed.");
  }

  fs.rmSync(artifactDir, { recursive: true, force: true });
  fs.mkdirSync(artifactDir, { recursive: true });

  const production = loadProductionD1FromWrangler();
  const d1Records = await loadD1Inventory();
  const databaseNameById = new Map(d1Records.map((database) => [database.full_id, database.name]));
  const databaseIdByName = new Map(d1Records.map((database) => [database.name, database.full_id]));
  const pages = await loadPagesInventory(databaseNameById, databaseIdByName);
  const workflowSummary = await loadWorkflowReferences();
  const handoffReferences = loadHandoffReferences(d1Records.map((database) => database.name));

  const pageBindingsByName = new Map();
  for (const binding of pages.bindings) {
    if (!pageBindingsByName.has(binding.d1_database_name)) pageBindingsByName.set(binding.d1_database_name, []);
    pageBindingsByName.get(binding.d1_database_name).push(binding);
  }

  const d1Inventory = d1Records.map((database) => {
    const pageBindings = pageBindingsByName.get(database.name) ?? [];
    const workflowReferences = workflowSummary.database_to_runs[database.name] ?? [];
    const handoffRefs = handoffReferences.get(database.name) ?? [];
    const classification = classifyDatabase({
      database,
      production,
      pageBindings,
      workflowReferences,
      handoffReferences: handoffRefs,
      d1Records,
    });
    return {
      name: database.name,
      masked_id: database.masked_id,
      created_at: database.created_at ?? "unknown",
      latest_use_at: classification.latest_use_at ?? "unknown",
      approved_preview_prefix: approvedPreviewDatabaseName(database.name),
      production_database: classification.classification === "PRODUCTION_PROTECTED",
      pages_binding_status: pageBindings.length > 0 ? "bound" : "unbound",
      pages_projects: [...new Set(pageBindings.map((binding) => binding.project_name))],
      latest_relevant_pages_deployment_at: maxIsoDate(pageBindings.map((binding) => binding.latest_deployment_at)) ?? "unknown",
      recent_workflow_references: workflowReferences.map((run) => ({
        workflow_name: run.workflow_name,
        run_id: run.run_id,
        run_url: run.run_url,
        branch: run.branch,
        candidate_sha: run.candidate_sha,
        conclusion: run.conclusion,
        status: run.status,
        created_at: run.created_at,
        updated_at: run.updated_at,
      })),
      handoff_references: handoffRefs,
      classification: classification.classification,
      classification_reason: classification.reason,
      database_version: database.database_version,
    };
  });

  const staleCandidates = d1Inventory
    .filter((database) => database.classification === "STALE_PREVIEW_CANDIDATE")
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  const selected = staleCandidates[0] ?? null;
  const selectedCandidate = selected ? {
    candidate_selected: true,
    name: selected.name,
    masked_id: selected.masked_id,
    creation_timestamp: selected.created_at,
    last_use_timestamp: selected.latest_use_at,
    originating_workflow: selected.recent_workflow_references[0]?.workflow_name ?? "unknown",
    originating_run_id: selected.recent_workflow_references[0]?.run_id ?? null,
    originating_run_url: selected.recent_workflow_references[0]?.run_url ?? null,
    branch: selected.recent_workflow_references[0]?.branch ?? null,
    candidate_commit: selected.recent_workflow_references[0]?.candidate_sha ?? null,
    pages_binding_result: selected.pages_binding_status,
    recent_workflow_result: selected.recent_workflow_references,
    handoff_reference_result: selected.handoff_references,
    supersession_evidence: selected.classification_reason,
    safety_justification: "All stale-preview rules passed: approved preview prefix, non-production name and ID, no Pages binding, no queued or running workflow, no recent successful workflow, no current handoff retention, identified workflow origin, known creation and latest-use timestamps, and supersession evidence.",
  } : {
    candidate_selected: false,
    reason: "No database satisfied every stale-candidate rule.",
    protected_plausible_candidates: d1Inventory
      .filter((database) => database.approved_preview_prefix && database.classification !== "PRODUCTION_PROTECTED")
      .map((database) => ({
        name: database.name,
        masked_id: database.masked_id,
        classification: database.classification,
        reason: database.classification_reason,
      })),
  };

  const metadata = {
    audit_started_at: startedAt,
    audit_finished_at: new Date().toISOString(),
    repository,
    branch: candidateBranch,
    ref: candidateRef,
    candidate_sha: candidateSha,
    github_run_id: currentRunId || null,
    github_run_number: process.env.GITHUB_RUN_NUMBER ?? null,
    github_run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    mode: process.env.MODE,
    d1_database_count: d1Inventory.length,
    pages_project_count: pages.projects.length,
    workflow_runs_scanned: workflowSummary.runs_scanned.length,
    cloudflare_d1_inventory_complete: true,
    pages_binding_inventory_complete: true,
    workflow_cross_reference_complete: true,
    handoff_cross_reference_complete: true,
    candidate_selected: Boolean(selected),
    retained_full_d1_ids: false,
    resource_mutation_performed: false,
    artifact_security_scan: "pending",
  };

  const protectedResources = {
    resources: d1Inventory
      .filter((database) => database.classification !== "STALE_PREVIEW_CANDIDATE")
      .map((database) => ({
        name: database.name,
        masked_id: database.masked_id,
        classification: database.classification,
        reason: database.classification_reason,
        pages_binding_status: database.pages_binding_status,
      })),
  };

  const pagesBindings = {
    projects_checked: pages.projects.length,
    projects: pages.projects,
    bound_resources: pages.bindings.map((binding) => ({
      project_name: binding.project_name,
      production_branch: binding.production_branch,
      environment: binding.environment,
      binding_name: binding.binding_name,
      d1_database_name: binding.d1_database_name,
      masked_d1_id: binding.masked_d1_id,
      latest_deployment_at: binding.latest_deployment_at,
      latest_successful_deployment_at: binding.latest_successful_deployment_at,
      protected: true,
    })),
  };

  writeJson("audit-metadata.json", metadata);
  writeJson("d1-inventory.json", { databases: d1Inventory });
  writeJson("pages-bindings.json", pagesBindings);
  writeJson("workflow-reference-summary.json", workflowSummary);
  writeJson("protected-resources.json", protectedResources);
  writeJson("cleanup-candidate.json", selectedCandidate);
  writeSummary({ metadata, d1Inventory, pageProjects: pages.projects, workflowSummary, selectedCandidate: selected ? selectedCandidate : null });

  scanArtifacts();
  metadata.artifact_security_scan = "passed";
  writeJson("audit-metadata.json", metadata);
  scanArtifacts();

  console.log(`D1 databases inventoried: ${d1Inventory.length}`);
  for (const database of d1Inventory) {
    console.log(`D1 audit: name=${database.name} id=${database.masked_id} classification=${database.classification} pages=${database.pages_binding_status} reason=${sanitizeText(database.classification_reason)}`);
  }
  console.log(`Pages projects checked: ${pages.projects.length}`);
  for (const binding of pages.bindings) {
    console.log(`Pages binding: project=${binding.project_name} environment=${binding.environment} binding=${binding.binding_name} database=${binding.d1_database_name} id=${binding.masked_d1_id}`);
  }
  console.log(`Workflow runs scanned: ${workflowSummary.runs_scanned.length}`);
  console.log(`Candidate selected: ${selected ? "true" : "false"}`);
  if (selected) {
    console.log(`Selected candidate: ${selected.name} id=${selected.masked_id}`);
  }
  appendStepSummary(metadata, selected ? selectedCandidate : null);
}

main().catch((error) => {
  console.error(sanitizeText(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
NODE
