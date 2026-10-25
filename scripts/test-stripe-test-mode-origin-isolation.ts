import assert from "node:assert/strict";
import { onRequest as membershipCheckout } from "../functions/api/billing/create-checkout-session";
import { onRequest as membershipPortal } from "../functions/api/billing/create-portal-session";
import { onRequest as storePublish } from "../functions/api/owner/store/publish";
import { onRequest as membershipWebhook } from "../functions/api/stripe/webhook";
import { onRequest as storeOrder } from "../functions/api/store/orders";
import { onRequest as storeWebhook } from "../functions/api/stripe/store-webhook";
import { isTestStripeModeOnProductionHost } from "../functions/_lib/stripe";
import type { Env, PagesFunction } from "../functions/_lib/types";
import { createCheckoutFixture } from "./fixtures/billing-checkout";
import { createWebhookFixture } from "./fixtures/billing-webhook";

const productionHosts = ["dayz-network.com", "www.dayz-network.com", "dzn-network.pages.dev"];
const context = (handler: PagesFunction, env: Env, request: Request) => ({
  env,
  request,
  params: {},
  data: {},
  waitUntil() {},
  next: async () => new Response(null, { status: 404 }),
});

async function expectBlocked(handler: PagesFunction, env: Env, request: Request) {
  const response = await handler(context(handler, env, request));
  const body = await response.text();
  assert.equal(response.status, 403, body);
  assert.match(response.headers.get("Cache-Control") ?? "", /private, no-store/);
  assert.doesNotMatch(body, /sk_test|sk_live|whsec|SQL|constraint/i);
}

async function run() {
  const testEnv = { STRIPE_SECRET_KEY: "sk_test_fixture" } as Env;
  for (const host of [...productionHosts, ...productionHosts.map(host => `${host}.`)]) {
    assert.equal(isTestStripeModeOnProductionHost(testEnv, new Request(`https://${host}/api/billing/create-checkout-session`)), true);
  }
  for (const host of ["local.test", "preview.dzn-network.pages.dev", "dayz-network.com.evil.test"]) {
    assert.equal(isTestStripeModeOnProductionHost(testEnv, new Request(`https://${host}/api/billing/create-checkout-session`)), false);
  }
  assert.equal(isTestStripeModeOnProductionHost({ STRIPE_SECRET_KEY: "sk_live_fixture" } as Env,
    new Request("https://dayz-network.com/api/billing/create-checkout-session")), false);
  console.log("PASS only exact public DZN production hosts are blocked for test-mode Stripe credentials");

  const checkoutFixture = createCheckoutFixture();
  for (const host of productionHosts) {
    await expectBlocked(membershipCheckout, checkoutFixture.env, new Request(`https://${host}/api/billing/create-checkout-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_key: "starter" }),
    }));
  }
  assert.equal(checkoutFixture.db.statements.length, 0);
  const localCheckout = await membershipCheckout(context(membershipCheckout, checkoutFixture.env,
    new Request("https://local.test/api/billing/create-checkout-session", { method: "POST" })));
  assert.equal(localCheckout.status, 401);
  for (const host of productionHosts) {
    await expectBlocked(membershipPortal, checkoutFixture.env,
      new Request(`https://${host}/api/billing/create-portal-session`, { method: "POST" }));
  }
  assert.equal(checkoutFixture.db.statements.length, 0);
  const localPortal = await membershipPortal(context(membershipPortal, checkoutFixture.env,
    new Request("https://local.test/api/billing/create-portal-session", { method: "POST" })));
  assert.equal(localPortal.status, 401);
  console.log("PASS membership checkout and portal block before authentication, database access, or Stripe on public production hosts");

  const webhookFixture = await createWebhookFixture();
  for (const host of productionHosts) {
    await expectBlocked(membershipWebhook, webhookFixture.env,
      new Request(`https://${host}/api/stripe/webhook`, { method: "POST", body: "{}" }));
  }
  assert.equal(webhookFixture.db.allWrites.length, 0);
  const localWebhook = await membershipWebhook(context(membershipWebhook, webhookFixture.env,
    new Request("https://local.test/api/stripe/webhook", { method: "POST", body: "{}" })));
  assert.equal(localWebhook.status, 400);
  console.log("PASS membership webhooks cannot reconcile test events through public production hosts");

  const storeEnv = {
    STRIPE_SECRET_KEY: "sk_test_store_fixture",
    STRIPE_STORE_WEBHOOK_SECRET: "whsec_store_fixture",
  } as unknown as Env;
  for (const host of productionHosts) {
    await expectBlocked(storeOrder, storeEnv, new Request(`https://${host}/api/store/orders`, {
      method: "POST",
      headers: { origin: `https://${host}`, "content-type": "application/json" },
      body: "{}",
    }));
    await expectBlocked(storeWebhook, storeEnv,
      new Request(`https://${host}/api/stripe/store-webhook`, { method: "POST", body: "{}" }));
    await expectBlocked(storePublish, storeEnv, new Request(`https://${host}/api/owner/store/publish`, {
      method: "POST",
      headers: { origin: `https://${host}`, "content-type": "application/json" },
      body: "{}",
    }));
  }
  const localStoreOrder = await storeOrder(context(storeOrder, storeEnv,
    new Request("https://local.test/api/store/orders", { method: "POST", headers: { origin: "https://local.test" }, body: "{}" })));
  assert.equal(localStoreOrder.status, 401);
  const localStoreWebhook = await storeWebhook(context(storeWebhook, storeEnv,
    new Request("https://local.test/api/stripe/store-webhook", { method: "POST", body: "{}" })));
  assert.equal(localStoreWebhook.status, 400);
  const localStorePublish = await storePublish(context(storePublish, storeEnv,
    new Request("https://local.test/api/owner/store/publish", { method: "POST", headers: { origin: "https://local.test" }, body: "{}" })));
  assert.equal(localStorePublish.status, 401);
  console.log("PASS Store checkout, webhook, and publication stay sandbox-testable away from public production hosts");

  checkoutFixture.db.sqlite.close();
  webhookFixture.db.sqlite.close();
}

run().catch(error => { console.error(error); process.exitCode = 1; });
