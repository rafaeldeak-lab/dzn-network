"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, EyeOff, Home, MessageSquareWarning, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ReportItem = {
  message_id: string;
  author_display_name: string;
  body: string;
  body_source?: "public" | "archive";
  visibility_state: string;
  created_at: string | null;
  expires_at: string | null;
  report_count: number;
  first_reported_at: string | null;
  reasons: string | null;
};

type AuditItem = {
  id: string;
  message_id: string | null;
  action: string;
  reason_code: string;
  created_at: string | null;
  actor_name: string | null;
};

type Payload = {
  ok: boolean;
  source?: string;
  reports?: ReportItem[];
  audit?: AuditItem[];
  archive_available?: boolean;
  retention?: { message_days: number; deleted_body_erasure: boolean };
  message?: string;
};

type Action = "hide" | "restore" | "delete" | "resolve_report" | "dismiss_report";

type ArchiveItem = {
  message_id: string;
  channel_slug: string;
  author_display_name: string;
  author_role_label: string;
  original_body: string;
  sent_at: string | null;
  deleted_at: string | null;
  deletion_kind: string | null;
  deleted_by_name: string | null;
  current_visibility_state: string;
};

type ArchivePayload = { ok: boolean; retention_days?: number; rows?: ArchiveItem[]; page?: { has_more?: boolean; next_cursor?: string | null } };

