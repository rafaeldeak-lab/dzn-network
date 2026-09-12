"use client";

import { ArrowLeft, ArrowRight, RefreshCw, Unlink } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { ManagedGameIdentityLink } from "@/functions/_lib/player-game-identity-revocation";

export function ManagedGameIdentityLinks({ linkId, onChanged }: { linkId?: string; onChanged?: () => void }) {
  const [after, setAfter] = useState("");
  const [revision, setRevision] = useState(0);
  const key = `${linkId ?? ""}:${after}:${revision}`;
  const [response, setResponse] = useState<{ key: string; items: ManagedGameIdentityLink[]; next: string | null; error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (linkId) params.set("link", linkId);
    if (after) params.set("after", after);
    void fetch(`/api/owner/player-game-identity-links?${params}`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async res => {
        const data = await res.json() as { ok: boolean; items?: ManagedGameIdentityLink[]; next?: string | null };
        if (!res.ok || !data.ok) throw new Error(res.status === 401 ? "Sign in to manage game stats links." : "Game stats links could not be loaded. Please refresh.");
        if (!controller.signal.aborted) setResponse({ key, items: data.items ?? [], next: data.next ?? null, error: "" });
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setResponse({ key, items: [], next: null, error: error instanceof Error ? error.message : "Game stats links could not be loaded." });
      });
    return () => controller.abort();
  }, [linkId, after, key]);
  const loading = response?.key !== key;
  const current = !loading ? response : null;
  const refresh = () => { setRevision(value => value + 1); onChanged?.(); };
  return <section aria-label="Manage game stats links" className="min-w-0 border-t border-white/15 py-5 [overflow-wrap:anywhere]">
    <header className="flex items-center justify-between gap-3">
      <h3 className="text-base font-bold text-white">Game stats links</h3>
      <button title="Refresh game stats links" aria-label="Refresh game stats links" disabled={loading} onClick={refresh} type="button"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-white/20 disabled:opacity-40"><RefreshCw className="size-4" /></button>
    </header>
    {loading ? <p role="status" className="py-4 text-sm text-zinc-300">Loading game stats links...</p> : null}
    {current?.error ? <p role="alert" className="py-4 text-sm text-rose-200">{current.error}</p> : null}
    {current && !current.error && !current.items.length ? <p className="py-4 text-sm text-zinc-300">No active verified links found.</p> : null}
    {current?.items.map(link => <LinkReview key={`${key}:${link.id}`} link={link} onChanged={refresh} />)}
    <div className="flex flex-wrap gap-4">
      {after ? <button type="button" onClick={() => setAfter("")} className="inline-flex items-center gap-2 py-3 text-sm"><ArrowLeft className="size-4" />First links</button> : null}
      {current?.next ? <button type="button" onClick={() => setAfter(current.next!)} className="inline-flex items-center gap-2 py-3 text-sm">More links<ArrowRight className="size-4" /></button> : null}
    </div>
  </section>;
}

function LinkReview({ link, onChanged }: { link: ManagedGameIdentityLink; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const revoke = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || !reason.trim() || busy || uncertain) return;
    setBusy(true); setMessage("");
    try {
      const res = await fetch(`/api/owner/player-game-identity-links/${encodeURIComponent(link.id)}`, {
        method: "PATCH", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), confirm: true }),
      });
      const result = await res.json() as { ok: boolean; message?: string };
      if (res.ok && result.ok) { onChanged(); return; }
      setMessage(result.message ?? "The link could not be updated. Refresh before trying again.");
      setUncertain(res.status !== 400);
    } catch { setMessage("The result could not be confirmed. Refresh to check the current link before trying again."); setUncertain(true); }
    finally { setBusy(false); }
  };
  const fields = [["Player", link.account_name ?? "DZN account"], ["Discord account", link.discord_id], ["DZN account", link.user_id],
    ["Server", link.server_name ?? "DZN server"], ["Game account", link.player_name ?? "Game profile"], ["Exact game ID", link.player_id], ["Link reference", link.id]];
  return <div className="min-w-0 border-b border-white/10 py-4">
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-zinc-400">{label}</dt><dd className="mt-1 text-zinc-100">{value}</dd></div>)}
    </dl>
    {link.legacy_conflict ? <p className="mt-3 border-l-2 border-amber-400 pl-3 text-sm text-amber-100">An older account association also exists. DZN support must check its evidence before this link can be safely revoked.</p>
      : <button type="button" onClick={() => setExpanded(value => !value)} disabled={busy} aria-expanded={expanded}
        className="mt-4 inline-flex items-center gap-2 rounded-md border border-rose-300/30 px-3 py-2 text-sm font-bold text-rose-100"><Unlink className="size-4" />{expanded ? "Cancel revocation" : "Revoke link"}</button>}
    {expanded && !link.legacy_conflict ? <form onSubmit={revoke} className="mt-4 grid min-w-0 gap-3">
      <p className="text-sm text-zinc-200">This removes the verified stats link for this server and closes older pending requests for the same game account. It does not delete gameplay, change rankings, cancel billing or remove Discord membership.</p>
      <label className="grid gap-1 text-sm">Reason shown to the player
        <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={240} required rows={3} disabled={busy}
          className="w-full min-w-0 rounded-md border border-white/25 bg-black/30 p-3 text-white" />
      </label>
      <label className="flex items-start gap-2 text-sm text-zinc-200"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} className="mt-1 shrink-0" />
        <span>I have checked the player and server above and want to revoke this link.</span></label>
      <button type="submit" disabled={!confirmed || !reason.trim() || busy || uncertain} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-bold text-rose-100 disabled:opacity-40">
        <Unlink className="size-4 shrink-0" />{busy ? "Revoking..." : "Confirm revocation"}</button>
      {message ? <p role="alert" className="text-sm text-amber-100">{message}</p> : null}
    </form> : null}
  </div>;
}
