"use client";

import { Crown, Eye, Loader2, ReceiptText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type PrivateCard = {
  product_key: string;
  product_name: string;
  granted_at: string;
  order_number: string;
  receipt_number: string;
  receipt_status: "issued";
};

type RevealState =
  | { status: "hidden"; cards: PrivateCard[]; message: string }
  | { status: "loading"; cards: PrivateCard[]; message: string }
  | { status: "ready"; cards: PrivateCard[]; message: string }
  | { status: "error"; cards: PrivateCard[]; message: string };

export function PrivateSupporterCards() {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<RevealState>({
    status: "hidden",
    cards: [],
    message: "Your card details stay concealed until you choose to reveal them on this private page.",
  });

  useEffect(() => {
    let active = true;
    void fetch("/api/player/supporter-cards", {
      method: "HEAD",
      cache: "no-store",
      credentials: "include",
    }).then((response) => {
      if (active && response.ok) setAvailable(true);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!available) return null;

  async function reveal() {
    if (state.status === "loading") return;
    setState({ status: "loading", cards: [], message: "Checking your account-bound Store entitlements..." });
    try {
      const response = await fetch("/api/player/supporter-cards", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; cards?: PrivateCard[] } | null;
      if (!response.ok || !payload?.ok || !Array.isArray(payload.cards)) {
        setState({ status: "error", cards: [], message: "Private Supporter Cards are not available right now." });
        return;
      }
      setState({
        status: "ready",
        cards: payload.cards,
        message: payload.cards.length
          ? "Verified from your active account-bound Store entitlements."
          : "No active Supporter Cards are attached to this account yet.",
      });
    } catch {
      setState({ status: "error", cards: [], message: "Private Supporter Cards are not available right now." });
    }
  }

  return (
    <div className="border-t border-white/10 pt-4" aria-labelledby="private-supporter-cards-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-violet-300/30 bg-violet-300/10 text-violet-100">
            <Crown aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 id="private-supporter-cards-title" className="text-sm font-black uppercase text-white">My Supporter Cards</h3>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">{state.message}</p>
          </div>
        </div>
        {state.status !== "ready" ? (
          <button
            type="button"
            onClick={() => void reveal()}
            disabled={state.status === "loading"}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-violet-300/35 bg-violet-300/10 px-3 text-sm font-black uppercase text-violet-100 hover:bg-violet-300/16 disabled:cursor-wait disabled:opacity-60"
          >
            {state.status === "loading" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
            {state.status === "loading" ? "Verifying" : state.status === "error" ? "Try again" : "Reveal my cards"}
          </button>
        ) : null}
      </div>

      {state.status === "ready" && state.cards.length ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Verified private Supporter Cards">
          {state.cards.map((card) => (
            <li key={`${card.product_key}-${card.order_number}`} className="min-w-0 rounded-md border border-violet-300/22 bg-violet-300/[0.07] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-black uppercase text-white [overflow-wrap:anywhere]">{card.product_name}</p>
                  <p className="mt-1 text-xs font-bold uppercase text-violet-200">Account-bound supporter card</p>
                </div>
                <ShieldCheck aria-label="Verified ownership" className="h-5 w-5 shrink-0 text-emerald-200" />
              </div>
              <dl className="mt-4 grid gap-2 text-xs">
                <CardDetail label="Granted" value={formatDate(card.granted_at)} />
                <CardDetail label="Purchase" value={card.order_number} />
                <CardDetail label="Receipt" value={card.receipt_number} icon={<ReceiptText aria-hidden="true" className="h-3.5 w-3.5" />} />
              </dl>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CardDetail({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return <div className="grid min-w-0 grid-cols-[5.25rem_minmax(0,1fr)] gap-2 border-t border-white/8 pt-2 first:border-t-0 first:pt-0"><dt className="flex items-center gap-1 font-black uppercase text-slate-500">{icon}{label}</dt><dd className="break-words text-right font-bold text-slate-200 [overflow-wrap:anywhere]">{value}</dd></div>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recorded" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}
