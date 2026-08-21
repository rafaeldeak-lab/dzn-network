set -euo pipefail

if [ "${MODE}" != "rebind-preview-d1" ] && [ "${CONFIRM_PREVIEW_ONLY}" != "PREVIEW_ONLY" ]; then
  echo "::error::confirm_preview_only must equal PREVIEW_ONLY."
  exit 1
fi
if [ "${MODE}" = "rebind-preview-d1" ] && [ -n "${CONFIRM_PREVIEW_ONLY:-}" ] && [ "${CONFIRM_PREVIEW_ONLY}" != "PREVIEW_ONLY" ]; then
  echo "::error::confirm_preview_only, when provided for rebind-preview-d1 mode, must equal PREVIEW_ONLY."
  exit 1
fi

if [ -z "${CANDIDATE_BRANCH:-}" ] || [ -z "${CANDIDATE_SHA:-}" ] || [ -z "${CANDIDATE_REF:-}" ]; then
  echo "::error::Missing canonical GitHub workflow ref identity."
  exit 1
fi
case "${CANDIDATE_REF}" in
  refs/heads/feature/owner-console|refs/heads/feature/creator-only-event-governance|refs/heads/feature/event-platform-performance-foundation) ;;
  refs/heads/main|refs/heads/master|refs/heads/production)
    echo "::error::Owner console preview must never run from main, master, or production."
    exit 1
    ;;
  refs/tags/*)
    echo "::error::Owner console preview does not accept tag refs."
    exit 1
    ;;
  refs/pull/*)
    echo "::error::Owner console preview does not accept pull-request merge refs."
    exit 1
    ;;
  *)
    echo "::error::Owner console preview may only run from feature/owner-console, feature/creator-only-event-governance, or feature/event-platform-performance-foundation."
    exit 1
    ;;
esac
case "${CANDIDATE_BRANCH}" in
  feature/owner-console|feature/creator-only-event-governance|feature/event-platform-performance-foundation) ;;
  main|master|production)
    echo "::error::Owner console preview must never run from main, master, or production."
    exit 1
    ;;
  *)
    echo "::error::Owner console preview may only run from feature/owner-console, feature/creator-only-event-governance, or feature/event-platform-performance-foundation."
    exit 1
    ;;
esac
if [ "${CANDIDATE_BRANCH}" = "feature/event-platform-performance-foundation" ] && [ "${MODE}" != "event-platform-performance-preview" ] && [ "${MODE}" != "billing-phase-1-preview" ] && [ "${MODE}" != "audit-preview-d1-capacity" ]; then
  echo "::error::feature/event-platform-performance-foundation may only run event-platform-performance-preview, billing-phase-1-preview, or audit-preview-d1-capacity mode."
  exit 1
fi

CHECKED_OUT_HEAD="$(git rev-parse HEAD)"
if [ "${CHECKED_OUT_HEAD}" != "${CANDIDATE_SHA}" ]; then
  echo "::error::Checked-out commit does not match github.sha."
  exit 1
fi
CHECKED_OUT_TREE="$(git rev-parse "HEAD^{tree}")"
git fetch origin "${CANDIDATE_BRANCH}:refs/remotes/origin/${CANDIDATE_BRANCH}" --depth=1
REMOTE_FEATURE_HEAD="$(git rev-parse "origin/${CANDIDATE_BRANCH}")"
if [ "${REMOTE_FEATURE_HEAD}" != "${CANDIDATE_SHA}" ]; then
  echo "::error::Selected workflow ref SHA is not the current remote branch head."
  exit 1
fi

CANDIDATE_SHORT_SHA="${CANDIDATE_SHA:0:7}"
if ! [[ "${CANDIDATE_SHORT_SHA}" =~ ^[a-f0-9]{7}$ ]]; then
  echo "::error::github.sha does not produce a valid short SHA."
  exit 1
fi
if [ "${MODE}" = "verify-existing-creator-governance-preview" ]; then
  PREVIEW_DB_NAME="${EXISTING_CREATOR_GOVERNANCE_PREVIEW_DB_NAME}"
elif [ "${MODE}" = "event-platform-performance-preview" ]; then
  PREVIEW_DB_NAME="${EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME}"
elif [ "${MODE}" = "billing-phase-1-preview" ]; then
  PREVIEW_PROJECT_NAME="${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}"
  PREVIEW_DB_NAME="${BILLING_PHASE_1_PREVIEW_DB_PREFIX}${CANDIDATE_SHORT_SHA}"
  PREVIEW_BASE_URL="${BILLING_PHASE_1_PREVIEW_STABLE_URL}"
elif [ "${MODE}" = "full-preview" ] && [ "${CANDIDATE_BRANCH}" = "feature/creator-only-event-governance" ]; then
  PREVIEW_DB_NAME="dzn_network_db_owner_console_preview_creator_governance_${CANDIDATE_SHORT_SHA}"
else
  PREVIEW_DB_NAME="dzn_network_db_owner_console_preview"
fi

if [ "${MODE}" = "verify-existing-creator-governance-preview" ]; then
  CREATOR_EVENT_NAME="${EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_NAME}"
else
  CREATOR_EVENT_NAME="Creator Governance Preview Cup ${CANDIDATE_SHORT_SHA}"
fi
{
  printf "OWNER_CONSOLE_CANDIDATE_SHORT_SHA=%s\n" "$CANDIDATE_SHORT_SHA"
  printf "OWNER_CONSOLE_CANDIDATE_BRANCH=%s\n" "$CANDIDATE_BRANCH"
  printf "OWNER_CONSOLE_CANDIDATE_SHA=%s\n" "$CANDIDATE_SHA"
  printf "OWNER_CONSOLE_CANDIDATE_TREE_SHA=%s\n" "$CHECKED_OUT_TREE"
  printf "OWNER_CONSOLE_REMOTE_BRANCH_HEAD=%s\n" "$REMOTE_FEATURE_HEAD"
  printf "OWNER_CONSOLE_CREATOR_EVENT_NAME=%s\n" "$CREATOR_EVENT_NAME"
  printf "PREVIEW_PROJECT_NAME=%s\n" "$PREVIEW_PROJECT_NAME"
  printf "PREVIEW_DB_NAME=%s\n" "$PREVIEW_DB_NAME"
  printf "PREVIEW_BASE_URL=%s\n" "$PREVIEW_BASE_URL"
} >> "$GITHUB_ENV"

if [ "${MODE}" = "activate-rebound-discord-preview" ]; then
  echo "::error::ACTIVATION_MODE_DEPRECATED_USE_REPAIR_MODE"
  exit 1
fi

case "${MODE}" in
  full-preview|cleanup-preview-d1|rebind-preview-d1|repair-rebound-discord-preview|verify-existing-creator-governance-preview|event-platform-performance-preview|billing-phase-1-preview|audit-preview-d1-capacity) ;;
  *)
    echo "::error::Owner console preview only supports full-preview, cleanup-preview-d1, rebind-preview-d1, repair-rebound-discord-preview, verify-existing-creator-governance-preview, event-platform-performance-preview, billing-phase-1-preview, or audit-preview-d1-capacity mode."
    exit 1
    ;;
esac

if [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
  echo "::error::Preview Pages project must not equal the production Pages project."
  exit 1
fi

case "${PREVIEW_PROJECT_NAME}" in
  *owner*console*preview*|*owner-console-preview*) ;;
  *)
    echo "::error::Preview Pages project name must contain owner console preview."
    exit 1
    ;;
esac

if [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ]; then
  echo "::error::Preview D1 database must not equal production D1 database."
  exit 1
fi

case "${PREVIEW_DB_NAME}" in
  *owner_console_preview*) ;;
  *)
    echo "::error::Preview D1 database name must contain owner_console_preview."
    exit 1
    ;;
esac
if [ "${MODE}" = "full-preview" ] && [ "${CANDIDATE_BRANCH}" = "feature/creator-only-event-governance" ]; then
  case "${PREVIEW_DB_NAME}" in
    dzn_network_db_owner_console_preview_creator_governance_*) ;;
    *)
      echo "::error::feature/creator-only-event-governance requires derived preview DB name beginning with dzn_network_db_owner_console_preview_creator_governance_."
      exit 1
      ;;
  esac
  if [ "${PREVIEW_DB_NAME}" != "dzn_network_db_owner_console_preview_creator_governance_${CANDIDATE_SHORT_SHA}" ]; then
    echo "::error::feature/creator-only-event-governance derived preview DB name mismatch."
    exit 1
  fi
fi
if [ "${MODE}" = "verify-existing-creator-governance-preview" ]; then
  if [ "${CANDIDATE_BRANCH}" != "feature/creator-only-event-governance" ]; then
    echo "::error::verify-existing-creator-governance-preview mode may only run from feature/creator-only-event-governance."
    exit 1
  fi
  if [ "${CONFIRM_EXISTING_CREATOR_GOVERNANCE_PREVIEW}" != "VERIFY_EXISTING_CREATOR_GOVERNANCE_PREVIEW" ]; then
    echo "::error::confirm_existing_creator_governance_preview must equal VERIFY_EXISTING_CREATOR_GOVERNANCE_PREVIEW for verify-existing-creator-governance-preview mode."
    exit 1
  fi
  if [ "${EXISTING_CREATOR_GOVERNANCE_PREVIEW_PROJECT_NAME}" != "dzn-network-owner-console-preview" ]; then
    echo "::error::Existing creator-governance preview project constant mismatch."
    exit 1
  fi
  if [ "${EXISTING_CREATOR_GOVERNANCE_PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ]; then
    echo "::error::Refusing existing creator-governance verification for production D1 database name."
    exit 1
  fi
  if [ "${EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_NAME}" != "Creator Governance Preview Cup 0919c46" ]; then
    echo "::error::Existing creator-governance preview event constant mismatch."
    exit 1
  fi
  if [ "${EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_SLUG}" != "creator-governance-preview-cup-0919c46" ]; then
    echo "::error::Existing creator-governance preview slug constant mismatch."
    exit 1
  fi
fi
if [ "${MODE}" = "event-platform-performance-preview" ]; then
  if [ "${CANDIDATE_BRANCH}" != "feature/event-platform-performance-foundation" ]; then
    echo "::error::event-platform-performance-preview mode may only run from feature/event-platform-performance-foundation."
    exit 1
  fi
  if [ "${CONFIRM_EVENT_PLATFORM_PERFORMANCE_PREVIEW}" != "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_CONFIRMATION}" ]; then
    echo "::error::confirm_event_platform_performance_preview must equal APPROVE_EVENT_PLATFORM_PERFORMANCE_PREVIEW for event-platform-performance-preview mode."
    exit 1
  fi
  if [ "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME}" != "dzn-network-owner-console-preview" ]; then
    echo "::error::Event platform performance preview project constant mismatch."
    exit 1
  fi
  if [ "${PREVIEW_PROJECT_NAME}" != "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME}" ]; then
    echo "::error::Event platform performance preview must use the fixed owner-console preview project."
    exit 1
  fi
  if [ "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME}" != "dzn_network_db_owner_console_preview_creator_governance_0919c46" ]; then
    echo "::error::Event platform performance preview database constant mismatch."
    exit 1
  fi
  if [ "${PREVIEW_DB_NAME}" != "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME}" ]; then
    echo "::error::Event platform performance preview must use the fixed reusable preview D1."
    exit 1
  fi
  if [ "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ]; then
    echo "::error::Refusing event platform performance preview for production D1 database name."
    exit 1
  fi
  if [ "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
    echo "::error::Refusing event platform performance preview for production Pages project."
    exit 1
  fi
fi
if [ "${MODE}" = "billing-phase-1-preview" ]; then
  if [ "${CANDIDATE_BRANCH}" != "feature/event-platform-performance-foundation" ]; then
    echo "::error::billing-phase-1-preview mode may only run from feature/event-platform-performance-foundation."
    exit 1
  fi
  if [ "${CONFIRM_PREVIEW_ONLY}" != "PREVIEW_ONLY" ]; then
    echo "::error::confirm_preview_only must equal PREVIEW_ONLY for billing-phase-1-preview mode."
    exit 1
  fi
  if [ "${CONFIRM_BILLING_PHASE_1_PREVIEW}" != "${BILLING_PHASE_1_PREVIEW_CONFIRMATION}" ]; then
    echo "::error::confirm_billing_phase_1_preview must equal APPROVE_BILLING_PHASE_1_PREVIEW for billing-phase-1-preview mode."
    exit 1
  fi
  if [ "${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}" != "dzn-network-owner-console-preview-billing-phase-1" ]; then
    echo "::error::Billing Phase 1 preview project constant mismatch."
    exit 1
  fi
  if [ "${PREVIEW_PROJECT_NAME}" != "${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}" ]; then
    echo "::error::Billing Phase 1 preview must use the dedicated Billing preview Pages project."
    exit 1
  fi
  if [ "${BILLING_PHASE_1_PREVIEW_DB_PREFIX}" != "dzn_network_db_owner_console_preview_billing_phase_1_" ]; then
    echo "::error::Billing Phase 1 preview D1 prefix constant mismatch."
    exit 1
  fi
  if [ "${PREVIEW_DB_NAME}" != "${BILLING_PHASE_1_PREVIEW_DB_PREFIX}${CANDIDATE_SHORT_SHA}" ]; then
    echo "::error::Billing Phase 1 preview D1 database name must be candidate-derived."
    exit 1
  fi
  if ! [[ "${PREVIEW_DB_NAME}" =~ ^dzn_network_db_owner_console_preview_billing_phase_1_[a-f0-9]{7}$ ]]; then
    echo "::error::Billing Phase 1 preview D1 database name is malformed."
    exit 1
  fi
  if [ "${BILLING_PHASE_1_PREVIEW_STABLE_URL}" != "https://dzn-network-owner-console-preview-billing-phase-1.pages.dev" ] || [ "${PREVIEW_BASE_URL}" != "${BILLING_PHASE_1_PREVIEW_STABLE_URL}" ]; then
    echo "::error::Billing Phase 1 preview stable URL constant mismatch."
    exit 1
  fi
  if [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${PREVIEW_DB_NAME}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME:-}" ]; then
    echo "::error::Refusing Billing Phase 1 preview for production D1 database name."
    exit 1
  fi
  if [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
    echo "::error::Refusing Billing Phase 1 preview for production Pages project."
    exit 1
  fi
fi

if [ "${MODE}" = "audit-preview-d1-capacity" ]; then
  if [ "${CANDIDATE_REF}" != "refs/heads/feature/event-platform-performance-foundation" ]; then
    echo "::error::audit-preview-d1-capacity mode may only run from refs/heads/feature/event-platform-performance-foundation."
    exit 1
  fi
  if [ "${CANDIDATE_BRANCH}" != "feature/event-platform-performance-foundation" ]; then
    echo "::error::audit-preview-d1-capacity mode may only run from feature/event-platform-performance-foundation."
    exit 1
  fi
  if [ "${CONFIRM_PREVIEW_ONLY}" != "PREVIEW_ONLY" ]; then
    echo "::error::confirm_preview_only must equal PREVIEW_ONLY for audit-preview-d1-capacity mode."
    exit 1
  fi
  if [ "${CONFIRM_D1_CAPACITY_AUDIT}" != "APPROVE_D1_CAPACITY_AUDIT" ]; then
    echo "::error::confirm_d1_capacity_audit must equal APPROVE_D1_CAPACITY_AUDIT for audit-preview-d1-capacity mode."
    exit 1
  fi
  if [ -n "${PREVIEW_DB_NAME_TO_DELETE:-}" ] || [ -n "${REVIEWED_PREVIEW_DB_ID_MASK:-}" ] || [ -n "${CONFIRM_PREVIEW_DB_CLEANUP:-}" ]; then
    echo "::error::audit-preview-d1-capacity rejects cleanup target, reviewed ID mask, and cleanup confirmation inputs."
    exit 1
  fi
  if [ "${CLEANUP_ACTION:-dry-run}" = "delete" ]; then
    echo "::error::audit-preview-d1-capacity rejects delete cleanup requests."
    exit 1
  fi
  if [ "${REBIND_ACTION:-dry-run}" = "apply" ] || [ -n "${CONFIRM_PREVIEW_D1_REBIND:-}" ]; then
    echo "::error::audit-preview-d1-capacity rejects rebind mutation inputs."
    exit 1
  fi
  if [ "${REPAIR_ACTION:-dry-run}" = "apply" ] || [ -n "${CONFIRM_REBOUND_DISCORD_PREVIEW_REPAIR:-}" ]; then
    echo "::error::audit-preview-d1-capacity rejects repair mutation inputs."
    exit 1
  fi
  if [ -n "${CONFIRM_BILLING_PHASE_1_PREVIEW:-}" ]; then
    echo "::error::audit-preview-d1-capacity must not be combined with Billing preview confirmation."
    exit 1
  fi
fi

if [ "${MODE}" = "cleanup-preview-d1" ]; then
  if [ "${CONFIRM_PREVIEW_DB_CLEANUP}" != "APPROVE_STALE_PREVIEW_D1_CLEANUP" ]; then
    echo "::error::confirm_preview_db_cleanup must equal APPROVE_STALE_PREVIEW_D1_CLEANUP for cleanup-preview-d1 mode."
    exit 1
  fi
  case "${CLEANUP_ACTION}" in
    dry-run|delete) ;;
    *)
      echo "::error::cleanup_action must be dry-run or delete."
      exit 1
      ;;
  esac
  if [ -z "${PREVIEW_DB_NAME_TO_DELETE:-}" ]; then
    echo "::error::preview_db_name_to_delete is required for cleanup-preview-d1 mode."
    exit 1
  fi
  if [ "${PREVIEW_DB_NAME_TO_DELETE}" = "${PRODUCTION_D1_DATABASE_NAME}" ]; then
    echo "::error::Refusing cleanup for production D1 database name."
    exit 1
  fi
  case "${PREVIEW_DB_NAME_TO_DELETE}" in
    *"*"*|*"?"*|*"["*|*"]"*|*" "*)
      echo "::error::preview_db_name_to_delete must be one exact database name, not a pattern or list."
      exit 1
      ;;
  esac
  case "${PREVIEW_DB_NAME_TO_DELETE}" in
    dzn_network_db_owner_console_preview_*|dzn_network_db_discord_announcements_preview_*|dzn_network_db_discord_control_preview|dzn_network_db_discord_phase_2a_preview|dzn_network_db_server_lifecycle_preview|dzn_network_db_server_advertising_preview|dzn_network_db_dzn_pulse_preview) ;;
    *)
      echo "::error::Refusing cleanup for database name without an approved DZN preview prefix."
      exit 1
      ;;
  esac
  if [ "${CLEANUP_ACTION}" = "delete" ]; then
    if ! [[ "${REVIEWED_PREVIEW_DB_ID_MASK}" =~ ^[a-fA-F0-9]{8}\.\.\.[a-fA-F0-9]{4}$ ]]; then
      echo "::error::delete cleanup requires reviewed_preview_db_id_mask in masked form, e.g. abcdef12...1234."
      exit 1
    fi
  fi
fi
if [ "${MODE}" = "rebind-preview-d1" ]; then
  if [ "${CANDIDATE_BRANCH}" != "feature/creator-only-event-governance" ]; then
    echo "::error::rebind-preview-d1 mode may only run from feature/creator-only-event-governance."
    exit 1
  fi
  case "${REBIND_ACTION}" in
    dry-run|apply) ;;
    *)
      echo "::error::rebind_action must be dry-run or apply."
      exit 1
      ;;
  esac
  if [ "${CONFIRM_PREVIEW_D1_REBIND}" != "APPROVE_PREVIEW_D1_REBIND" ]; then
    echo "::error::confirm_preview_d1_rebind must equal APPROVE_PREVIEW_D1_REBIND for rebind-preview-d1 mode."
    exit 1
  fi
  if [ "${REBIND_PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
    echo "::error::Refusing rebind for production Pages project."
    exit 1
  fi
  if [ "${REBIND_OLD_PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${REBIND_REPLACEMENT_PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ]; then
    echo "::error::Refusing rebind for production D1 database name."
    exit 1
  fi
fi
if [ "${MODE}" = "activate-rebound-discord-preview" ]; then
  if [ "${CANDIDATE_BRANCH}" != "feature/creator-only-event-governance" ]; then
    echo "::error::activate-rebound-discord-preview mode may only run from feature/creator-only-event-governance."
    exit 1
  fi
  if [ "${CONFIRM_REBOUND_DISCORD_PREVIEW_DEPLOY}" != "APPROVE_REBOUND_DISCORD_PREVIEW_DEPLOY" ]; then
    echo "::error::confirm_rebound_discord_preview_deploy must equal APPROVE_REBOUND_DISCORD_PREVIEW_DEPLOY for activate-rebound-discord-preview mode."
    exit 1
  fi
  if [ "${ACTIVATE_PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
    echo "::error::Refusing activation deploy for production Pages project."
    exit 1
  fi
  if [ "${ACTIVATE_REPLACEMENT_PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${ACTIVATE_OLD_PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ]; then
    echo "::error::Refusing activation deploy for production D1 database name."
    exit 1
  fi
  if ! [[ "${APPROVED_MAIN_RUNTIME_SHA}" =~ ^[a-f0-9]{40}$ ]]; then
    echo "::error::Approved main runtime SHA is malformed."
    exit 1
  fi
fi
if [ "${MODE}" = "repair-rebound-discord-preview" ]; then
  if [ "${CANDIDATE_BRANCH}" != "feature/creator-only-event-governance" ]; then
    echo "::error::repair-rebound-discord-preview mode may only run from feature/creator-only-event-governance."
    exit 1
  fi
  case "${REPAIR_ACTION}" in
    dry-run|apply) ;;
    *)
      echo "::error::repair_action must be dry-run or apply."
      exit 1
      ;;
  esac
  if [ "${CONFIRM_REBOUND_DISCORD_PREVIEW_REPAIR}" != "APPROVE_REPAIR_REBOUND_DISCORD_PREVIEW" ]; then
    echo "::error::confirm_rebound_discord_preview_repair must equal APPROVE_REPAIR_REBOUND_DISCORD_PREVIEW for repair-rebound-discord-preview mode."
    exit 1
  fi
  if [ "${REPAIR_PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
    echo "::error::Refusing repair for production Pages project."
    exit 1
  fi
  if [ "${REPAIR_REPLACEMENT_PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${REPAIR_OLD_PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ]; then
    echo "::error::Refusing repair for production D1 database name."
    exit 1
  fi
  if ! [[ "${APPROVED_MAIN_RUNTIME_SHA}" =~ ^[a-f0-9]{40}$ ]]; then
    echo "::error::Approved main runtime SHA is malformed."
    exit 1
  fi
fi

if [ "${DZN_DISCORD_NOTIFICATIONS_ENABLED}" != "false" ]; then
  echo "::error::DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false."
  exit 1
fi
if [ "${DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED}" != "false" ]; then
  echo "::error::DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED must remain false."
  exit 1
fi

if [ -z "${DZN_PLATFORM_OWNER_DISCORD_IDS:-}" ]; then
  echo "::error::Missing DZN_PLATFORM_OWNER_DISCORD_IDS for owner console preview."
  exit 1
fi
echo "::add-mask::${DZN_PLATFORM_OWNER_DISCORD_IDS}"
if [ -z "${DZN_PLATFORM_CREATOR_DISCORD_ID:-}" ]; then
  echo "::error::Missing fake DZN_PLATFORM_CREATOR_DISCORD_ID for creator-event-governance preview."
  exit 1
fi
echo "::add-mask::${DZN_PLATFORM_CREATOR_DISCORD_ID}"

if [ -n "${CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN:-}" ]; then
  echo "::add-mask::${CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN}"
fi
if [ -n "${CLOUDFLARE_PULSE_PREVIEW_TOKEN:-}" ]; then
  echo "::add-mask::${CLOUDFLARE_PULSE_PREVIEW_TOKEN}"
fi
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "::add-mask::${CLOUDFLARE_API_TOKEN}"
fi
if [ "${MODE}" = "cleanup-preview-d1" ] || [ "${MODE}" = "rebind-preview-d1" ]; then
  if [ -z "${CLOUDFLARE_PREVIEW_D1_CLEANUP_TOKEN:-}" ] && [ -z "${CLOUDFLARE_PULSE_PREVIEW_TOKEN:-}" ] && [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo "::error::Missing Cloudflare token source for ${MODE} mode."
    exit 1
  fi
else
  CF_TOKEN="${CLOUDFLARE_PULSE_PREVIEW_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
  if [ -z "${CF_TOKEN:-}" ]; then
    echo "::error::Missing CLOUDFLARE_PULSE_PREVIEW_TOKEN or CLOUDFLARE_API_TOKEN GitHub secret."
    exit 1
  fi
  if [ "${#CF_TOKEN}" -le 20 ]; then
    echo "::error::Cloudflare preview token is present but too short to be valid."
    exit 1
  fi
  {
    printf "OWNER_CONSOLE_CF_TOKEN=%s\n" "$CF_TOKEN"
    printf "CLOUDFLARE_API_TOKEN=%s\n" "$CF_TOKEN"
  } >> "$GITHUB_ENV"
fi

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "::error::Missing CLOUDFLARE_ACCOUNT_ID GitHub secret or repository variable."
  exit 1
fi
if ! [[ "${CLOUDFLARE_ACCOUNT_ID}" =~ ^[a-fA-F0-9]{32}$ ]]; then
  echo "::error::CLOUDFLARE_ACCOUNT_ID does not look like a 32-character Cloudflare account id."
  exit 1
fi

if [ "${MODE}" = "full-preview" ] || [ "${MODE}" = "billing-phase-1-preview" ]; then
  OWNER_PREVIEW_SESSION_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
  echo "::add-mask::$OWNER_PREVIEW_SESSION_SECRET"
  printf "OWNER_PREVIEW_SESSION_SECRET=%s\n" "$OWNER_PREVIEW_SESSION_SECRET" >> "$GITHUB_ENV"

  OWNER_PREVIEW_DISCORD_CLIENT_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
  echo "::add-mask::$OWNER_PREVIEW_DISCORD_CLIENT_SECRET"
  printf "OWNER_PREVIEW_DISCORD_CLIENT_SECRET=%s\n" "$OWNER_PREVIEW_DISCORD_CLIENT_SECRET" >> "$GITHUB_ENV"
fi

OWNER_PREVIEW_DISCORD_CLIENT_ID="990000000000000199"
OWNER_PREVIEW_DISCORD_REDIRECT_URI="${PREVIEW_BASE_URL}/api/auth/discord/callback"
if ! [[ "${OWNER_PREVIEW_DISCORD_CLIENT_ID}" =~ ^[0-9]+$ ]]; then
  echo "::error::Owner console preview Discord client id must be numeric."
  exit 1
fi
{
  printf "OWNER_PREVIEW_DISCORD_CLIENT_ID=%s\n" "$OWNER_PREVIEW_DISCORD_CLIENT_ID"
  printf "OWNER_PREVIEW_DISCORD_REDIRECT_URI=%s\n" "$OWNER_PREVIEW_DISCORD_REDIRECT_URI"
} >> "$GITHUB_ENV"

node <<'NODE'
const fs = require("node:fs");
const ownerIds = String(process.env.DZN_PLATFORM_OWNER_DISCORD_IDS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => /^\d+$/.test(entry));
if (ownerIds.length === 0) {
  console.error("Missing DZN_PLATFORM_OWNER_DISCORD_IDS for owner console preview.");
  process.exit(1);
}
const creatorId = String(process.env.DZN_PLATFORM_CREATOR_DISCORD_ID ?? "");
if (!/^\d+$/.test(creatorId) || !ownerIds.includes(creatorId)) {
  console.error("Fake creator id must be numeric and included in the fake owner allowlist for preview.");
  process.exit(1);
}
fs.appendFileSync(process.env.GITHUB_ENV, `OWNER_CONSOLE_PREVIEW_OWNER_ID=${ownerIds[0]}\n`);
fs.appendFileSync(process.env.GITHUB_ENV, `OWNER_CONSOLE_PREVIEW_CREATOR_ID=${creatorId}\n`);

const source = fs.readFileSync("wrangler.toml", "utf8");
const name = source.match(/database_name\s*=\s*"([^"]+)"/)?.[1] ?? "";
const id = source.match(/database_id\s*=\s*"([^"]+)"/)?.[1] ?? "";
const auditMode = process.env.MODE === "audit-preview-d1-capacity";
function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}
if (!name || !id) {
  console.error("Could not detect production D1 database name/id from wrangler.toml.");
  process.exit(1);
}
console.log(`::add-mask::${id}`);
fs.appendFileSync(process.env.GITHUB_ENV, `DETECTED_PRODUCTION_D1_DATABASE_NAME=${name}\n`);
if (!auditMode) {
  fs.appendFileSync(process.env.GITHUB_ENV, `DETECTED_PRODUCTION_D1_DATABASE_ID=${id}\n`);
}
console.log(`Detected production D1 database name: ${name}`);
console.log(`Detected production D1 database id: ${maskId(id)}`);
NODE

{
  echo "## DZN Owner Console Preview Guard"
  echo ""
  echo "- Mode: ${MODE}"
  echo "- Workflow ref: ${CANDIDATE_REF}"
  echo "- Workflow ref name: ${CANDIDATE_BRANCH}"
  echo "- Checked-out SHA: ${CHECKED_OUT_HEAD}"
  echo "- Checked-out tree: ${CHECKED_OUT_TREE}"
  echo "- Remote branch HEAD: ${REMOTE_FEATURE_HEAD}"
  echo "- Preview D1 database name: ${PREVIEW_DB_NAME}"
  echo "- Preview Pages project name: ${PREVIEW_PROJECT_NAME}"
  echo "- Cleanup mode: ${MODE}"
  if [ "${MODE}" = "cleanup-preview-d1" ]; then
    echo "- Cleanup action: ${CLEANUP_ACTION}"
    echo "- Cleanup target database: ${PREVIEW_DB_NAME_TO_DELETE}"
    echo "- Cleanup confirmation accepted: true"
  fi
  if [ "${MODE}" = "rebind-preview-d1" ]; then
    echo "- Rebind action: ${REBIND_ACTION}"
    echo "- Rebind preview Pages project: ${REBIND_PREVIEW_PROJECT_NAME}"
    echo "- Rebind old database: ${REBIND_OLD_PREVIEW_DB_NAME}"
    echo "- Rebind replacement database: ${REBIND_REPLACEMENT_PREVIEW_DB_NAME}"
    echo "- Rebind confirmation accepted: true"
    echo "- Rebind Pages deployment required after config patch: yes"
  fi
  if [ "${MODE}" = "activate-rebound-discord-preview" ]; then
    echo "- Activation preview Pages project: ${ACTIVATE_PREVIEW_PROJECT_NAME}"
    echo "- Activation replacement database: ${ACTIVATE_REPLACEMENT_PREVIEW_DB_NAME}"
    echo "- Activation former database: ${ACTIVATE_OLD_PREVIEW_DB_NAME}"
    echo "- Activation runtime source: ${APPROVED_MAIN_RUNTIME_SHA}"
    echo "- Activation confirmation accepted: true"
    echo "- Preview deployment will be performed only by activation mode: yes"
  fi
  if [ "${MODE}" = "repair-rebound-discord-preview" ]; then
    echo "- Repair action: ${REPAIR_ACTION}"
    echo "- Repair preview Pages project: ${REPAIR_PREVIEW_PROJECT_NAME}"
    echo "- Repair replacement database: ${REPAIR_REPLACEMENT_PREVIEW_DB_NAME}"
    echo "- Repair old database: ${REPAIR_OLD_PREVIEW_DB_NAME}"
    echo "- Repair runtime source: ${APPROVED_MAIN_RUNTIME_SHA}"
    echo "- Repair confirmation accepted: true"
    echo "- Repair dry-run mutates nothing: $([ "${REPAIR_ACTION}" = "dry-run" ] && echo yes || echo no)"
  fi
  if [ "${MODE}" = "verify-existing-creator-governance-preview" ]; then
    echo "- Existing preview verification project: ${EXISTING_CREATOR_GOVERNANCE_PREVIEW_PROJECT_NAME}"
    echo "- Existing preview verification database: ${EXISTING_CREATOR_GOVERNANCE_PREVIEW_DB_NAME}"
    echo "- Existing preview verification event: ${EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_NAME}"
    echo "- Existing preview verification slug: ${EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_SLUG}"
    echo "- Existing preview verification is read-only: true"
    echo "- Existing preview confirmation accepted: true"
  fi
  if [ "${MODE}" = "event-platform-performance-preview" ]; then
    echo "- Event platform performance preview project: ${EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME}"
    echo "- Event platform performance preview database: ${EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME}"
    echo "- Event platform performance preview seed prefix: ${EVENT_PLATFORM_PERFORMANCE_PREVIEW_SEED_PREFIX}"
    echo "- Event platform performance preview confirmation accepted: true"
    echo "- D1 database creation/deletion path enabled: false"
    echo "- Only migration 0057 may be applied: true"
  fi
  if [ "${MODE}" = "billing-phase-1-preview" ]; then
    echo "- Billing Phase 1 preview project: ${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}"
    echo "- Billing Phase 1 preview database: ${PREVIEW_DB_NAME}"
    echo "- Billing Phase 1 preview stable URL: ${BILLING_PHASE_1_PREVIEW_STABLE_URL}"
    echo "- Billing Phase 1 preview confirmation accepted: true"
    echo "- Billing Phase 1 preview D1 name candidate-derived: true"
    echo "- Billing Phase 1 preview branch guard: feature/event-platform-performance-foundation"
  fi
  if [ "${MODE}" = "audit-preview-d1-capacity" ]; then
    echo "- D1 capacity audit confirmation accepted: true"
    echo "- D1 capacity audit branch guard: feature/event-platform-performance-foundation"
    echo "- D1 capacity audit mutates resources: false"
    echo "- D1 capacity audit exports D1 IDs: false"
  fi
  echo "- Production Pages project name: ${PRODUCTION_PAGES_PROJECT_NAME}"
  echo "- DZN_PLATFORM_OWNER_DISCORD_IDS configured: true"
  echo "- DZN_PLATFORM_CREATOR_DISCORD_ID configured: true"
  echo "- Discord OAuth client id configured: true"
  echo "- Discord OAuth redirect URI: ${OWNER_PREVIEW_DISCORD_REDIRECT_URI}"
  echo "- DZN_PULSE_ENABLED: true"
  echo "- DZN_DISCORD_NOTIFICATIONS_ENABLED: false"
  echo "- DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: false"
  echo "- Creator governance preview event name is SHA-scoped: true"
} >> "$GITHUB_STEP_SUMMARY"
