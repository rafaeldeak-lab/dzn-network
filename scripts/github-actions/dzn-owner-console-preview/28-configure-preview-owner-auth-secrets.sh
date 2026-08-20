set -euo pipefail

printf "%s" "$DZN_PLATFORM_OWNER_DISCORD_IDS" | npx wrangler pages secret put DZN_PLATFORM_OWNER_DISCORD_IDS --project-name "${PREVIEW_PROJECT_NAME}"
printf "%s" "$DZN_PLATFORM_CREATOR_DISCORD_ID" | npx wrangler pages secret put DZN_PLATFORM_CREATOR_DISCORD_ID --project-name "${PREVIEW_PROJECT_NAME}"
printf "%s" "$OWNER_PREVIEW_SESSION_SECRET" | npx wrangler pages secret put SESSION_SECRET --project-name "${PREVIEW_PROJECT_NAME}"
printf "%s" "$OWNER_PREVIEW_DISCORD_CLIENT_SECRET" | npx wrangler pages secret put DISCORD_CLIENT_SECRET --project-name "${PREVIEW_PROJECT_NAME}"
echo "Owner console preview auth secrets configured."
