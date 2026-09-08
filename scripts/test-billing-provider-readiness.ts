import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createSession } from "../functions/_lib/db";
import { getBillingProviderReadiness } from "../functions/_lib/billing-provider-readiness";
import { onRequest } from "../functions/api/billing/provider-readiness";
import { createCheckoutFixture } from "./fixtures/billing-checkout";

const f = createCheckoutFixture();
const originalFetch = globalThis.fetch;
const calls: string[] = [];
const baseAccount = { id: "acct_expected", charges_enabled: true, payouts_enabled: true, details_submitted: true,
  country: "GB", business_type: "individual", requirements: { disabled_reason: null, currently_due: [], past_due: [] } };
const basePortal = { data: [{ active: true, livemode: true, is_default: true, features: {
  payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: "at_period_end" },
  invoice_history: { enabled: true },
} }], has_more: false };
const baseWebhooks = { data: [{ url: "https://dayz-network.com/api/stripe/webhook", status: "enabled", livemode: true,
  enabled_events: ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated",
    "customer.subscription.deleted", "invoice.payment_succeeded", "invoice.payment_failed"] }], has_more: false };
let account: unknown = baseAccount, portal: unknown = basePortal, webhooks: unknown = baseWebhooks;
let failPath = "", wrongPrice = false;

