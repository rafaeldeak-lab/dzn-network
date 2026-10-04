import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { CommsMessageTime } from "../components/comms/comms-message-time";
import { DznCommsShell } from "../components/comms/dzn-comms-shell";
import { loadCommsHistory, parseCommsHistory } from "../components/comms/comms-history-client";

import { dznCommsReadHistoryBoundary, readDznCommsReadHistoryFlags } from "../functions/_lib/dzn-comms-read-history";
import type { Env, PagesContext } from "../functions/_lib/types";
import { onRequest as messageHistoryRoute } from "../functions/api/comms/message-history";

const migrationName = "0065_dzn_comms_read_history.sql";
const migrationFiles = readdirSync("migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const migration = readFileSync(`migrations/${migrationName}`, "utf8");
const helper = readFileSync("functions/_lib/dzn-comms-read-history.ts", "utf8");
const route = readFileSync("functions/api/comms/message-history.ts", "utf8");
const shell = readFileSync("components/comms/dzn-comms-shell.tsx", "utf8");
const historyClient = readFileSync("components/comms/comms-history-client.ts", "utf8");
const communityPage = readFileSync("app/community/page.tsx", "utf8");
const envExample = readFileSync(".env.example", "utf8");
const cloudflareEnv = readFileSync("cloudflare-env.d.ts", "utf8");
const platformSpec = readFileSync("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md", "utf8");
const packageJson = readFileSync("package.json", "utf8");

assert.ok(migrationFiles.includes(migrationName), "The approved Comms migration must remain available.");
assert.equal(new Set(migrationFiles.map((name) => name.slice(0, 4))).size, migrationFiles.length, "Migration numbers must stay unique, including later non-Comms migrations.");
assert.match(migration, /CREATE TABLE IF NOT EXISTS dzn_comms_channels/i, "Migration must define Comms channels.");
assert.match(migration, /CREATE TABLE IF NOT EXISTS dzn_comms_messages/i, "Migration must define the read-only message-history table.");
assert.match(migration, /CREATE TABLE IF NOT EXISTS dzn_comms_private_group_members/i, "Migration must define private group membership proof.");
assert.match(migration, /visibility_state TEXT NOT NULL DEFAULT 'visible'/i, "Message rows need explicit visibility states.");
assert.match(migration, /CHECK\(visibility_state IN \('visible', 'hidden', 'deleted', 'quarantined', 'expired'\)\)/i, "Visibility states must cover hidden/deleted/quarantined/expired handling.");
assert.match(migration, /PRIMARY KEY\(channel_id, user_id\)/i, "Private group membership must be unique per channel and user.");
assert.match(migration, /idx_dzn_comms_messages_channel_created/i, "Message reads need a bounded channel/time index.");
assert.match(migration, /idx_dzn_comms_private_group_members_user/i, "Membership checks need a current-user index.");
assert.doesNotMatch(
  migration,
  /\b(?:account_entitlements|owner_billing_accounts|server_subscriptions|stripe|checkout_session|player_saved_servers|player_profile_privacy_preferences|player_public_profiles|server_reviews|competitive_events|event_suggestions|badge_awards|dzn_season|server_war|ctf|xp_award|calling_card|earned_spins|spin_ledger|retained_export)\b/i,
  "Comms read-history schema must not touch payment, owner, profile, review, event, progression, retained export, or competitive tables.",
);

assert.match(envExample, /DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED=false/, "Comms route flag must default off.");
assert.match(envExample, /DZN_COMMS_MESSAGE_HISTORY_READ_SCOPE=local_test/, "Comms route scope must be local/test by default.");
assert.match(envExample, /NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=false/, "Comms UI flag must default off.");
assert.match(envExample, /NEXT_PUBLIC_DZN_COMMS_PRIVATE_GROUPS_UI_ENABLED=false/, "Private-group selection must have a separate default-off UI flag.");
assert.match(envExample, /NEXT_PUBLIC_DZN_COMMS_REACTIONS_UI_ENABLED=false/, "Comms reaction UI flag must default off.");
assert.match(cloudflareEnv, /DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED\?: string/, "Cloudflare Env type must include the route flag.");
assert.match(cloudflareEnv, /DZN_COMMS_MESSAGE_HISTORY_READ_SCOPE\?: string/, "Cloudflare Env type must include the local/test scope.");
assert.match(cloudflareEnv, /NEXT_PUBLIC_DZN_COMMS_REACTIONS_UI_ENABLED\?: string/, "Cloudflare Env type must include the reaction UI flag.");
assert.match(cloudflareEnv, /NEXT_PUBLIC_DZN_COMMS_PRIVATE_GROUPS_UI_ENABLED\?: string/, "Cloudflare Env type must include the private-group UI flag.");

const helperWriteTargets = [...helper.matchAll(/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+|DELETE\s+FROM|UPSERT|REPLACE\s+INTO)\s+([a-z_]+)/gi)];
assert.deepEqual(helperWriteTargets, [], "DZN Comms read-history helper must contain no SQL write statements.");
const helperSqlTargets = [...helper.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)].map((match) => match[1]).sort();
assert.deepEqual(
  [...new Set(helperSqlTargets)],
  ["dzn_comms_channels", "dzn_comms_messages", "dzn_comms_private_group_members"],
  "DZN Comms read-history helper may only read Comms read-model tables directly.",
);
assert.match(helper, /request\.method !== "GET"/, "DZN Comms message history route must be GET-only.");
assert.match(helper, /DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED/, "Route must require an explicit server-side flag.");
assert.match(helper, /DZN_COMMS_MESSAGE_HISTORY_READ_SCOPE/, "Route must require an explicit local/test scope.");
assert.match(helper, /liveScope === "production"/, "Released live history must require an explicit production scope.");
assert.match(helper, /getSessionUser\(env, request\)/, "Private group reads must resolve the current Discord session.");
assert.match(helper, /membership_state = 'active'/, "Private group reads must require an active membership row.");
assert.match(helper, /readDznCommsPrivateGroupFlags/, "Private group reads and discovery must require the dedicated server flag.");
assert.match(helper, /LIMIT 20/, "Private group discovery must remain bounded.");
assert.match(helper, /channel\.visibility === "support_private"\) return unavailableChannel\(\)/, "Private support history must remain indistinguishably unavailable in this slice.");
assert.match(helper, /membership\.channel_id = messages\.channel_id[\s\S]*membership\.user_id = \?[\s\S]*membership\.membership_state = 'active'/, "The private message query must recheck active membership in the same SQL statement.");
assert.match(helper, /julianday\(created_at\) = julianday\(\?\) AND id < \?/, "Pagination must break equal-timestamp ties with message ID.");
assert.match(helper, /encodeHistoryCursor\(lastRow\)/, "The API must issue an opaque cursor from the last row in the page.");
assert.match(helper, /Use either before or cursor, not both/, "Legacy and opaque cursors must not be combined.");
assert.match(helper, /sending_enabled: channel\.visibility === "private_group" \? privateGroupFlags\.enabled : flags\.writeFeaturesEnabled/, "Route payload must derive sending state from the protected channel-specific server flag.");
assert.match(helper, /reactions_enabled: reactionFlags\.readEnabled/, "Route payload must derive reaction reads from their separate server flag.");
assert.match(helper, /reactions_write_enabled: reactionFlags\.writeEnabled/, "Route payload must derive reaction writes from their separate server flag.");
assert.match(helper, /ai_assist_runtime_enabled: false/, "Route payload must report AI support runtime disabled.");
assert.match(helper, /durable_objects_or_websockets_enabled: false/, "Route payload must report WebSocket/Durable Object runtime disabled.");
assert.doesNotMatch(helper + route, /\b(?:\.run\(|batch\(|exec\(|fetch\(|WebSocket|DurableObject|EventSource|navigator|sendBeacon|localStorage|sessionStorage|STRIPE_SECRET|DZN_LIVE_CHECKOUT_ENABLED|OPENAI_API_KEY|AI_GATEWAY|VECTORIZE|R2_BUCKET)\b/i, "Comms route/helper must not write, call providers, use browser storage, or touch payment/AI/storage runtimes.");

assert.match(route, /handleDznCommsMessageHistoryRequest/, "Function route should delegate to the read-history helper.");
assert.match(communityPage, /DznCommsShell/, "The /community route must render the DZN Comms shell.");
assert.match(shell, /NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED/, "The /community shell must fetch only behind the public UI flag.");
assert.match(shell, /NEXT_PUBLIC_DZN_COMMS_PRIVATE_GROUPS_UI_ENABLED/, "Private channel controls must have a separate public UI switch.");
assert.match(shell, /loadCommsHistory\(controller.signal, \{ channelSlug: selectedChannel \}\)/, "The UI must use the bounded history client for the selected channel.");
assert.match(shell, /if \(selectedChannel !== "global-chat"\)[\s\S]*Private group access changed\. Returning to Global Chat\.[\s\S]*setSelectedChannel\("global-chat"\)/, "A failed private refresh must clear private history and return to Global Chat.");
assert.match(shell, /selectedChannelRef\.current !== selectedChannel[\s\S]*payload\.channel\.slug !== selectedChannel/, "History refreshes must discard responses for a channel that is no longer selected.");
assert.match(shell, /const poller = window\.setInterval/, "Read-only and live private history must both recheck revoked access.");
assert.match(shell, /const targetChannel = payload\.channel\.slug;[\s\S]*selectedChannelRef\.current !== targetChannel[\s\S]*sendCommsMessage\(targetChannel/, "The composer must send only to the channel represented by the visible validated payload.");
assert.match(shell, /selectedChannelRef\.current === targetChannel[\s\S]*refreshed\.channel\.slug === targetChannel/, "Mutation refreshes must not overwrite a newer channel selection.");
assert.match(shell, /fetch\("\/api\/auth\/me", \{ cache: "no-store", credentials: "include"/, "Reaction writes must use the current authenticated-session probe.");
assert.match(shell, /NEXT_PUBLIC_DZN_COMMS_REACTIONS_UI_ENABLED/, "Reaction controls must have a dedicated public activation switch.");
assert.match(shell, /reactionUiEnabled = liveUiEnabled && reactionUiFlagEnabled && payload\.feature_flags\.reactions_enabled/, "Reaction rows must require the live UI, dedicated reaction UI and server read switches.");
assert.match(shell, /reactionWritesAvailable && authStatus === "authenticated"/, "Reaction mutations must remain disabled until authentication is confirmed.");
assert.match(shell, /Log in to react/, "Signed-out users must receive a direct login action instead of enabled mutation controls.");
assert.match(shell, /if \(!reactionWritesAvailable\) return;/, "The auth probe must remain dormant until reaction writes are available.");
assert.match(shell, /\}, \[reactionWritesAvailable\]\);/, "The auth probe must follow the authoritative reaction-write availability state.");
assert.match(shell, /reactionAttemptRef\.current\.delete\(addAttemptKey\)[\s\S]*reactionAttemptRef\.current\.delete\(removeAttemptKey\)/, "A successful reaction mutation must clear stale retry IDs for both action directions.");
assert.match(historyClient, /`\/api\/comms\/message-history\?channel=\$\{encodeURIComponent\(selectedChannel\)\}&limit=30`/, "The client should fetch only the selected read-only history route.");
assert.match(historyClient, /credentials: "include"/, "The client should preserve current-user cookies for read checks.");
assert.match(shell, /NEXT_PUBLIC_DZN_COMMS_LIVE_UI_ENABLED/, "The live composer must remain behind an explicit public UI flag.");
assert.doesNotMatch(shell, /\b(?:sendBeacon|analytics|localStorage|sessionStorage|WebSocket|EventSource|DurableObject|OPENAI_API_KEY|AI_GATEWAY|stripe|checkout|DZN_LIVE_CHECKOUT_ENABLED)\b/i, "The /community shell must not track, call AI, or touch checkout.");
assert.match(platformSpec, /DZN Comms\/support remains the next queued product area/i, "Master spec must keep DZN Comms in the queued product area.");
assert.match(packageJson, /"test:dzn-comms-read-history": "tsx scripts\/test-dzn-comms-read-history\.ts && npm run test:dzn-comms-history-client"/, "Dedicated Comms read-history and client tests must be registered.");

assert.equal(readDznCommsReadHistoryFlags({} as Env).enabled, false, "Read-history route must default disabled.");
assert.equal(
  readDznCommsReadHistoryFlags({ DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED: "true" } as unknown as Env).enabled,
  false,
  "Read-history route must not enable without local/test scope.",
);
assert.equal(
  readDznCommsReadHistoryFlags({
    DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED: "true",
    DZN_COMMS_MESSAGE_HISTORY_READ_SCOPE: "local_test",
  } as unknown as Env).enabled,
  true,
  "Read-history route should enable only when the explicit local/test scope is present.",
);
assert.equal(
  readDznCommsReadHistoryFlags({
    DZN_COMMS_LIVE_ENABLED: "true",
    DZN_COMMS_LIVE_SCOPE: "production",
    SESSION_SECRET: "session-secret-at-least-32-bytes-long",
  } as unknown as Env).writeFeaturesEnabled,
  false,
  "Live write features must fail closed without the dedicated ledger secret.",
);
assert.equal(
  readDznCommsReadHistoryFlags({
    DZN_COMMS_LIVE_ENABLED: "true",
    DZN_COMMS_LIVE_SCOPE: "production",
    SESSION_SECRET: "session-secret-at-least-32-bytes-long",
    DZN_COMMS_LEDGER_SECRET: "ledger-secret-at-least-32-bytes-long",
  } as unknown as Env).writeFeaturesEnabled,
  true,
  "Live write features require independent session and stable ledger secrets.",
);
assert.ok(dznCommsReadHistoryBoundary().some((line) => /separate same-origin routes/i.test(line)), "Boundary copy must identify the protected write routes.");

async function main() {
  testMessageTimestamps();
  await testRuntimeContracts();
  console.log("DZN Comms read-history foundation checks passed.");
}

function testMessageTimestamps() {
  const previousTimezone = process.env.TZ;
  const expectedShellTimes = ["10:12 UTC", "10:18 UTC", "10:24 UTC"];
  const fixtures = [
    ["2026-09-01T10:12:00.000Z", "2026-09-01T10:12:00.000Z", "10:12"],
    ["2026-09-01 10:12:00", "2026-09-01T10:12:00.000Z", "10:12"],
    ["2026-09-01T10:12:00", "2026-09-01T10:12:00.000Z", "10:12"],
    ["2026-09-01T11:12:00+01:00", "2026-09-01T10:12:00.000Z", "10:12"],
    ["2026-09-01T06:12:00-04:00", "2026-09-01T10:12:00.000Z", "10:12"],
    ["2026-01-01T00:05:00+01:00", "2025-12-31T23:05:00.000Z", "23:05"],
    ["2026-03-29T01:30:00Z", "2026-03-29T01:30:00.000Z", "01:30"],
    ["2026-11-01T05:30:00Z", "2026-11-01T05:30:00.000Z", "05:30"],
  ];
  let baseline: string[] | undefined;
  try {
    for (const timezone of ["UTC", "Europe/London", "America/New_York", "Asia/Kathmandu", "Pacific/Kiritimati"]) {
      process.env.TZ = timezone;
      const rendered = fixtures.map(([value, canonical, label]) => {
        const html = renderToString(createElement(CommsMessageTime, { value }));
        assert.ok(html.includes(`dateTime="${canonical}"`), `${timezone}: canonical machine-readable date`);
        assert.ok(html.includes(`title="${canonical}"`), `${timezone}: full timestamp available`);
        assert.ok(html.includes(`>${label} UTC</time>`), `${timezone}: visible timezone label`);
        return html;
      });
      baseline ??= rendered;
      assert.deepEqual(rendered, baseline, `Timestamps must render byte-identically in ${timezone}.`);
      for (const value of [null, "", "invalid", "09/01/2026 10:12", "2026-09-01T99:00:00Z"]) {
        assert.equal(renderToString(createElement(CommsMessageTime, { value })), "", "Missing/invalid times must not invent a date.");
      }
      const html = renderToString(createElement(DznCommsShell));
      assert.deepEqual([...html.matchAll(/<time[^>]*>(.*?)<\/time>/g)].map((match) => match[1]), expectedShellTimes);
      assert.match(html, /Static fallback is active/);
      assert.match(html, /aria-label="Send is unavailable"/);
      assert.doesNotMatch(html, /suppressHydrationWarning/);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
}

async function testRuntimeContracts() {
  const unicodeDb = seededDb();
  unicodeDb.messages.splice(0, unicodeDb.messages.length, ...Array.from({ length: 30 }, (_, index) =>
    message({ id: `unicode-${index}`, channelId: "channel-global", body: "\u4e2d".repeat(2_000), createdAt: "2026-09-01T10:00:00.000Z" })));
  const unicodeRead = await callMessageHistoryRoute(unicodeDb, "GET", "https://dzn.test/api/comms/message-history?channel=global-chat&limit=30", enabledEnv(unicodeDb));
  assert.equal(unicodeRead.status, 200);
  assert.ok((await unicodeRead.clone().arrayBuffer()).byteLength > 128_000);
  const unicodePayload = await loadCommsHistory(new AbortController().signal, { fetcher: async () => unicodeRead });
  assert.equal(unicodePayload.messages.length, 30, "A real API page of long Unicode messages must not fall back to static content.");
  assert.ok(unicodePayload.messages.every(row => row.body === "\u4e2d".repeat(2_000)));
  const astralDb = seededDb();
  astralDb.messages.splice(0, astralDb.messages.length,
    message({ id: "astral", channelId: "channel-global", body: "😀".repeat(2_000), createdAt: "2026-09-01T10:00:00.000Z" }));
  const astralRead = await callMessageHistoryRoute(astralDb, "GET", "https://dzn.test/api/comms/message-history?channel=global-chat", enabledEnv(astralDb));
  const astralPayload = await loadCommsHistory(new AbortController().signal, { fetcher: async () => astralRead });
  assert.equal([...astralPayload.messages[0].body].length, 2_000, "Accepted astral characters must survive the API and client without truncation or split surrogates.");
  for (const kind of ["public", "private_group", "support"] as const) {
    for (const visibility of ["public", "private_group", "support_private"] as const) {
      if (visibility === (kind === "support" ? "support_private" : kind)) continue;
      const inconsistentDb = seededDb();
      inconsistentDb.channels.get("global-chat")!.kind = kind;
      inconsistentDb.channels.get("global-chat")!.visibility = visibility;
      const response = await callMessageHistoryRoute(inconsistentDb, "GET", "https://dzn.test/api/comms/message-history", enabledEnv(inconsistentDb));
      assert.equal(response.status, 404, "Inconsistent channel privacy must fail closed");
      assert.equal(inconsistentDb.queries.some(query => query.includes("FROM dzn_comms_messages")), false);
    }
  }
  const paginationDb = seededDb();
  paginationDb.messages.splice(0, paginationDb.messages.length,
    message({ id: "older", channelId: "channel-global", body: "Older", createdAt: "2026-09-01 10:29:59" }),
    message({ id: "newer", channelId: "channel-global", body: "Newer", createdAt: "2026-09-01 11:00:00" }),
    message({ id: "expired-state", channelId: "channel-global", body: "Expired", createdAt: "2026-09-01 10:29:59.900", visibilityState: "expired" }),
  );
  const paged = await callMessageHistoryRoute(paginationDb, "GET", "https://dzn.test/api/comms/message-history?limit=1&before=2026-09-01T10:30:00.000Z", enabledEnv(paginationDb));
  assert.deepEqual(((await paged.json()) as CommsPayload).messages.map(row => row.id), ["older"], "SQLite timestamps and expired-state rows must respect the cursor and limit");
  const tieDb = seededDb();
  tieDb.messages.splice(0, tieDb.messages.length,
    message({ id: "same-a", channelId: "channel-global", body: "A", createdAt: "2026-09-01T10:00:00.000Z" }),
    message({ id: "same-b", channelId: "channel-global", body: "B", createdAt: "2026-09-01T10:00:00.000Z" }),
    message({ id: "same-c", channelId: "channel-global", body: "C", createdAt: "2026-09-01T10:00:00.000Z" }),
  );
  const tieFirst = await callMessageHistoryRoute(tieDb, "GET", "https://dzn.test/api/comms/message-history?limit=2", enabledEnv(tieDb));
  const tieFirstPayload = await tieFirst.json() as CommsPayload;
  assert.deepEqual(tieFirstPayload.messages.map(row => row.id), ["same-b", "same-c"]);
  assert.equal(tieFirstPayload.page.has_more, true);
  assert.match(tieFirstPayload.page.next_cursor ?? "", /^[A-Za-z0-9_-]{8,1024}$/);
  const tieSecond = await callMessageHistoryRoute(tieDb, "GET", `https://dzn.test/api/comms/message-history?limit=2&cursor=${encodeURIComponent(tieFirstPayload.page.next_cursor ?? "")}`, enabledEnv(tieDb));
  const tieSecondPayload = await tieSecond.json() as CommsPayload;
  assert.deepEqual(tieSecondPayload.messages.map(row => row.id), ["same-a"], "Opaque cursors must not skip rows sharing the same timestamp.");
  assert.deepEqual(tieSecondPayload.page, { next_cursor: null, has_more: false, limit: 2 });
  const unusualDb = seededDb();
  unusualDb.messages.splice(0, unusualDb.messages.length,
    { ...message({ id: "unsortable", channelId: "channel-global", body: "No timestamp", createdAt: "2026-09-01T10:00:00.000Z" }), created_at: null as unknown as string },
    message({ id: "odd id/😀", channelId: "channel-global", body: "Odd ID", createdAt: "2026-09-01T10:00:00.000Z" }),
    message({ id: "older", channelId: "channel-global", body: "Older", createdAt: "2026-08-31T10:00:00.000Z" }),
  );
  const unusualFirst = await callMessageHistoryRoute(unusualDb, "GET", "https://dzn.test/api/comms/message-history?limit=1", enabledEnv(unusualDb));
  const unusualFirstPayload = await unusualFirst.json() as CommsPayload;
  assert.deepEqual(unusualFirstPayload.messages.map(row => row.id), ["odd id/😀"]);
  assert.equal(unusualFirstPayload.page.has_more, true);
  assert.ok(unusualFirstPayload.page.next_cursor);
  const unusualSecond = await callMessageHistoryRoute(unusualDb, "GET", `https://dzn.test/api/comms/message-history?limit=1&cursor=${encodeURIComponent(unusualFirstPayload.page.next_cursor ?? "")}`, enabledEnv(unusualDb));
  assert.deepEqual(((await unusualSecond.json()) as CommsPayload).messages.map(row => row.id), ["older"], "Every bounded text ID must produce a usable cursor; unsortable timestamps stay out of history.");
  const malformedCursor = await callMessageHistoryRoute(tieDb, "GET", "https://dzn.test/api/comms/message-history?cursor=not+a+cursor", enabledEnv(tieDb));
  assert.equal(malformedCursor.status, 400);
  const disabledDb = new FakeD1Database();
  const disabled = await callMessageHistoryRoute(disabledDb, "GET", "https://dzn.test/api/comms/message-history");
  assert.equal(disabled.status, 404, "Unset flags must keep the read-history route disabled.");
  assert.equal(disabledDb.queries.length, 0, "Disabled route must not query D1.");
  const disabledPayload = await disabled.json() as { code?: string; flags?: { enabled?: boolean } };
  assert.equal(disabledPayload.code, "DZN_COMMS_MESSAGE_HISTORY_DISABLED");
  assert.equal(disabledPayload.flags?.enabled, false);

  const postDb = new FakeD1Database();
  const post = await callMessageHistoryRoute(postDb, "POST", "https://dzn.test/api/comms/message-history", enabledEnv(postDb));
  assert.equal(post.status, 405, "Message history must not accept mutation methods.");

  const invalidDb = new FakeD1Database();
  const invalidChannel = await callMessageHistoryRoute(invalidDb, "GET", "https://dzn.test/api/comms/message-history?channel=../billing", enabledEnv(invalidDb));
  assert.equal(invalidChannel.status, 400, "Invalid channel slugs must be rejected before query.");

  const publicDb = seededDb();
  const publicRead = await callMessageHistoryRoute(publicDb, "GET", "https://dzn.test/api/comms/message-history?channel=global-chat&limit=99&before=2026-09-01T10:30:00.000Z", enabledEnv(publicDb));
  assert.equal(publicRead.status, 200, "Public channel reads should succeed when local/test flags are enabled.");
  assert.equal(publicRead.headers.get("cache-control")?.includes("private, no-store"), true, "Comms history responses must not be cached.");
  assert.equal(publicRead.headers.get("vary"), "Cookie", "Comms history responses must vary by Cookie.");
  const publicPayload = await publicRead.json() as CommsPayload;
  assert.equal(parseCommsHistory(publicPayload).messages.length, publicPayload.messages.length, "The current public API projection must pass the client contract.");
  assert.equal(publicPayload.read_only, true);
  assert.equal(publicPayload.presentation_only, true);
  assert.equal(publicPayload.feature_flags.sending_enabled, false);
  assert.equal(publicPayload.feature_flags.reactions_enabled, false);
  assert.equal(publicPayload.feature_flags.report_actions_enabled, false);
  assert.equal(publicPayload.feature_flags.moderation_mutations_enabled, false);
  assert.equal(publicPayload.feature_flags.ai_assist_runtime_enabled, false);
  assert.equal(publicPayload.feature_flags.analytics_or_tracking_enabled, false);
  assert.equal(publicPayload.messages.length, 4, "Expired and future-cursor-excluded rows must not be returned.");
  assert.equal(publicPayload.messages[0].id, "visible-1", "Messages should be returned oldest-to-newest for UI rendering.");
  assert.equal(publicPayload.messages.some((message) => message.id === "expired-1"), false, "Expired state rows must not appear.");
  assert.equal(publicPayload.messages.some((message) => message.id === "later-1"), false, "Rows after the before cursor must not appear.");
  assert.equal(publicPayload.messages.find((message) => message.id === "hidden-1")?.body, "Message hidden by DZN Safety.");
  assert.equal(publicPayload.messages.find((message) => message.id === "deleted-1")?.author_display_name, "DZN Safety");
  assert.equal(publicPayload.messages.find((message) => message.id === "quarantined-1")?.body.includes("unavailable"), true);
  const publicJson = JSON.stringify(publicPayload);
  for (const forbidden of ["author_user_id", "member-user", "other-user", "discord_id", "checkout_session", "ranking_score", "xp_award", "server_war", "ctf_tournament"]) {
    assert.equal(publicJson.includes(forbidden), false, `Public Comms payload must not expose ${forbidden}.`);
  }
  assert.deepEqual(publicDb.writeTargets, [], "Public read route must not write to D1.");

  const memberDirectory = await callMessageHistoryRoute(publicDb, "GET", "https://dzn.test/api/comms/message-history?channel=global-chat", privateEnabledEnv(publicDb), {
    cookie: "dzn_session=member-token",
  });
  const memberDirectoryPayload = await memberDirectory.json() as CommsPayload;
  assert.deepEqual(memberDirectoryPayload.available_channels?.map((channel) => channel.slug), ["global-chat", "pandora-squad"], "An active member should discover only Global Chat and their own groups.");
  assert.doesNotMatch(JSON.stringify(memberDirectoryPayload.available_channels), /channel-private|member-user|discord-member/, "Channel discovery must not expose internal channel, user or Discord IDs.");

  const nonMemberDirectory = await callMessageHistoryRoute(publicDb, "GET", "https://dzn.test/api/comms/message-history?channel=global-chat", privateEnabledEnv(publicDb), {
    cookie: "dzn_session=other-token",
  });
  const nonMemberDirectoryPayload = await nonMemberDirectory.json() as CommsPayload;
  assert.deepEqual(nonMemberDirectoryPayload.available_channels?.map((channel) => channel.slug), ["global-chat"], "A signed-in non-member must not enumerate private groups.");

  const privateDb = seededDb();
  const privateDisabled = await callMessageHistoryRoute(privateDb, "GET", "https://dzn.test/api/comms/message-history?channel=pandora-squad", enabledEnv(privateDb), {
    cookie: "dzn_session=member-token",
  });
  assert.equal(privateDisabled.status, 404, "Private group reads must remain unavailable while their dedicated server flag is off.");

  const anonymousPrivate = await callMessageHistoryRoute(privateDb, "GET", "https://dzn.test/api/comms/message-history?channel=pandora-squad", privateEnabledEnv(privateDb));
  assert.equal(anonymousPrivate.status, 404, "Private group reads must not reveal channel existence to signed-out users.");

  const deniedQueryStart = privateDb.queries.length;
  const deniedPrivate = await callMessageHistoryRoute(privateDb, "GET", "https://dzn.test/api/comms/message-history?channel=pandora-squad", privateEnabledEnv(privateDb), {
    cookie: "dzn_session=other-token",
  });
  const deniedQueryCount = privateDb.queries.length - deniedQueryStart;
  assert.equal(deniedPrivate.status, 404, "Private group reads must not reveal channel existence to non-members.");

  const unknownQueryStart = privateDb.queries.length;
  const unknownPrivate = await callMessageHistoryRoute(privateDb, "GET", "https://dzn.test/api/comms/message-history?channel=unknown-squad", privateEnabledEnv(privateDb), {
    cookie: "dzn_session=other-token",
  });
  const unknownQueryCount = privateDb.queries.length - unknownQueryStart;
  assert.equal(deniedQueryCount, unknownQueryCount, "Unknown and unauthorized private slugs must perform equivalent database work.");
  const unavailableBodies = await Promise.all([anonymousPrivate.clone().text(), deniedPrivate.clone().text(), unknownPrivate.clone().text()]);
  assert.equal(new Set(unavailableBodies).size, 1, "Unknown, signed-out and non-member private requests must be indistinguishable.");
  assert.deepEqual(
    [anonymousPrivate, deniedPrivate, unknownPrivate].map((response) => response.headers.get("cache-control")),
    Array(3).fill(anonymousPrivate.headers.get("cache-control")),
    "Unavailable private responses must use identical cache protection.",
  );

  const allowedPrivate = await callMessageHistoryRoute(privateDb, "GET", "https://dzn.test/api/comms/message-history?channel=pandora-squad", privateEnabledEnv(privateDb), {
    cookie: "dzn_session=member-token",
  });
  assert.equal(allowedPrivate.status, 200, "Private group reads should succeed for active members.");
  const privatePayload = await allowedPrivate.json() as CommsPayload;
  assert.equal(privatePayload.access.private_group_membership_required, true);
  assert.equal(privatePayload.access.current_user_member_role, "member");
  assert.deepEqual(privatePayload.available_channels?.map((channel) => channel.slug), ["global-chat", "pandora-squad"]);
  assert.deepEqual(privatePayload.messages.map((message) => message.id), ["private-1"]);
  assert.deepEqual(privateDb.writeTargets, [], "Private read route must not write to D1.");

  const revocationRaceDb = seededDb();
  revocationRaceDb.beforeMessageRead = () => {
    revocationRaceDb.privateGroupMembers.delete("channel-private:member-user");
  };
  const revokedDuringRead = await callMessageHistoryRoute(
    revocationRaceDb,
    "GET",
    "https://dzn.test/api/comms/message-history?channel=pandora-squad",
    privateEnabledEnv(revocationRaceDb),
    { cookie: "dzn_session=member-token" },
  );
  assert.equal(revokedDuringRead.status, 404, "A membership revoked during the read must invalidate the complete private response.");
  const revokedDuringReadText = await revokedDuringRead.text();
  assert.doesNotMatch(revokedDuringReadText, /Pandora Squad|pandora-squad|member|private-1/i, "A revoked in-flight response must not leak channel metadata, role or messages.");

  const lateRevocationDb = seededDb();
  lateRevocationDb.beforeAvailableChannels = () => {
    lateRevocationDb.privateGroupMembers.delete("channel-private:member-user");
  };
  const revokedAfterMessageRead = await callMessageHistoryRoute(
    lateRevocationDb,
    "GET",
    "https://dzn.test/api/comms/message-history?channel=pandora-squad",
    privateEnabledEnv(lateRevocationDb),
    { cookie: "dzn_session=member-token" },
  );
  assert.equal(revokedAfterMessageRead.status, 404, "A revocation during later private-data reads must invalidate the complete response.");
  assert.doesNotMatch(await revokedAfterMessageRead.text(), /Pandora Squad|pandora-squad|member|private-1/i);

  const supportRead = await callMessageHistoryRoute(privateDb, "GET", "https://dzn.test/api/comms/message-history?channel=support-case", enabledEnv(privateDb), {
    cookie: "dzn_session=member-token",
  });
  assert.equal(supportRead.status, 404, "Private support history must remain indistinguishably unavailable in this foundation.");
}

function seededDb() {
  const db = new FakeD1Database();
  db.channels.set("global-chat", {
    id: "channel-global",
    slug: "global-chat",
    kind: "public",
    name: "Global Chat",
    description: "Public read model",
    visibility: "public",
    is_readable: 1,
  });
  db.channels.set("pandora-squad", {
    id: "channel-private",
    slug: "pandora-squad",
    kind: "private_group",
    name: "Pandora Squad",
    description: "Private read model",
    visibility: "private_group",
    is_readable: 1,
  });
  db.channels.set("support-case", {
    id: "channel-support",
    slug: "support-case",
    kind: "support",
    name: "Support Case",
    description: "Private support history",
    visibility: "support_private",
    is_readable: 1,
  });
  db.messages.push(
    message({ id: "visible-1", channelId: "channel-global", authorDisplayName: "Rafael DZN", body: "Welcome everyone.", createdAt: "2026-09-01T10:12:00.000Z" }),
    message({ id: "hidden-1", channelId: "channel-global", authorDisplayName: "Bad Row", body: "Should not leak.", visibilityState: "hidden", createdAt: "2026-09-01T10:15:00.000Z" }),
    message({ id: "deleted-1", channelId: "channel-global", authorDisplayName: "Deleted Row", body: "Should not leak.", visibilityState: "deleted", createdAt: "2026-09-01T10:18:00.000Z" }),
    message({ id: "quarantined-1", channelId: "channel-global", authorDisplayName: "Quarantine Row", body: "Should not leak.", visibilityState: "quarantined", createdAt: "2026-09-01T10:20:00.000Z" }),
    message({ id: "expired-1", channelId: "channel-global", authorDisplayName: "Expired Row", body: "Should not appear.", visibilityState: "expired", createdAt: "2026-09-01T10:21:00.000Z" }),
    message({ id: "later-1", channelId: "channel-global", authorDisplayName: "Later Row", body: "Should not appear with cursor.", createdAt: "2026-09-01T10:40:00.000Z" }),
    message({ id: "private-1", channelId: "channel-private", authorDisplayName: "NovaRift", body: "Private group read history.", createdAt: "2026-09-01T10:16:00.000Z" }),
  );
  db.sessionUsers.set("member-token", { id: "member-user", discord_id: "discord-member", username: "Member", avatar: null });
  db.sessionUsers.set("other-token", { id: "other-user", discord_id: "discord-other", username: "Other", avatar: null });
  db.privateGroupMembers.set("channel-private:member-user", { role: "member", membershipState: "active" });
  return db;
}

function message(input: Partial<FakeMessageInput> & { id: string; channelId: string; body: string; createdAt: string }): FakeMessage {
  return {
    id: input.id,
    channel_id: input.channelId,
    author_display_name: input.authorDisplayName ?? "DZN Player",
    author_role_label: input.authorRoleLabel ?? "Member",
    body: input.body,
    visibility_state: input.visibilityState ?? "visible",
    created_at: input.createdAt,
    edited_at: input.editedAt ?? null,
    expires_at: input.expiresAt ?? null,
  };
}

function enabledEnv(db: FakeD1Database) {
  return {
    DB: db,
    SESSION_SECRET: "test-secret",
    DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED: "true",
    DZN_COMMS_MESSAGE_HISTORY_READ_SCOPE: "local_test",
  } as unknown as Env;
}

function privateEnabledEnv(db: FakeD1Database) {
  return {
    ...enabledEnv(db),
    SESSION_SECRET: "session-secret-at-least-32-bytes-long",
    DZN_COMMS_LEDGER_SECRET: "ledger-secret-at-least-32-bytes-long",
    DZN_COMMS_LIVE_ENABLED: "true",
    DZN_COMMS_LIVE_SCOPE: "production",
    DZN_COMMS_PRIVATE_GROUPS_ENABLED: "true",
  } as unknown as Env;
}

async function callMessageHistoryRoute(
  db: FakeD1Database,
  method: string,
  url: string,
  env: Env = { DB: db } as unknown as Env,
  headers: HeadersInit = {},
) {
  const cookie = new Headers(headers).get("cookie");
  FakeD1PreparedStatement.currentCookieValue = cookie?.match(/(?:^|;\s*)dzn_session=([^;]+)/)?.[1] ?? null;
  try {
    return await messageHistoryRoute({
      request: new Request(url, { method, headers }),
      env,
      params: {},
      data: {},
      waitUntil: () => undefined,
      next: async () => new Response(null, { status: 404 }),
    } satisfies PagesContext) as Response;
  } finally {
    FakeD1PreparedStatement.currentCookieValue = null;
  }
}

type CommsPayload = {
  read_only: boolean;
  presentation_only: boolean;
  access: {
    private_group_membership_required: boolean;
    current_user_member_role: string | null;
  };
  available_channels?: Array<{ slug: string }>;
  messages: Array<{
    id: string;
    author_display_name: string;
    body: string;
  }>;
  page: {
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
  feature_flags: {
    sending_enabled: boolean;
    reactions_enabled: boolean;
    report_actions_enabled: boolean;
    moderation_mutations_enabled: boolean;
    ai_assist_runtime_enabled: boolean;
    analytics_or_tracking_enabled: boolean;
  };
};

type FakeChannel = {
  id: string;
  slug: string;
  kind: "public" | "private_group" | "support";
  name: string;
  description: string | null;
  visibility: "public" | "private_group" | "support_private";
  is_readable: number;
};

type FakeMessageInput = {
  authorDisplayName: string;
  authorRoleLabel: string;
  visibilityState: "visible" | "hidden" | "deleted" | "quarantined" | "expired";
  editedAt: string | null;
  expiresAt: string | null;
};

type FakeMessage = {
  id: string;
  channel_id: string;
  author_display_name: string;
  author_role_label: string;
  body: string;
  visibility_state: "visible" | "hidden" | "deleted" | "quarantined" | "expired";
  created_at: string;
  edited_at: string | null;
  expires_at: string | null;
};

type FakeSessionUser = {
  id: string;
  discord_id: string;
  username: string;
  avatar: string | null;
};

class FakeD1Database {
  readonly channels = new Map<string, FakeChannel>();
  readonly messages: FakeMessage[] = [];
  readonly sessionUsers = new Map<string, FakeSessionUser>();
  readonly privateGroupMembers = new Map<string, { role: "owner" | "moderator" | "member"; membershipState: "active" | "removed" }>();
  readonly queries: string[] = [];
  readonly writeTargets: string[] = [];
  beforeMessageRead: (() => void) | null = null;
  beforeAvailableChannels: (() => void) | null = null;

  prepare(query: string) {
    this.queries.push(query);
    return new FakeD1PreparedStatement(this, query);
  }

  batch() {
    throw new Error("DZN Comms read-history tests do not allow D1 batch.");
  }

  exec() {
    throw new Error("DZN Comms read-history tests do not allow D1 exec.");
  }
}

class FakeD1PreparedStatement {
  static currentCookieValue: string | null = null;
  private bindings: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async first<T>() {
    if (this.query.includes("JOIN dzn_comms_private_group_members AS m")) {
      const [slug, userId] = this.bindings.map((value) => String(value));
      const channel = this.db.channels.get(slug);
      const member = channel ? this.db.privateGroupMembers.get(`${channel.id}:${userId}`) : null;
      return (channel?.kind === "private_group" && channel.visibility === "private_group" && channel.is_readable === 1 && member?.membershipState === "active"
        ? { ...channel, role: member.role }
        : null) as T | null;
    }

    if (this.query.includes("FROM dzn_comms_channels")) {
      const slug = String(this.bindings[0]);
      const row = this.db.channels.get(slug);
      return (row && row.is_readable === 1 ? row : null) as T | null;
    }

    if (this.query.includes("FROM sessions")) {
      const requestCookieValue = FakeD1PreparedStatement.currentCookieValue;
      const user = requestCookieValue ? this.db.sessionUsers.get(requestCookieValue) : null;
      return (user ? { ...user } : null) as T | null;
    }

    if (this.query.includes("FROM dzn_comms_private_group_members")) {
      const [channelId, userId] = this.bindings.map((value) => String(value));
      const row = this.db.privateGroupMembers.get(`${channelId}:${userId}`);
      return (row?.membershipState === "active" ? { role: row.role } : null) as T | null;
    }

    return null;
  }

  async all<T>() {
    if (this.query.includes("JOIN dzn_comms_channels c ON c.id = m.channel_id")) {
      this.db.beforeAvailableChannels?.();
      this.db.beforeAvailableChannels = null;
      const userId = String(this.bindings[0]);
      const results = [...this.db.privateGroupMembers.entries()].flatMap(([key, member]) => {
        const [channelId, memberUserId] = key.split(":");
        if (memberUserId !== userId || member.membershipState !== "active") return [];
        const channel = [...this.db.channels.values()].find((candidate) => candidate.id === channelId);
        return channel?.kind === "private_group" && channel.visibility === "private_group" && channel.is_readable === 1
          ? [{ slug: channel.slug, kind: channel.kind, name: channel.name, description: channel.description, visibility: channel.visibility, role: member.role }]
          : [];
      });
      return { results: results as T[], success: true, meta: {} };
    }

    if (this.query.includes("FROM dzn_comms_messages")) {
      this.db.beforeMessageRead?.();
      this.db.beforeMessageRead = null;
      const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
        DatabaseSync: new (file: string) => {
          exec(sql: string): void;
          prepare(sql: string): { run(...values: unknown[]): void; all(...values: unknown[]): T[] };
          close(): void;
        };
      };
      const sqlite = new DatabaseSync(":memory:");
      try {
        sqlite.exec(`CREATE TABLE dzn_comms_messages (id TEXT, channel_id TEXT, author_display_name TEXT, author_role_label TEXT, body TEXT, visibility_state TEXT, created_at TEXT, edited_at TEXT, expires_at TEXT);
          CREATE TABLE dzn_comms_private_group_members (channel_id TEXT, user_id TEXT, role TEXT, membership_state TEXT);`);
        const insert = sqlite.prepare("INSERT INTO dzn_comms_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const row of this.db.messages) insert.run(row.id, row.channel_id, row.author_display_name, row.author_role_label, row.body, row.visibility_state, row.created_at, row.edited_at, row.expires_at);
        const insertMember = sqlite.prepare("INSERT INTO dzn_comms_private_group_members VALUES (?, ?, ?, ?)");
        for (const [key, member] of this.db.privateGroupMembers) {
          const separator = key.indexOf(":");
          insertMember.run(key.slice(0, separator), key.slice(separator + 1), member.role, member.membershipState);
        }
        return { results: sqlite.prepare(this.query).all(...this.bindings), success: true, meta: {} };
      } finally { sqlite.close(); }
    }

    return { results: [] as T[], success: true, meta: {} };
  }

  async run() {
    throw new Error("DZN Comms read-history tests do not allow SQL writes.");
  }
}

void main();
