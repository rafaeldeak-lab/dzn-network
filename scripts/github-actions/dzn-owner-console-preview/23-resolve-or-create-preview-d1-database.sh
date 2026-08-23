set -euo pipefail

case "${PREVIEW_DB_NAME}" in
  *owner_console_preview*) ;;
  *)
    echo "::error::Refusing D1 command for non-preview owner console database name."
    exit 1
    ;;
esac

node <<'NODE'
const fs = require("node:fs");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.OWNER_CONSOLE_CF_TOKEN;
const previewName = process.env.PREVIEW_DB_NAME;
const productionName = process.env.DETECTED_PRODUCTION_D1_DATABASE_NAME || process.env.PRODUCTION_D1_DATABASE_NAME;
const productionId = process.env.DETECTED_PRODUCTION_D1_DATABASE_ID;
const configuredLimit = Number(process.env.D1_ACCOUNT_DATABASE_LIMIT || "10");
function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}
function sanitizeMessage(message) {
  return String(message ?? "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]");
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
  return database?.uuid ?? database?.id ?? "";
}
function cleanupCandidates(databases) {
  return databases
    .filter((item) => {
      const name = String(item?.name ?? "");
      const id = databaseId(item);
      return name !== productionName && id !== productionId && isApprovedPreviewName(name) && name !== previewName;
    })
    .map((item) => ({ name: item.name, id: maskId(databaseId(item)), created_at: item.created_at ?? item.created_on ?? "unknown" }));
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
    parsed = { success: false, errors: [{ message: "Cloudflare API returned non-JSON response." }] };
  }
  if (!response.ok || parsed.success === false) {
    const message = parsed.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return parsed;
}
function writeCapacitySummary({ databases, database, candidates }) {
  const lines = [
    "## Preview D1 Capacity Preflight",
    "",
    `- Current D1 database count: ${databases.length}`,
    `- Configured D1 database limit: ${Number.isFinite(configuredLimit) ? configuredLimit : "unknown"}`,
    `- Requested preview D1: ${previewName}`,
    `- Requested preview D1 exists: ${database ? "yes" : "no"}`,
    `- Preview-only cleanup candidates requiring review: ${candidates.length}`,
    "- Production D1 protected by name and ID: yes",
    "- Automatic deletion: none",
  ];
  for (const candidate of candidates.slice(0, 10)) {
    lines.push(`- Candidate: ${candidate.name} (${candidate.id})`);
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}
void (async () => {
  if (previewName === productionName) throw new Error("preview_db_name equals production database name.");
  const list = await api("/d1/database?per_page=100");
  const databases = Array.isArray(list.result) ? list.result : list.result?.databases ?? [];
  let database = databases.find((item) => item?.name === previewName);
  const candidates = cleanupCandidates(databases);
  console.log(`D1 database count: ${databases.length}`);
  console.log(`D1 database limit: ${Number.isFinite(configuredLimit) ? configuredLimit : "unknown"}`);
  console.log(`Requested preview D1 exists: ${database ? "yes" : "no"}`);
  console.log(`Preview-only cleanup candidates requiring review: ${candidates.length}`);
  for (const candidate of candidates.slice(0, 10)) {
    console.log(`Preview cleanup candidate: ${candidate.name} id=${candidate.id}`);
  }
  writeCapacitySummary({ databases, database, candidates });
  if (!database && Number.isFinite(configuredLimit) && databases.length >= configuredLimit) {
    console.error("PREVIEW_D1_CAPACITY_EXHAUSTED");
    console.error(`Requested preview D1 database ${previewName} does not exist and the account is at the configured D1 database limit.`);
    console.error("No preview migrations, seed, Pages configuration, deployment, or event creation were attempted.");
    process.exit(1);
  }
  if (!database) {
    try {
      database = (await api("/d1/database", {
        method: "POST",
        body: JSON.stringify({ name: previewName }),
      })).result;
    } catch (error) {
      const message = sanitizeMessage(error instanceof Error ? error.message : String(error));
      if (/System limit reached|databases per account/i.test(message)) {
        console.error("PREVIEW_D1_CAPACITY_EXHAUSTED");
        console.error(`Cloudflare rejected preview D1 creation for ${previewName}: ${message}`);
        console.error("No preview migrations, seed, Pages configuration, deployment, or event creation were attempted.");
        process.exit(1);
      }
      throw error;
    }
  } else {
    console.log(`Reusing existing preview D1 database: ${previewName} id=${maskId(databaseId(database))}`);
  }
  const previewId = database?.uuid ?? database?.id;
  if (!previewId) throw new Error("Could not resolve preview D1 database id.");
  if (previewId === productionId) throw new Error("Preview D1 database id equals production D1 database id.");
  fs.writeFileSync("owner-console-preview-d1.json", JSON.stringify({ name: previewName, id: previewId }, null, 2));
  fs.writeFileSync("wrangler.owner-console-preview.toml", [
    'name = "dzn-owner-console-preview-d1"',
    'compatibility_date = "2026-05-13"',
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = "${previewName}"`,
    `database_id = "${previewId}"`,
    "",
  ].join("\n"));
  fs.appendFileSync(process.env.GITHUB_ENV, `PREVIEW_D1_DATABASE_ID=${previewId}\n`);
  console.log(`::add-mask::${previewId}`);
  console.log(`Preview D1 database name: ${previewName}`);
  console.log(`Preview D1 database id: ${maskId(previewId)}`);
})().catch((error) => {
  console.error(sanitizeMessage(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
NODE
