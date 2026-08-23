set -euo pipefail

node <<'NODE'
const fs = require("node:fs");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.OWNER_CONSOLE_CF_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const projectName = process.env.REPAIR_PREVIEW_PROJECT_NAME;
const replacementName = process.env.REPAIR_REPLACEMENT_PREVIEW_DB_NAME;
const oldName = process.env.REPAIR_OLD_PREVIEW_DB_NAME;
const oldExpectedMask = process.env.REPAIR_OLD_PREVIEW_DB_ID_MASK;
const productionProject = process.env.PRODUCTION_PAGES_PROJECT_NAME;
const productionName = process.env.DETECTED_PRODUCTION_D1_DATABASE_NAME || process.env.PRODUCTION_D1_DATABASE_NAME;
const productionId = process.env.DETECTED_PRODUCTION_D1_DATABASE_ID || "";
const repairAction = process.env.REPAIR_ACTION;
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!token || token.length <= 20) throw new Error("Missing Cloudflare preview token for repair mode.");

function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}

function sanitize(value) {
  let text = String(value ?? "");
  for (const sensitive of [accountId, productionId, token]) {
    if (sensitive) text = text.split(sensitive).join("[redacted]");
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted-token]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\b[0-9a-f]{32}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]")
    .replace(/(authorization|cookie|session|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1200);
}

function fail(message) {
  console.error(sanitize(message));
  process.exit(1);
}

function appendSummary(lines) {
  if (summaryPath) fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);
}

function success(result) {
  return Boolean(result?.ok && result?.parsed?.success !== false);
}

function databaseId(database) {
  return String(database?.uuid ?? database?.id ?? database?.database_id ?? "");
}

