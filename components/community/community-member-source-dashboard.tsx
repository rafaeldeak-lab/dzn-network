"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  EyeOff,
  History,
  Import,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";

type LoadState = "loading" | "ready" | "unauthorized" | "plan_required" | "forbidden" | "not_configured" | "error";
type CandidateStatus = "pending" | "imported" | "rejected" | "duplicate" | "ambiguous";
type MatchStatus = "pending" | "matched" | "no_match" | "duplicate" | "ambiguous";
type StatusFilter = CandidateStatus | "all";
type ActionKind = "import" | "reject";

type ServerOption = {
  id: string;
  server_name: string;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string;
};

type CandidateItem = {
  id: string;
  linked_server_id: string;
  server_name: string;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string;
  candidate_discord_id_masked: string | null;
  candidate_username: string | null;
  candidate_display_name: string | null;
  role_label: string | null;
  source: string;
  status: CandidateStatus;
  match_status: MatchStatus;
  matched_user_id: string | null;
  matched_username: string | null;
  imported_member_id: string | null;
  existing_member_id: string | null;
  reason: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  public_profile_linkable: boolean;
  public_profile: {
    public_handle: string;
    public_href: string;
    public_api_href: string;
  } | null;
};

type AuditItem = {
  id: string;
  candidate_id: string | null;
  community_member_id: string | null;
  linked_server_id: string;
  server_name: string;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string;
  actor_user_id: string;
  actor_role: "owner" | "admin";
  action: string;
  result_status: string;
  reason: string | null;
  created_at: string | null;
};

type Payload = {
  ok: true;
  role: "owner" | "admin";
  filters: {
    status: StatusFilter;
    linked_server_id: string | null;
  };
  counts: {
    total: number;
    pending: number;
    imported: number;
    rejected: number;
    duplicate: number;
    ambiguous: number;
  };
  servers: ServerOption[];
  candidates: CandidateItem[];
  audit: AuditItem[];
  safeguards: {
    public_profile_link_requires_player_opt_in_handle: boolean;
    trusted_dzn_user_bridge_required: boolean;
    rejects_duplicate_members: boolean;
    rejects_ambiguous_user_bridge: boolean;
    affects_ctf_scoring_rows: boolean;
    affects_owner_workflow_decisions: boolean;
    affects_approval_decisions: boolean;
    affects_bracket_outcomes: boolean;
    affects_billing: boolean;
    affects_rankings: boolean;
    affects_discovery_score: boolean;
    affects_reviews: boolean;
    affects_badges: boolean;
    affects_seasons: boolean;
    affects_server_wars_scoring: boolean;
    affects_xp_awards: boolean;
    affects_calling_card_awards: boolean;
    affects_competitive_eligibility: boolean;
  };
  generated_at: string;
};

type CandidateForm = {
  linkedServerId: string;
  discordId: string;
  dznUserId: string;
  username: string;
  displayName: string;
  roleLabel: string;
  reason: string;
};

