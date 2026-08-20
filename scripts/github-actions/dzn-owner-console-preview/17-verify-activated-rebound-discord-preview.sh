set -euo pipefail

node <<'NODE'
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.OWNER_CONSOLE_CF_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const projectName = process.env.ACTIVATE_PREVIEW_PROJECT_NAME;
const replacementId = process.env.ACTIVATE_REPLACEMENT_D1_DATABASE_ID;
const oldName = process.env.ACTIVATE_OLD_PREVIEW_DB_NAME;
const replacementName = process.env.ACTIVATE_REPLACEMENT_PREVIEW_DB_NAME;
const productionProject = process.env.PRODUCTION_PAGES_PROJECT_NAME;
const immutableUrl = process.env.ACTIVATE_IMMUTABLE_PREVIEW_URL;
const stableUrl = process.env.ACTIVATE_STABLE_PREVIEW_URL || `https://${projectName}.pages.dev`;
const productionUrl = "https://dzn-network.pages.dev";
const forbiddenText = [
  "Error 1102",
  "Worker exceeded resource limits",
  "Minified React error #",
  "Owner console data could not be loaded",
  "Owner console error",
  "encrypted_token",
  "TOKEN_ENCRYPTION_KEY",
  "SESSION_SECRET",
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
  if (!response.ok || parsed?.success === false) {
    throw new Error(`Cloudflare read failed: ${response.status}`);
  }
  return parsed.result;
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
async function fetchPath(base, path, expectedStatus, options = {}) {
  const response = await fetch(`${base}${path}`, {
    redirect: options.redirect ?? "manual",
    headers: { "User-Agent": "dzn-rebound-discord-preview-activation" },
  });
  const text = await response.text().catch(() => "");
  if (response.status !== expectedStatus) {
    throw new Error(`${base}${path} expected ${expectedStatus}, got ${response.status}`);
  }
  for (const marker of forbiddenText) {
    if (text.includes(marker)) throw new Error(`${base}${path} exposed forbidden marker ${marker}`);
  }
  return { response, text };
}
async function verifyBase(base) {
  await fetchPath(base, "/", 200);
  const owner = await fetchPath(base, "/owner", 302);
  const location = owner.response.headers.get("location") || "";
  assert(location.includes("/login"), `${base}/owner did not redirect to login.`);
  await fetchPath(base, "/api/owner/overview", 401);
  await fetchPath(base, "/api/owner/discord/overview", 401);
  await fetchPath(base, "/api/public/servers", 200);
  await fetchPath(base, "/api/public/home-stats", 200);
  await fetchPath(base, "/api/public/leaderboards", 200);
  await fetchPath(base, "/api/public/server-rail", 200);
  const pulse = await fetchPath(base, "/api/dzn-pulse/config", 200);
  const parsed = JSON.parse(pulse.text);
  assert(parsed.discordNotificationsEnabled === false, `${base}/api/dzn-pulse/config did not report discordNotificationsEnabled=false.`);
}
async function repeatedSamples(base) {
  for (const path of ["/owner", "/api/owner/overview", "/api/public/servers", "/api/public/home-stats", "/api/public/leaderboards"]) {
    for (let index = 0; index < 3; index += 1) {
      const expected = path === "/owner" ? 302 : path === "/api/owner/overview" ? 401 : 200;
      await fetchPath(base, path, expected);
    }
  }
}
void (async () => {
  assert(projectName !== productionProject, "Activation verification project is production.");
  const project = await cloudflare(`/pages/projects/${encodeURIComponent(projectName)}`);
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    const db = config?.d1_databases?.DB;
    const dbId = String(db?.id ?? db?.database_id ?? db ?? "");
    assert(dbId === replacementId, `${environment} config DB binding does not point to replacement after deploy.`);
    assert(envValue(config, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED") === "false", `${environment} server announcements flag is not false after deploy.`);
    assert(envValue(config, "DZN_DISCORD_NOTIFICATIONS_ENABLED") === "false", `${environment} Discord notifications flag is not false after deploy.`);
  }
  const rowCountRows = await d1Query("SELECT COUNT(*) AS row_count FROM discord_announcement_posts;");
  const rowCount = Number(rowCountRows[0]?.row_count ?? NaN);
  assert(rowCount === 0, `discord_announcement_posts row count should remain 0, got ${rowCount}.`);
  await verifyBase(immutableUrl);
  await verifyBase(stableUrl);
  await repeatedSamples(stableUrl);
  await fetchPath(productionUrl, "/", 200);
  await fetchPath(productionUrl, "/owner", 302);
  await fetchPath(productionUrl, "/api/owner/overview", 401);
  console.log(`Activated rebound Discord preview verified: immutable=${immutableUrl} stable=${stableUrl}`);
  console.log(`Replacement DB ${replacementName} remains bound; old DB ${oldName} not used by project config.`);
})().catch((error) => fail(error instanceof Error ? error.message : String(error)));
NODE
