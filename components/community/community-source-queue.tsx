"use client";

import { Check, ChevronDown, Clock3, Search, ShieldX } from "lucide-react";
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
  has_existing_member: boolean;
  can_import: boolean;
  readiness: { state: "ready" | "blocked" | "no_match" | "complete"; label: string; detail: string };
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
  const [candidateScope, setCandidateScope] = useState<"all" | "pending" | "complete">("pending");
  const [readinessFilter, setReadinessFilter] = useState<"all" | Candidate["readiness"]["state"]>("all");
  const [candidateLimit, setCandidateLimit] = useState(8);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditAction, setAuditAction] = useState("all");
  const [auditResult, setAuditResult] = useState("all");
  const [auditLimit, setAuditLimit] = useState(8);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
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
      setSelectedCandidateIds((current) => current.filter((id) => id !== candidate.id));
      await loadQueue(serverId, setCandidates, setAudit, setMessage, true);
      if (action === "import") await onImported();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The decision could not be saved."); }
    finally { setBusy(null); }
  }

  const query = normalizeSearchText(filter);
  const filteredCandidates = candidates.filter((candidate) => {
    const matchesScope = candidateScope === "all" || (candidateScope === "pending" ? candidate.status === "pending" : candidate.status !== "pending");
    const matchesReadiness = readinessFilter === "all" || candidate.readiness.state === readinessFilter;
    const matchesQuery = !query || [candidate.candidate_username, candidate.matched_username, candidate.public_handle, candidate.candidate_discord_id_masked, candidate.status, candidate.role_label, candidate.readiness.label, candidate.readiness.detail].some((value) => normalizeSearchText(value).includes(query));
    return matchesScope && matchesReadiness && matchesQuery;
  });
  const visibleCandidates = filteredCandidates.slice(0, candidateLimit);
  const normalizedAuditQuery = normalizeSearchText(auditQuery);
  const filteredAudit = audit.filter((item) => {
    const matchesQuery = !normalizedAuditQuery || [item.action, item.result_status, item.reason].some((value) => normalizeSearchText(value).includes(normalizedAuditQuery));
    return matchesQuery && (auditAction === "all" || item.action === auditAction) && (auditResult === "all" || item.result_status === auditResult);
  });
  const visibleAudit = filteredAudit.slice(0, auditLimit);
  const pendingCount = candidates.filter((candidate) => candidate.status === "pending").length;
  const completeCount = candidates.length - pendingCount;
  const selectedCandidateSet = new Set(selectedCandidateIds);
  const selectedPendingCandidates = candidates.filter((candidate) => candidate.status === "pending" && selectedCandidateSet.has(candidate.id));
  const visiblePendingCandidates = visibleCandidates.filter((candidate) => candidate.status === "pending");
  const allVisiblePendingSelected = visiblePendingCandidates.length > 0 && visiblePendingCandidates.every((candidate) => selectedCandidateSet.has(candidate.id));
  const selectedCanImport = selectedPendingCandidates.length > 0 && selectedPendingCandidates.every((candidate) => candidate.can_import);

  function toggleCandidate(candidateId: string, checked: boolean) {
    setSelectedCandidateIds((current) => checked ? Array.from(new Set([...current, candidateId])) : current.filter((id) => id !== candidateId));
  }

  function toggleVisibleCandidates(checked: boolean) {
    const visibleIds = new Set(visiblePendingCandidates.map((candidate) => candidate.id));
    setSelectedCandidateIds((current) => checked
      ? Array.from(new Set([...current, ...visibleIds]))
      : current.filter((id) => !visibleIds.has(id)));
  }

  async function decideSelected(action: "import" | "reject") {
    if (busy || selectedPendingCandidates.length === 0 || selectedPendingCandidates.length > 25) return;
    setBusy(`bulk-${action}`); setMessage("");
    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/community-member-candidates`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selectedPendingCandidates.map((candidate) => candidate.id), action }),
      });
      const payload = await response.json() as { message?: string; processed?: number; failed?: number };
      if (!response.ok) throw new Error(payload.message ?? "The selected candidates could not be processed.");
      setMessage(payload.message ?? "Selected candidates processed.");
      setSelectedCandidateIds([]);
      await loadQueue(serverId, setCandidates, setAudit, setMessage, true);
      if (action === "import" && (payload.processed ?? 0) > 0) await onImported();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The selected candidates could not be processed."); }
    finally { setBusy(null); }
  }

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

      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="grid gap-3 lg:grid-cols-[auto_190px_1fr] lg:items-end">
          <div className="grid grid-cols-3 rounded-md border border-white/10 bg-black/20 p-1" aria-label="Candidate status filter">
            <ScopeButton active={candidateScope === "pending"} label="Pending" count={pendingCount} onClick={() => { setCandidateScope("pending"); setCandidateLimit(8); setSelectedCandidateIds([]); }} />
            <ScopeButton active={candidateScope === "complete"} label="Complete" count={completeCount} onClick={() => { setCandidateScope("complete"); setCandidateLimit(8); setSelectedCandidateIds([]); }} />
            <ScopeButton active={candidateScope === "all"} label="All" count={candidates.length} onClick={() => { setCandidateScope("all"); setCandidateLimit(8); setSelectedCandidateIds([]); }} />
          </div>
          <label className="text-[10px] font-black uppercase text-zinc-500">Readiness<select value={readinessFilter} onChange={(event) => { setReadinessFilter(event.target.value as typeof readinessFilter); setCandidateLimit(8); setSelectedCandidateIds([]); }} className="mt-1 min-h-10 w-full rounded-md border border-white/10 bg-[#0a1220] px-3 text-xs font-bold text-zinc-200 outline-none focus:border-cyan-300/50"><option value="all">All readiness</option><option value="ready">Ready</option><option value="blocked">Needs profile</option><option value="no_match">No match</option><option value="complete">Complete</option></select></label>
          <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 focus-within:border-cyan-300/50">
            <Search size={16} className="shrink-0 text-zinc-500" />
            <span className="sr-only">Search candidates</span>
            <input value={filter} onChange={(event) => { setFilter(event.target.value); setCandidateLimit(8); setSelectedCandidateIds([]); }} placeholder="Search name, handle, role or status" className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-zinc-600" />
            <span className="text-xs font-black text-zinc-500">{filteredCandidates.length}</span>
          </label>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {visibleCandidates.length === 0 ? <QueueNotice text="No matching source candidates." /> : visibleCandidates.map((candidate) => (
          <article key={candidate.id} className="rounded-md border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">{candidate.status === "pending" ? <input type="checkbox" checked={selectedCandidateSet.has(candidate.id)} onChange={(event) => toggleCandidate(candidate.id, event.target.checked)} aria-label={`Select ${candidate.matched_username ?? candidate.candidate_username ?? "candidate"}`} className="mt-1 h-4 w-4 shrink-0 accent-cyan-300" /> : null}<div className="min-w-0"><p className="truncate font-black">{candidate.matched_username ?? candidate.candidate_username ?? "Unknown Discord account"}</p><p className="mt-1 text-xs font-bold text-zinc-500">{candidate.candidate_discord_id_masked ?? "ID erased"}{candidate.public_handle ? ` · /${candidate.public_handle}` : ""}{candidate.role_label ? ` · ${candidate.role_label}` : ""}</p></div></div>
              <span className={`rounded px-2 py-1 text-[10px] font-black uppercase ${candidate.status === "pending" ? "bg-amber-300/10 text-amber-200" : candidate.status === "imported" ? "bg-emerald-300/10 text-emerald-200" : "bg-zinc-300/10 text-zinc-400"}`}>{candidate.status.replace("_", " ")}</span>
            </div>
            {candidate.reason ? <p className="mt-2 text-xs font-semibold text-zinc-400">{candidate.reason}</p> : null}
            <div className={`mt-3 rounded border px-3 py-2 ${candidate.readiness.state === "ready" ? "border-emerald-300/20 bg-emerald-300/5" : candidate.readiness.state === "blocked" || candidate.readiness.state === "no_match" ? "border-amber-300/20 bg-amber-300/5" : "border-white/10 bg-white/[0.03]"}`}><p className="text-[10px] font-black uppercase text-zinc-200">{candidate.readiness.label}</p><p className="mt-1 text-xs font-semibold leading-5 text-zinc-400">{candidate.readiness.detail}</p></div>
            {candidate.status === "pending" ? <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3"><button type="button" disabled={busy !== null || !candidate.can_import} onClick={() => void decide(candidate, "import")} className="inline-flex min-h-9 items-center gap-2 rounded border border-emerald-300/25 px-3 text-xs font-black uppercase text-emerald-200 disabled:opacity-40"><Check size={14} /> {candidate.has_existing_member ? "Reconcile existing" : "Import privately"}</button><button type="button" disabled={busy !== null} onClick={() => void decide(candidate, "reject")} className="inline-flex min-h-9 items-center gap-2 rounded border border-red-300/20 px-3 text-xs font-black uppercase text-red-200 disabled:opacity-40"><ShieldX size={14} /> Reject</button></div> : null}
          </article>
        ))}
      </div>
      {visibleCandidates.length < filteredCandidates.length ? <button type="button" onClick={() => setCandidateLimit((value) => value + 8)} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-white/10 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-cyan-100"><ChevronDown size={15} /> Show 8 more candidates</button> : null}
      {visiblePendingCandidates.length > 0 ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-black/20 p-2"><label className="mr-auto inline-flex min-h-9 items-center gap-2 px-2 text-xs font-black uppercase text-zinc-300"><input type="checkbox" checked={allVisiblePendingSelected} onChange={(event) => toggleVisibleCandidates(event.target.checked)} className="h-4 w-4 accent-cyan-300" /> Select visible</label><span className="px-2 text-xs font-black text-zinc-500">{selectedPendingCandidates.length} selected</span><button type="button" disabled={busy !== null || !selectedCanImport || selectedPendingCandidates.length > 25} onClick={() => void decideSelected("import")} className="inline-flex min-h-9 items-center gap-2 rounded border border-emerald-300/25 px-3 text-xs font-black uppercase text-emerald-200 disabled:opacity-40"><Check size={14} /> Import selected</button><button type="button" disabled={busy !== null || selectedPendingCandidates.length === 0 || selectedPendingCandidates.length > 25} onClick={() => void decideSelected("reject")} className="inline-flex min-h-9 items-center gap-2 rounded border border-red-300/20 px-3 text-xs font-black uppercase text-red-200 disabled:opacity-40"><ShieldX size={14} /> Reject selected</button>{selectedPendingCandidates.length > 25 ? <p className="w-full px-2 text-xs font-bold text-amber-200">Choose no more than 25 candidates at once.</p> : null}</div> : null}

      <details className="mt-5 border-t border-white/10 pt-4">
        <summary className="cursor-pointer text-xs font-black uppercase text-zinc-300">Decision history ({audit.length})</summary>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_150px]">
          <label className="flex min-h-10 min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 focus-within:border-cyan-300/50"><Search size={15} className="shrink-0 text-zinc-500" /><span className="sr-only">Search decision history</span><input value={auditQuery} onChange={(event) => { setAuditQuery(event.target.value); setAuditLimit(8); }} placeholder="Search decision history" className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-zinc-600" /></label>
          <label className="text-[10px] font-black uppercase text-zinc-500">Action<select value={auditAction} onChange={(event) => { setAuditAction(event.target.value); setAuditLimit(8); }} className="mt-1 min-h-10 w-full rounded-md border border-white/10 bg-[#0a1220] px-3 text-xs font-bold text-zinc-200 outline-none focus:border-cyan-300/50"><option value="all">All actions</option><option value="candidate_created">Created</option><option value="candidate_imported">Imported</option><option value="candidate_rejected">Rejected</option><option value="candidate_duplicate">Duplicate</option><option value="candidate_no_match">No match</option></select></label>
          <label className="text-[10px] font-black uppercase text-zinc-500">Result<select value={auditResult} onChange={(event) => { setAuditResult(event.target.value); setAuditLimit(8); }} className="mt-1 min-h-10 w-full rounded-md border border-white/10 bg-[#0a1220] px-3 text-xs font-bold text-zinc-200 outline-none focus:border-cyan-300/50"><option value="all">All results</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="skipped">Skipped</option></select></label>
        </div>
        <div className="mt-3 grid gap-2">
          {visibleAudit.length === 0 ? <QueueNotice text="No matching source decisions." /> : visibleAudit.map((item) => <div key={item.id} className="grid gap-2 rounded border border-white/10 bg-black/20 p-3 text-xs sm:grid-cols-[1fr_auto] sm:items-start"><div className="min-w-0"><p className="font-black uppercase text-zinc-200">{item.action.replaceAll("_", " ")}</p><p className="mt-1 font-semibold text-zinc-500">{item.reason ?? "No reason recorded."}</p></div><div className="flex items-center justify-between gap-3 sm:block sm:text-right"><span className="font-bold uppercase text-zinc-400">{item.result_status}</span><time className="block text-[10px] font-bold uppercase text-zinc-600" dateTime={item.created_at}>{formatCompactDate(item.created_at)}</time></div></div>)}
        </div>
        {visibleAudit.length < filteredAudit.length ? <button type="button" onClick={() => setAuditLimit((value) => value + 8)} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-white/10 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-cyan-100"><ChevronDown size={15} /> Show 8 more decisions</button> : null}
      </details>
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

function ScopeButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-9 px-3 text-xs font-black uppercase ${active ? "rounded border border-cyan-300/25 bg-cyan-300/10 text-cyan-100" : "text-zinc-500 hover:text-zinc-200"}`}>{label} <span className="ml-1 text-[10px]">{count}</span></button>;
}

function formatCompactDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function normalizeSearchText(value: string | null | undefined) {
  return value?.trim().toLowerCase().replaceAll("_", " ") ?? "";
}
