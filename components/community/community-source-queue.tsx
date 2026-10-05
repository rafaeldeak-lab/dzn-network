"use client";

import { Check, Clock3, Search, ShieldX } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

type Candidate = {
  id: string;
  candidate_discord_id_masked: string | null;
  candidate_username: string | null;
  role_label: string | null;
  status: "pending" | "imported" | "rejected" | "duplicate" | "no_match";
  matched_username: string | null;
  public_handle: string | null;
  reason: string | null;
  can_import: boolean;
  updated_at: string;
};

type AuditItem = {
  id: string;
  candidate_id: string | null;
  action: string;
  result_status: string;
  reason: string | null;
  created_at: string;
};

export function CommunitySourceQueue({ serverId, onImported }: { serverId: string; onImported: () => Promise<void> }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [discordId, setDiscordId] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void loadQueue(serverId, setCandidates, setAudit, setMessage); }, [serverId]);

  async function createCandidate(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{17,32}$/.test(discordId.trim()) || busy) return;
    setBusy("create"); setMessage("");
    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/community-member-candidates`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discord_id: discordId.trim(), username: username.trim(), role_label: role.trim() }),
      });
      const payload = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "The candidate could not be checked.");
      setDiscordId(""); setUsername(""); setRole(""); setMessage(payload.message ?? "Candidate checked.");
      await loadQueue(serverId, setCandidates, setAudit, setMessage, true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The candidate could not be checked."); }
    finally { setBusy(null); }
  }

  async function decide(candidate: Candidate, action: "import" | "reject") {
    if (busy) return;
    setBusy(candidate.id); setMessage("");
    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/community-member-candidates`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: candidate.id, action }),
      });
      const payload = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "The decision could not be saved.");
      setMessage(payload.message ?? "Decision saved.");
      await loadQueue(serverId, setCandidates, setAudit, setMessage, true);
      if (action === "import") await onImported();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The decision could not be saved."); }
    finally { setBusy(null); }
  }

  const query = filter.trim().toLowerCase();
  const visible = query ? candidates.filter((candidate) => [candidate.candidate_username, candidate.matched_username, candidate.public_handle, candidate.candidate_discord_id_masked, candidate.status].some((value) => value?.toLowerCase().includes(query))) : candidates;

  return (
    <section className="mt-5 rounded-md border border-cyan-300/15 bg-[#08101d] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-black uppercase text-cyan-200">Private source checks</p><h2 className="mt-1 text-xl font-black uppercase">Discord candidate queue</h2><p className="mt-2 max-w-2xl text-sm font-semibold text-zinc-400">Check an exact Discord user ID against an existing DZN account. Import creates a private invitation; the player still decides whether it can appear publicly.</p></div>
        <span className="inline-flex items-center gap-2 rounded border border-emerald-300/20 bg-emerald-300/5 px-3 py-2 text-xs font-black uppercase text-emerald-200"><Clock3 size={15} /> Audited</span>
      </div>

      <form onSubmit={createCandidate} className="mt-5 grid gap-3 border-t border-white/10 pt-4 md:grid-cols-[1.2fr_1fr_1fr_auto]">
        <label className="text-xs font-black uppercase text-zinc-300">Discord user ID<input inputMode="numeric" pattern="[0-9]{17,32}" required value={discordId} onChange={(event) => setDiscordId(event.target.value.replace(/\D/g, ""))} maxLength={32} placeholder="Exact numeric ID" className="mt-2 min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm font-semibold normal-case text-white outline-none focus:border-cyan-300/60" /></label>
        <label className="text-xs font-black uppercase text-zinc-300">Known name<input value={username} onChange={(event) => setUsername(event.target.value)} maxLength={64} placeholder="Optional" className="mt-2 min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm font-semibold normal-case text-white outline-none focus:border-cyan-300/60" /></label>
        <label className="text-xs font-black uppercase text-zinc-300">Role<input value={role} onChange={(event) => setRole(event.target.value)} maxLength={36} placeholder="Optional" className="mt-2 min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm font-semibold normal-case text-white outline-none focus:border-cyan-300/60" /></label>
        <button disabled={busy !== null || !/^\d{17,32}$/.test(discordId)} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-4 text-xs font-black uppercase text-cyan-100 disabled:opacity-50"><Search size={16} /> Check</button>
      </form>
      {message ? <p className="mt-3 text-sm font-semibold text-cyan-100">{message}</p> : null}

      <div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4">
        <Search size={16} className="shrink-0 text-zinc-500" />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search candidates" className="min-h-10 min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-zinc-600" />
        <span className="text-xs font-black text-zinc-500">{visible.length}</span>
      </div>

      <div className="mt-3 grid gap-2">
        {visible.length === 0 ? <QueueNotice text="No matching source candidates." /> : visible.map((candidate) => (
          <article key={candidate.id} className="rounded-md border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="truncate font-black">{candidate.matched_username ?? candidate.candidate_username ?? "Unknown Discord account"}</p><p className="mt-1 text-xs font-bold text-zinc-500">{candidate.candidate_discord_id_masked ?? "ID erased"}{candidate.public_handle ? ` · /${candidate.public_handle}` : ""}{candidate.role_label ? ` · ${candidate.role_label}` : ""}</p></div>
              <span className={`rounded px-2 py-1 text-[10px] font-black uppercase ${candidate.status === "pending" ? "bg-amber-300/10 text-amber-200" : candidate.status === "imported" ? "bg-emerald-300/10 text-emerald-200" : "bg-zinc-300/10 text-zinc-400"}`}>{candidate.status.replace("_", " ")}</span>
            </div>
            {candidate.reason ? <p className="mt-2 text-xs font-semibold text-zinc-400">{candidate.reason}</p> : null}
            {candidate.status === "pending" ? <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3"><button type="button" disabled={busy !== null || !candidate.can_import} onClick={() => void decide(candidate, "import")} className="inline-flex min-h-9 items-center gap-2 rounded border border-emerald-300/25 px-3 text-xs font-black uppercase text-emerald-200 disabled:opacity-40"><Check size={14} /> Import privately</button><button type="button" disabled={busy !== null} onClick={() => void decide(candidate, "reject")} className="inline-flex min-h-9 items-center gap-2 rounded border border-red-300/20 px-3 text-xs font-black uppercase text-red-200 disabled:opacity-40"><ShieldX size={14} /> Reject</button></div> : null}
          </article>
        ))}
      </div>

      <details className="mt-5 border-t border-white/10 pt-4"><summary className="cursor-pointer text-xs font-black uppercase text-zinc-300">Decision history ({audit.length})</summary><div className="mt-3 grid gap-2">{audit.length === 0 ? <QueueNotice text="No source decisions recorded yet." /> : audit.map((item) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded border border-white/10 bg-black/20 p-3 text-xs"><div><p className="font-black uppercase text-zinc-200">{item.action.replaceAll("_", " ")}</p><p className="mt-1 font-semibold text-zinc-500">{item.reason ?? "No reason recorded."}</p></div><span className="font-bold uppercase text-zinc-500">{item.result_status}</span></div>)}</div></details>
    </section>
  );
}

async function loadQueue(serverId: string, setCandidates: (items: Candidate[]) => void, setAudit: (items: AuditItem[]) => void, setMessage: (message: string) => void, preserveMessage = false) {
  try {
    const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/community-member-candidates`, { credentials: "include", cache: "no-store" });
    const payload = await response.json() as { ok?: boolean; candidates?: Candidate[]; audit?: AuditItem[] };
    if (!response.ok || !payload.ok) throw new Error();
    setCandidates(payload.candidates ?? []); setAudit(payload.audit ?? []);
  } catch { if (!preserveMessage) setMessage("The private source queue could not be loaded."); }
}

function QueueNotice({ text }: { text: string }) { return <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm font-semibold text-zinc-400">{text}</div>; }
