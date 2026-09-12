"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, CreditCard, X } from "lucide-react";
import { ApiRequestError, createCheckoutSession } from "./api";
import { RETURNING_STARTER_OFFER } from "../../lib/billing/returning-starter";

export function StarterCheckoutButton({ disabled = false, label = "Choose Starter", returnTo = "/dashboard" }: {
  disabled?: boolean; label?: string; returnTo?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const id = useId();
  useEffect(() => {
    if (confirmation) dialog.current?.showModal();
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [confirmation]);

  function close() { if (!inFlight.current) { setConfirmation(null); setAccepted(false); setError(""); } }
  async function proceed(offer?: string) {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const session = await createCheckoutSession("starter", returnTo, offer);
      window.location.assign(session.url);
    } catch (failure) {
      const next = failure instanceof ApiRequestError ? failure.offer as { id?: unknown; confirmation?: unknown } | undefined : undefined;
      if (failure instanceof ApiRequestError && failure.errorCode === "STARTER_PAID_CONFIRMATION_REQUIRED" &&
          next?.id === RETURNING_STARTER_OFFER && typeof next.confirmation === "string" && /^[a-f0-9]{64}$/.test(next.confirmation)) {
        setConfirmation(next.confirmation); setAccepted(false);
      } else {
        setError(failure instanceof Error ? failure.message : "Checkout is unavailable. Please try again.");
      }
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <>
    <button ref={trigger} type="button" disabled={disabled || busy || Boolean(confirmation)} onClick={() => void proceed()}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs font-black text-cyan-50 hover:bg-cyan-400/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:opacity-50">
      {busy ? "Checking checkout..." : label}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
    </button>
    {!confirmation && error ? <p role="alert" className="mt-2 text-sm text-red-200">{error}</p> : null}
    <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-terms`}
      onCancel={event => { event.preventDefault(); close(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg border border-cyan-200/35 bg-[#070d13] p-5 text-white shadow-2xl backdrop:bg-black/80 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <CreditCard aria-hidden="true" className="h-7 w-7 text-cyan-200" />
        <button type="button" autoFocus aria-label="Close checkout confirmation" title="Close" disabled={busy} onClick={close}
          className="grid h-10 w-10 shrink-0 place-items-center rounded border border-white/20 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-200 disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button>
      </div>
      <p className="mt-3 text-xs font-bold uppercase text-cyan-200">DZN Starter</p>
      <h2 id={`${id}-title`} className="mt-1 text-2xl font-black">Return to Starter</h2>
      <p className="mt-4 text-3xl font-black">&#163;2<span className="text-base font-semibold text-zinc-300"> / month</span></p>
      <div id={`${id}-terms`} className="mt-3 space-y-2 text-sm leading-6 text-zinc-200">
        <p>Your free trial has already been used. There is no new free trial.</p>
        <p><strong>&#163;2 is due when you confirm payment in Stripe.</strong> After that, Starter renews at &#163;2/month until you cancel through Manage Billing.</p>
        <p className="text-zinc-400">Continuing opens Stripe. It does not charge you here or give access before payment is confirmed.</p>
      </div>
      <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-6">
        <input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-cyan-400" />
        <span>I understand this is &#163;2 now, then &#163;2/month, with no new trial.</span>
      </label>
      {error ? <p role="alert" className="mt-3 text-sm leading-6 text-red-200">{error}</p> : null}
      <p role="status" className="sr-only">{busy ? "Checking your account and opening secure checkout." : ""}</p>
      <button type="button" disabled={!accepted || busy || disabled} onClick={() => confirmation && void proceed(confirmation)}
        className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-3 text-sm font-black text-black hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? "Opening checkout..." : "Continue to Stripe"}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
      </button>
    </dialog>
  </>;
}
