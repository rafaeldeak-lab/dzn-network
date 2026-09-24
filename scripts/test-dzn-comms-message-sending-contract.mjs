import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const baseMigration = read("migrations/0071_dzn_comms_live_moderation.sql");
const privacyMigration = read("migrations/0072_dzn_comms_private_rate_ledgers.sql");
const migration = `${baseMigration}\n${privacyMigration}`;
const runtime = read("functions/_lib/dzn-comms-live.ts");
const shell = read("components/comms/dzn-comms-shell.tsx");
const client = read("components/comms/comms-history-client.ts");
const env = read(".env.example");

test("live Comms implementation remains default-off and migration-gated", () => {
  assert.match(env, /^DZN_COMMS_LIVE_ENABLED=false$/m);
  assert.match(env, /^DZN_COMMS_LIVE_SCOPE=local_test$/m);
  assert.match(env, /^NEXT_PUBLIC_DZN_COMMS_LIVE_UI_ENABLED=false$/m);
  assert.match(env, /^DZN_COMMS_OWNER_MODERATION_ENABLED=false$/m);
  assert.match(env, /^DZN_COMMS_RETENTION_ENABLED=false$/m);
  assert.ok(existsSync(new URL("functions/api/comms/messages.ts", root)));
  assert.ok(existsSync(new URL("functions/api/comms/reports.ts", root)));
  assert.ok(existsSync(new URL("functions/api/owner/comms/moderate.ts", root)));
  assert.ok(existsSync(new URL("functions/owner/comms.ts", root)), "The owner Comms page must have a platform-owner page guard.");
  assert.ok(existsSync(new URL("scripts/test-dzn-comms-live-runtime.ts", root)));
  assert.match(migration, /Production application remains a separate release operation/);
});

