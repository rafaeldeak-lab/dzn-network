import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { syncServerSubscriptionsForOwner } from "../functions/_lib/automation";
import { getOwnerBillingStatus, upsertBillingAccount } from "../functions/_lib/plans";
import { createWebhookFixture, type WebhookFixtureDb } from "./fixtures/billing-webhook";
import { onRequest } from "../functions/api/stripe/webhook";
import type { Env } from "../functions/_lib/types";

type Row = Record<string, unknown>;
let db: WebhookFixtureDb;
let env: Env;
let eventSequence = 0;
const periodStart = 1788220800;
const periodEnd = 1790812800;
const renewedEnd = 1793491200;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const invoice = { object: "invoice", customer: "cus_owner", subscription: "sub_owner" };
const subscription = (overrides: Row = {}): Row => ({
  id: "sub_owner", object: "subscription", customer: "cus_owner", status: "active",
  metadata: { discord_user_id: "discord-owner", source: "dzn-network" },
  current_period_start: periodStart, current_period_end: periodEnd, cancel_at_period_end: false,
  items: { data: [{ price: { id: "price_starter_fixture" } }] }, ...overrides,
});
let provider: Row | null = subscription();
let providerCalls = 0;
const originalFetch = globalThis.fetch;
const row = (table: string, field: string, value: string) => db.sqlite.prepare(`SELECT * FROM ${table} WHERE ${field} = ?`).get(value)!;
const account = () => row("owner_billing_accounts", "discord_user_id", "discord-owner");
const entitlement = () => row("owner_plan_entitlements", "discord_user_id", "discord-owner");
const server = () => row("server_subscriptions", "guild_id", "guild-owner");

