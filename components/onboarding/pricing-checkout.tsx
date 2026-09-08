"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { ApiRequestError, createCheckoutSession, getBillingPlans, getMe } from "./api";
import { StarterCheckoutButton } from "./starter-checkout-button";
import { PAYMENT_COPY, pricingReturnTo } from "../../lib/billing/payment-copy";

export function PricingCheckout({ planKey }: { planKey: "starter" | "pro" }) {
  const [state, setState] = useState<"loading" | "login" | "ready" | "paused" | "error">("loading");
  const [returnTo, setReturnTo] = useState("/setup");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { plans } = await getBillingPlans();
        if (!active) return;
        setReturnTo(pricingReturnTo(new URLSearchParams(window.location.search).get("returnTo")));
        const plan = plans.find(p => p.plan_key === planKey);
        // Unknown or omitted readiness never enables checkout.
        if (plan?.configured !== true || plan.checkout_enabled !== true) { setState("paused"); return; }
        try {
          const auth = await getMe();
          if (active) setState(auth.authenticated === true ? "ready" : "login");
        } catch (failure) {
          // Only the auth endpoint's expected anonymous response is a sign-in state.
          if (!(failure instanceof ApiRequestError) || failure.status !== 401) throw failure;
          if (active) setState("login");
        }
      } catch { if (active) setState("error"); }
    }
    void load();
    return () => { active = false; };
  }, [planKey, retry]);

  async function proCheckout() {
    if (inFlight.current || state !== "ready") return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const session = await createCheckoutSession("pro", returnTo);
      window.location.assign(session.url);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Checkout is unavailable. Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded border border-cyan-200/35 bg-cyan-400/10 px-4 py-3 text-sm font-bold text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50";
  if (state === "login") return <Link href={`/login?returnTo=${encodeURIComponent(`/pricing?returnTo=${encodeURIComponent(returnTo)}`)}`} className={buttonClass}>Sign in to choose {planKey === "starter" ? "Starter" : "Pro"}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" /></Link>;
  return <div>
    {planKey === "starter" ? <StarterCheckoutButton disabled={state !== "ready"} returnTo={returnTo} /> : <button type="button" className={buttonClass} disabled={state !== "ready" || busy} onClick={() => void proCheckout()}>{busy ? "Opening checkout..." : "Choose Pro"}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" /></button>}
    <p role="status" className="mt-3 text-sm leading-6 text-zinc-300">{state === "loading" ? "Checking checkout availability..." : state === "paused" ? PAYMENT_COPY.paused : state === "error" ? "We could not check checkout availability. No payment has been started." : "Review your plan and recurring payment in Stripe before confirming."}</p>
    {state === "paused" || state === "error" ? <button type="button" className="mt-2 inline-flex min-h-10 items-center gap-2 text-sm text-cyan-200" onClick={() => { setState("loading"); setRetry(n => n + 1); }}><RefreshCw aria-hidden="true" className="h-4 w-4" />Check again</button> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-red-200">{error}</p> : null}
  </div>;
}
