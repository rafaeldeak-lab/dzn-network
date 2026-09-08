import { requireBadgeAdminUser } from "../../_lib/badge-evaluation";
import { getBillingProviderReadiness } from "../../_lib/billing-provider-readiness";
import { json } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

const headers = { "cache-control": "private, no-store", vary: "Cookie", "x-robots-tag": "noindex" };

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return json({ ok: false }, { status: 405, headers: { ...headers, allow: "GET" } });
  // Never let preview/mock authentication reach live provider credentials.
  if (env.MOCK_AUTH) return json({ ok: false }, { status: 403, headers });
  const auth = await requireBadgeAdminUser(env, request);
  if (!auth.ok) return json(auth.payload, { status: auth.status, headers });
  const params = new URL(request.url).searchParams;
  const expectedAccount = params.get("expected_account") ?? "";
  const expectedFingerprint = params.get("expected_webhook_fingerprint") ?? "";
  if (!/^acct_[a-zA-Z0-9]{1,100}$/.test(expectedAccount)) {
    return json({ ok: false, error: "The expected Stripe account is required." }, { status: 400, headers });
  }
  if (expectedFingerprint && !/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
    return json({ ok: false, error: "A SHA-256 fingerprint is required, not a signing secret." }, { status: 400, headers });
  }
  return json(await getBillingProviderReadiness(env, expectedAccount, expectedFingerprint), { headers });
};
