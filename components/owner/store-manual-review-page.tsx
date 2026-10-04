"use client";

import { AlertTriangle, ArrowLeft, ClipboardCheck, Home, LoaderCircle, RefreshCw, Search, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type ReviewItem = {
  id: string;
  order_number: string;
  stripe_mode: "test" | "live";
  currency: string;
  total_amount_minor: number;
  stock_reservation_state: string;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  product_key: string;
  product_name: string;
  fulfilment_kind: string;
  customer_username: string;
  customer_avatar: string | null;
  latest_event_type: string | null;
  latest_event_status: string | null;
  latest_event_at: string | null;
  latest_action: string | null;
  latest_action_reason: string | null;
  latest_action_evidence_category: string | null;
  latest_action_at: string | null;
  action_count: number;
};

type Payload = {
  ok?: boolean;
  items?: ReviewItem[];
  page?: { nextCursor: string | null };
  error?: string;
  message?: string;
};

const EVIDENCE = [
  ["none", "No provider evidence recorded"],
  ["webhook_mode_mismatch", "Webhook mode mismatch"],
  ["payment_state_mismatch", "Payment state mismatch"],
  ["stock_conflict", "Stock conflict"],
  ["dispute_conflict", "Dispute conflict"],
  ["duplicate_retry", "Duplicate retry"],
  ["other", "Other safe evidence"],
] as const;

export function StoreManualReviewPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [mode, setMode] = useState("all");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "disabled" | "blocked" | "error">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const pendingActionKeys = useRef(new Map<string, string>());

  const load = useCallback(async (cursor?: string) => {
    const sequence = ++requestSequence.current;
    if (!cursor) setState("loading");
    setNotice(null);
    const params = new URLSearchParams({ limit: "30", mode });
    if (appliedQuery) params.set("q", appliedQuery);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/owner/store/manual-review?${params}`, { credentials: "include", cache: "no-store" });
      const payload = await response.json().catch(() => null) as Payload | null;
      if (sequence !== requestSequence.current) return;
      if (response.status === 401 || response.status === 403) { setState("blocked"); return; }
      if (response.status === 404) { setState("disabled"); return; }
      if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "The Store review queue could not be loaded.");
      setItems((current) => cursor ? mergeById(current, payload.items ?? []) : payload.items ?? []);
      setNextCursor(payload.page?.nextCursor ?? null);
      setState("ready");
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setNotice(error instanceof Error ? error.message : "The Store review queue could not be loaded.");
      setState("error");
    }
  }, [appliedQuery, mode]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function search(event: FormEvent) {
    event.preventDefault();
    setAppliedQuery(query.trim());
  }

  async function record(item: ReviewItem, action: "note" | "hold" | "escalate", reason: string, evidenceCategory: string) {
    const key = `${item.id}:${action}`;
    const fingerprint = JSON.stringify([item.id, action, reason, evidenceCategory]);
    const requestKey = pendingActionKeys.current.get(fingerprint) ?? crypto.randomUUID();
    pendingActionKeys.current.set(fingerprint, requestKey);
    setBusy(key);
    setNotice(null);
    try {
      const response = await fetch("/api/owner/store/manual-review", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: item.id, requestKey, action, reason, evidenceCategory }),
      });
      const payload = await response.json().catch(() => null) as Payload | null;
      if (payload && response.status < 500) pendingActionKeys.current.delete(fingerprint);
      if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "The review action was not recorded.");
      await load();
      setNotice("Review action recorded in the immutable audit history. Payment and fulfilment state were not changed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The review action was not recorded.");
    } finally {
      setBusy(null);
    }
  }

  return <main className="min-h-screen bg-[#02050b] px-3 py-4 text-zinc-100 sm:px-5 lg:px-8">
    <div className="mx-auto max-w-[1440px]">
      <header className="border-b border-cyan-300/20 pb-5">
        <nav className="flex flex-wrap gap-2">
          <Link href="/owner/store" className={navClass}><ArrowLeft size={14} />Store drafts</Link>
          <Link href="/owner" className={navClass}><Home size={14} />Command Centre</Link>
          <button type="button" onClick={() => void load()} className={`${navClass} ml-auto`}><RefreshCw size={14} />Refresh</button>
        </nav>
        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div><p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">Private platform-owner workspace</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Store review queue</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Inspect payment exceptions and append safe operator notes. This workspace cannot fulfil, refund, dispute, or charge an order.</p></div>
          <div className="rounded-md border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2 text-xs font-black text-emerald-100"><ShieldCheck className="mr-2 inline" size={15} />Non-financial audit actions only</div>
        </div>
      </header>

      <form onSubmit={search} className="mt-4 grid gap-2 rounded-lg border border-white/10 bg-black/35 p-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
        <label className="relative"><span className="sr-only">Search review queue</span><Search className="absolute left-3 top-3 text-zinc-500" size={16} /><input maxLength={80} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order, product, or customer" className={`${inputClass} pl-10`} /></label>
        <label><span className="sr-only">Payment mode</span><select value={mode} onChange={(event) => setMode(event.target.value)} className={inputClass}><option value="all">All modes</option><option value="test">Test only</option><option value="live">Live only</option></select></label>
        <button className="min-h-11 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-5 text-sm font-black text-cyan-100">Search</button>
      </form>

      {notice ? <p role="status" className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 text-sm font-bold text-cyan-50">{notice}</p> : null}
      {state !== "ready" ? <StatePanel state={state} /> : <section className="mt-4 grid gap-3">
        <div className="flex items-center justify-between"><h2 className="font-black">Open exceptions</h2><span className="text-xs font-bold text-zinc-500">{items.length} loaded</span></div>
        {items.length === 0 ? <div className="rounded-lg border border-dashed border-white/10 p-10 text-center"><ClipboardCheck className="mx-auto text-emerald-300" /><p className="mt-3 font-black">No matching manual-review orders</p></div> : items.map((item) => <ReviewCard key={item.id} item={item} busy={busy} onRecord={record} />)}
        {nextCursor ? <button type="button" onClick={() => void load(nextCursor)} className="min-h-11 rounded-md border border-white/10 bg-white/[0.03] text-sm font-black">Load more</button> : null}
      </section>}
    </div>
  </main>;
}

function ReviewCard({ item, busy, onRecord }: { item: ReviewItem; busy: string | null; onRecord: (item: ReviewItem, action: "note" | "hold" | "escalate", reason: string, evidence: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("none");
  return <article className="rounded-lg border border-amber-300/15 bg-black/35 p-4">
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-amber-300/10 px-2 py-1 text-[10px] font-black uppercase text-amber-200">Manual review</span><span className="rounded bg-white/5 px-2 py-1 text-[10px] font-black uppercase text-zinc-300">{item.stripe_mode}</span><h3 className="break-all text-lg font-black">{item.order_number}</h3></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Customer" value={item.customer_username} image={item.customer_avatar} />
          <Fact label="Product" value={item.product_name} />
          <Fact label="Order total" value={formatPrice(item.total_amount_minor, item.currency)} />
          <Fact label="Stock" value={label(item.stock_reservation_state)} />
        </div>
        <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
          <p>Latest event: <strong className="text-zinc-200">{item.latest_event_type ?? "No event recorded"}</strong>{item.latest_event_at ? ` · ${formatDate(item.latest_event_at)}` : ""}</p>
          <p>Audit entries: <strong className="text-zinc-200">{item.action_count}</strong> · Updated {formatDate(item.updated_at)}</p>
        </div>
        {item.latest_action ? <div className="mt-3 rounded-md border border-white/10 bg-white/[0.025] p-3 text-xs"><p className="font-black text-cyan-200">Latest action: {label(item.latest_action)}</p><p className="mt-1 break-words text-zinc-300">{item.latest_action_reason}</p><p className="mt-1 text-zinc-500">{label(item.latest_action_evidence_category ?? "none")} · {formatDate(item.latest_action_at)}</p></div> : null}
      </div>
      <div className="grid content-start gap-2 border-t border-white/10 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
        <label className="grid gap-1 text-xs font-black text-zinc-300">Evidence category<select value={evidence} onChange={(event) => setEvidence(event.target.value)} className={inputClass}>{EVIDENCE.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-black text-zinc-300">Required operator reason<textarea minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className={`${inputClass} h-auto resize-y py-2`} /></label>
        <div className="grid grid-cols-3 gap-2">{(["note", "hold", "escalate"] as const).map((action) => <button key={action} type="button" disabled={reason.trim().length < 3 || busy !== null} onClick={() => void onRecord(item, action, reason.trim(), evidence)} className="min-h-10 rounded-md border border-white/10 bg-white/[0.04] px-2 text-xs font-black capitalize disabled:opacity-40">{busy === `${item.id}:${action}` ? <LoaderCircle className="mx-auto animate-spin" size={15} /> : action}</button>)}</div>
      </div>
    </div>
  </article>;
}

function Fact({ label: factLabel, value, image }: { label: string; value: string; image?: string | null }) { return <div className="min-w-0 rounded-md border border-white/10 bg-white/[0.025] p-3"><p className="text-[9px] font-black uppercase text-zinc-500">{factLabel}</p><div className="mt-1 flex min-w-0 items-center gap-2">{image ? <Image src={image} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-full object-cover" /> : null}<p className="truncate text-sm font-black text-white">{value}</p></div></div>; }
function StatePanel({ state }: { state: "loading" | "disabled" | "blocked" | "error" }) { const loading = state === "loading"; const title = loading ? "Loading review queue" : state === "disabled" ? "Store owner controls are off" : state === "blocked" ? "Platform-owner access required" : "Review queue unavailable"; const body = state === "disabled" ? "Enable only the private Store and owner-admin controls after the required schema is verified." : state === "blocked" ? "Sign in with the configured platform-owner Discord account." : state === "error" ? "The review ledger may still require its controlled migration." : "Reading purpose-limited order exceptions."; const Icon = loading ? LoaderCircle : AlertTriangle; return <section className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-8 text-center"><Icon className={`mx-auto text-amber-300 ${loading ? "animate-spin" : ""}`} /><p className="mt-3 font-black">{title}</p><p className="mt-1 text-sm text-zinc-400">{body}</p></section>; }

const navClass = "inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-black";
const inputClass = "h-11 w-full rounded-md border border-white/10 bg-[#070b13] px-3 text-sm font-normal text-white outline-none focus:border-cyan-300/50";
function mergeById(current: ReviewItem[], next: ReviewItem[]) { const values = new Map(current.map((item) => [item.id, item])); for (const item of next) values.set(item.id, item); return [...values.values()]; }
function label(value: string) { return value.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "); }
function formatPrice(minor: number, currency: string) { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(minor / 100); }
function formatDate(value: string | null) { if (!value) return "Unknown"; const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value; const date = new Date(normalized); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }); }
