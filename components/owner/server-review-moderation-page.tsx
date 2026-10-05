"use client";

import { ArrowLeft, Bell, CheckCircle2, EyeOff, Filter, Home, ListChecks, RefreshCw, Search, ShieldCheck, Star, XCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ReviewStatus = "pending" | "approved" | "hidden";
type ReviewItem = {
  id: string;
  linked_server_id: string;
  server_name: string | null;
  public_slug: string | null;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  moderation_reason: string | null;
  moderation_version: number;
  active_report_count: number;
  report_reasons: string | null;
  first_reported_at: string | null;
  created_at: string;
};
type AuditItem = {
  id: string;
  review_id: string;
  action: string;
  reason: string;
  actor_name: string | null;
  created_at: string;
  server_name: string | null;
  reviewer_name: string | null;
};
type QueuePayload = { ok?: boolean; reviews?: ReviewItem[]; audit?: AuditItem[]; reviewUnreadCount?: number; message?: string };

export function ServerReviewModerationPage() {
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "blocked" | "error">("loading");
  const [busy, setBusy] = useState<"approve" | "hide" | null>(null);
  const [reviewAlertsBusy, setReviewAlertsBusy] = useState(false);
  const [reviewUnreadCount, setReviewUnreadCount] = useState(0);
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(() => new Set());
  const [bulkReason, setBulkReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState<"approve" | "hide" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const statusRef = useRef(status);
  const appliedSearchRef = useRef(appliedSearch);

  const load = useCallback(async (options?: { keepNotice?: boolean }) => {
    const requestSequence = ++loadSequence.current;
    setState("loading");
    if (!options?.keepNotice) setNotice(null);
    try {
      const params = new URLSearchParams({ status: statusRef.current });
      if (appliedSearchRef.current) params.set("q", appliedSearchRef.current);
      const response = await fetch(`/api/owner/reviews/moderate?${params}`, { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => null) as QueuePayload | null;
      if (requestSequence !== loadSequence.current) return;
      if (response.status === 401 || response.status === 403) { setState("blocked"); return; }
      if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "Review moderation is unavailable.");
      const nextReviews = payload.reviews ?? [];
      setReviews(nextReviews);
      setAudit(payload.audit ?? []);
      setReviewUnreadCount(Math.max(0, Number(payload.reviewUnreadCount ?? 0) || 0));
      setSelectedReviewIds(new Set());
      setSelectedId((current) => nextReviews.some((review) => review.id === current) ? current : nextReviews[0]?.id ?? null);
      setState("ready");
    } catch (error) {
      if (requestSequence !== loadSequence.current) return;
      setNotice(error instanceof Error ? error.message : "Review moderation is unavailable.");
      setState("error");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [appliedSearch, load, status]);
  const selected = useMemo(() => reviews.find((review) => review.id === selectedId) ?? null, [reviews, selectedId]);

  async function decide(action: "approve" | "hide") {
    if (!selected) return;
    if (reason.trim().length < 5) { setNotice("Add a clear decision reason first."); return; }
    setBusy(action); setNotice(null);
    try {
      const response = await fetch("/api/owner/reviews/moderate", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewId: selected.id, moderationVersion: selected.moderation_version, action, reason: reason.trim() }),
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "The moderation decision was not saved.");
      setReason("");
      setNotice(action === "approve" ? "Review approved and restored to the public score." : "Review hidden from the public score.");
      await load({ keepNotice: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The moderation decision was not saved.");
    } finally { setBusy(null); }
  }

  async function markReviewAlertsRead() {
    if (reviewAlertsBusy || reviewUnreadCount === 0) return;
    setReviewAlertsBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/owner/reviews/notifications/read", { method: "POST", credentials: "include" });
      const payload = await response.json().catch(() => null) as { ok?: boolean; marked?: number; reviewUnreadCount?: number; message?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "Review alerts could not be marked read.");
      const marked = Math.max(0, Number(payload.marked ?? 0) || 0);
      setReviewUnreadCount(Math.max(0, Number(payload.reviewUnreadCount ?? 0) || 0));
      setNotice(marked === 1 ? "One review alert marked read." : `${marked} review alerts marked read.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Review alerts could not be marked read.");
    } finally { setReviewAlertsBusy(false); }
  }

  function toggleReviewSelection(reviewId: string) {
    if (!selectedReviewIds.has(reviewId) && selectedReviewIds.size >= 20) {
      setNotice("A group decision can include at most 20 reviews.");
      return;
    }
    setSelectedReviewIds((current) => {
      const next = new Set(current);
      if (next.has(reviewId)) next.delete(reviewId); else next.add(reviewId);
      return next;
    });
  }

  async function bulkDecide(action: "approve" | "hide") {
    const selectedReviews = reviews.filter((review) => selectedReviewIds.has(review.id));
    if (selectedReviews.length < 2) { setNotice("Select at least two reviews for a group decision."); return; }
    if (bulkReason.trim().length < 5) { setNotice("Add a clear group decision reason first."); return; }
    setBulkBusy(action); setNotice(null);
    try {
      const response = await fetch("/api/owner/reviews/bulk", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: selectedReviews.map((review) => ({ reviewId: review.id, moderationVersion: review.moderation_version })),
          action,
          reason: bulkReason.trim(),
        }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; updated?: number; message?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "The group decision was not saved.");
      setBulkReason("");
      setNotice(`${payload.updated ?? selectedReviews.length} reviews updated together.`);
      await load({ keepNotice: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The group decision was not saved.");
    } finally { setBulkBusy(null); }
  }

  return (
    <main className="min-h-screen bg-[#02050b] px-3 py-4 text-zinc-100 sm:px-5 lg:px-8">
      <div className="mx-auto max-w-[1540px]">
        <header className="border-b border-cyan-300/20 pb-5">
          <nav className="flex flex-wrap gap-2">
            <Link href="/owner" className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-black"><ArrowLeft size={14} />Command Centre</Link>
            <Link href="/" className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-black"><Home size={14} />Home</Link>
            <button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100"><RefreshCw size={14} />Refresh</button>
          </nav>
          <div className="mt-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div><p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">Private platform-owner workspace</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Review moderation</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Resolve reported server reviews without changing rankings, gameplay statistics, billing, or competitive results.</p></div>
            <div className="flex flex-wrap gap-2">
              <div className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] p-3"><p className="text-[10px] font-black uppercase text-amber-200">Showing</p><p className="mt-1 text-2xl font-black">{reviews.length}</p></div>
              <button type="button" disabled={reviewAlertsBusy || reviewUnreadCount === 0} onClick={() => void markReviewAlertsRead()} className="inline-flex min-h-14 items-center gap-3 rounded-md border border-rose-300/25 bg-rose-300/[0.08] px-4 text-left disabled:cursor-not-allowed disabled:opacity-45">
                <Bell size={18} className="text-rose-200" aria-hidden="true" />
                <span><span className="block text-[10px] font-black uppercase text-rose-200">Review alerts</span><span className="mt-1 block text-sm font-black">{reviewAlertsBusy ? "Clearing..." : `${reviewUnreadCount} unread`}</span></span>
              </button>
            </div>
          </div>
        </header>

        <form onSubmit={(event) => { event.preventDefault(); const nextSearch = search.trim(); appliedSearchRef.current = nextSearch; setAppliedSearch(nextSearch); }} className="mt-4 grid gap-2 rounded-lg border border-white/10 bg-black/35 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative"><span className="sr-only">Search reviews</span><Search className="pointer-events-none absolute left-3 top-3 text-zinc-500" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={80} placeholder="Search server, player, title, or review" className="h-11 w-full rounded-md border border-white/10 bg-[#070b13] pl-10 pr-3 text-sm outline-none focus:border-cyan-300/50" /></label>
          <label className="relative"><span className="sr-only">Review status</span><Filter className="pointer-events-none absolute left-3 top-3 text-zinc-500" size={17} /><select value={status} onChange={(event) => { const nextStatus = event.target.value as ReviewStatus; statusRef.current = nextStatus; setStatus(nextStatus); }} className="h-11 min-w-40 appearance-none rounded-md border border-white/10 bg-[#070b13] pl-10 pr-8 text-sm font-bold outline-none"><option value="pending">Needs review</option><option value="approved">Approved</option><option value="hidden">Hidden</option></select></label>
          <button type="submit" className="h-11 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-5 text-sm font-black text-cyan-100">Search</button>
        </form>

        {notice ? <p className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 text-sm font-bold text-cyan-50">{notice}</p> : null}
        {state === "ready" && reviews.length >= 2 ? <section className="mt-4 grid gap-3 rounded-lg border border-violet-300/20 bg-violet-300/[0.05] p-3 lg:grid-cols-[auto_minmax(240px,1fr)_auto_auto] lg:items-center">
          <div className="flex items-center gap-3"><ListChecks size={19} className="text-violet-200" /><div><p className="text-xs font-black uppercase text-violet-100">Group decision</p><p className="text-xs text-zinc-400">{selectedReviewIds.size} selected, maximum 20</p></div></div>
          <input value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} maxLength={240} placeholder="One audit reason for every selected review" className="h-11 w-full rounded-md border border-white/10 bg-[#070b13] px-3 text-sm outline-none focus:border-violet-300/50" />
          <button type="button" disabled={Boolean(bulkBusy) || selectedReviewIds.size < 2} onClick={() => void bulkDecide("hide")} className="h-11 rounded-md border border-red-400/30 bg-red-400/10 px-4 text-sm font-black text-red-100 disabled:opacity-45">{bulkBusy === "hide" ? "Saving..." : "Hide selected"}</button>
          <button type="button" disabled={Boolean(bulkBusy) || selectedReviewIds.size < 2} onClick={() => void bulkDecide("approve")} className="h-11 rounded-md border border-emerald-300/30 bg-emerald-300/10 px-4 text-sm font-black text-emerald-100 disabled:opacity-45">{bulkBusy === "approve" ? "Saving..." : "Approve selected"}</button>
        </section> : null}
        {state !== "ready" ? <StatePanel state={state} /> : (
          <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)_360px]">
            <section className="min-w-0 rounded-lg border border-white/10 bg-black/35 p-3"><div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-black"><ShieldCheck size={18} className="text-cyan-300" />Review queue</h2>{reviews.length >= 2 ? <button type="button" onClick={() => setSelectedReviewIds(selectedReviewIds.size > 0 ? new Set() : new Set(reviews.slice(0, 20).map((review) => review.id)))} className="text-[10px] font-black uppercase text-violet-200">{selectedReviewIds.size > 0 ? "Clear" : "Select first 20"}</button> : null}</div><div className="mt-3 grid max-h-[68vh] gap-2 overflow-auto pr-1">{reviews.length === 0 ? <EmptyState /> : reviews.map((review) => { const checked = selectedReviewIds.has(review.id); const capped = !checked && selectedReviewIds.size >= 20; return <div key={review.id} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2"><label className={`mt-3 grid h-7 w-7 place-items-center rounded border border-white/15 bg-white/[0.04] ${capped ? "cursor-not-allowed opacity-35" : "cursor-pointer"}`} title={capped ? "Maximum 20 reviews selected" : "Include in group decision"}><input type="checkbox" checked={checked} disabled={capped} onChange={() => toggleReviewSelection(review.id)} className="h-4 w-4 accent-violet-400" aria-label={`Select review by ${review.reviewer_name ?? "unknown player"}`} /></label><button type="button" onClick={() => setSelectedId(review.id)} className={`rounded-md border p-3 text-left ${review.id === selectedId ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/10 bg-white/[0.03]"}`}><div className="flex items-center gap-3">{review.reviewer_avatar_url ? <Image src={review.reviewer_avatar_url} alt="" width={40} height={40} unoptimized className="h-10 w-10 rounded-full border border-white/15 object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-full bg-white/10 font-black">{(review.reviewer_name ?? "?").slice(0, 1).toUpperCase()}</div>}<div className="min-w-0"><p className="truncate text-sm font-black">{review.reviewer_name ?? "Unknown player"}</p><p className="truncate text-xs text-zinc-500">{review.server_name ?? "Unknown server"}</p></div></div><div className="mt-2 flex items-center justify-between gap-2"><Stars value={review.rating} /><span className="rounded bg-amber-300/10 px-2 py-1 text-[10px] font-black text-amber-200">{review.active_report_count} OPEN</span></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{review.title || review.body}</p></button></div>; })}</div></section>

            <section className="min-w-0 rounded-lg border border-white/10 bg-black/35 p-4">{!selected ? <EmptyState /> : <><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-black uppercase text-cyan-200">{selected.server_name ?? "Unknown server"}</p><h2 className="mt-1 text-xl font-black">{selected.title || "Untitled review"}</h2></div><Stars value={selected.rating} /></div><div className="mt-4 flex items-center gap-3">{selected.reviewer_avatar_url ? <Image src={selected.reviewer_avatar_url} alt="" width={48} height={48} unoptimized className="h-12 w-12 rounded-full border border-cyan-300/25 object-cover" /> : null}<div><p className="font-black">{selected.reviewer_name ?? "Unknown player"}</p><p className="text-xs text-zinc-500">Posted {formatDate(selected.created_at)}</p></div></div><div className="mt-4 whitespace-pre-wrap break-words rounded-md border border-white/10 bg-[#070b13] p-4 text-sm leading-6 text-zinc-200">{selected.body}</div><div className="mt-3 grid gap-2 sm:grid-cols-2"><Info label="Open reports" value={String(selected.active_report_count)} /><Info label="First reported" value={formatDate(selected.first_reported_at)} /><Info label="Report reasons" value={selected.report_reasons || "No written reason"} /><Info label="Current status" value={selected.status} /></div><label className="mt-4 block text-xs font-black uppercase text-zinc-300">Decision reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={240} rows={3} placeholder="Required for the permanent audit record" className="mt-2 w-full resize-none rounded-md border border-white/15 bg-[#070b13] px-3 py-3 text-sm font-normal normal-case text-white outline-none focus:border-cyan-300/60" /></label><div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" disabled={Boolean(busy)} onClick={() => void decide("hide")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-red-400/30 bg-red-400/10 px-4 text-sm font-black text-red-100 disabled:opacity-50"><EyeOff size={17} />{busy === "hide" ? "Saving..." : "Hide review"}</button><button type="button" disabled={Boolean(busy)} onClick={() => void decide("approve")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-emerald-300/30 bg-emerald-300/10 px-4 text-sm font-black text-emerald-100 disabled:opacity-50"><CheckCircle2 size={17} />{busy === "approve" ? "Saving..." : "Approve review"}</button></div></>}</section>

            <section className="min-w-0 rounded-lg border border-white/10 bg-black/35 p-3"><h2 className="font-black">Recent decisions</h2><div className="mt-3 grid max-h-[68vh] gap-2 overflow-auto pr-1">{audit.length === 0 ? <p className="rounded-md border border-dashed border-white/10 p-4 text-sm text-zinc-500">No review decisions recorded yet.</p> : audit.map((item) => <article key={item.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3"><div className="flex items-center justify-between gap-2"><strong className={item.action === "approve" ? "text-emerald-200" : "text-red-200"}>{item.action === "approve" ? "Approved" : "Hidden"}</strong><span className="text-[10px] text-zinc-500">{formatDate(item.created_at)}</span></div><p className="mt-2 text-xs font-bold">{item.reviewer_name ?? "Unknown player"} · {item.server_name ?? "Unknown server"}</p><p className="mt-2 text-xs leading-5 text-zinc-400">{item.reason}</p><p className="mt-2 text-[10px] text-zinc-500">By {item.actor_name ?? "DZN owner"}</p></article>)}</div></section>
          </div>
        )}
      </div>
    </main>
  );
}

function Stars({ value }: { value: number }) { return <span className="inline-flex gap-0.5" aria-label={`${value} out of 5 stars`}>{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={14} className={star <= value ? "fill-amber-300 text-amber-300" : "text-zinc-700"} />)}</span>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-md border border-white/10 bg-white/[0.03] p-3"><p className="text-[10px] font-black uppercase text-zinc-500">{label}</p><p className="mt-1 break-words text-xs text-zinc-200">{value}</p></div>; }
function EmptyState() { return <div className="rounded-md border border-dashed border-emerald-300/20 bg-emerald-300/[0.04] p-7 text-center"><CheckCircle2 className="mx-auto text-emerald-300" /><p className="mt-3 font-black">Nothing to review</p><p className="mt-1 text-xs text-zinc-500">No reviews match this status and search.</p></div>; }
function StatePanel({ state }: { state: "loading" | "blocked" | "error" }) { const copy = state === "loading" ? "Loading the review queue..." : state === "blocked" ? "Sign in with the platform-owner Discord account to open this workspace." : "The review queue could not be loaded."; return <section className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-8 text-center"><XCircle className="mx-auto text-amber-300" /><p className="mt-3 font-black">{copy}</p></section>; }
function formatDate(value: string | null) { if (!value) return "Not recorded"; const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value; const date = new Date(normalized); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }); }