const DEFAULT_PRICING_URL = "/pricing?intent=owner_setup&returnTo=%2Fdashboard%2Fcommunity-members";
const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "ambiguous", label: "Ambiguous" },
  { value: "duplicate", label: "Duplicate" },
  { value: "imported", label: "Imported" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const EMPTY_FORM: CandidateForm = {
  linkedServerId: "",
  discordId: "",
  dznUserId: "",
  username: "",
  displayName: "",
  roleLabel: "",
  reason: "",
};

export function CommunityMemberSourceDashboard({ homeHref = "/dashboard", embedded = false }: { homeHref?: string; embedded?: boolean }) {
  const [state, setState] = useState<LoadState>("loading");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [linkedServerFilter, setLinkedServerFilter] = useState("all");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [form, setForm] = useState<CandidateForm>(EMPTY_FORM);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pricingUrl, setPricingUrl] = useState(DEFAULT_PRICING_URL);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ status: statusFilter, limit: "120" });
    if (linkedServerFilter !== "all") params.set("linked_server_id", linkedServerFilter);

    fetch(`/api/owner/community-members?${params.toString()}`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const result = await safeJson(response);
        if (!active) return;
        if (response.status === 401) {
          setState("unauthorized");
          setPayload(null);
          return;
        }
        if (response.status === 402) {
          setPricingUrl(typeof result?.pricing_url === "string" ? result.pricing_url : DEFAULT_PRICING_URL);
          setState("plan_required");
          setPayload(null);
          return;
        }
        if (response.status === 403) {
          setState("forbidden");
          setPayload(null);
          return;
        }
        if (response.status === 503 && result?.error === "COMMUNITY_MEMBER_SOURCE_MANAGEMENT_NOT_CONFIGURED") {
          setState("not_configured");
          setPayload(null);
          return;
        }
        if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Community member source management could not be loaded."));
        const nextPayload = result as Payload;
        setPayload(nextPayload);
        setState("ready");
        setForm((current) => ({
          ...current,
          linkedServerId: current.linkedServerId || nextPayload.servers[0]?.id || "",
        }));
      })
      .catch((error) => {
        if (!active) return;
        setPayload(null);
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Community member source management could not be loaded." });
        setState("error");
      });

    return () => {
      active = false;
    };
  }, [statusFilter, linkedServerFilter, refreshKey]);

  const counts = payload?.counts ?? { total: 0, pending: 0, imported: 0, rejected: 0, duplicate: 0, ambiguous: 0 };
  const candidates = payload?.candidates ?? [];
  const audit = payload?.audit ?? [];
  const servers = payload?.servers ?? [];
  const filteredServerName = linkedServerFilter === "all"
    ? "All linked communities"
    : servers.find((server) => server.id === linkedServerFilter)?.server_name ?? "Selected community";

  async function submitCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("create");
    setMessage({ tone: "info", text: "Saving community member candidate." });
    try {
      const response = await fetch("/api/owner/community-members", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          linked_server_id: form.linkedServerId,
          candidate_discord_id: form.discordId,
          dzn_user_id: form.dznUserId,
          candidate_username: form.username,
          candidate_display_name: form.displayName,
          role_label: form.roleLabel,
          reason: form.reason,
          source: payload?.role === "admin" ? "admin_import" : "owner_import",
        }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Community member candidate could not be saved."));
      setMessage({ tone: "success", text: apiMessage(result, "Community member candidate saved.") });
      setForm((current) => ({ ...EMPTY_FORM, linkedServerId: current.linkedServerId || servers[0]?.id || "" }));
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Community member candidate could not be saved." });
    } finally {
      setBusyAction(null);
    }
  }

  async function runCandidateAction(candidate: CandidateItem, action: ActionKind) {
    const busyKey = `${candidate.id}:${action}`;
    setBusyAction(busyKey);
    setMessage({ tone: "info", text: action === "import" ? "Checking trusted bridge before import." : "Rejecting community member candidate." });
    try {
      const response = await fetch(`/api/owner/community-members/${encodeURIComponent(candidate.id)}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action,
          reason: action === "import" ? "Owner/admin approved unique DZN user bridge." : "Rejected by owner/admin review.",
          role_label: candidate.role_label,
        }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Community member action failed."));
      setMessage({ tone: "success", text: apiMessage(result, action === "import" ? "Community member imported." : "Candidate rejected.") });
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Community member action failed." });
      setRefreshKey((value) => value + 1);
    } finally {
      setBusyAction(null);
    }
  }

  const wrapperClassName = embedded ? "grid gap-5" : "min-h-screen bg-[#02030a] px-4 py-5 text-zinc-100 sm:px-6";
  const contentClassName = embedded ? "grid gap-5" : "mx-auto grid max-w-7xl gap-5";
  const loading = state === "loading";

  const content = (
    <div className={contentClassName}>
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={homeHref} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
            Back to dashboard
          </Link>
          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/24 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 hover:bg-cyan-400/16"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      ) : null}

      <section className="rounded-lg border border-cyan-300/18 bg-[linear-gradient(135deg,rgba(34,211,238,0.08),rgba(139,92,246,0.08)_45%,rgba(0,0,0,0.36))] p-4 shadow-[0_0_36px_rgba(34,211,238,0.08)]">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">
                <ShieldCheck className="h-3.5 w-3.5" />
                Owner/admin source controls
              </span>
              {payload?.role ? (
                <span className="rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">
                  {payload.role}
                </span>
              ) : null}
            </div>
            <h1 className="mt-4 text-2xl font-black uppercase text-white sm:text-3xl">Trusted community member sources</h1>
            <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-zinc-300">
              Candidate Source Queue imports into the presentation-only community_members bridge after Duplicate/ambiguous-user rejection and unique DZN user bridge checks.
            </p>
          </div>
          <div className="grid gap-2 rounded-lg border border-white/10 bg-black/28 p-3 text-xs font-bold text-zinc-400">
            <StatusLine label="public profile opt-in handle" ok={payload?.safeguards.public_profile_link_requires_player_opt_in_handle ?? true} />
            <StatusLine label="CTF scoring rows" ok={!(payload?.safeguards.affects_ctf_scoring_rows ?? false)} />
            <StatusLine label="Billing and rankings" ok={!((payload?.safeguards.affects_billing ?? false) || (payload?.safeguards.affects_rankings ?? false))} />
            <StatusLine label="XP and calling cards" ok={!((payload?.safeguards.affects_xp_awards ?? false) || (payload?.safeguards.affects_calling_card_awards ?? false))} />
          </div>
        </div>
      </section>

      {message ? <MessageBanner tone={message.tone}>{message.text}</MessageBanner> : null}

      {state === "unauthorized" ? <AccessPanel title="Sign in required" body="Log in with Discord before managing community member sources." actionHref="/login?returnTo=%2Fdashboard%2Fcommunity-members" actionLabel="Log in with Discord" /> : null}
      {state === "plan_required" ? <AccessPanel title="Owner access required" body="Community member source controls sit behind the owner entitlement gate." actionHref={pricingUrl} actionLabel="View owner plans" /> : null}
      {state === "forbidden" ? <AccessPanel title="Not available" body="This Discord account cannot manage community member sources for the selected scope." /> : null}
      {state === "not_configured" ? <AccessPanel title="Source tables not configured" body="The additive community member source management migration has not been applied in this environment." /> : null}
      {state === "error" ? <AccessPanel title="Could not load source controls" body={message?.text ?? "Community member source management is temporarily unavailable."} /> : null}

      {state === "ready" || loading ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard label="Total candidates" value={counts.total} loading={loading} tone="cyan" />
            <MetricCard label="Pending review" value={counts.pending} loading={loading} tone="amber" />
            <MetricCard label="Imported bridge" value={counts.imported} loading={loading} tone="emerald" />
            <MetricCard label="Rejected" value={counts.rejected} loading={loading} tone="rose" />
            <MetricCard label="Duplicates" value={counts.duplicate} loading={loading} tone="violet" />
            <MetricCard label="Ambiguous" value={counts.ambiguous} loading={loading} tone="red" />
          </div>

          <section className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
            <form onSubmit={submitCandidate} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center justify-between gap-3">
                <PanelTitle icon={<UserPlus className="h-4 w-4" />} title="Add candidate" />
                <span className="rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">Private</span>
              </div>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                  Linked community
                  <select
                    value={form.linkedServerId}
                    onChange={(event) => setForm((current) => ({ ...current, linkedServerId: event.target.value }))}
                    className="rounded border border-white/10 bg-black/40 px-3 py-3 text-xs font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40"
                  >
                    {servers.length ? servers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {server.server_name} / {server.community_name}
                      </option>
                    )) : <option value="">No linked community found</option>}
                  </select>
                </label>
                <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                  Discord ID
                  <input value={form.discordId} onChange={(event) => setForm((current) => ({ ...current, discordId: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" placeholder="Numeric Discord user ID" />
                </label>
                <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                  DZN user ID
                  <input value={form.dznUserId} onChange={(event) => setForm((current) => ({ ...current, dznUserId: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" placeholder="Optional exact DZN user ID" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                    Username
                    <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                  </label>
                  <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                    Role
                    <input value={form.roleLabel} onChange={(event) => setForm((current) => ({ ...current, roleLabel: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" placeholder="Raid Lead" />
                  </label>
                </div>
                <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                  Display name
                  <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                </label>
                <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                  Audit note
                  <textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} rows={3} className="resize-none rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                </label>
                <button
                  type="submit"
                  disabled={busyAction === "create" || !form.linkedServerId || (!form.discordId.trim() && !form.dznUserId.trim())}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/12 px-4 py-3 text-xs font-black uppercase text-cyan-50 transition hover:bg-cyan-400/18 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <UserPlus className="h-4 w-4" />
                  {busyAction === "create" ? "Saving" : "Save candidate"}
                </button>
              </div>
            </form>

            <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <PanelTitle icon={<Users className="h-4 w-4" />} title="Candidate Source Queue" />
                  <p className="mt-2 text-sm font-bold text-zinc-400">{filteredServerName}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none focus:border-cyan-300/40">
                    {STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <select value={linkedServerFilter} onChange={(event) => setLinkedServerFilter(event.target.value)} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none focus:border-cyan-300/40">
                    <option value="all">All communities</option>
                    {servers.map((server) => <option key={server.id} value={server.id}>{server.server_name}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {loading ? <SkeletonRows /> : null}
                {!loading && !candidates.length ? (
                  <EmptyState icon={<Users className="h-5 w-5" />} title="No candidates in this view" body="Candidate imports and rejections will appear here with their audit history." />
                ) : null}
                {candidates.map((candidate) => (
                  <CandidateCard key={candidate.id} candidate={candidate} busyAction={busyAction} onAction={runCandidateAction} />
                ))}
              </div>
            </section>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PanelTitle icon={<History className="h-4 w-4" />} title="Source audit history" />
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{audit.length} rows</span>
            </div>
            <div className="mt-4 grid gap-2">
              {!loading && !audit.length ? <EmptyState icon={<History className="h-5 w-5" />} title="No audit entries yet" body="Candidate creation, import, duplicate rejection, ambiguous rejection, and manual rejection entries will appear here." /> : null}
              {loading ? <SkeletonRows /> : null}
              {audit.map((item) => (
                <div key={item.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-white">{titleCaseToken(item.action)}</p>
                      <p className="mt-1 text-xs font-bold text-zinc-500">{item.server_name} / {item.community_name}</p>
                    </div>
                    <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${auditTone(item.result_status)}`}>{item.result_status}</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs font-bold text-zinc-500 sm:grid-cols-4">
                    <span>Actor: {item.actor_role}</span>
                    <span>Candidate: {compactId(item.candidate_id)}</span>
                    <span>Bridge: {compactId(item.community_member_id)}</span>
                    <span>{formatDate(item.created_at)}</span>
                  </div>
                  {item.reason ? <p className="mt-3 text-xs leading-5 text-zinc-400">{item.reason}</p> : null}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );

  return <main className={wrapperClassName}>{content}</main>;
}