async function run() {
  f.env.STRIPE_SECRET_KEY = "sk_live_private_fixture";
  f.env.DZN_OWNER_DISCORD_IDS = "discord-owner";
  f.db.sqlite.exec("INSERT INTO users (id,discord_id) VALUES ('owner','discord-owner'), ('other','discord-other')");
  const owner = (await createSession(f.env, "owner")).token;
  const other = (await createSession(f.env, "other")).token;
  f.db.statements.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.stripe.com");
    assert.equal(init?.method, "GET", "The provider probe must never mutate Stripe");
    calls.push(url.pathname);
    if (url.pathname === failPath) return Response.json({ error: { message: "private-provider-response-must-not-leak" } }, { status: 500 });
    if (url.pathname === "/v1/account") return Response.json(account);
    if (url.pathname === "/v1/billing_portal/configurations") {
      assert.equal(url.searchParams.get("is_default"), "true"); return Response.json(portal);
    }
    if (url.pathname === "/v1/webhook_endpoints") return Response.json(webhooks);
    assert.match(url.pathname, /^\/v1\/prices\/price_(starter|pro)_fixture$/);
    const id = url.pathname.split("/").at(-1);
    return Response.json({ id, active: true, livemode: true, currency: wrongPrice ? "usd" : "gbp",
      unit_amount: id?.includes("starter") ? 200 : 1000, type: "recurring", billing_scheme: "per_unit",
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } });
  };
  async function request(status: number, token = owner, method = "GET", query = "?expected_account=acct_expected") {
    const response = await onRequest({ env: f.env, request: new Request(`https://local.test/api/billing/provider-readiness${query}`, {
      method, headers: token ? { cookie: `dzn_session=${token}` } : {},
    }), params: {}, data: {}, waitUntil() {}, next: async () => new Response(null) });
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
    assert.equal(response.headers.get("vary"), "Cookie");
    const body = await response.json();
    assert.doesNotMatch(JSON.stringify(body), /acct_expected|price_starter|price_pro|sk_live|whsec_|private-provider-response|discord-owner/);
    return body;
  }
  await request(405, owner, "POST"); await request(401, ""); await request(403, other);
  await request(400, owner, "GET", "");
  await request(400, owner, "GET", "?expected_account=https://evil.example");
  await request(400, owner, "GET", "?expected_account=acct_expected&expected_webhook_fingerprint=whsec_do_not_send_raw_secrets");
  f.env.MOCK_AUTH = "true"; await request(403); delete f.env.MOCK_AUTH;
  assert.equal(calls.length, 0, "Auth, method and input gates must precede provider contact");
  f.env.MOCK_AUTH = "false";
  await request(401, ""); await request(403, other);
  assert.equal(calls.length, 0, "Explicitly disabled mock auth must still require a real operator");
  const explicitFalse = await request(200) as Awaited<ReturnType<typeof getBillingProviderReadiness>>;
  assert.equal(explicitFalse.providerConfigurationVerified, true);
  assert.equal(calls.length, 5);
  calls.length = 0; delete f.env.MOCK_AUTH;
  const success = await request(200) as Awaited<ReturnType<typeof getBillingProviderReadiness>>;
  assert.equal(success.providerConfigurationVerified, true);
  assert.equal(calls.length, 5);
  assert.equal(success.webhookSigningSecretMatchVerified, false);
  assert.equal(success.endToEndPaymentVerified, false);
  assert.equal(success.productionMutationAllowed, false);
  assert.equal(success.checkoutActivatedByThisCheck, false);
  assert.ok(f.db.statements.every(sql => /^SELECT\s/i.test(sql.trim())), "The route must not persist or reconcile any state");
  const read = () => getBillingProviderReadiness(f.env, "acct_expected");
  for (const invalid of [null, {}, { ...baseAccount, id: "acct_foreign" }]) {
    account = invalid; const before: number = calls.length;
    assert.equal((await read()).providerConfigurationVerified, false); assert.equal(calls.length - before, 1);
  }
  for (const field of ["charges_enabled", "payouts_enabled", "details_submitted"] as const) {
    account = { ...baseAccount, [field]: false }; assert.equal((await read()).providerConfigurationVerified, false);
  }
  account = { ...baseAccount, requirements: { disabled_reason: "private", currently_due: [], past_due: [] } };
  assert.equal((await read()).checks.accountRequirementsClear, false);
  account = baseAccount; wrongPrice = true;
  const badPrices = await read(); assert.equal(badPrices.checks.starterPrice, false); assert.equal(badPrices.checks.proPrice, false);
  wrongPrice = false;
  for (const invalid of [null, {}, { data: [], has_more: false }, { ...basePortal, has_more: true },
    { data: [{ ...basePortal.data[0], active: false }], has_more: false },
    { data: [{ ...basePortal.data[0], features: {} }], has_more: false }]) {
    portal = invalid; assert.equal((await read()).providerConfigurationVerified, false);
  }
  portal = basePortal;
  for (const invalid of [null, {}, { data: [], has_more: false }, { ...baseWebhooks, has_more: true },
    { data: [...baseWebhooks.data, ...baseWebhooks.data], has_more: false },
    { data: [{ ...baseWebhooks.data[0], livemode: false }], has_more: false },
    { data: [{ ...baseWebhooks.data[0], enabled_events: ["invoice.payment_failed"] }], has_more: false }]) {
    webhooks = invalid; assert.equal((await read()).providerConfigurationVerified, false);
  }
  webhooks = baseWebhooks;
  for (const path of ["/v1/account", "/v1/prices/price_starter_fixture", "/v1/billing_portal/configurations", "/v1/webhook_endpoints"]) {
    failPath = path; const result = await request(200) as Awaited<ReturnType<typeof read>>;
    assert.equal(result.providerConfigurationVerified, false);
  }
  failPath = "";
  f.env.STRIPE_WEBHOOK_SECRET = "whsec_private_fixture";
  const fingerprint = createHash("sha256").update(f.env.STRIPE_WEBHOOK_SECRET).digest("hex");
  const matched = await request(200, owner, "GET", `?expected_account=acct_expected&expected_webhook_fingerprint=${fingerprint}`) as Awaited<ReturnType<typeof read>>;
  assert.equal(matched.webhookSigningSecretMatchVerified, true);
  assert.equal(matched.endToEndPaymentVerified, false);
  assert.doesNotMatch(JSON.stringify(matched), new RegExp(fingerprint));
  assert.equal((await getBillingProviderReadiness(f.env, "acct_expected", "0".repeat(64))).webhookSigningSecretMatchVerified, false);
  account = { ...baseAccount, id: "acct_foreign" };
  assert.equal((await getBillingProviderReadiness(f.env, "acct_expected", fingerprint)).webhookSigningSecretMatchVerified, false);
  account = baseAccount; delete f.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await getBillingProviderReadiness(f.env, "acct_expected", fingerprint)).webhookSigningSecretMatchVerified, false);
  f.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  const before: number = calls.length; assert.equal((await read()).providerConfigurationVerified, false); assert.equal(calls.length, before);
  const ui = readFileSync("components/billing/billing-provider-check.tsx", "utf8");
  assert.match(ui, /method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error"/);
  assert.match(ui, /if \(active\.current\) return/);
  assert.match(ui, /setResult\(null\)/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|document\.cookie|dangerouslySetInnerHTML|STRIPE_WEBHOOK_SECRET|whsec_/);
  console.log("Provider readiness: auth, mock isolation, GET-only provider access, exact Price contract, account/portal/webhook failure handling, redaction, no-store and zero-write checks passed.");
}
run().finally(() => { globalThis.fetch = originalFetch; f.db.sqlite.close(); }).catch(error => { console.error(error); process.exitCode = 1; });
