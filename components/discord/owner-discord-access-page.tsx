"use client";

import { CheckCircle2, CircleAlert, RefreshCw, Server, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type ServerOption = { id: string; name: string; slug: string | null; status: string | null; lifecycleStatus: string | null };
type AccessRequest = { id: string; linkedServerId: string; serverName: string; note: string | null; status: "pending" | "approved" | "rejected" | "revoked"; decisionReason: string | null; reviewedAt: string | null; createdAt: string | null; updatedAt: string | null };
type Payload = { ok?: boolean; user?: { username: string }; servers?: ServerOption[]; requests?: AccessRequest[]; delivery?: string; message?: string };

export function OwnerDiscordAccessPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "blocked" | "error">("loading");
  const [serverId, setServerId] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const load = useCallback(async () => {
    setState("loading"); setNotice(null);
    try {
      const response = await fetch("/api/discord/owner-access", { credentials: "include", cache: "no-store" });
      const payload = await response.json().catch(() => null) as Payload | null;
      if (response.status === 401) { setState("blocked"); return; }
      if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "Owner Discord access is unavailable.");
      setData(payload); setServerId((current) => current || payload.servers?.[0]?.id || ""); setState("ready");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Owner Discord access is unavailable."); setState("error"); }
  }, []);
  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!serverId || submitting) return;
    setSubmitting(true); setNotice(null);
    try {
      const response = await fetch("/api/discord/owner-access", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ linkedServerId: serverId, note }) });
      const payload = await response.json().catch(() => null) as { ok?: boolean; duplicate?: boolean; message?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "The request could not be saved.");
      setNote(""); setNotice(payload.duplicate ? "This server already has a request waiting for review." : "Your server-owner access request is now waiting for review."); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The request could not be saved."); }
    finally { setSubmitting(false); }
  }
  const requests = data?.requests ?? [];
  return <main className="min-h-screen bg-[#02050b] px-3 py-4 text-zinc-100 sm:px-5 lg:px-8"><div className="mx-auto max-w-4xl">
    <nav className="flex flex-wrap gap-2"><Link href="/dashboard" className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200">Server dashboard</Link><Link href="/" className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200">Home</Link><button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] px-3 py-2 text-xs font-black text-cyan-100"><RefreshCw size={14} />Refresh</button></nav>
    <header className="mt-6 border-b border-cyan-300/20 pb-6"><p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">DZN Discord</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Server-owner access</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Request access using a DZN server linked to your Discord account. DZN reviews the exact server before an owner-only Discord invite can be issued.</p></header>
    {notice ? <p className="mt-5 rounded-md border border-amber-300/25 bg-amber-300/[0.08] px-4 py-3 text-sm font-bold text-amber-100">{notice}</p> : null}
    {state === "loading" ? <p className="mt-8 text-sm text-zinc-400">Loading your server access options...</p> : null}
    {state === "blocked" ? <section className="mt-8 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-5"><CircleAlert className="text-amber-200" /><h2 className="mt-3 text-xl font-black">Discord login required</h2><p className="mt-2 text-sm leading-6 text-zinc-400">Log in with the Discord account that owns the linked DZN server, then return here.</p></section> : null}
    {state === "ready" ? <><section className="mt-6 grid gap-4 rounded-lg border border-cyan-300/20 bg-[#07111d] p-5 md:grid-cols-[1fr_auto]"><div><div className="flex items-center gap-2 text-cyan-100"><ShieldCheck size={18} /><h2 className="font-black">Approval stays manual</h2></div><p className="mt-2 text-sm leading-6 text-zinc-400">Every request is reviewed by DZN against the linked server. This does not prove a paid plan, give public listing access, or change your server configuration.</p></div><span className="h-fit rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs font-black text-zinc-300">{requests.filter((request) => request.status === "pending").length} pending</span></section>
    <section className="mt-5 rounded-lg border border-white/10 bg-white/[0.025] p-5"><div className="flex items-center gap-2"><Server size={18} className="text-cyan-200" /><h2 className="text-xl font-black">Request owner access</h2></div>{data?.servers?.length ? <form onSubmit={submit} className="mt-5 grid gap-4"><label className="grid gap-2 text-xs font-black uppercase tracking-wide text-zinc-300">Your linked DZN server<select value={serverId} onChange={(event) => setServerId(event.target.value)} className="min-h-11 rounded-md border border-white/10 bg-[#02050b] px-3 text-sm normal-case tracking-normal text-white">{data.servers.map((server) => <option key={server.id} value={server.id}>{server.name}{server.lifecycleStatus ? ` - ${server.lifecycleStatus.replace(/_/g, " ")}` : ""}</option>)}</select></label><label className="grid gap-2 text-xs font-black uppercase tracking-wide text-zinc-300">Note for DZN review <textarea value={note} maxLength={400} onChange={(event) => setNote(event.target.value)} placeholder="Optional: anything that helps verify this owner request." className="min-h-24 rounded-md border border-white/10 bg-[#02050b] px-3 py-2 text-sm normal-case tracking-normal text-white" /></label><button disabled={submitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50"><CheckCircle2 size={16} />{submitting ? "Saving request..." : "Request server-owner access"}</button></form> : <p className="mt-4 text-sm leading-6 text-zinc-400">There are no eligible linked servers on this Discord account yet. Complete server setup first, then return here.</p>}</section>
    <section className="mt-5 rounded-lg border border-white/10 bg-white/[0.025] p-5"><h2 className="text-xl font-black">Your request history</h2>{requests.length ? <div className="mt-4 grid gap-3">{requests.map((request) => <article key={request.id} className="rounded-md border border-white/10 bg-black/20 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-black">{request.serverName}</h3><Status status={request.status} /></div><p className="mt-2 text-sm text-zinc-400">Requested {formatTime(request.createdAt)}{request.decisionReason ? ` - ${request.decisionReason}` : ""}</p></article>)}</div> : <p className="mt-3 text-sm text-zinc-400">No requests have been made yet.</p>}</section>
    <p className="mt-5 text-xs leading-5 text-zinc-500">{data?.delivery}</p></> : null}
  </div></main>;
}
function Status({ status }: { status: AccessRequest["status"] }) { const colors = { pending: "border-amber-300/30 text-amber-100", approved: "border-emerald-300/30 text-emerald-100", rejected: "border-rose-300/30 text-rose-100", revoked: "border-zinc-500/40 text-zinc-300" }; return <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${colors[status]}`}>{status}</span>; }
function formatTime(value: string | null) { const time = value ? new Date(value) : null; return time && Number.isFinite(time.getTime()) ? time.toLocaleString() : "recently"; }