async function deliver(type: string, object: Row = invoice, expected = 200, signatureValid = true) {
  const body = JSON.stringify({ id: `evt_recovery_${++eventSequence}`, livemode: false, type, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", signatureValid ? env.STRIPE_WEBHOOK_SECRET! : "wrong").update(`${timestamp}.${body}`).digest("hex");
  const response = await onRequest({
    env, request: new Request("https://local.test/api/stripe/webhook", {
      method: "POST", body, headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    }), params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 404 }),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${type}: ${text}`);
  assert.doesNotMatch(text, /cus_owner|sub_owner|discord-owner|sk_test|whsec|raw-provider-secret/);
  return text;
}

function expectState(status: string, end = periodEnd, canceledAtEnd = false, plan = "starter") {
  assert.equal(account().plan_status, status);
  assert.equal(account().current_period_end, iso(end));
  assert.equal(account().cancel_at_period_end, Number(canceledAtEnd));
  assert.equal(server().status, status);
  assert.equal(server().current_period_end, iso(end));
  assert.equal(server().cancel_at_period_end, Number(canceledAtEnd));
  assert.equal(server().stripe_price_id, plan === "starter" ? "price_starter_fixture" : plan === "premium" ? "price_legacy_fixture" : "price_pro_fixture");
  assert.equal(entitlement().plan_key, ["active", "trialing"].includes(status) ? plan : "free");
}

async function unchanged(type: string, object: Row, expected = 500) {
  const before = [account(), entitlement(), server()];
  const writes = db.writes.length;
  await deliver(type, object, expected);
  assert.deepEqual([account(), entitlement(), server()], before);
  assert.equal(db.writes.length, writes, "Rejected or irrelevant events cannot mutate billing records.");
}

async function main() {
  ({ db, env } = await createWebhookFixture());
  db.sqlite.exec("ALTER TABLE linked_servers ADD COLUMN nitrado_service_id TEXT");
  for (const owner of ["owner", "other"]) {
    const values = {
      stripeCustomerId: `cus_${owner}`, stripeSubscriptionId: `sub_${owner}`, planKey: "starter" as const,
      currentPeriodStart: iso(periodStart), currentPeriodEnd: iso(periodEnd),
    };
    await upsertBillingAccount(env, { discordUserId: `discord-${owner}`, ...values, planStatus: "active" });
    await syncServerSubscriptionsForOwner(env, `discord-${owner}`, { ...values, status: "active", stripePriceId: "price_starter_fixture" });
  }
  const otherBefore = [row("owner_billing_accounts", "discord_user_id", "discord-other"),
    row("owner_plan_entitlements", "discord_user_id", "discord-other"), row("server_subscriptions", "guild_id", "guild-other")];
  const linkedBefore = db.sqlite.prepare("SELECT * FROM linked_servers ORDER BY id").all();
  db.writes = [];
  globalThis.fetch = async (input, init) => {
    providerCalls++;
    assert.match(String(input), /^https:\/\/api\.stripe\.com\/v1\/subscriptions\/sub_[a-z]+$/);
    assert.equal(init?.method ?? "GET", "GET", "Only provider reads are allowed.");
    if (!provider) throw new Error("raw-provider-secret must not escape");
    return Response.json(provider);
  };

  provider = subscription({ status: "past_due" });
  await deliver("invoice.payment_failed");
  expectState("past_due");
  provider = subscription();
  db.failAccountLookup = true;
  await unchanged("invoice.payment_succeeded", invoice);
  db.failAccountLookup = false;
  await deliver("invoice.payment_succeeded");
  expectState("active");
  assert.equal(row("owner_starter_trial_claims", "discord_user_id", "discord-owner").status, "active");
  console.log("PASS failed payment -> successful retry restores account, trial claim, entitlement and linked-server access");

  provider = subscription({ current_period_start: periodEnd, current_period_end: renewedEnd });
  await deliver("invoice.paid", { ...invoice, subscription: undefined,
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_owner" } } });
  expectState("active", renewedEnd);
  assert.equal(account().current_period_start, iso(periodEnd));
  assert.equal(server().current_period_start, iso(periodEnd));
  const stableIds = [account().id, server().id];
  await deliver("invoice.payment_succeeded", { ...invoice, subscription: subscription({ status: "past_due" }) });
  await deliver("invoice.payment_failed");
  await deliver("customer.subscription.updated", subscription({ status: "past_due" }));
  expectState("active", renewedEnd);
  assert.deepEqual([account().id, server().id], stableIds);
  console.log("PASS renewal uses provider periods; repeated/expanded/delayed invoice and subscription snapshots do not regress recovered access");

  provider = subscription({ cancel_at_period_end: true });
  await deliver("customer.subscription.updated", subscription());
  expectState("active", periodEnd, true);
  provider = subscription();
  await deliver("customer.subscription.updated", subscription({ cancel_at_period_end: true }));
  expectState("active");
  // The hosted portal can schedule the exact period end using cancel_at alone.
  for (const status of ["active", "trialing"]) {
    provider = subscription({ status, current_period_start: undefined, current_period_end: undefined,
      cancel_at_period_end: false, cancel_at: periodEnd,
      items: { data: [{ price: { id: "price_starter_fixture" }, current_period_start: periodStart, current_period_end: periodEnd }] } });
    await deliver("customer.subscription.updated", subscription());
    expectState(status, periodEnd, true);
    const published = await getOwnerBillingStatus(env, { id: "user-owner", discord_id: "discord-owner", username: "Synthetic owner", avatar: null });
    assert.equal(published.cancel_at_period_end, true);
    assert.equal(published.current_period_end, iso(periodEnd));
    assert.equal(published.plan_key, "starter", "Scheduled cancellation does not revoke the remaining period.");
    const claimedTrial = row("owner_starter_trial_claims", "discord_user_id", "discord-owner");
    assert.equal(typeof claimedTrial.claimed_at, "string");
    provider = subscription({ status, cancel_at_period_end: false, cancel_at: null });
    await deliver("customer.subscription.updated", subscription({ cancel_at: periodEnd }));
    expectState(status);
    assert.equal(row("owner_starter_trial_claims", "discord_user_id", "discord-owner").claimed_at, claimedTrial.claimed_at);
  }
  provider = subscription({ cancel_at: renewedEnd });
  await deliver("customer.subscription.updated", subscription());
  expectState("active", periodEnd, false);
  provider = subscription({ status: "canceled", cancel_at: periodEnd });
  await deliver("customer.subscription.deleted", subscription({ status: "canceled" }));
  expectState("canceled", periodEnd, true);
  console.log("PASS portal cancel_at at the current period end, undo, later-date distinction and terminal revocation preserve account ownership and trial dates");
  for (const status of ["trialing", "past_due", "unpaid", "paused", "incomplete", "incomplete_expired", "canceled"]) {
    provider = subscription({ status });
    await deliver(status === "canceled" ? "customer.subscription.deleted" : "customer.subscription.updated", subscription({ status }));
    expectState(status);
    await deliver("invoice.payment_succeeded");
    expectState(status);
  }
  await deliver("customer.subscription.updated", subscription({ status: "active" }));
  expectState("canceled");
  console.log("PASS cancellation/undo, trial end, unpaid/paused/incomplete states and delayed success cannot invent active access");

  for (const status of ["canceled", "past_due", "unpaid"]) {
    provider = subscription();
    await deliver("invoice.paid");
    provider = subscription({ status, items: { data: [{ price: { id: "price_removed_fixture" } }] } });
    await deliver("customer.subscription.updated", subscription({ status }));
    assert.equal(account().plan_status, status);
    assert.equal(server().status, status);
    assert.equal(entitlement().plan_key, "free", "Removed price configuration cannot prevent access revocation.");
  }
  console.log("PASS removed Price bindings still allow revocation of the exact current subscription without paid access");

  provider = subscription();
  const beforeCalls = providerCalls;
  await unchanged("invoice.payment_failed", { ...invoice, subscription: undefined }, 200);
  await unchanged("invoice.payment_failed", { ...invoice, subscription: undefined, parent: { type: "quote_details" } }, 200);
  await unchanged("invoice.payment_failed", { ...invoice, parent: { type: "subscription_details", subscription_details: { subscription: "sub_other" } } });
  await deliver("invoice.payment_succeeded", invoice, 400, false);
  assert.equal(providerCalls, beforeCalls);
  await unchanged("customer.subscription.deleted", subscription({ status: "canceled" }));
  await unchanged("customer.subscription.updated", { ...subscription(), object: "invoice" });

  for (const bad of [
    null, subscription({ id: "sub_other" }), subscription({ customer: "cus_other" }),
    subscription({ status: "invented" }), subscription({ current_period_end: null }),
    subscription({ current_period_end: periodStart - 1 }), subscription({ cancel_at_period_end: "false" }),
    ...["1790812800", true, 0, -1, 1790812800.5, {}, 8640000000001].map(cancel_at => subscription({ cancel_at })),
    subscription({ items: { data: [{ price: { id: "price_unknown" } }] }, metadata: { discord_user_id: "discord-owner", plan_key: "pro" } }),
    subscription({ metadata: { discord_user_id: "discord-other" } }),
  ]) {
    provider = bad;
    await unchanged("invoice.payment_succeeded", invoice);
  }
  console.log("PASS invalid signatures, provider failures, unknown prices, malformed periods and cross-owner identities fail closed without billing writes");

  provider = subscription();
  await deliver("invoice.payment_succeeded");
  expectState("active");
  provider = subscription({ status: "past_due" });
  await deliver("invoice.payment_failed");
  db.failNextServerWrite = true;
  provider = subscription();
  await deliver("invoice.payment_succeeded", invoice, 500);
  expectState("past_due");
  await deliver("invoice.payment_succeeded");
  expectState("active");
  console.log("PASS downstream failure rolls back all billing writes; fresh delivery recovers from database/provider failure");

  provider = subscription({ metadata: undefined });
  await deliver("invoice.paid");
  expectState("active");
  provider = subscription({ id: "sub_old", status: "canceled" });
  await unchanged("invoice.payment_failed", { ...invoice, subscription: "sub_old" }, 200);
  await unchanged("customer.subscription.deleted", provider, 200);
  provider = subscription({ customer: "cus_other", metadata: { discord_user_id: "discord-owner" } });
  await unchanged("invoice.payment_succeeded", { ...invoice, customer: "cus_other" });
  console.log("PASS old subscriptions cannot replace the current subscription; ambiguous customer/account bridges are rejected");

  for (const [price, plan] of [["price_pro_fixture", "pro"], ["price_legacy_fixture", "premium"]]) {
    provider = subscription({ items: { data: [{ price: { id: price } }] } });
    await deliver("invoice.paid");
    expectState("active", periodEnd, false, plan);
  }
  provider = subscription({ current_period_start: undefined, current_period_end: undefined,
    items: { data: [{ price: { id: "price_starter_fixture" }, current_period_start: periodStart, current_period_end: periodEnd }] } });
  await deliver("invoice.paid");
  expectState("active");

  provider = subscription({ id: "sub_new", customer: "cus_new", metadata: { discord_user_id: "discord-new" } });
  await unchanged("invoice.payment_succeeded", { ...invoice, customer: "cus_new", subscription: "sub_new" }, 500);
  assert.equal(db.sqlite.prepare("SELECT * FROM owner_billing_accounts WHERE discord_user_id = 'discord-new'").get(), undefined);
  await deliver("customer.subscription.created", { ...provider, metadata: { discord_user_id: "discord-other" } });
  assert.equal(row("owner_billing_accounts", "discord_user_id", "discord-new").stripe_subscription_id, "sub_new");
  console.log("PASS legacy paid-plan normalization, item-level periods and provider-owned first-subscription metadata; invoices never bootstrap an owner");

  assert.deepEqual([row("owner_billing_accounts", "discord_user_id", "discord-other"),
    row("owner_plan_entitlements", "discord_user_id", "discord-other"), row("server_subscriptions", "guild_id", "guild-other")], otherBefore);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM linked_servers ORDER BY id").all(), linkedBefore);
  for (const sql of db.writes) assert.match(sql,
    /^\s*(INSERT INTO (owner_billing_accounts|owner_plan_entitlements|owner_starter_trial_claims|server_subscriptions|server_sync_state)\s|UPDATE server_sync_state\s)/i,
    "Webhook DML must stay inside the canonical billing and scheduling records.");
  assert.equal(env.DZN_LIVE_CHECKOUT_ENABLED, "false");
  console.log("PASS write allowlist, other-owner isolation, unchanged server ownership/lifecycle and disabled live checkout");
  console.log("Billing payment recovery: all local SQLite/mocked-provider checks passed; no external services called.");
}

main().finally(() => {
  globalThis.fetch = originalFetch;
  db.sqlite.close();
}).catch((error) => { console.error(error); process.exitCode = 1; });
