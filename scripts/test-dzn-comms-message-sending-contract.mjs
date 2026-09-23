import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const migration = read("migrations/0071_dzn_comms_live_moderation.sql");
const runtime = read("functions/_lib/dzn-comms-live.ts");
const shell = read("components/comms/dzn-comms-shell.tsx");
const client = read("components/comms/comms-history-client.ts");
const env = read(".env.example");

test("live Comms implementation remains default-off and migration-gated", () => {
  assert.match(env, /^DZN_COMMS_LIVE_ENABLED=false$/m);
  assert.match(env, /^DZN_COMMS_LIVE_SCOPE=local_test$/m);
  assert.match(env, /^NEXT_PUBLIC_DZN_COMMS_LIVE_UI_ENABLED=false$/m);
  assert.ok(existsSync(new URL("functions/api/comms/messages.ts", root)));
  assert.ok(existsSync(new URL("functions/api/comms/reports.ts", root)));
  assert.ok(existsSync(new URL("functions/api/owner/comms/moderate.ts", root)));
  assert.match(migration, /Production application remains a separate release operation/);
});

test("schema supplies durable idempotency, quotas, reports, timeouts and audit", () => {
  for (const table of ["dzn_comms_send_receipts", "dzn_comms_send_slots", "dzn_comms_attempt_slots", "dzn_comms_report_slots", "dzn_comms_timeouts", "dzn_comms_reports", "dzn_comms_moderation_audit"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /UNIQUE\(actor_user_id, channel_id, client_request_id\)/);
  assert.match(migration, /accepted_at TEXT NOT NULL/);
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
  assert.match(runtime, /secretReady/);
  assert.match(runtime, /scope === "local_test" && localRequest/);
  assert.match(runtime, /WITH RECURSIVE slots\(slot\)/);
  assert.doesNotMatch(runtime, /boundedSlot/);
  assert.match(runtime, /julianday\(accepted_at\) > julianday\(\?, '-5 seconds'\)/);
  assert.match(runtime, /exactKeys\(parsed\.value, \["messageId", "reason"\]\)/);
  assert.match(runtime, /exactKeys\(parsed\.value, \["messageId", "action", "reason"\]\)/);
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
  assert.match(client, /"\/api\/comms\/messages"/);
  assert.match(client, /"\/api\/comms\/reports"/);
  assert.doesNotMatch(runtime + shell + client, /STRIPE_SECRET|DZN_LIVE_CHECKOUT_ENABLED|NITRADO_TOKEN|DISCORD_BOT_TOKEN|WebSocket|DurableObject|OPENAI_API_KEY/);
});