async function cloudflare(endpointCategory, apiPath, init = {}, accountScoped = true) {
  const base = accountScoped
    ? `https://api.cloudflare.com/client/v4/accounts/${accountId}`
    : "https://api.cloudflare.com/client/v4";
  const response = await fetch(`${base}${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
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
    contentType: response.headers.get("content-type") || "unknown",
    bodyLength: text.length,
  };
}

function cloudflareError(result) {
  const first = Array.isArray(result?.parsed?.errors) ? result.parsed.errors[0] : null;
  return `${result?.status ?? "unknown"} ${first?.code ?? "unknown"} ${sanitize(first?.message ?? "unknown")}`;
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
  for (let page = 1; page <= 50; page += 1) {
    const result = await cloudflare(endpointCategory, `${basePath}?per_page=${perPage}&page=${page}`);
    if (!success(result)) fail(`${endpointCategory} failed: ${cloudflareError(result)}`);
    const pageItems = itemsFromResult(result.parsed, keys);
    items.push(...pageItems);
    const info = resultInfo(result.parsed);
    const totalPages = Number(info.total_pages ?? 0);
    if (totalPages > 0 && page >= totalPages) break;
    if (pageItems.length < perPage) break;
  }
  return items;
}

async function getProject(name) {
  const result = await cloudflare("pages-project-detail", `/pages/projects/${encodeURIComponent(name)}`);
  if (!success(result)) fail(`Could not read Pages project ${name}: ${cloudflareError(result)}`);
  return result.parsed?.result;
}

function envValue(config, key) {
  const value = config?.env_vars?.[key];
  if (value && typeof value === "object") return String(value.value ?? "");
  return String(value ?? "");
}

function collectD1Bindings(configValue, context) {
  const bindings = [];
  if (!configValue || typeof configValue !== "object") return bindings;
  if (Array.isArray(configValue)) {
    for (const value of configValue) {
      const id = String(value?.id ?? value?.database_id ?? "");
      const name = String(value?.database_name ?? value?.name ?? "");
      const binding = String(value?.binding ?? value?.name ?? "unnamed");
      if (id || name) bindings.push({ ...context, binding, id, name });
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

function projectD1Bindings(project, databasesById = new Map()) {
  const bindings = [];
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    for (const binding of collectD1Bindings(config.d1_databases, {
      source: "pages",
      project: project?.name ?? "unknown",
      environment,
    })) {
      bindings.push({ ...binding, resolvedName: binding.name || databasesById.get(binding.id) || "unknown" });
    }
  }
  return bindings;
}

function bindingMatches(binding, name, id) {
  return binding.id === id || binding.name === name || binding.resolvedName === name;
}

function classifyBinding(binding, ids) {
  if (!binding?.id && !binding?.name) return "unknown";
  if (bindingMatches(binding, replacementName, ids.replacementId)) return "replacement preview D1";
  if (bindingMatches(binding, oldName, ids.oldId)) return "old stale preview D1";
  if (bindingMatches(binding, productionName, ids.productionId)) return "real production D1";
  return "unknown";
}

function latestDeployment(project) {
  const deployment = project?.latest_deployment ?? project?.canonical_deployment ?? {};
  const trigger = deployment.deployment_trigger?.metadata ?? deployment.source?.config ?? {};
  return {
    id: maskId(String(deployment.id ?? "")),
    url: String(deployment.url ?? deployment.aliases?.[0] ?? "unknown"),
    commit: String(trigger.commit_hash ?? trigger.commit ?? deployment.source?.config?.commit_hash ?? "unknown"),
    branch: String(trigger.branch ?? deployment.source?.config?.branch ?? "unknown"),
  };
}

function productionProjectSignature(project) {
  return projectD1Bindings(project)
    .filter((binding) => binding.binding === "DB")
    .map((binding) => `${binding.environment}:${binding.id || binding.name}`)
    .sort()
    .join("|");
}

function withFalseDiscordFlags(config) {
  const envVars = { ...(config?.env_vars ?? {}) };
  envVars.DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED = { type: "plain_text", value: "false" };
  envVars.DZN_DISCORD_NOTIFICATIONS_ENABLED = { type: "plain_text", value: "false" };
  return { ...(config ?? {}), env_vars: envVars };
}

function patchD1Binding(config, replacementId) {
  const currentD1 = config?.d1_databases && typeof config.d1_databases === "object" && !Array.isArray(config.d1_databases)
    ? { ...config.d1_databases }
    : {};
  return {
    ...withFalseDiscordFlags(config),
    d1_databases: {
      ...currentD1,
      DB: { id: replacementId },
    },
  };
}

function verifyProjectSafe(project, replacementId) {
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    const db = config?.d1_databases?.DB;
    const dbId = String(db?.id ?? db?.database_id ?? db ?? "");
    if (dbId !== replacementId) fail(`${environment} config DB binding does not point to replacement after repair.`);
    if (envValue(config, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED") !== "false") fail(`${environment} server announcements flag is not false after repair.`);
    if (envValue(config, "DZN_DISCORD_NOTIFICATIONS_ENABLED") !== "false") fail(`${environment} Discord notifications flag is not false after repair.`);
  }
}

void (async () => {
  if (projectName !== "dzn-network-discord-announcements-preview") fail("Repair preview project constant mismatch.");
  if (projectName === productionProject) fail("Refusing to repair real production Pages project.");
  if (replacementName === productionName || oldName === productionName) fail("Refusing to repair using production D1 name.");

  const verify = await cloudflare("token-verify", "/user/tokens/verify", {}, false);
  if (!success(verify)) fail(`Cloudflare token verification failed: ${cloudflareError(verify)}`);

  const databases = await listPaginated("d1-database-list", "/d1/database", ["databases"]);
  const databasesById = new Map(databases.map((database) => [databaseId(database), String(database?.name ?? "unnamed")]));
  const oldDatabase = databases.find((database) => String(database?.name ?? "") === oldName);
  const replacementDatabase = databases.find((database) => String(database?.name ?? "") === replacementName);
  const productionDatabase = databases.find((database) => String(database?.name ?? "") === productionName);
  if (!oldDatabase) fail("Old stale preview D1 was not found.");
  if (!replacementDatabase) fail("Replacement preview D1 was not found.");
  const oldId = databaseId(oldDatabase);
  const replacementId = databaseId(replacementDatabase);
  const resolvedProductionId = productionId || databaseId(productionDatabase);
  const oldMask = maskId(oldId);
  const replacementMask = maskId(replacementId);
  if (oldMask !== oldExpectedMask) fail(`Old stale preview D1 masked ID changed; expected ${oldExpectedMask}, got ${oldMask}.`);
  if (oldId === resolvedProductionId || replacementId === resolvedProductionId) fail("Production D1 ID detected in repair path.");

  const project = await getProject(projectName);
  const productionProjectRecord = await getProject(productionProject);
  const productionSignature = productionProjectSignature(productionProjectRecord);
  const ids = { oldId, replacementId, productionId: resolvedProductionId };
  const bindings = projectD1Bindings(project, databasesById).filter((binding) => binding.binding === "DB");
  const productionBinding = bindings.find((binding) => binding.environment === "production");
  const previewBinding = bindings.find((binding) => binding.environment === "preview");
  const productionClassification = classifyBinding(productionBinding, ids);
  const previewClassification = classifyBinding(previewBinding, ids);
  const quarantined = productionClassification === "real production D1" || previewClassification === "real production D1";
  const latest = latestDeployment(project);

  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    console.log(`${environment} config DB binding classification: ${environment === "production" ? productionClassification : previewClassification}`);
    console.log(`${environment} config DB binding ID: ${maskId(String(config?.d1_databases?.DB?.id ?? config?.d1_databases?.DB?.database_id ?? config?.d1_databases?.DB ?? ""))}`);
    console.log(`${environment} DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: ${envValue(config, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED") || "unset"}`);
    console.log(`${environment} DZN_DISCORD_NOTIFICATIONS_ENABLED: ${envValue(config, "DZN_DISCORD_NOTIFICATIONS_ENABLED") || "unset"}`);
  }
  console.log(`Repair action: ${repairAction}`);
  console.log(`Latest deployment ID: ${latest.id}`);
  console.log(`Latest immutable URL: ${sanitize(latest.url)}`);
  console.log(`Latest deployment commit: ${sanitize(latest.commit)}`);
  console.log(`Latest deployment branch: ${sanitize(latest.branch)}`);
  console.log(`Preview project quarantined: ${quarantined ? "yes" : "no"}`);
  console.log(`Route probes allowed before repair: no`);

  appendSummary([
    "## Rebound Discord Preview Repair",
    "",
    `- Repair action: ${repairAction}`,
    `- Preview project: ${projectName}`,
    `- Replacement preview D1: ${replacementName}`,
    `- Replacement preview D1 ID: ${replacementMask}`,
    `- Old stale preview D1: ${oldName}`,
    `- Old stale preview D1 ID: ${oldMask}`,
    `- Production config DB classification: ${productionClassification}`,
    `- Preview config DB classification: ${previewClassification}`,
    `- Preview quarantined: ${quarantined ? "yes" : "no"}`,
    `- Latest deployment ID: ${latest.id}`,
    `- Latest immutable URL: ${sanitize(latest.url)}`,
    `- Latest deployment commit: ${sanitize(latest.commit)}`,
    `- Latest deployment branch: ${sanitize(latest.branch)}`,
    "- Dry-run patches Pages: no",
    "- Dry-run deploys Pages: no",
    "- Dry-run route probes: no",
    "- Discord messages sent: false",
  ]);

  if (repairAction === "dry-run") {
    console.log("Rebound Discord preview repair dry-run completed. No Pages binding changed and no route probes were made.");
    return;
  }

  const productionBranch = String(project?.production_branch ?? "");
  if (!productionBranch) fail("Discord preview Pages project production_branch is not configured.");
  const patchPayload = {
    deployment_configs: {
      production: patchD1Binding(project.deployment_configs?.production ?? {}, replacementId),
      preview: patchD1Binding(project.deployment_configs?.preview ?? {}, replacementId),
    },
  };
  console.log(`Applying preview-only repair config patch: project=${projectName} replacement=${replacementMask}`);
  const patch = await cloudflare("pages-project-patch", `/pages/projects/${encodeURIComponent(projectName)}`, {
    method: "PATCH",
    body: JSON.stringify(patchPayload),
  });
  if (!success(patch)) fail(`Preview repair config patch failed: ${cloudflareError(patch)}`);
  const afterProject = await getProject(projectName);
  verifyProjectSafe(afterProject, replacementId);

  fs.appendFileSync(process.env.GITHUB_ENV, [
    `REPAIR_REPLACEMENT_D1_DATABASE_ID=${replacementId}`,
    `REPAIR_OLD_D1_DATABASE_ID=${oldId}`,
    `REPAIR_PREVIEW_PROJECT_BRANCH=${productionBranch}`,
    `REPAIR_PRODUCTION_PROJECT_SIGNATURE=${Buffer.from(productionSignature).toString("base64")}`,
    `REPAIR_PREVIEW_STABLE_URL=https://${projectName}.pages.dev`,
    "",
  ].join("\n"));
  appendSummary([
    "",
    "- Repair config patch result: success",
    "- Both preview project environments use replacement D1 before deploy: yes",
    "- Both Discord flags false before deploy: yes",
  ]);
})().catch((error) => fail(error instanceof Error ? error.message : String(error)));
NODE
