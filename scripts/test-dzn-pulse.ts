import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { getPulseSummary, sanitizePulseActionUrl } from "../functions/_lib/dzn-pulse";

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

const migration = read("migrations/0052_dzn_pulse.sql");
const service = read("functions/_lib/dzn-pulse.ts");
const flags = read("functions/_lib/feature-flags.ts");
const provider = read("components/dzn-pulse/dzn-pulse-provider.tsx");
const pulsePage = read("components/dzn-pulse/dzn-pulse-page.tsx");
const eventsPage = read("components/events/events-platform.tsx");
const dashboard = read("components/onboarding/dashboard.tsx");
const siteHeader = read("components/site-header.tsx");
const discordCallback = read("functions/api/auth/discord/callback.ts");
const discordHelpers = read("functions/_lib/discord.ts");
const envExample = read(".env.example");
const cloudflareEnv = read("cloudflare-env.d.ts");
const packageJson = read("package.json");
const gitignore = read(".gitignore");

for (const table of [
  "notification_campaigns",
  "user_notifications",
  "event_popup_dismissals",
  "notification_preferences",
]) {
  assert.equal(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), true, `Missing ${table} table.`);
}

for (const requiredSql of [
  "ON user_notifications(user_id, dedupe_key)",
  "ON user_notifications(user_id, read_at, created_at)",
  "ON event_popup_dismissals(user_id, campaign_id, scope_key)",
  "CHECK(mode IN ('snooze', 'forever', 'joined'))",
]) {
  assert.equal(migration.includes(requiredSql), true, `Missing migration constraint/index: ${requiredSql}`);
}

assert.equal(/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM\s+player_profiles|CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?player_stats/i.test(migration), false, "Pulse migration must be additive and must not create player_stats.");

