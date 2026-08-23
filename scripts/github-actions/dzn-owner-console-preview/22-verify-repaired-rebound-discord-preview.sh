set -euo pipefail

node <<'NODE'
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.OWNER_CONSOLE_CF_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const projectName = process.env.REPAIR_PREVIEW_PROJECT_NAME;
const replacementName = process.env.REPAIR_REPLACEMENT_PREVIEW_DB_NAME;
const oldName = process.env.REPAIR_OLD_PREVIEW_DB_NAME;
const productionProject = process.env.PRODUCTION_PAGES_PROJECT_NAME;
const productionName = process.env.DETECTED_PRODUCTION_D1_DATABASE_NAME || process.env.PRODUCTION_D1_DATABASE_NAME;
const productionId = process.env.DETECTED_PRODUCTION_D1_DATABASE_ID || "";
const replacementId = process.env.REPAIR_REPLACEMENT_D1_DATABASE_ID;
const oldId = process.env.REPAIR_OLD_D1_DATABASE_ID;
const expectedProductionSignature = Buffer.from(process.env.REPAIR_PRODUCTION_PROJECT_SIGNATURE || "", "base64").toString("utf8");
const immutableUrl = process.env.REPAIR_IMMUTABLE_PREVIEW_URL;
const stableUrl = process.env.REPAIR_STABLE_PREVIEW_URL || `https://${projectName}.pages.dev`;
const productionUrl = "https://dzn-network.pages.dev";
const forbiddenText = [
  "Error 1102",
  "Worker exceeded resource limits",
  "Minified React error #",
  "stack trace",
  "TOKEN_ENCRYPTION_KEY",
  "SESSION_SECRET",
  "encrypted_token",
];