function CandidateCard({ candidate, busyAction, onAction }: { candidate: CandidateItem; busyAction: string | null; onAction: (candidate: CandidateItem, action: ActionKind) => void }) {
  const canImport = candidate.status === "pending" && candidate.match_status === "matched" && !candidate.existing_member_id;
  const canReject = candidate.status === "pending";
  const importBusy = busyAction === `${candidate.id}:import`;
  const rejectBusy = busyAction === `${candidate.id}:reject`;
  return (
    <article className="rounded-lg border border-white/10 bg-black/28 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={candidate.status} />
            <MatchPill status={candidate.match_status} />
            {candidate.public_profile_linkable ? (
              <span className="rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">Published profile ready</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded border border-zinc-400/16 bg-white/[0.03] px-2 py-1 text-[10px] font-black uppercase text-zinc-400">
                <EyeOff className="h-3 w-3" />
                Hidden until player opt-in
              </span>
            )}
          </div>
          <h2 className="mt-3 truncate text-lg font-black text-white">
            {candidate.candidate_display_name ?? candidate.candidate_username ?? candidate.matched_username ?? "Community member candidate"}
          </h2>
          <p className="mt-1 text-xs font-bold text-zinc-500">{candidate.server_name} / {candidate.community_name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canImport || importBusy}
            onClick={() => onAction(candidate, "import")}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300/24 bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-50 transition hover:bg-emerald-400/16 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Import className="h-3.5 w-3.5" />
            {importBusy ? "Importing" : "Import"}
          </button>
          <button
            type="button"
            disabled={!canReject || rejectBusy}
            onClick={() => onAction(candidate, "reject")}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-300/24 bg-rose-400/10 px-3 py-2 text-[10px] font-black uppercase text-rose-50 transition hover:bg-rose-400/16 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <XCircle className="h-3.5 w-3.5" />
            {rejectBusy ? "Rejecting" : "Reject"}
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-xs font-bold text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
        <span>Discord: {candidate.candidate_discord_id_masked ?? "not stored"}</span>
        <span>DZN user: {compactId(candidate.matched_user_id)}</span>
        <span>Role: {candidate.role_label ?? "Community member"}</span>
        <span>Source: {titleCaseToken(candidate.source)}</span>
      </div>
      {candidate.reason ? <p className="mt-3 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-5 text-zinc-400">{candidate.reason}</p> : null}
      {candidate.public_profile ? (
        <Link href={candidate.public_profile.public_href} className="mt-3 inline-flex items-center gap-2 rounded border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50">
          View public profile
          <ArrowRight className="h-3 w-3" />
        </Link>
      ) : null}
    </article>
  );
}

