"use client";

import { Eye, EyeOff, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Invitation = { id: string; server_name: string; public_slug: string | null; role_label: string | null; public_member_enabled: number; member_approved_at: string | null };

export function CommunityDirectoryConsent() {
  const [items, setItems] = useState<Invitation[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/player/community-directory", { credentials: "include", cache: "no-store" });
    const payload = await response.json() as { ok?: boolean; invitations?: Invitation[] };
    if (response.ok && payload.ok) setItems(payload.invitations ?? []);
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/player/community-directory", { credentials: "include", cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() as { ok?: boolean; invitations?: Invitation[] } }))
      .then(({ response, payload }) => { if (active && response.ok && payload.ok) setItems(payload.invitations ?? []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function decide(item: Invitation, approve: boolean) {
    if (busy) return;
    setBusy(item.id); setMessage("");
    try {
      const response = await fetch("/api/player/community-directory", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, approve }) });
      if (!response.ok) throw new Error();
      setMessage(approve ? "Community listing approved." : "Community listing permission removed.");
      await load();
    } catch { setMessage("The community listing choice could not be saved."); }
    finally { setBusy(null); }
  }

  return (
    <section className="mt-5 rounded-md border border-cyan-300/20 bg-cyan-300/[0.05] p-4">
      <h3 className="flex items-center gap-2 text-sm font-black uppercase text-white"><Users size={17} className="text-cyan-200" /> Community directory approvals</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">A server owner can suggest your public profile, but it remains hidden from that community directory until you approve it here.</p>
      <div className="mt-4 grid gap-2">{items.length === 0 ? <p className="text-sm font-semibold text-slate-400">No server community has requested to list your profile.</p> : items.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 p-3"><div><p className="font-black text-white">{item.server_name}</p><p className="text-xs font-semibold text-slate-400">{item.role_label ?? "Community member"} · Owner {item.public_member_enabled === 1 ? "published" : "kept private"}</p></div>{item.member_approved_at ? <button type="button" disabled={busy === item.id} onClick={() => void decide(item, false)} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-xs font-black uppercase text-slate-200 disabled:opacity-50"><EyeOff size={14} /> Revoke</button> : <button type="button" disabled={busy === item.id} onClick={() => void decide(item, true)} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs font-black uppercase text-emerald-100 disabled:opacity-50"><Eye size={14} /> Approve</button>}</div>)}</div>
      {message ? <p className="mt-3 text-sm font-semibold text-cyan-100" aria-live="polite">{message}</p> : null}
    </section>
  );
}
