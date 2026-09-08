import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync } from "node:fs";
import { syncServerSubscriptionsForOwner } from "../functions/_lib/automation";
import { getOwnerBillingStatus, getOwnerEntitlements, upsertBillingAccount } from "../functions/_lib/plans";
import { onRequest } from "../functions/api/stripe/webhook";
import { createWebhookFixture } from "./fixtures/billing-webhook";

type Row = Record<string, unknown>;
type Fixture = Awaited<ReturnType<typeof createWebhookFixture>>;
const fixtures: Fixture[] = [];
const originalFetch = globalThis.fetch;
const periodStart = 1788220800;
const periodEnd = 1790812800;
const iso = (time: number) => new Date(time * 1000).toISOString();
const subscription = (overrides: Row = {}) => ({ id: "sub_owner", object: "subscription", customer: "cus_owner", livemode: false,
  status: "active", metadata: { discord_user_id: "discord-owner" }, current_period_start: periodStart, current_period_end: periodEnd,
  cancel_at_period_end: false, items: { data: [{ price: { id: "price_starter_fixture" } }] }, ...overrides });
const event = (id: string, type = "invoice.paid", object: Row = { object: "invoice", customer: "cus_owner", subscription: "sub_owner" }) => ({ id, type, livemode: false, data: { object } });
let provider: (id: string) => Promise<Row> = async () => subscription();
let fetches = 0;
async function fixture(migration = true) {
  const f = await createWebhookFixture(migration);
  fixtures.push(f);
  for (const owner of ["owner", "other"]) {
    const values = { stripeCustomerId: `cus_${owner}`, stripeSubscriptionId: `sub_${owner}`, planKey: "starter" as const,
      currentPeriodStart: iso(periodStart), currentPeriodEnd: iso(periodEnd), status: "past_due" };
    await upsertBillingAccount(f.env, { discordUserId: `discord-${owner}`, ...values, planStatus: values.status });
    await syncServerSubscriptionsForOwner(f.env, `discord-${owner}`, { ...values, stripePriceId: "price_starter_fixture" });
  }
  f.db.writes = [];
  f.db.allWrites = [];
  return f;
}
const tables = ["owner_billing_accounts", "owner_plan_entitlements", "owner_starter_trial_claims", "server_subscriptions", "server_sync_state"];
const state = (f: Fixture) => tables.map(table => f.db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
const account = (f: Fixture, owner = "discord-owner") => f.db.sqlite.prepare("SELECT * FROM owner_billing_accounts WHERE discord_user_id = ?").get(owner)!;
const count = (f: Fixture, table: string) => f.db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n;
async function deliver(f: Fixture, payload: ReturnType<typeof event>, expected: number, validSignature = true) {
  const body = JSON.stringify(payload);
  const time = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", validSignature ? f.env.STRIPE_WEBHOOK_SECRET! : "wrong").update(`${time}.${body}`).digest("hex");
  const response = await onRequest({ env: f.env, request: new Request("https://local.test/api/stripe/webhook", {
    method: "POST", body, headers: { "stripe-signature": `t=${time},v1=${signature}` },
  }), params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 404 }) });
  const text = await response.text();
  assert.equal(response.status, expected, text);
  assert.doesNotMatch(text, /cus_|sub_|discord-|whsec|sk_test|SQL|constraint|private-evidence/);
  if (expected !== 400) assert.match(response.headers.get("Cache-Control") ?? "", /private, no-store/);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function run() {
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /^https:\/\/api\.stripe\.com\/v1\/subscriptions\/sub_[A-Za-z0-9_]+$/);
    assert.equal(init?.method, "GET");
    fetches++;
    return Response.json(await provider(String(input).split("/").at(-1)!));
  };
  const duplicate = await fixture();
  const otherBefore = account(duplicate, "discord-other");
  const linkedBefore = duplicate.db.sqlite.prepare("SELECT * FROM linked_servers ORDER BY id").all();
  const one = event("evt_duplicate");
  await Promise.all(Array.from({ length: 8 }, () => deliver(duplicate, one, 200)));
  assert.equal(count(duplicate, "billing_webhook_receipts"), 1);
  assert.equal(duplicate.db.sqlite.prepare("SELECT version FROM billing_webhook_versions").get()?.version, 1);
  const applied = state(duplicate);
  const afterFetch = fetches;
  const afterWrites = duplicate.db.allWrites.length;
  await deliver(duplicate, one, 200);
  assert.deepEqual(state(duplicate), applied);
  assert.equal(fetches, afterFetch);
  assert.equal(duplicate.db.allWrites.length, afterWrites);
  await deliver(duplicate, { ...one, data: { object: { ...one.data.object, metadata: { secret: "private-evidence" } } } }, 500);
  assert.deepEqual(state(duplicate), applied);
  assert.equal(fetches, afterFetch);
  assert.deepEqual(account(duplicate, "discord-other"), otherBefore);
  assert.deepEqual(duplicate.db.sqlite.prepare("SELECT * FROM linked_servers ORDER BY id").all(), linkedBefore);
  console.log("PASS concurrent and sequential duplicate IDs commit once; conflicting ID reuse fails without provider reads or additional writes");

  const overlapping = await fixture();
  const entered = deferred();
  const release = deferred();
  let first = true;
  provider = async () => {
    if (first) { first = false; entered.resolve(); await release.promise; return subscription({ status: "active" }); }
    return subscription({ status: "canceled" });
  };
  const older = event("evt_older_read");
  const pending = deliver(overlapping, older, 500);
  await entered.promise;
  await deliver(overlapping, event("evt_newer_read", "customer.subscription.deleted", subscription({ status: "canceled" })), 200);
  release.resolve();
  await pending;
  assert.equal(account(overlapping).plan_status, "canceled");
  assert.equal(count(overlapping, "billing_webhook_receipts"), 1);
  await deliver(overlapping, older, 200);
  assert.equal(account(overlapping).plan_status, "canceled");
  assert.equal(count(overlapping, "billing_webhook_receipts"), 2);
  console.log("PASS stale in-flight provider result cannot overwrite a newer commit; retry re-reads current canceled state");

  provider = async () => subscription();
  for (let index = 0; index < 7; index++) {
    const interrupted = await fixture();
    const before = state(interrupted);
    interrupted.db.failBatchStatement = index;
    const payload = event(`evt_failure_${index}`);
    await deliver(interrupted, payload, 500);
    assert.deepEqual(state(interrupted), before);
    assert.equal(count(interrupted, "billing_webhook_receipts"), 0);
    assert.equal(count(interrupted, "billing_webhook_versions"), 0);
    assert.equal(interrupted.db.allWrites.length, 0);
    await deliver(interrupted, payload, 200);
    assert.equal(account(interrupted).plan_status, "active");
    assert.equal(count(interrupted, "billing_webhook_receipts"), 1);
  }
  console.log("PASS failure at every batch stage rolls back receipt, revision, claim, account, entitlement, subscription and scheduling writes; same event retries successfully");

  const lost = await fixture();
  lost.db.loseBatchResponse = true;
  await deliver(lost, event("evt_commit_lost"), 200);
  const saved = state(lost);
  const calls = fetches;
  await deliver(lost, event("evt_commit_lost"), 200);
  assert.deepEqual(state(lost), saved);
  assert.equal(fetches, calls);
  assert.equal(count(lost, "billing_webhook_receipts"), 1);
  console.log("PASS lost response after commit is reconciled from the durable receipt without repeating downstream writes");

  const initial = await createWebhookFixture();
  fixtures.push(initial);
  const early = event("evt_early_invoice");
  await deliver(initial, early, 500);
  assert.equal(count(initial, "billing_webhook_receipts"), 0);
  assert.equal(count(initial, "owner_billing_accounts"), 0);
  await deliver(initial, event("evt_initial_subscription", "customer.subscription.created", subscription()), 200);
  await deliver(initial, early, 200);
  assert.equal(count(initial, "billing_webhook_receipts"), 2);
  assert.equal(account(initial).stripe_subscription_id, "sub_owner");
  console.log("PASS early invoice is not acknowledged/lost before association; the same event succeeds after verified initial subscription association");

  const ownership = await fixture();
  const previous = state(ownership);
  ownership.db.beforeBatch = async () => {
    ownership.db.beforeBatch = undefined;
    ownership.db.sqlite.exec("UPDATE linked_servers SET user_id = 'user-other' WHERE id = 'server-owner'");
  };
  await deliver(ownership, event("evt_membership_changed"), 500);
  assert.deepEqual(state(ownership), previous);
  assert.equal(count(ownership, "billing_webhook_receipts"), 0);
  const conflict = await fixture();
  conflict.db.sqlite.exec("UPDATE linked_servers SET guild_id = 'guild-owner' WHERE id = 'server-other'");
  const conflictBefore = state(conflict);
  await deliver(conflict, event("evt_shared_guild"), 500);
  assert.deepEqual(state(conflict), conflictBefore);
  console.log("PASS current linked-server membership and shared-guild ownership are rechecked inside the transaction");

  const accountRace = await fixture();
  const grantsBefore = accountRace.db.sqlite.prepare("SELECT * FROM owner_plan_entitlements ORDER BY 1").all();
  accountRace.db.beforeBatch = async () => {
    accountRace.db.beforeBatch = undefined;
    accountRace.db.sqlite.exec("UPDATE owner_billing_accounts SET stripe_subscription_id = 'sub_replacement' WHERE discord_user_id = 'discord-owner'");
  };
  await deliver(accountRace, event("evt_account_changed"), 500);
  assert.equal(account(accountRace).stripe_subscription_id, "sub_replacement");
  assert.deepEqual(accountRace.db.sqlite.prepare("SELECT * FROM owner_plan_entitlements ORDER BY 1").all(), grantsBefore);
  assert.equal(count(accountRace, "billing_webhook_receipts"), 0);
  console.log("PASS account association change between read and commit invalidates the entire write plan");

  const separate = await fixture();
  provider = async id => subscription({ id, customer: id === "sub_owner" ? "cus_owner" : "cus_other",
    metadata: { discord_user_id: id === "sub_owner" ? "discord-owner" : "discord-other" } });
  await Promise.all([deliver(separate, event("evt_independent_owner"), 200),
    deliver(separate, event("evt_independent_other", "invoice.paid", { object: "invoice", customer: "cus_other", subscription: "sub_other" }), 200)]);
  assert.equal(account(separate).plan_status, "active");
  assert.equal(account(separate, "discord-other").plan_status, "active");
  assert.equal(count(separate, "billing_webhook_versions"), 2);
  assert.equal(count(separate, "billing_webhook_receipts"), 2);
  console.log("PASS separate owners/customers reconcile concurrently without a global lock or cross-account updates");

  const competing = await fixture();
  provider = async () => subscription({ id: "sub_old", status: "canceled" });
  const oldCheckout = event("evt_old_checkout", "checkout.session.completed", { id: "cs_old", mode: "subscription", customer: "cus_owner",
    subscription: "sub_old", metadata: { discord_user_id: "discord-owner" } });
  const competingBefore = state(competing);
  await deliver(competing, oldCheckout, 200);
  assert.deepEqual(state(competing), competingBefore);
  assert.equal(competing.db.sqlite.prepare("SELECT outcome FROM billing_webhook_receipts").get()?.outcome, "superseded");
  console.log("PASS delayed checkout completion cannot replace the current subscription or resurrect access");

  const replacement = await fixture();
  replacement.db.sqlite.exec("UPDATE owner_billing_accounts SET plan_status = 'canceled' WHERE discord_user_id = 'discord-owner'");
  provider = async () => subscription({ id: "sub_replacement", items: { data: [{ price: { id: "price_pro_fixture" } }] } });
  const replaceEvent = event("evt_replace", "checkout.session.completed", { id: "cs_replacement", mode: "subscription", customer: "cus_owner", subscription: "sub_replacement",
    metadata: { discord_user_id: "discord-owner", dzn_checkout_attempt_id: "attempt_replacement" } });
  await deliver(replacement, replaceEvent, 500);
  replacement.db.sqlite.prepare(`INSERT INTO billing_checkout_attempts
    (id, discord_user_id, plan_key, stripe_customer_id, stripe_mode, stripe_key_fingerprint, stripe_api_version, params_json, state, first_requested_at, stripe_session_id, created_at, updated_at)
    VALUES ('attempt_replacement', 'discord-owner', 'pro', 'cus_owner', 'test', 'fixture', 'fixture', ?, 'session_ready', 1, 'cs_replacement', 1, 1)`)
    .run(JSON.stringify({ "line_items[0][price]": "price_pro_fixture" }));
  await deliver(replacement, replaceEvent, 200);
  assert.equal(account(replacement).stripe_subscription_id, "sub_replacement");
  assert.equal(account(replacement).plan_status, "active");
  console.log("PASS replacing a terminal subscription requires the exact private current checkout attempt/Session/Price proof");

  const denied = await fixture();
  const deniedBefore = state(denied);
  const beforeDenied = fetches;
  await deliver(denied, event("evt_bad_signature"), 400, false);
  await deliver(denied, { ...event("evt_mode"), livemode: true }, 500);
  await deliver(denied, { ...event(""), id: "" }, 500);
  assert.equal(fetches, beforeDenied);
  assert.deepEqual(state(denied), deniedBefore);
  assert.equal(denied.db.allWrites.length, 0);
  const missing = await fixture(false);
  await deliver(missing, event("evt_missing_schema"), 500);
  assert.equal(fetches, beforeDenied);
  assert.equal(missing.db.allWrites.length, 0);
  console.log("PASS invalid signatures, missing IDs, test/live mismatch and missing migration fail without provider contact or writes");

  const empty = await createWebhookFixture();
  fixtures.push(empty);
  const emptyEntitlements = await getOwnerEntitlements(empty.env, "discord-owner");
  assert.equal(emptyEntitlements.plan_key, "free");
  assert.equal(count(empty, "owner_plan_entitlements"), 0, "Read-side fallback cannot insert stale free entitlements over a racing grant.");
  const display = await fixture();
  display.db.sqlite.exec("ALTER TABLE linked_servers ADD COLUMN nitrado_service_id TEXT");
  provider = async () => subscription();
  await deliver(display, event("evt_display_active"), 200);
  display.db.afterFirst = async sql => {
    if (!sql.startsWith("SELECT * FROM owner_billing_accounts")) return;
    display.db.afterFirst = undefined;
    provider = async () => subscription({ status: "canceled" });
    await deliver(display, event("evt_display_canceled"), 200);
  };
  await getOwnerBillingStatus(display.env, { id: "user-owner", discord_id: "discord-owner", username: "Fixture", avatar: null });
  assert.equal(account(display).plan_status, "canceled");
  assert.equal(display.db.sqlite.prepare("SELECT plan_key FROM owner_plan_entitlements WHERE discord_user_id = 'discord-owner'").get()?.plan_key, "free",
    "An already-running billing status read cannot restore paid entitlements after a cancellation commits.");
  console.log("PASS a stale billing-status read cannot persist paid permissions over a newer cancellation");
  for (const f of fixtures) {
    for (const sql of f.db.allWrites) assert.match(sql, /^\s*(INSERT INTO (billing_webhook_receipts|billing_webhook_versions|owner_billing_accounts|owner_plan_entitlements|owner_starter_trial_claims|server_subscriptions|server_sync_state)\b)/);
    assert.equal(f.env.DZN_LIVE_CHECKOUT_ENABLED, "false");
  }
  const numbers = readdirSync("migrations").filter(file => /^\d{4}_.+\.sql$/.test(file)).map(file => file.slice(0, 4));
  assert.equal(new Set(numbers).size, numbers.length);
  console.log("PASS read fallback cannot overwrite grants; all writes stay in approved billing/receipt tables, migration numbers are unique and live checkout remains off");
}
run().finally(() => { globalThis.fetch = originalFetch; for (const f of fixtures) f.db.sqlite.close(); })
  .catch(error => { console.error(error); process.exitCode = 1; });
