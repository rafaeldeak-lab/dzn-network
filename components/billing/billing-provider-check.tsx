"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, RefreshCw, XCircle } from "lucide-react";

const labels = {
  liveKey: "Live Stripe key", accountMatches: "Expected Stripe account", accountCanCharge: "Payments enabled by Stripe",
  accountCanPayOut: "Payouts enabled by Stripe", accountDetailsSubmitted: "Account details submitted",
  accountRequirementsClear: "Account requirements clear", individualUkAccount: "UK individual account",
  starterPrice: "Starter: GBP 2 per month", proPrice: "Pro: GBP 10 per month", defaultPortal: "Default customer portal",
  paymentMethodUpdates: "Payment method updates", cancellationAtPeriodEnd: "Cancel at the end of the billing period",
  invoiceHistory: "Customer invoice history", webhookDestination: "Production webhook destination", webhookEvents: "Required webhook events",
} as const;
type Result = { checkedAt: string; checks: Record<keyof typeof labels, boolean>; webhookSigningSecretMatchVerified: boolean };

export function BillingProviderCheck() {
  const [account, setAccount] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function check(event: FormEvent) {
    event.preventDefault();
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true); setError(""); setResult(null);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const query = new URLSearchParams({ expected_account: account.trim(), expected_webhook_fingerprint: fingerprint.trim() });
      const response = await fetch(`/api/billing/provider-readiness?${query}`, {
        method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) throw new Error("Sign in with a DZN admin, support or developer account.");
      if (!response.ok) throw new Error("The check could not complete. Check the account and fingerprint, then retry.");
      const data = await response.json();
      if (!data.ok || !data.checks || typeof data.checkedAt !== "string") throw new Error("The check returned an unexpected result.");
      // Accept only fixed boolean checks; never render provider records or arbitrary response text.
      const checks = Object.fromEntries(Object.keys(labels).map(key => [key, data.checks[key] === true])) as Result["checks"];
      setResult({ checks, checkedAt: data.checkedAt, webhookSigningSecretMatchVerified: data.webhookSigningSecretMatchVerified === true });
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The check could not complete.");
      else setError("The check timed out or was cancelled. No settings were changed.");
    } finally {
      clearTimeout(timeout); active.current = null; setPending(false);
    }
  }

  return <main className="mx-auto w-full max-w-3xl px-4 py-8 text-slate-100">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-cyan-200"><ArrowLeft size={16} /> Dashboard</Link>
    <h1 className="mt-6 text-2xl font-bold">Billing checks</h1>
    <form onSubmit={check} className="mt-6 grid gap-4 border-y border-white/15 py-6">
      <label className="grid gap-2 text-sm">Stripe account
        <input required autoComplete="off" spellCheck={false} pattern="acct_[a-zA-Z0-9]{1,100}" maxLength={105} value={account} disabled={pending}
          onChange={event => { setAccount(event.target.value); setResult(null); }} className="min-w-0 rounded border border-white/20 bg-black/40 px-3 py-2" />
      </label>
      <label className="grid gap-2 text-sm">Webhook fingerprint (SHA-256)
        <input autoComplete="off" spellCheck={false} pattern="[a-f0-9]{64}" maxLength={64} value={fingerprint} disabled={pending}
          onChange={event => { setFingerprint(event.target.value); setResult(null); }} className="min-w-0 rounded border border-white/20 bg-black/40 px-3 py-2" />
      </label>
      <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-cyan-300/40 bg-cyan-950 px-4 py-2 text-sm font-semibold disabled:opacity-50">
        <RefreshCw size={16} className={pending ? "motion-safe:animate-spin" : ""} /> {pending ? "Checking" : "Check Stripe connection"}
      </button>
    </form>
    {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    {result && <section className="mt-6" aria-label="Billing verification results" aria-live="polite">
      <p className="mb-3 text-sm text-slate-300">Checked: {result.checkedAt}</p>
      <ul className="divide-y divide-white/10">{[...Object.entries(labels).map(([key, label]) => ({ label, ok: result.checks[key as keyof typeof labels] })),
        { label: "Webhook signing secret matches", ok: result.webhookSigningSecretMatchVerified }].map(({ label, ok }) => <li key={label} className="flex min-h-11 items-center gap-3 py-2 text-sm">
          {ok ? <CheckCircle2 size={18} className="shrink-0 text-emerald-300" aria-hidden="true" /> : <XCircle size={18} className="shrink-0 text-red-300" aria-hidden="true" />}
          <span className="min-w-0 flex-1">{label}</span><span className={ok ? "text-emerald-300" : "text-red-300"}>{ok ? "Verified" : "Not verified"}</span>
        </li>)}</ul>
      <p className="mt-4 text-sm text-slate-300">Payment delivery: not verified by this check. No settings changed.</p>
    </section>}
  </main>;
}