test("schema supplies durable idempotency, quotas, reports, timeouts and audit", () => {
  for (const table of ["dzn_comms_send_receipts", "dzn_comms_send_slots", "dzn_comms_attempt_slots", "dzn_comms_report_slots", "dzn_comms_timeouts", "dzn_comms_reports", "dzn_comms_moderation_audit"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /UNIQUE\(actor_user_id, channel_id, client_request_id\)/);
  assert.match(migration, /accepted_at TEXT NOT NULL/);
  assert.match(migration, /actor_rate_key TEXT NOT NULL/);
  assert.match(migration, /actor_receipt_key TEXT NOT NULL/);
  assert.match(migration, /send_rate_key TEXT/);
  assert.match(migration, /send_minute_bucket TEXT/);
  assert.match(migration, /send_slot INTEGER/);
  assert.match(migration, /CHECK\(slot BETWEEN 1 AND 20\)/);
  assert.match(migration, /CHECK\(slot BETWEEN 1 AND 30\)/);
  assert.match(migration, /CHECK\(slot BETWEEN 1 AND 10\)/);
  assert.doesNotMatch(migration, /\b(?:stripe|billing|subscription|nitrado|player_profiles|server_war|ranking|xp_award)\b/i);
});

test("send and report routes are session-bound, same-origin and bounded", () => {
  assert.match(runtime, /getSessionUser\(env, request\)/);
  assert.match(runtime, /if \(!sameOrigin\(request\)\)/);
  assert.match(runtime, /readBoundedJson<SendInput>\(request, MAX_REQUEST_BYTES\)/);
  assert.match(runtime, /MAX_BODY_CODE_POINTS = 2_000/);
  assert.match(runtime, /MAX_BODY_BYTES = 8_000/);
  assert.match(runtime, /channelSlug !== "global-chat"/);
  assert.match(runtime, /requirePlatformOwner\(env, request\)/);
  assert.match(runtime, /db\.batch\(statements\)/);
  assert.match(runtime, /channels\.slug = 'global-chat'/);
  assert.match(runtime, /keyedDigest/);
  assert.match(runtime, /rateLimitDigest/);
  assert.match(runtime, /receiptDigest/);
  assert.match(runtime, /receiptDigest\(user\.id, requestId, env\.SESSION_SECRET!\)/, "Replay keys must be scoped to one actor and one client request.");
  assert.match(runtime, /actorId\.normalize\("NFKC"\).*requestId\.normalize\("NFKC"\)/, "Separate receipts from one actor must not share a stable join key.");
  assert.doesNotMatch(runtime, /dzn_comms_send_receipts \(id, actor_user_id/, "Receipt writes must not retain the raw account ID.");
  assert.match(runtime, /secretReady/);
  assert.match(runtime, /scope === "local_test" && localRequest/);
  assert.match(runtime, /WITH RECURSIVE slots\(slot\)/);
  assert.match(runtime, /await allocateAttemptSlot\(db, user\.id, minuteBucket\)\.run\(\)[\s\S]*const replay = await readReceipt/, "Attempt quota must be reserved before an idempotency replay can return.");
  assert.doesNotMatch(runtime, /boundedSlot/);
  assert.match(runtime, /julianday\(accepted_at\) > julianday\(\?, '-5 seconds'\)/);
  assert.match(runtime, /exactKeys\(parsed\.value, \["messageId", "reason"\]\)/);
  assert.match(runtime, /exactKeys\(parsed\.value, \["messageId", "action", "reason"\]\)/);
  assert.match(runtime, /concurrentReplay\) return error\(409, "REQUEST_ID_CONFLICT"/, "Concurrent different-body retries must preserve 409 conflict semantics.");
  assert.match(runtime, /WHERE changes\(\) > 0/, "Moderation audit rows must depend on a real state transition.");
  assert.match(runtime, /MODERATION_NO_CHANGE/, "No-op moderation must return a conflict instead of a false success.");
  assert.match(runtime, /SET message_id = NULL, send_rate_key = NULL, send_minute_bucket = NULL, send_slot = NULL/, "Destructive erasure must clear the exact receipt-to-rate-slot association.");
  assert.doesNotMatch(runtime, /DELETE FROM dzn_comms_send_slots[\s\S]{0,500}message_id/, "Destructive erasure must not refund accepted-send rate limits.");
});

test("moderation publishes only allow decisions and never stores rejected text", () => {
  assert.match(runtime, /moderated\.decision !== "allow"/);
  assert.match(runtime, /SECRET_DETECTED/);
  assert.match(runtime, /SPAM_BLOCKED/);
  assert.match(runtime, /SAFETY_TIMEOUT/);
  const rejected = runtime.slice(runtime.indexOf("async function storeRejected"));
  assert.doesNotMatch(rejected, /moderated\.body|parsed\.value\.body/);
  assert.match(runtime, /body = 'Message deleted\.'/);
});

test("browser UI polls history, posts through protected routes and stays isolated", () => {
  assert.match(shell, /window\.setInterval/);
  assert.match(shell, /sendAttemptRef/);
  assert.match(shell, /sendCommsMessage\(draft, pendingAttempt\.requestId\)/);
  assert.match(shell, /Message sent\. Chat history will refresh shortly\./);
  assert.match(shell, /reportCommsMessage\(message\.id\)/);
  assert.match(shell, /reportActionsEnabled = liveUiEnabled && payload\.feature_flags\.report_actions_enabled/, "Report controls must stay behind the matching live UI gate.");
  assert.match(shell, /sendingEnabled = liveUiEnabled && payload\.feature_flags\.sending_enabled/, "Composer controls must stay behind the matching live UI gate.");
  assert.match(shell, /liveUiEnabled && payload\.feature_flags\.sending_enabled \? "Global Chat is live/, "Read-only history must not claim chat is live before the matching UI release gate.");
  assert.match(shell, /Report received\./);
  assert.match(shell, /Report failed\. Try again\./);
  assert.match(shell, /liveUiEnabled \? "Live" : "History"/, "Production history must not be labelled Local/Test.");
  assert.match(client, /"\/api\/comms\/messages"/);
  assert.match(client, /"\/api\/comms\/reports"/);
  assert.match(client, /setTimeout\(\(\) => controller\.abort\(\), COMMS_HISTORY_TIMEOUT_MS\)/, "Send and report mutations must have a bounded abort timeout.");
  assert.match(client, /body: JSON\.stringify\(body\), signal: controller\.signal/, "Every mutation request must carry the timeout signal.");
  assert.match(runtime, /CHAT_STORAGE_UNAVAILABLE/);
  assert.match(runtime, /REPORT_STORAGE_UNAVAILABLE/);
  assert.match(runtime, /julianday\(expires_at\) > julianday\('now'\)/, "Expired idempotency receipts must not replay forever.");
  assert.match(runtime, /DELETE FROM dzn_comms_send_receipts[^\n]+julianday\(expires_at\) <= julianday\('now'\)/, "An exact expired receipt must be replaceable atomically.");
  assert.match(runtime, /host === "\[::1\]"/, "Local activation must accept WHATWG bracketed IPv6 loopback hosts.");
  assert.match(shell, /current\.status === "ready"[\s\S]*last received messages/, "A failed poll after a successful load must preserve real history.");
  assert.doesNotMatch(runtime + shell + client, /STRIPE_SECRET|DZN_LIVE_CHECKOUT_ENABLED|NITRADO_TOKEN|DISCORD_BOT_TOKEN|WebSocket|DurableObject|OPENAI_API_KEY/);
});