export function DznCommsModerationPage() {
  const [state, setState] = useState<"loading" | "ready" | "disabled" | "blocked" | "error">("loading");
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [archiveAvailable, setArchiveAvailable] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<"all" | "visible" | "hidden" | "deleted">("all");
  const [archiveNextCursor, setArchiveNextCursor] = useState<string | null>(null);
  const [archiveLoadingMore, setArchiveLoadingMore] = useState(false);
  const archiveAbortController = useRef<AbortController | null>(null);

  const loadArchive = useCallback(async (filter: "all" | "visible" | "hidden" | "deleted", query: string, cursor?: string | null, append = false) => {
    archiveAbortController.current?.abort();
    const controller = new AbortController();
    archiveAbortController.current = controller;
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    try {
      const response = await fetch(`/api/owner/comms/archive?filter=${filter}&query=${encodeURIComponent(query)}${cursorParam}`, { cache: "no-store", credentials: "include", signal: controller.signal });
      if (archiveAbortController.current !== controller) return;
      if (response.ok) {
        const payload = await response.json().catch(() => null) as ArchivePayload | null;
        if (payload?.ok) {
          setArchive((current) => append ? [...current, ...(payload.rows ?? [])] : payload.rows ?? []);
          setArchiveNextCursor(payload.page?.next_cursor ?? null);
          setArchiveAvailable(true);
          setRetentionDays(payload.retention_days ?? 30);
        }
      } else if (response.status === 404) {
        setArchiveAvailable(false);
        setArchive([]);
        setArchiveNextCursor(null);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    }
  }, []);

  const load = useCallback(async (clearNotice = true) => {
    setState("loading");
    if (clearNotice) setNotice(null);
    try {
      const response = await fetch("/api/owner/comms/moderate", { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => null) as Payload | null;
      if (response.status === 404) { setState("disabled"); return; }
      if (response.status === 401 || response.status === 403) { setState("blocked"); return; }
      if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "Moderation queue unavailable.");
      setReports(payload.reports ?? []);
      setAudit(payload.audit ?? []);
      setArchiveAvailable(payload.archive_available === true);
      setRetentionDays(payload.retention?.message_days ?? 30);
      setSelectedId((current) => (payload.reports ?? []).some((item) => item.message_id === current) ? current : payload.reports?.[0]?.message_id ?? null);
      await loadArchive("all", "");
      setState("ready");
    } catch {
      setState("error");
    }
  }, [loadArchive]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (state !== "ready") return;
    const timer = window.setTimeout(() => void loadArchive(archiveFilter, archiveQuery), 250);
    return () => window.clearTimeout(timer);
  }, [archiveFilter, archiveQuery, loadArchive, state]);
  const selected = useMemo(() => reports.find((item) => item.message_id === selectedId) ?? null, [reports, selectedId]);

  async function moderate(action: Action) {
    if (!selected || reason.trim().length < 3) { setNotice("Add a clear moderation reason first."); return; }
    const deletePrompt = archiveAvailable
      ? "Remove this message from public chat? Its original content stays in the private 30-day safety archive."
      : "Remove this message from public chat? This permanently erases its author and body because the private archive is not active.";
    if (action === "delete" && !window.confirm(deletePrompt)) return;
    setBusy(action); setNotice(null);
    try {
      const response = await fetch("/api/owner/comms/moderate", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: selected.message_id, action, reason: reason.trim().slice(0, 80) }),
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "The moderation action was not applied.");
      setReason("");
      setNotice("Moderation action recorded in the audit history.");
      await load(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The moderation action was not applied.");
    } finally { setBusy(null); }
  }

  return (
    <main className="min-h-screen bg-[#02040a] px-3 py-4 text-zinc-100 sm:px-5 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(34,211,238,0.13),transparent_34%),radial-gradient(circle_at_88%_8%,rgba(168,85,247,0.14),transparent_30%)]" />
      <div className="relative mx-auto max-w-[1540px]">
        <header className="border-b border-cyan-300/20 pb-5">
          <nav className="flex flex-wrap gap-2">
            <Link href="/owner" className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-black"><ArrowLeft size={14} />Command Centre</Link>
            <Link href="/" className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-black"><Home size={14} />Home</Link>
            <button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100"><RefreshCw size={14} />Refresh</button>
          </nav>
          <div className="mt-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div><p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">Private platform-owner workspace</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Global Chat moderation</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Review reported messages, record a reason for every decision, and keep destructive actions auditable.</p></div>
            <div className="grid min-w-64 grid-cols-2 gap-2"><Metric label="Open reports" value={reports.reduce((sum, item) => sum + Number(item.report_count), 0)} /><Metric label="Retention" value={`${retentionDays} days`} /></div>
          </div>
        </header>

        {state !== "ready" ? <StatePanel state={state} /> : (<>
          <div className="mt-4 grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
            <section className="min-w-0 rounded-lg border border-white/10 bg-black/35 p-3">
              <div className="flex items-center gap-2"><MessageSquareWarning className="text-amber-300" size={18} /><h2 className="font-black">Report queue</h2></div>
              <div className="mt-3 grid max-h-[66vh] gap-2 overflow-auto pr-1">
                {reports.length === 0 ? <EmptyQueue /> : reports.map((item) => <button key={item.message_id} type="button" onClick={() => setSelectedId(item.message_id)} className={`min-w-0 rounded-md border p-3 text-left ${selectedId === item.message_id ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/10 bg-white/[0.03]"}`}><div className="flex items-center justify-between gap-2"><strong className="truncate text-sm">{item.author_display_name}</strong><span className="rounded bg-amber-300/10 px-2 py-1 text-[10px] font-black text-amber-200">{item.report_count} REPORT{Number(item.report_count) === 1 ? "" : "S"}</span></div><p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-400">{item.body}</p>{item.body_source === "archive" ? <p className="mt-2 text-[10px] font-black uppercase text-violet-200">Archived original</p> : null}<p className="mt-2 text-[10px] font-bold uppercase text-zinc-500">{(item.reasons ?? "other").replaceAll(",", " / ")}</p></button>)}
              </div>
            </section>

            <section className="min-w-0 rounded-lg border border-white/10 bg-black/35 p-4">
              {!selected ? <EmptyQueue /> : <><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-cyan-300/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">{selected.visibility_state}</span>{selected.body_source === "archive" ? <span className="rounded bg-violet-300/10 px-2 py-1 text-[10px] font-black uppercase text-violet-100">Archived original</span> : null}<span className="text-xs text-zinc-500">{formatDate(selected.created_at)}</span></div><h2 className="mt-4 text-xl font-black">{selected.author_display_name}</h2><div className="mt-3 min-h-32 whitespace-pre-wrap break-words rounded-md border border-white/10 bg-[#070b13] p-4 text-sm leading-6 text-zinc-200">{selected.body}</div><div className="mt-4 grid gap-2 sm:grid-cols-2"><Info label="Report reasons" value={(selected.reasons ?? "other").replaceAll(",", ", ")} /><Info label="First reported" value={formatDate(selected.first_reported_at)} /><Info label="Message expiry" value={formatDate(selected.expires_at)} /><Info label="Message reference" value={selected.message_id} /></div><label className="mt-4 block text-xs font-black uppercase text-zinc-300">Decision reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={80} placeholder="Required for the audit record" className="mt-2 w-full rounded-md border border-white/15 bg-[#070b13] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300/60" /></label>{notice ? <p className="mt-3 text-xs font-bold text-amber-200">{notice}</p> : null}<div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5"><ActionButton label="Hide" icon={<EyeOff size={15} />} busy={busy === "hide"} onClick={() => void moderate("hide")} /><ActionButton label="Restore" icon={<Eye size={15} />} busy={busy === "restore"} onClick={() => void moderate("restore")} /><ActionButton label="Resolve" icon={<CheckCircle2 size={15} />} busy={busy === "resolve_report"} onClick={() => void moderate("resolve_report")} /><ActionButton label="Dismiss" icon={<XCircle size={15} />} busy={busy === "dismiss_report"} onClick={() => void moderate("dismiss_report")} /><ActionButton danger label="Erase" icon={<Trash2 size={15} />} busy={busy === "delete"} onClick={() => void moderate("delete")} /></div></>}
            </section>

            <section className="min-w-0 rounded-lg border border-white/10 bg-black/35 p-3"><div className="flex items-center gap-2"><ShieldCheck className="text-emerald-300" size={18} /><h2 className="font-black">Recent decisions</h2></div><div className="mt-3 grid max-h-[66vh] gap-2 overflow-auto pr-1">{audit.length === 0 ? <p className="rounded-md border border-dashed border-white/10 p-4 text-sm text-zinc-500">No moderation decisions recorded yet.</p> : audit.map((item) => <article key={item.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3"><div className="flex items-center justify-between gap-2"><strong className="text-xs uppercase text-violet-200">{item.action.replaceAll("_", " ")}</strong><span className="text-[10px] text-zinc-500">{formatDate(item.created_at)}</span></div><p className="mt-2 break-words text-xs leading-5 text-zinc-300">{item.reason_code}</p><p className="mt-2 text-[10px] text-zinc-500">By {item.actor_name ?? "DZN owner"}</p></article>)}</div></section>
          </div>
          {archiveAvailable ? <section className="mt-4 min-w-0 rounded-lg border border-violet-300/20 bg-black/35 p-4">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Private platform-owner record</p><h2 className="mt-1 text-xl font-black">30-day message archive</h2><p className="mt-1 text-xs text-zinc-400">Original message text and deletion details are retained for safety review, then removed automatically.</p></div><span className="rounded-md border border-violet-300/25 bg-violet-300/10 px-3 py-2 text-xs font-black text-violet-100">{archive.length} matching</span></div>
            <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]"><input value={archiveQuery} onChange={(event) => setArchiveQuery(event.target.value)} maxLength={80} placeholder="Search author or message text" aria-label="Search message archive" className="w-full rounded-md border border-white/15 bg-[#070b13] px-3 py-3 text-sm text-white outline-none focus:border-violet-300/60" /><select value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value as "all" | "visible" | "hidden" | "deleted")} aria-label="Archive filter" className="rounded-md border border-white/15 bg-[#070b13] px-3 py-3 text-sm text-white outline-none focus:border-violet-300/60"><option value="all">All message states</option><option value="visible">Visible</option><option value="hidden">Hidden</option><option value="deleted">Deleted</option></select></div>
            <div className="mt-3 grid max-h-[42vh] gap-2 overflow-auto pr-1">{archive.length === 0 ? <p className="rounded-md border border-dashed border-white/10 p-4 text-sm text-zinc-500">No archived messages match this search.</p> : archive.map((item) => <article key={item.message_id} className="rounded-md border border-white/10 bg-white/[0.03] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-sm text-white">{item.author_display_name}</strong><span className="ml-2 text-[10px] font-black uppercase text-cyan-200">{item.author_role_label}</span></div><ArchiveVisibilityBadge state={item.current_visibility_state} /></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">{item.original_body}</p><p className="mt-2 text-[10px] text-zinc-500">#{item.channel_slug} · Sent {formatDate(item.sent_at)}{item.deleted_at ? ` · ${item.deletion_kind?.replaceAll("_", " ") ?? "deleted"} ${formatDate(item.deleted_at)}${item.deleted_by_name ? ` by ${item.deleted_by_name}` : ""}` : ""}</p></article>)}</div>{archiveNextCursor ? <button type="button" disabled={archiveLoadingMore} onClick={() => { setArchiveLoadingMore(true); void loadArchive(archiveFilter, archiveQuery, archiveNextCursor, true).finally(() => setArchiveLoadingMore(false)); }} className="mt-3 min-h-10 rounded-md border border-violet-300/25 bg-violet-300/10 px-3 text-xs font-black text-violet-100 disabled:opacity-50">{archiveLoadingMore ? "Loading older messages" : "Load older messages"}</button> : null}
          </section> : null}
        </>)}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-md border border-white/10 bg-white/[0.04] p-3"><p className="text-[10px] font-black uppercase text-zinc-500">{label}</p><p className="mt-1 text-xl font-black text-white">{value}</p></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-md border border-white/10 bg-white/[0.03] p-3"><p className="text-[10px] font-black uppercase text-zinc-500">{label}</p><p className="mt-1 break-all text-xs text-zinc-200">{value}</p></div>; }
function ActionButton({ label, icon, busy, danger, onClick }: { label: string; icon: ReactNode; busy: boolean; danger?: boolean; onClick: () => void }) { return <button type="button" disabled={busy} onClick={onClick} className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-black disabled:opacity-50 ${danger ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-100"}`}>{icon}{busy ? "Working" : label}</button>; }
function ArchiveVisibilityBadge({ state }: { state: string }) { const label = state === "visible" ? "Visible" : state === "hidden" ? "Hidden" : state === "deleted" ? "Deleted" : state.replaceAll("_", " "); const tone = state === "visible" ? "bg-emerald-300/10 text-emerald-200" : state === "hidden" ? "bg-amber-300/10 text-amber-200" : state === "deleted" ? "bg-red-300/10 text-red-200" : "bg-zinc-300/10 text-zinc-200"; return <span className={`rounded px-2 py-1 text-[10px] font-black uppercase ${tone}`}>{label}</span>; }
function EmptyQueue() { return <div className="rounded-md border border-dashed border-emerald-300/20 bg-emerald-300/[0.04] p-6 text-center"><CheckCircle2 className="mx-auto text-emerald-300" /><p className="mt-3 font-black">Queue clear</p><p className="mt-1 text-xs text-zinc-500">No open Global Chat reports need a decision.</p></div>; }
function StatePanel({ state }: { state: "loading" | "disabled" | "blocked" | "error" }) { const copy = state === "loading" ? "Loading moderation queue..." : state === "disabled" ? "Owner moderation is installed but not activated in this environment." : state === "blocked" ? "Sign in with the platform-owner Discord account to open this workspace." : "The moderation queue could not be loaded."; return <section className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-8 text-center"><AlertTriangle className="mx-auto text-amber-300" /><p className="mt-3 font-black">{copy}</p></section>; }
function formatDate(value: string | null) { if (!value) return "Not recorded"; const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value; const date = new Date(normalized); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }); }