function fail(message) {
  console.error(String(message).replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]"));
  process.exit(1);
}
function assert(condition, message) {
  if (!condition) fail(message);
}
function envValue(config, key) {
  const value = config?.env_vars?.[key];
  if (value && typeof value === "object") return String(value.value ?? "");
  return String(value ?? "");
}
function collectD1Bindings(configValue, context) {
  const bindings = [];
  if (!configValue || typeof configValue !== "object") return bindings;
  for (const [binding, value] of Object.entries(configValue)) {
    if (typeof value === "string") bindings.push({ ...context, binding, id: value, name: "" });
    else if (value && typeof value === "object") bindings.push({
      ...context,
      binding,
      id: String(value.id ?? value.database_id ?? ""),
      name: String(value.database_name ?? value.name ?? ""),
    });
  }
  return bindings.filter((binding) => binding.id || binding.name);
}
function projectD1Bindings(project) {
  const bindings = [];
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    bindings.push(...collectD1Bindings(config.d1_databases, {
      project: project?.name ?? "unknown",
      environment,
    }));
  }
  return bindings;
}
function bindingMatches(binding, name, id) {
  return binding.id === id || binding.name === name;
}
function productionProjectSignature(project) {
  return projectD1Bindings(project)
    .filter((binding) => binding.binding === "DB")
    .map((binding) => `${binding.environment}:${binding.id || binding.name}`)
    .sort()
    .join("|");
}
function patchD1Binding(config, replacementId) {
  const currentD1 = config?.d1_databases && typeof config.d1_databases === "object" && !Array.isArray(config.d1_databases)
    ? { ...config.d1_databases }
    : {};
  const envVars = { ...(config?.env_vars ?? {}) };
  envVars.DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED = { type: "plain_text", value: "false" };
  envVars.DZN_DISCORD_NOTIFICATIONS_ENABLED = { type: "plain_text", value: "false" };
  return { ...(config ?? {}), env_vars: envVars, d1_databases: { ...currentD1, DB: { id: replacementId } } };
}
async function cloudflare(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok || parsed?.success === false) throw new Error(`Cloudflare API failed: ${response.status}`);
  return parsed.result;
}
async function getProject(name) {
  return await cloudflare(`/pages/projects/${encodeURIComponent(name)}`);
}
async function repatchAndFail(reason) {
  console.log(`PREVIEW_DEPLOY_CONFIGURATION_DRIFT: ${reason}`);
  const current = await getProject(projectName);
  await cloudflare(`/pages/projects/${encodeURIComponent(projectName)}`, {
    method: "PATCH",
    body: JSON.stringify({
      deployment_configs: {
        production: patchD1Binding(current.deployment_configs?.production ?? {}, replacementId),
        preview: patchD1Binding(current.deployment_configs?.preview ?? {}, replacementId),
      },
    }),
  });
  const repaired = await getProject(projectName);
  for (const environment of ["production", "preview"]) {
    const config = repaired?.deployment_configs?.[environment] ?? {};
    const db = config?.d1_databases?.DB;
    const dbId = String(db?.id ?? db?.database_id ?? db ?? "");
    assert(dbId === replacementId, `${environment} repatch did not restore replacement D1.`);
    assert(envValue(config, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED") === "false", `${environment} server announcements flag not false after drift repatch.`);
    assert(envValue(config, "DZN_DISCORD_NOTIFICATIONS_ENABLED") === "false", `${environment} Discord notifications flag not false after drift repatch.`);
  }
  fail("PREVIEW_DEPLOY_CONFIGURATION_DRIFT repaired on preview project; route probes skipped.");
}
async function d1Query(sql) {
  if (!/^\s*(SELECT|PRAGMA)\b/i.test(sql)) throw new Error("Refusing non-read-only verification query.");
  const result = await cloudflare(`/d1/database/${encodeURIComponent(replacementId)}/query`, {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
  const payload = Array.isArray(result) ? result : [result];
  return payload.flatMap((item) => item?.results ?? []);
}
async function fetchSafe(base, path) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    headers: {
      "User-Agent": "dzn-rebound-discord-preview-repair",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  const text = await response.text().catch(() => "");
  for (const marker of forbiddenText) {
    if (text.includes(marker)) throw new Error(`${base}${path} exposed forbidden marker ${marker}`);
  }
  return {
    response,
    text,
    status: response.status,
    contentType: response.headers.get("content-type") || "unknown",
    bodyLength: text.length,
  };
}
async function fetchPath(base, path, expectedStatus) {
  const result = await fetchSafe(base, path);
  if (result.status !== expectedStatus) {
    throw new Error(`${base}${path} expected ${expectedStatus}, got ${result.status}; content-type=${result.contentType}; body-length=${result.bodyLength}`);
  }
  return result;
}
function statusSummary(result) {
  return `status=${result.status} content-type=${result.contentType} body-length=${result.bodyLength}`;
}
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function expectOwnerApi401(base, path) {
  const result = await fetchSafe(base, path);
  if (result.status === 404) {
    throw new Error(`PREVIEW_PAGES_FUNCTIONS_WORKER_MISSING: ${base}${path} returned 404; ${statusSummary(result)}`);
  }
  if (result.status === 500 || result.status === 503) {
    throw new Error(`PREVIEW_OWNER_API_RUNTIME_ERROR: ${base}${path} returned ${result.status}; ${statusSummary(result)}`);
  }
  if (result.status !== 401) {
    throw new Error(`${base}${path} expected 401, got ${result.status}; ${statusSummary(result)}`);
  }
  return result;
}
async function verifyBase(base) {
  let lastError = "";
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      await fetchPath(base, "/", 200);
      const owner = await fetchSafe(base, "/owner");
      if (owner.status === 200) {
        const ownerApi = await fetchSafe(base, "/api/owner/overview");
        throw new Error(`PREVIEW_PAGES_FUNCTIONS_WORKER_MISSING: ${base}/owner returned 200 instead of 302; owner_api_${statusSummary(ownerApi)}`);
      }
      if (owner.status !== 302) {
        throw new Error(`${base}/owner expected 302, got ${owner.status}; ${statusSummary(owner)}`);
      }
      const location = owner.response.headers.get("location") || "";
      assert(location.includes("/login"), `${base}/owner did not redirect to login.`);
      await expectOwnerApi401(base, "/api/owner/overview");
      await expectOwnerApi401(base, "/api/owner/discord/overview");
      await fetchPath(base, "/api/public/servers", 200);
      await fetchPath(base, "/api/public/home-stats", 200);
      await fetchPath(base, "/api/public/leaderboards", 200);
      await fetchPath(base, "/api/public/server-rail", 200);
      const pulse = await fetchPath(base, "/api/dzn-pulse/config", 200);
      const parsed = JSON.parse(pulse.text);
      assert(parsed.discordNotificationsEnabled === false, `${base}/api/dzn-pulse/config did not report discordNotificationsEnabled=false.`);
      if (attempt > 1) console.log(`${base} preview route verification passed on attempt ${attempt}.`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.log(`Preview route verification attempt ${attempt}/12 failed for ${base}: ${lastError}`);
      if (attempt < 12) await wait(5000);
    }
  }
  fail(`Preview route verification failed after 12 attempts for ${base}: ${lastError}`);
}
void (async () => {
  assert(projectName !== productionProject, "Repair verification project is production.");
  const project = await getProject(projectName);
  const projectBindings = projectD1Bindings(project).filter((binding) => binding.binding === "DB");
  const oldProjectBindings = projectBindings.filter((binding) => bindingMatches(binding, oldName, oldId));
  const replacementProjectBindings = projectBindings.filter((binding) => bindingMatches(binding, replacementName, replacementId));
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    const db = config?.d1_databases?.DB;
    const dbId = String(db?.id ?? db?.database_id ?? db ?? "");
    if (dbId !== replacementId) await repatchAndFail(`${environment} config DB binding drifted away from replacement.`);
    if (dbId === productionId || dbId === productionName) await repatchAndFail(`${environment} config DB binding drifted to production D1.`);
    if (envValue(config, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED") !== "false") await repatchAndFail(`${environment} server announcements flag drifted.`);
    if (envValue(config, "DZN_DISCORD_NOTIFICATIONS_ENABLED") !== "false") await repatchAndFail(`${environment} Discord notifications flag drifted.`);
  }
  if (oldProjectBindings.length !== 0) await repatchAndFail(`old D1 project-config bindings=${oldProjectBindings.length}`);
  if (replacementProjectBindings.length !== 2) await repatchAndFail(`replacement D1 project-config bindings=${replacementProjectBindings.length}`);
  const productionProjectRecord = await getProject(productionProject);
  assert(productionProjectSignature(productionProjectRecord) === expectedProductionSignature, "Real production Pages project D1 binding signature changed.");

  const rowCountRows = await d1Query("SELECT COUNT(*) AS row_count FROM discord_announcement_posts;");
  const rowCount = Number(rowCountRows[0]?.row_count ?? NaN);
  assert(rowCount === 0, `discord_announcement_posts row count should remain 0, got ${rowCount}.`);
  await verifyBase(immutableUrl);
  await verifyBase(stableUrl);
  await fetchPath(productionUrl, "/", 200);
  await fetchPath(productionUrl, "/owner", 302);
  await fetchPath(productionUrl, "/api/owner/overview", 401);
  console.log(`Repaired rebound Discord preview verified: immutable=${immutableUrl} stable=${stableUrl}`);
  console.log(`Replacement DB ${replacementName} active; old DB ${oldName} project-config bindings=0.`);
  console.log("Discord messages sent: false");
})().catch((error) => fail(error instanceof Error ? error.message : String(error)));
NODE