function StatusPill({ status }: { status: CandidateStatus }) {
  const tone = {
    pending: "border-amber-300/24 bg-amber-400/10 text-amber-100",
    imported: "border-emerald-300/24 bg-emerald-400/10 text-emerald-100",
    rejected: "border-rose-300/24 bg-rose-400/10 text-rose-100",
    duplicate: "border-violet-300/24 bg-violet-400/10 text-violet-100",
    ambiguous: "border-red-300/24 bg-red-400/10 text-red-100",
  }[status];
  return <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${tone}`}>{status}</span>;
}

function MatchPill({ status }: { status: MatchStatus }) {
  const tone = {
    pending: "border-zinc-400/18 bg-white/[0.03] text-zinc-400",
    matched: "border-emerald-300/24 bg-emerald-400/10 text-emerald-100",
    no_match: "border-amber-300/24 bg-amber-400/10 text-amber-100",
    duplicate: "border-violet-300/24 bg-violet-400/10 text-violet-100",
    ambiguous: "border-red-300/24 bg-red-400/10 text-red-100",
  }[status];
  return <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${tone}`}>{status.replace("_", " ")}</span>;
}

function MetricCard({ label, value, loading, tone }: { label: string; value: number; loading: boolean; tone: "cyan" | "amber" | "emerald" | "rose" | "violet" | "red" }) {
  const color = {
    cyan: "border-cyan-300/22 bg-cyan-400/10 text-cyan-100",
    amber: "border-amber-300/22 bg-amber-400/10 text-amber-100",
    emerald: "border-emerald-300/22 bg-emerald-400/10 text-emerald-100",
    rose: "border-rose-300/22 bg-rose-400/10 text-rose-100",
    violet: "border-violet-300/22 bg-violet-400/10 text-violet-100",
    red: "border-red-300/22 bg-red-400/10 text-red-100",
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <p className="text-3xl font-black leading-none">{loading ? "..." : value}</p>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">{label}</p>
    </div>
  );
}

function StatusLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-black/22 px-3 py-2">
      <span>{label}</span>
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-red-300" />}
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">{icon}</span>
      <h2 className="text-sm font-black uppercase text-white">{title}</h2>
    </div>
  );
}

function AccessPanel({ title, body, actionHref, actionLabel }: { title: string; body: string; actionHref?: string; actionLabel?: string }) {
  return (
    <section className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-5">
      <AlertTriangle className="h-6 w-6 text-amber-200" />
      <h2 className="mt-3 text-xl font-black text-white">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-zinc-300">{body}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-200/25 bg-amber-300/10 px-4 py-3 text-xs font-black uppercase text-amber-50">
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </section>
  );
}

function MessageBanner({ tone, children }: { tone: "success" | "error" | "info"; children: ReactNode }) {
  const color = {
    success: "border-emerald-300/20 bg-emerald-400/10 text-emerald-50",
    error: "border-red-300/20 bg-red-400/10 text-red-50",
    info: "border-cyan-300/20 bg-cyan-400/10 text-cyan-50",
  }[tone];
  return <p className={`rounded-lg border px-4 py-3 text-sm font-bold ${color}`}>{children}</p>;
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <div className="text-zinc-400">{icon}</div>
      <h3 className="mt-3 text-sm font-black uppercase text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{body}</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-28 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
      ))}
    </>
  );
}

function auditTone(status: string) {
  if (status === "accepted") return "border-emerald-300/24 bg-emerald-400/10 text-emerald-100";
  if (status === "rejected") return "border-red-300/24 bg-red-400/10 text-red-100";
  if (status === "skipped") return "border-amber-300/24 bg-amber-400/10 text-amber-100";
  return "border-zinc-400/18 bg-white/[0.03] text-zinc-400";
}

function titleCaseToken(value: string | null | undefined) {
  const text = String(value ?? "").replace(/[_-]+/g, " ").trim();
  if (!text) return "Unknown";
  return text.replace(/\b\w/g, (match) => match.toUpperCase());
}

function compactId(value: string | null | undefined) {
  if (!value) return "none";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function apiMessage(value: Record<string, unknown> | null, fallback: string) {
  return typeof value?.message === "string" && value.message.trim() ? value.message : fallback;
}
