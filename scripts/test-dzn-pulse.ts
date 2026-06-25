import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sanitizePulseActionUrl } from "../functions/_lib/dzn-pulse";

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

console.log("DZN Pulse tests passed.");
