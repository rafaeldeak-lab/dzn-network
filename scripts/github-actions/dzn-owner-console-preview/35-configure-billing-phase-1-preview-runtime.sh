set -euo pipefail

if [ "${MODE}" != "billing-phase-1-preview" ]; then
  echo "::error::35-configure-billing-phase-1-preview-runtime.sh may only run in billing-phase-1-preview mode."
  exit 1
fi
if [ "${PREVIEW_PROJECT_NAME}" != "${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}" ] || [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ] || [ "${PREVIEW_PROJECT_NAME}" = "dzn-network" ]; then
  echo "::error::Refusing Billing runtime configuration for a non-dedicated or production Pages project."
  exit 1
fi
if [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${PREVIEW_DB_NAME}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME:-}" ]; then
  echo "::error::Refusing Billing runtime configuration for production D1 database name."
  exit 1
fi
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID:-}" ]; then
  echo "::error::Refusing Billing runtime configuration because preview D1 id equals production D1 id."
  exit 1
fi
if [ "${PREVIEW_BASE_URL}" != "https://dzn-network-owner-console-preview-billing-phase-1.pages.dev" ]; then
  echo "::error::Billing runtime must use the dedicated Billing preview stable URL."
  exit 1
fi
if [ -z "${TOKEN_ENCRYPTION_KEY:-}" ] || [ -z "${OWNER_PREVIEW_SESSION_SECRET:-}" ] || [ -z "${OWNER_PREVIEW_DISCORD_CLIENT_SECRET:-}" ]; then
  echo "::error::Missing required ephemeral Billing preview secret values."
  exit 1
fi

SECRET_LIST_FILE="${RUNNER_TEMP:-.}/billing-phase-1-preview-secret-list.txt"
trap 'rm -f "${SECRET_LIST_FILE}"' EXIT

node <<'NODE'
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.OWNER_CONSOLE_CF_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const projectName = process.env.PREVIEW_PROJECT_NAME;
const expectedProject = process.env.BILLING_PHASE_1_PREVIEW_PROJECT_NAME;
const previewBaseUrl = process.env.PREVIEW_BASE_URL;
const d1Id = process.env.PREVIEW_D1_DATABASE_ID;
const productionProject = process.env.PRODUCTION_PAGES_PROJECT_NAME;
const ownerPreviewDiscordClientId = process.env.OWNER_PREVIEW_DISCORD_CLIENT_ID || "990000000000000199";
const ownerPreviewDiscordRedirectUri = process.env.OWNER_PREVIEW_DISCORD_REDIRECT_URI || `${previewBaseUrl}/api/auth/discord/callback`;

function fail(message) {
  console.error(message);
  process.exit(1);
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
      MOCK_AUTH: { type: "plain_text", value: "true" },
      MOCK_NITRADO: { type: "plain_text", value: "true" },
      DZN_BILLING_PREVIEW_DIAGNOSTICS: { type: "plain_text", value: "true" },
      DZN_PULSE_ENABLED: { type: "plain_text", value: "true" },
      DZN_DISCORD_NOTIFICATIONS_ENABLED: { type: "plain_text", value: "false" },
      DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: { type: "plain_text", value: "false" },
      DZN_APP_URL: { type: "plain_text", value: previewBaseUrl },
      NEXT_PUBLIC_APP_URL: { type: "plain_text", value: previewBaseUrl },
      DISCORD_CLIENT_ID: { type: "plain_text", value: ownerPreviewDiscordClientId },
      DISCORD_REDIRECT_URI: { type: "plain_text", value: ownerPreviewDiscordRedirectUri },
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
    return errors.map((error) => `[${error.code ?? "unknown"}] ${String(error.message ?? "Cloudflare API error").replace(/[A-Za-z0-9_-]{48,}/g, "[redacted]")}`).join("; ");
  }
  return fallback;
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
void (async () => {
  if (projectName !== expectedProject || projectName === productionProject || projectName === "dzn-network") {
    fail("Billing runtime configuration target is not the dedicated preview project.");
  }
  const get = await api(`/pages/projects/${encodeURIComponent(projectName)}`);
  if (!get.ok || get.parsed.success === false) fail(errorMessage(get, "Failed to read Billing preview Pages project."));
  const project = get.parsed.result ?? null;
  const patched = await api(`/pages/projects/${encodeURIComponent(projectName)}`, {
    method: "PATCH",
    body: JSON.stringify({
      production_branch: process.env.CANDIDATE_BRANCH,
      deployment_configs: {
        production: mergeConfig(project?.deployment_configs?.production ?? {}),
        preview: mergeConfig(project?.deployment_configs?.preview ?? {}),
      },
    }),
  });
  if (!patched.ok || patched.parsed.success === false) fail(errorMessage(patched, "Failed to configure Billing preview Pages runtime variables."));
  console.log(`Billing preview Pages runtime variables configured for ${projectName}.`);
})().catch((error) => fail(error instanceof Error ? error.message : String(error)));
NODE

printf "%s" "$TOKEN_ENCRYPTION_KEY" | npx wrangler pages secret put TOKEN_ENCRYPTION_KEY --project-name "${PREVIEW_PROJECT_NAME}" >/dev/null
printf "%s" "$OWNER_PREVIEW_SESSION_SECRET" | npx wrangler pages secret put SESSION_SECRET --project-name "${PREVIEW_PROJECT_NAME}" >/dev/null
printf "%s" "$OWNER_PREVIEW_DISCORD_CLIENT_SECRET" | npx wrangler pages secret put DISCORD_CLIENT_SECRET --project-name "${PREVIEW_PROJECT_NAME}" >/dev/null

npx wrangler pages secret list --project-name "${PREVIEW_PROJECT_NAME}" > "${SECRET_LIST_FILE}"
node <<'NODE'
const fs = require("node:fs");
const path = process.env.SECRET_LIST_FILE || `${process.env.RUNNER_TEMP || "."}/billing-phase-1-preview-secret-list.txt`;
const text = fs.readFileSync(path, "utf8");
for (const name of ["TOKEN_ENCRYPTION_KEY", "SESSION_SECRET", "DISCORD_CLIENT_SECRET"]) {
  if (!text.includes(name)) {
    console.error(`Billing preview secret name missing after configuration: ${name}`);
    process.exit(1);
  }
}
for (const forbidden of ["DISCORD_BOT_TOKEN", "STRIPE_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NITRADO_TOKEN"]) {
  if (text.includes(forbidden)) {
    console.error(`Forbidden secret name present in Billing preview secret list: ${forbidden}`);
    process.exit(1);
  }
}
console.log("Billing preview secret names verified: TOKEN_ENCRYPTION_KEY, SESSION_SECRET, DISCORD_CLIENT_SECRET.");
NODE

{
  echo "## Billing Phase 1 Runtime Configuration"
  echo ""
  echo "- Preview Pages project: ${PREVIEW_PROJECT_NAME}"
  echo "- Plain-text flags: MOCK_AUTH=true, MOCK_NITRADO=true, DZN_BILLING_PREVIEW_DIAGNOSTICS=true, DZN_PULSE_ENABLED=true"
  echo "- Discord notification flags: false"
  echo "- App URL: ${PREVIEW_BASE_URL}"
  echo "- Preview secret names verified: TOKEN_ENCRYPTION_KEY, SESSION_SECRET, DISCORD_CLIENT_SECRET"
  echo "- Forbidden secret names configured: false"
} >> "$GITHUB_STEP_SUMMARY"
