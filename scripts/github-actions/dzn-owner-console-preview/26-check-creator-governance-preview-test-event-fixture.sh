set -euo pipefail

case "${PREVIEW_DB_NAME}" in
  dzn_network_db_owner_console_preview_creator_governance_*) ;;
  *)
    echo "::error::Refusing creator-governance fixture check for non-governance preview database name."
    exit 1
    ;;
esac
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID}" ]; then
  echo "::error::Refusing creator-governance fixture check because preview D1 id equals production D1 id."
  exit 1
fi

node <<'NODE'
const fs = require("node:fs");
const eventName = process.env.OWNER_CONSOLE_CREATOR_EVENT_NAME ?? "";
if (!/^Creator Governance Preview Cup [a-f0-9]{7}$/.test(eventName)) {
  console.error("Creator-governance preview event name is missing or malformed.");
  process.exit(1);
}
function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
fs.writeFileSync("owner-console-creator-event-preflight.sql", `
SELECT COUNT(*) AS existing_event_count
FROM competitive_events
WHERE name = ${sql(eventName)};
`);
NODE

CHECK_SQL="$(cat owner-console-creator-event-preflight.sql)"
npx wrangler d1 execute DB \
  --config wrangler.owner-console-preview.toml \
  --remote \
  --json \
  --command "${CHECK_SQL}" \
  > owner-console-creator-event-preflight.json \
  2> owner-console-creator-event-preflight.stderr.log
echo "Creator-governance preview event fixture check completed without row deletion."
