set -euo pipefail

if [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
  echo "::error::Refusing to deploy owner console preview to production Pages project."
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
  echo "::error::Refusing preview deploy because preview D1 id equals production D1 id."
  exit 1
fi

DZN_PULSE_ENABLED=true \
DZN_DISCORD_NOTIFICATIONS_ENABLED=false \
DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED=false \
DZN_APP_URL="${PREVIEW_BASE_URL}" \
NEXT_PUBLIC_APP_URL="${PREVIEW_BASE_URL}" \
DISCORD_CLIENT_ID="${OWNER_PREVIEW_DISCORD_CLIENT_ID}" \
DISCORD_REDIRECT_URI="${OWNER_PREVIEW_DISCORD_REDIRECT_URI}" \
npm run build
npx wrangler pages deploy out \
  --project-name "${PREVIEW_PROJECT_NAME}" \
  --branch "${CANDIDATE_BRANCH}" \
  --commit-dirty=true \
  | tee owner-console-pages-deploy.txt

node <<'NODE'
const fs = require("node:fs");
const deployText = fs.readFileSync("owner-console-pages-deploy.txt", "utf8");
const immutableUrl = deployText.match(/https:\/\/[^\s]+\.pages\.dev/)?.[0] ?? "";
const stableUrl = `https://${process.env.PREVIEW_PROJECT_NAME}.pages.dev`;
fs.writeFileSync("owner-console-preview-url.txt", `${stableUrl}\n`);
if (immutableUrl) fs.writeFileSync("owner-console-preview-immutable-url.txt", `${immutableUrl}\n`);
console.log(`Preview URL: ${stableUrl}`);
if (immutableUrl) console.log(`Immutable preview URL: ${immutableUrl}`);
NODE