assert.equal(envExample.includes("DZN_PULSE_ENABLED=false"), true, "DZN Pulse must default off in .env.example.");
assert.equal(envExample.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED=false"), true, "Discord notification delivery must default off in .env.example.");
assert.equal(cloudflareEnv.includes("DZN_PULSE_ENABLED?: string"), true, "Cloudflare Env type must include DZN_PULSE_ENABLED.");
assert.equal(cloudflareEnv.includes("DZN_DISCORD_NOTIFICATIONS_ENABLED?: string"), true, "Cloudflare Env type must include DZN_DISCORD_NOTIFICATIONS_ENABLED.");
assert.equal(cloudflareEnv.includes("DZN_PULSE_PREVIEW_AUTH_DIAGNOSTICS?: string"), true, "Cloudflare Env type must include preview auth diagnostics flag.");
assert.equal(flags.includes("parseBooleanFlag"), true, "Feature flags must use a typed parser.");

for (const serviceContract of [
  "listUserNotifications",
  "countUnreadNotifications",
  "markNotificationRead",
  "markAllNotificationsRead",
  "clearReadNotifications",
  "createNotification",
  "dispatchPulseDiscordNotification",
  "createEventEntryNotification",
  "listEventPopups",
  "dismissEventPopup",
  "getPulseSummary",
  "generateDuePulseNotifications",
  "sanitizePulseActionUrl",
]) {
  assert.equal(service.includes(`export ${serviceContract}`) || service.includes(`export async function ${serviceContract}`) || service.includes(`export function ${serviceContract}`), true, `Missing service contract ${serviceContract}.`);
}
assert.equal(service.includes("export const PULSE_NO_STORE_HEADERS"), true, "Missing no-store header export.");

assert.equal(service.includes("INSERT OR IGNORE INTO user_notifications"), true, "Notifications must deduplicate by dedupe_key.");
assert.equal(service.includes("discord_notification_dispatcher_not_configured"), true, "Discord delivery must remain an explicit disabled adapter unless a dispatcher is configured.");
assert.equal(service.includes("WHERE id = ? AND user_id = ? LIMIT 1"), true, "Popup dismissals must verify server ownership.");
assert.equal(service.includes("notification_not_found"), true, "Notification mutations must not report success for guessed or cross-user IDs.");
assert.equal(service.includes("campaign_not_found"), true, "Popup dismissals must verify the campaign exists before writing.");
assert.equal(service.includes("\"private, no-store, no-cache, must-revalidate\""), true, "Private Pulse APIs must use no-store caching.");
assert.equal(service.includes("sanitizePulseActionUrl(campaign.action_url)"), true, "Campaign action URLs must be sanitized.");
assert.equal(service.includes("if (!isDznPulseEnabled(env))"), true, "Pulse generation/service methods must no-op or reject when disabled.");
assert.equal(service.includes("getPublicLeaderboardsPayload"), false, "Pulse summary must not call the broad public leaderboard payload.");
assert.equal(service.includes("getEventsListPayload"), false, "Pulse summary must not call the broad events payload.");
assert.equal(service.includes("readPulseSummaryEvents"), true, "Pulse summary must use a bounded events query.");
assert.equal(service.includes("readPulseSummaryRankings"), true, "Pulse summary must use a bounded ranking query.");
assert.equal(service.includes("LIMIT 25"), true, "Pulse summary rankings must stay bounded.");
assert.equal(discordHelpers.includes("class DiscordRequestError"), true, "Discord OAuth failures must have sanitized stages.");
assert.equal(discordHelpers.includes("SAFE_TOKEN_ERROR_CODES"), true, "Discord token errors must be allowlisted.");
assert.equal(discordHelpers.includes("invalid_client"), true, "Token diagnostics must preserve invalid_client.");
assert.equal(discordHelpers.includes("invalid_grant"), true, "Token diagnostics must preserve invalid_grant.");
assert.equal(discordHelpers.includes("redirect_uri_mismatch"), true, "Token diagnostics must preserve redirect URI mismatch.");
assert.equal(discordHelpers.includes("missing_client_secret"), true, "Token diagnostics must report missing client secret without exposing the value.");
assert.equal(discordCallback.includes("DZN_PULSE_PREVIEW_AUTH_DIAGNOSTICS"), true, "Preview callback diagnostics must be feature-flagged.");
assert.equal(discordCallback.includes("DZN_PULSE_ENABLED"), true, "Preview callback diagnostics must work under feature-on preview runtime flags.");
assert.equal(discordCallback.includes("dzn-network-pulse-preview.pages.dev"), true, "Preview callback diagnostics must be host-gated.");
assert.equal(discordCallback.includes("stage: \"token_exchange\"") || discordCallback.includes("stage: error.stage"), true, "Callback must report token exchange stage safely.");
assert.equal(discordCallback.includes("state_validation"), true, "Callback must report state validation stage safely.");
assert.equal(discordCallback.includes("d1_or_session"), true, "Callback must report D1/session stage safely.");
assert.equal(discordCallback.includes("client_secret_trimmed"), true, "Callback diagnostics must include secret trim boolean only.");
assert.equal(discordCallback.includes("session_secret_trimmed"), true, "Callback diagnostics must include session secret trim boolean only.");
assert.equal(/searchParams\.set\(\s*["'](?:oauth_)?code["']/i.test(discordCallback), false, "Callback diagnostics must not include OAuth code values.");
assert.equal(/searchParams\.set\(\s*["'](?:access_|refresh_)?token["']/i.test(discordCallback), false, "Callback diagnostics must not include token values.");
assert.equal(/searchParams\.set\(\s*["']cookie["']/i.test(discordCallback), false, "Callback diagnostics must not include cookie values.");
assert.equal(/searchParams\.set\(\s*["'](?:client_|session_)?secret["']/i.test(discordCallback), false, "Callback diagnostics must not include secret values.");
assert.equal(sanitizePulseActionUrl("/events/weekend-kill-race"), "/events/weekend-kill-race");
assert.equal(sanitizePulseActionUrl("/dashboard/events"), "/dashboard/events");
assert.equal(sanitizePulseActionUrl("/events-evil"), null, "Sibling paths must not pass an internal route prefix check.");
assert.equal(sanitizePulseActionUrl("//evil.example/events"), null, "Protocol-relative URLs must be rejected.");
assert.equal(sanitizePulseActionUrl("javascript:alert(1)"), null, "javascript: URLs must be rejected.");
assert.equal(sanitizePulseActionUrl("data:text/html,test"), null, "data: URLs must be rejected.");
assert.equal(sanitizePulseActionUrl("https://dzn-network.pages.dev/events"), null, "Absolute external-style URLs must be rejected unless explicitly allowlisted.");

for (const route of [
  "functions/api/dzn-pulse/config.ts",
  "functions/api/dzn-pulse/notifications/index.ts",
  "functions/api/dzn-pulse/notifications/unread-count.ts",
  "functions/api/dzn-pulse/notifications/[notificationId]/read.ts",
  "functions/api/dzn-pulse/notifications/read-all.ts",
  "functions/api/dzn-pulse/notifications/clear-read.ts",
  "functions/api/dzn-pulse/event-popups/index.ts",
  "functions/api/dzn-pulse/event-popups/[campaignId]/dismiss.ts",
  "functions/api/dzn-pulse/summary.ts",
]) {
  assert.equal(existsSync(route), true, `Missing Pulse API route ${route}.`);
}

assert.equal(provider.includes("NOTIFICATION_POLL_MS = 60_000"), true, "Unread polling must be bounded.");
assert.equal(provider.includes("POPUP_POLL_MS = 60_000"), true, "Popup eligibility polling must be bounded.");
assert.equal(provider.includes("dzn:pulse:session-dismissals:v1"), true, "Session dismissal fallback key must be versioned.");
assert.equal(provider.includes("dzn:pulse:pending-dismissals:v1"), true, "Pending persisted dismissal fallback key must be versioned.");
assert.equal(provider.includes("data-dzn-pulse-bell"), true, "Bell focus restoration needs a stable selector.");
assert.equal(provider.includes("DznPulseDrawer"), true, "Provider must render the drawer.");
assert.equal(provider.includes("EventPopupManager"), true, "Provider must support popup manager mounting.");
assert.equal(provider.includes("const [mounted, setMounted] = useState(false)"), true, "Pulse provider must defer dynamic Pulse UI until after client hydration.");
assert.equal(provider.includes("enabled: mounted && enabled"), true, "Pulse context must not expose enabled state before hydration completes.");
assert.equal(provider.includes("mounted && enabled ? <DznPulseDrawer />"), true, "Pulse drawer must be client-mounted to avoid hydration drift.");
assert.equal(provider.includes("trapFocus"), true, "Drawer/popup must trap focus.");
assert.equal(provider.includes("markAllRead"), true, "Drawer must support mark-all-read.");
assert.equal(provider.includes("clearRead"), true, "Drawer must support clearing read notifications.");
assert.equal(provider.includes("popupInFlightRef"), true, "Popup polling must be in-flight guarded.");
assert.equal(provider.includes("unreadInFlightRef"), true, "Unread polling must be in-flight guarded.");
assert.equal(provider.includes("listRequestSeqRef"), true, "Notification list responses must be order protected.");
assert.equal(provider.includes("pendingListRefreshRef"), true, "Skipped list refreshes must be retried after the in-flight request completes.");
assert.equal(provider.includes("document.visibilityState === \"hidden\""), true, "Pulse polling must pause while the tab is hidden.");
assert.equal(provider.includes("flushPendingDismissals"), true, "Failed persisted dismissals must be retried safely.");
assert.equal(provider.includes("expiresAt: mode === \"snooze\""), true, "Local snooze fallback must expire rather than suppress forever.");
assert.equal(provider.includes("setInterval(run, POPUP_POLL_MS)"), true, "Popup manager must poll on the bounded cadence.");

assert.equal(pulsePage.includes("The heartbeat of the DZN Network"), true, "DZN Pulse page header copy must be present.");
assert.equal(pulsePage.includes("No live events right now."), true, "DZN Pulse page must include honest live-event empty state.");
assert.equal(pulsePage.includes("Same-Category Matching"), true, "DZN Pulse page must explain same-category matching.");
assert.equal(pulsePage.includes("/api/dzn-pulse/summary"), true, "DZN Pulse page must use the summary API.");
assert.equal(/<Link[^>]+href=["']\/["'][\s\S]{0,120}<DznLogo/.test(pulsePage), false, "DZN Pulse page must not wrap DznLogo in Link because DznLogo already renders an anchor.");

assert.equal(eventsPage.includes("DznPulseProvider enablePopups"), true, "Events shell must mount the Pulse provider with popups.");
assert.equal(eventsPage.includes("PulseEventsSidebarItem"), true, "Events sidebar must include a feature-gated Pulse item.");
assert.equal(eventsPage.includes("PulseEventSpotlight"), true, "Events page must include a feature-gated visual enhancement.");
assert.equal(eventsPage.includes("PulseFeaturedMatchup"), true, "Challenges page must include a feature-gated matchup card.");

assert.equal(dashboard.includes("DznPulseProvider enablePopups"), true, "Dashboard shell must mount the Pulse provider.");
assert.equal(dashboard.includes("DznPulseBell"), true, "Dashboard must use the shared Pulse bell.");
assert.equal(siteHeader.includes("DznPulseProvider"), true, "Shared site header must mount the Pulse provider.");
assert.equal(siteHeader.includes("DznPulseBell"), true, "Shared site header must expose the Pulse bell for authenticated users.");

assert.equal(packageJson.includes("\"test:dzn-pulse\""), true, "Package scripts must include test:dzn-pulse.");
assert.equal(gitignore.includes("tmp/dzn-pulse-demo-seed.sql"), true, "Generated Pulse demo seed SQL must be ignored.");
assert.equal(gitignore.includes("tmp/dzn-pulse-*.patch"), true, "Pulse preflight patches must be ignored.");

const summaryQueries: string[] = [];
const emptyStatement = {
  bind: () => emptyStatement,
  all: async () => ({ results: [] }),
  first: async () => null,
  run: async () => ({ success: true }),
};
const emptyPreviewDb = {
  prepare: (query: string) => {
    summaryQueries.push(query);
    return emptyStatement;
  },
};
getPulseSummary(
  { DZN_PULSE_ENABLED: "true", DB: emptyPreviewDb } as never,
  { id: "preview-user", email: "preview@example.test", name: "Preview User", role: "owner" } as never,
)
  .then((emptyPreviewSummary) => {
    assert.equal(emptyPreviewSummary.ok, true, "Authenticated Pulse summary must return a controlled empty-state payload.");
    assert.equal(emptyPreviewSummary.metrics.live_events, 0, "Empty preview summary must not fabricate live events.");
    assert.equal(emptyPreviewSummary.top_server, null, "Empty preview summary must not fabricate a top server.");
    assert.deepEqual(emptyPreviewSummary.monthly_rankings, [], "Empty preview summary must not fabricate rankings.");
    assert.equal(summaryQueries.some((query) => query.includes("LIMIT 8")), true, "Pulse summary event query must stay bounded.");
    assert.equal(summaryQueries.some((query) => query.includes("LIMIT 25")), true, "Pulse summary ranking query must stay bounded.");
    console.log("DZN Pulse tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
