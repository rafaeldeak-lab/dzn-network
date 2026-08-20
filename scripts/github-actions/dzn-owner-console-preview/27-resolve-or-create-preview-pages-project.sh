set -euo pipefail

if [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
  echo "::error::Refusing to resolve owner console preview against production Pages project."
  exit 1
fi
case "${PREVIEW_PROJECT_NAME}" in
  *owner*console*preview*|*owner-console-preview*) ;;
  *)
    echo "::error::Refusing non-preview owner console Pages project name."
    exit 1
    ;;
esac
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID}" ]; then
  echo "::error::Refusing preview Pages configuration because preview D1 id equals production D1 id."
  exit 1
fi

node <<'NODE'
const fs = require("node:fs");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.OWNER_CONSOLE_CF_TOKEN;
const projectName = process.env.PREVIEW_PROJECT_NAME;
const branch = process.env.CANDIDATE_BRANCH;
const previewBaseUrl = process.env.PREVIEW_BASE_URL;
const ownerPreviewDiscordClientId = process.env.OWNER_PREVIEW_DISCORD_CLIENT_ID || "1504270029795885178";
const previewRedirectUri = process.env.OWNER_PREVIEW_DISCORD_REDIRECT_URI || `${previewBaseUrl}/api/auth/discord/callback`;
const d1Id = process.env.PREVIEW_D1_DATABASE_ID;
const previewDbName = process.env.PREVIEW_DB_NAME;
function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
async function api(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
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
    parsed = { success: false, errors: [{ code: "non_json", message: "Cloudflare API returned non-JSON response." }] };
  }
  return { ok: response.ok, status: response.status, parsed };
}
function envVars(config) {
  return config?.env_vars && typeof config.env_vars === "object" ? config.env_vars : {};
}
function d1Databases(config) {
  return config?.d1_databases && typeof config.d1_databases === "object" ? config.d1_databases : {};
}
function mergeConfig(config) {
  return {
    ...config,
    env_vars: {
      ...envVars(config),
      DZN_PULSE_ENABLED: { type: "plain_text", value: "true" },
      DZN_DISCORD_NOTIFICATIONS_ENABLED: { type: "plain_text", value: "false" },
      DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: { type: "plain_text", value: "false" },
      DZN_APP_URL: { type: "plain_text", value: previewBaseUrl },
      NEXT_PUBLIC_APP_URL: { type: "plain_text", value: previewBaseUrl },
      DISCORD_CLIENT_ID: { type: "plain_text", value: ownerPreviewDiscordClientId },
      DISCORD_REDIRECT_URI: { type: "plain_text", value: previewRedirectUri },
    },
    d1_databases: {
      ...d1Databases(config),
      DB: { id: d1Id },
    },
  };
}
function errorMessage(result, fallback) {
  const errors = result.parsed?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((error) => `[${error.code ?? "unknown"}] ${error.message ?? "Cloudflare API error"}`).join("; ");
  }
  return fallback;
}
void (async () => {
  const get = await api(`/pages/projects/${projectName}`);
  let project = null;
  if (get.status === 404) {
    const created = await api("/pages/projects", {
      method: "POST",
      body: JSON.stringify({ name: projectName, production_branch: branch }),
    });
    if (!created.ok || created.parsed.success === false) {
      fail(errorMessage(created, "Failed to create preview Pages project."));
    }
    project = created.parsed.result ?? null;
    console.log(`Created preview Pages project: ${projectName}`);
  } else if (!get.ok || get.parsed.success === false) {
    fail(errorMessage(get, "Failed to read preview Pages project."));
  } else {
    project = get.parsed.result ?? null;
    console.log(`Reusing preview Pages project: ${projectName}`);
  }

  const patched = await api(`/pages/projects/${projectName}`, {
    method: "PATCH",
    body: JSON.stringify({
      production_branch: branch,
      deployment_configs: {
        production: mergeConfig(project?.deployment_configs?.production ?? {}),
        preview: mergeConfig(project?.deployment_configs?.preview ?? {}),
      },
    }),
  });
  if (!patched.ok || patched.parsed.success === false) {
    fail(errorMessage(patched, "Failed to configure preview Pages project."));
  }

  const wranglerToml = [
    `name = ${JSON.stringify(projectName)}`,
    'compatibility_date = "2026-05-13"',
    'pages_build_output_dir = "out"',
    "",
    "[vars]",
    'DZN_PULSE_ENABLED = "true"',
    'DZN_DISCORD_NOTIFICATIONS_ENABLED = "false"',
    'DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED = "false"',
    `DZN_APP_URL = ${JSON.stringify(previewBaseUrl)}`,
    `NEXT_PUBLIC_APP_URL = ${JSON.stringify(previewBaseUrl)}`,
    `DISCORD_CLIENT_ID = ${JSON.stringify(ownerPreviewDiscordClientId)}`,
    `DISCORD_REDIRECT_URI = ${JSON.stringify(previewRedirectUri)}`,
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = ${JSON.stringify(previewDbName)}`,
    `database_id = ${JSON.stringify(d1Id)}`,
    "",
  ].join("\n");
  fs.writeFileSync("wrangler.toml", wranglerToml);
  console.log(`Configured preview Pages project: ${projectName}`);
  console.log(`Configured preview URL: ${previewBaseUrl}`);
  console.log(`Configured preview Discord callback URL: ${previewRedirectUri}`);
  console.log(`Configured preview D1 binding DB id: ${maskId(d1Id)}`);
})().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
NODE
