"use client";

import { Crown, Eye, EyeOff, Loader2, LockKeyhole, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { supporterCardArtworkUrl } from "@/lib/supporter-card-art";

type CabinetCard = {
  product_key: string;
  product_name: string;
  granted_at: string;
  entitlement_key: string;
  publicly_showcased: boolean;
};

type CabinetPayload = {
  ok: true;
  cards: CabinetCard[];
  next_cursor: string | null;
  selected_count: number;
  public_showcase_limit: number;
  message: string;
};

type CabinetState =
  | { status: "hidden"; data: null; message: string }
  | { status: "loading"; data: CabinetPayload | null; message: string }
  | { status: "ready"; data: CabinetPayload; message: string }
  | { status: "saving"; data: CabinetPayload; message: string }
  | { status: "error"; data: CabinetPayload | null; message: string };

export function PlayerCabinet() {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<CabinetState>({
    status: "hidden",
    data: null,
    message: "Your permanent cards remain private until you open your cabinet.",
  });

  useEffect(() => {
    let active = true;
    void fetch("/api/player/cabinet", {
      method: "HEAD",
      cache: "no-store",
      credentials: "include",
    }).then((response) => {
      if (active && response.ok) setAvailable(true);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!available) return null;

  async function load(cursor: string | null = null) {
    if (state.status === "loading" || state.status === "saving") return;
    const previous = state.data;
    const append = Boolean(cursor && previous);
    setState({ status: "loading", data: previous, message: append ? "Loading more cards from your private cabinet..." : "Opening your private Player Cabinet..." });
    try {
      const url = cursor ? `/api/player/cabinet?${new URLSearchParams({ cursor })}` : "/api/player/cabinet";
      const response = await fetch(url, { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => null) as Partial<CabinetPayload> & { message?: string } | null;
      if (!response.ok || !payload?.ok || !Array.isArray(payload.cards) || typeof payload.public_showcase_limit !== "number" || typeof payload.selected_count !== "number" || (payload.next_cursor !== null && typeof payload.next_cursor !== "string")) {
        throw new Error(payload?.message ?? "Your Player Cabinet is not available right now.");
      }
      const next = payload as CabinetPayload;
      setState({
        status: "ready",
        data: append && previous ? { ...next, cards: [...previous.cards, ...next.cards] } : next,
        message: payload.message ?? "Your Player Cabinet is ready.",
      });
    } catch (error) {
      setState({ status: "error", data: previous, message: errorMessage(error) });
    }
  }

  async function setPublic(card: CabinetCard, publiclyShowcased: boolean) {
    if (!state.data || state.status === "saving") return;
    const previous = state.data;
    const optimistic = {
      ...previous,
      cards: previous.cards.map((item) => item.entitlement_key === card.entitlement_key ? { ...item, publicly_showcased: publiclyShowcased } : item),
      selected_count: Math.max(0, previous.selected_count + (publiclyShowcased ? 1 : -1)),
    };
    setState({ status: "saving", data: optimistic, message: publiclyShowcased ? "Saving this card to your public profile showcase..." : "Removing this card from your public profile showcase..." });
    try {
      const response = await fetch("/api/player/cabinet", {
        method: "PATCH",
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ entitlementKey: card.entitlement_key, publiclyShowcased }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; card?: CabinetCard; message?: string } | null;
      if (!response.ok || !payload?.ok || !payload.card) throw new Error(payload?.message ?? "That cabinet choice could not be saved.");
      setState({
        status: "ready",
        data: {
          ...previous,
          cards: previous.cards.map((item) => item.entitlement_key === payload.card!.entitlement_key ? payload.card! : item),
          selected_count: Math.max(0, previous.selected_count + (publiclyShowcased ? 1 : -1)),
        },
        message: publiclyShowcased ? "Card selected for your public profile showcase." : "Card kept private in your cabinet.",
      });
    } catch (error) {
      setState({ status: "error", data: previous, message: errorMessage(error) });
    }
  }

  const opened = state.data !== null;
  const selected = state.data?.selected_count ?? 0;

  return (
    <section className="border-t border-white/10 pt-4" aria-labelledby="player-cabinet-title" aria-busy={state.status === "loading" || state.status === "saving"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-violet-300/30 bg-violet-300/10 text-violet-100">
            <Crown aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-200">Account collection</p>
            <h3 id="player-cabinet-title" className="mt-0.5 text-sm font-black uppercase text-white">My Player Cabinet</h3>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">{state.message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.status === "loading" || state.status === "saving"}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-violet-300/35 bg-violet-300/10 px-3 text-sm font-black uppercase text-violet-100 transition hover:bg-violet-300/16 disabled:cursor-wait disabled:opacity-60"
        >
          {state.status === "loading" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : opened ? <Sparkles aria-hidden="true" className="h-4 w-4" /> : <LockKeyhole aria-hidden="true" className="h-4 w-4" />}
          {state.status === "loading" ? "Opening" : opened ? "Refresh cabinet" : "Open cabinet"}
        </button>
      </div>

      {state.data ? (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-cyan-300/18 bg-cyan-300/[0.06] px-3 py-2 text-xs font-bold text-cyan-50">
            <span>Public profile showcase</span>
            <span className="rounded border border-cyan-300/25 bg-slate-950/60 px-2 py-1 font-black uppercase text-cyan-100">{selected} of {state.data.public_showcase_limit} selected</span>
          </div>
          {state.data.cards.length ? (
            <>
              <ul className="mt-3 grid gap-3 lg:grid-cols-2" aria-label="Owned permanent cards">
                {state.data.cards.map((card) => (
                  <CabinetCardTile key={card.entitlement_key} card={card} saving={state.status === "saving"} onPublicChange={setPublic} />
                ))}
              </ul>
              {state.data.next_cursor ? (
                <button
                  type="button"
                  onClick={() => void load(state.data!.next_cursor)}
                  disabled={state.status === "loading" || state.status === "saving"}
                  className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/[0.07] px-3 text-xs font-black uppercase text-cyan-100 transition hover:bg-cyan-300/[0.12] disabled:cursor-wait disabled:opacity-60"
                >
                  {state.status === "loading" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Sparkles aria-hidden="true" className="h-4 w-4" />}
                  {state.status === "loading" ? "Loading cards" : "Load more cards"}
                </button>
              ) : null}
            </>
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-violet-300/25 bg-violet-300/[0.04] p-4 text-sm font-semibold leading-6 text-slate-300">
              Your cabinet is ready for permanent cosmetic purchases. Once a confirmed Store order is fulfilled, the card will appear here—private by default.
            </div>
          )}
          <p className="mt-3 text-xs font-semibold leading-5 text-slate-400">A selected card appears only when your public profile and its Cabinet Cards section are enabled. Cabinet choices never affect gameplay, ranking, event access, or competitive eligibility.</p>
        </>
      ) : null}
    </section>
  );
}

function CabinetCardTile({ card, saving, onPublicChange }: { card: CabinetCard; saving: boolean; onPublicChange: (card: CabinetCard, publiclyShowcased: boolean) => void }) {
  const artwork = supporterCardArtworkUrl(card.product_key);
  return (
    <li className={`relative overflow-hidden rounded-lg border p-4 ${card.publicly_showcased ? "border-cyan-300/45 bg-cyan-300/[0.07] shadow-[0_0_30px_rgba(34,211,238,0.08)]" : "border-white/10 bg-slate-950/68"}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_86%_0%,rgba(168,85,247,0.16),transparent_38%)]" aria-hidden="true" />
      <div className="relative flex min-w-0 gap-3">
        <div className="relative flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-violet-300/25 bg-[#090711]">
          {artwork ? <img src={artwork} alt="" className="h-full w-full object-contain p-1" loading="lazy" decoding="async" /> : <Crown aria-hidden="true" className="h-8 w-8 text-violet-200" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2"><p className="break-words text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{card.product_name}</p><span className="rounded border border-violet-300/30 bg-violet-300/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-violet-100">Permanent</span></div>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-violet-200">Account-bound card</p>
          <p className="mt-2 text-xs font-semibold text-slate-400">Added {formatDate(card.granted_at)}</p>
          <button
            type="button"
            disabled={saving}
            onClick={() => onPublicChange(card, !card.publicly_showcased)}
            className={`mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-xs font-black uppercase transition disabled:cursor-wait disabled:opacity-60 ${card.publicly_showcased ? "border-cyan-200/45 bg-cyan-300/14 text-cyan-50 hover:bg-cyan-300/22" : "border-white/15 bg-white/[0.04] text-slate-200 hover:border-white/30"}`}
            aria-pressed={card.publicly_showcased}
            aria-label={`${card.publicly_showcased ? "Remove" : "Show"} ${card.product_name} ${card.publicly_showcased ? "from" : "on"} your public profile`}
          >
            {card.publicly_showcased ? <Eye aria-hidden="true" className="h-4 w-4" /> : <EyeOff aria-hidden="true" className="h-4 w-4" />}
            {card.publicly_showcased ? "Public on profile" : "Keep private"}
          </button>
        </div>
      </div>
    </li>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Your Player Cabinet is not available right now.";
}
