"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Filter,
  History,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  User,
  Zap,
} from "lucide-react";

type ProgressionAwardAuditStatus =
  | "finished"
  | "pending"
  | "progressed"
  | "awarded"
  | "duplicate"
  | "skipped"
  | "failed"
  | "all";

type ProgressionAwardAuditRetryFilter = "all" | "available" | "not_available";
type LoadState = "loading" | "ready" | "unauthorized" | "plan_required" | "forbidden" | "error";

type ProgressionAwardAuditItem = {
  id: string;
  user_id: string;
  player_name: string | null;
  challenge_id: string;
  challenge_slug: string | null;
  challenge_title: string | null;
  linked_server_id: string | null;
  server_name: string | null;
  public_slug: string | null;
  source_type: string;
  source_id: string;
  source_table: string | null;
  adapter_key: string | null;
  progress_value: number;
  verification_status: string;
  verified_at: string | null;
  processed_at: string | null;
  result_status: string;
  result_message: string | null;
  attempt_count: number;
  last_attempted_at: string | null;
  retry_count: number;
  last_retried_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  retry_available: boolean;
};

type ProgressionAwardAuditPayload = {
  ok: true;
  role: "owner" | "admin";
  filter: ProgressionAwardAuditStatus;
  filters?: {
    status: ProgressionAwardAuditStatus;
    adapter_key: string | null;
    linked_server_id: string | null;
    retry: ProgressionAwardAuditRetryFilter;
  };
  count: number;
  counts: {
    pending: number;
    progressed: number;
    awarded: number;
    duplicate: number;
    skipped: number;
    failed: number;
    total: number;
  };
  retry: {
    available_failed_rows: number;
    protected_job?: string;
    request_body?: unknown;
  };
  awards: ProgressionAwardAuditItem[];
};

type LinkedServerOption = {
  id: string;
  display_name?: string | null;
  hostname?: string | null;
  server_name?: string | null;
  nitrado_service_name?: string | null;
  public_slug?: string | null;
};

const DEFAULT_PRICING_URL = "/pricing?intent=owner_setup&returnTo=%2Fdashboard%2Fprogression-awards";

const STATUS_FILTERS: Array<{ value: ProgressionAwardAuditStatus; label: string }> = [
  { value: "finished", label: "Finished" },
  { value: "failed", label: "Failed" },
  { value: "awarded", label: "Awarded" },
  { value: "skipped", label: "Skipped" },
  { value: "duplicate", label: "Duplicate" },
  { value: "progressed", label: "Progressed" },
  { value: "pending", label: "Pending" },
  { value: "all", label: "All" },
];

const RETRY_FILTERS: Array<{ value: ProgressionAwardAuditRetryFilter; label: string }> = [
  { value: "all", label: "All retry states" },
  { value: "available", label: "Needs protected retry" },
  { value: "not_available", label: "No retry needed" },
];

const KNOWN_ADAPTERS: Array<{ value: string; label: string; detail: string }> = [
  { value: "adm_player_event", label: "ADM player activity", detail: "Player join/activity imports" },
  { value: "adm_kill_event", label: "ADM combat activity", detail: "Verified kill-event imports" },
  { value: "event_entry", label: "Event participation", detail: "Completed server event entries" },
  { value: "approved_review", label: "Approved reviews", detail: "Approved community review activity" },
];

export function ProgressionAwardAuditDashboard({
  homeHref = "/dashboard",
  embedded = false,
  linkedServers = [],
  selectedLinkedServerId = null,
}: {
  homeHref?: string;
  embedded?: boolean;
  linkedServers?: LinkedServerOption[];
  selectedLinkedServerId?: string | null;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [statusFilter, setStatusFilter] = useState<ProgressionAwardAuditStatus>("finished");
  const [adapterFilter, setAdapterFilter] = useState("all");
  const [linkedServerFilter, setLinkedServerFilter] = useState(selectedLinkedServerId ?? "all");
  const [retryFilter, setRetryFilter] = useState<ProgressionAwardAuditRetryFilter>("all");
  const [payload, setPayload] = useState<ProgressionAwardAuditPayload | null>(null);
  const [message, setMessage] = useState("");
  const [pricingUrl, setPricingUrl] = useState(DEFAULT_PRICING_URL);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const params = new URLSearchParams({
      status: statusFilter,
      limit: "80",
    });
    if (adapterFilter !== "all") params.set("adapter_key", adapterFilter);
    if (linkedServerFilter !== "all") params.set("linked_server_id", linkedServerFilter);
    if (retryFilter !== "all") params.set("retry", retryFilter);

    fetch(`/api/owner/progression/award-audit?${params.toString()}`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const result = await safeJson(response);
        if (!active) return;
        if (response.status === 401) {
          setPayload(null);
          setState("unauthorized");
          return;
        }
        if (response.status === 402) {
          setPricingUrl(typeof result?.pricing_url === "string" ? result.pricing_url : DEFAULT_PRICING_URL);
          setPayload(null);
          setState("plan_required");
          return;
        }
        if (response.status === 403) {
          setPayload(null);
          setState("forbidden");
          return;
        }
        if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Progression award audit history could not be loaded."));
        setPayload(result as unknown as ProgressionAwardAuditPayload);
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        setPayload(null);
        setMessage(error instanceof Error ? error.message : "Progression award audit history could not be loaded.");
        setState("error");
      });

    return () => {
      active = false;
    };
  }, [statusFilter, adapterFilter, linkedServerFilter, retryFilter, refreshKey]);

  const adapterOptions = useMemo(() => {
    const options = new Map(KNOWN_ADAPTERS.map((adapter) => [adapter.value, adapter]));
    for (const award of payload?.awards ?? []) {
      if (award.adapter_key && !options.has(award.adapter_key)) {
        options.set(award.adapter_key, {
          value: award.adapter_key,
          label: titleCaseToken(award.adapter_key),
          detail: "Verified progression adapter",
        });
      }
    }
    return Array.from(options.values());
  }, [payload]);

  const linkedServerOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: string; detail: string }>();
    for (const server of linkedServers) {
      options.set(server.id, {
        value: server.id,
        label: displayLinkedServerName(server),
        detail: server.public_slug ? `/servers/profile?slug=${server.public_slug}` : "Linked server",
      });
    }
    for (const award of payload?.awards ?? []) {
      if (award.linked_server_id) {
        options.set(award.linked_server_id, {
          value: award.linked_server_id,
          label: award.server_name ?? `Linked server ${compactId(award.linked_server_id)}`,
          detail: award.public_slug ? `/servers/profile?slug=${award.public_slug}` : "Linked server",
        });
      } else if (payload?.role === "admin") {
        options.set("__global__", {
          value: "__global__",
          label: "Global DZN sources",
          detail: "Admin-only unscoped source facts",
        });
      }
    }
    return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [linkedServers, payload]);

  const counts = payload?.counts ?? {
    pending: 0,
    progressed: 0,
    awarded: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    total: 0,
  };
  const awards = payload?.awards ?? [];
  const loading = state === "loading";
  const wrapperClassName = embedded
    ? "grid gap-5"
    : "min-h-screen bg-[#02030a] px-4 py-5 text-zinc-100 sm:px-6";
  const contentClassName = embedded ? "grid gap-5" : "mx-auto grid max-w-7xl gap-5";

  const content = (
    <div className={contentClassName}>
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={homeHref} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
            Back
          </Link>
          <Link href="/events/challenges" className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black uppercase text-cyan-50">
            Player challenges
          </Link>
        </div>
      ) : null}

      <section className="rounded-lg border border-white/10 bg-black/45 p-4 shadow-[0_0_40px_rgba(34,211,238,0.08)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <PanelHeader icon={<History className="h-5 w-5" />} title="Progression award audit" />
            <h1 className="mt-3 text-2xl font-black uppercase text-white md:text-3xl">Verified source history</h1>
            <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-zinc-300">
              Owner/admin visibility for trusted award-source rows. This dashboard can inspect source status, adapter provenance, retry metadata, and linked-server scope, but it cannot retry jobs or grant progression from the browser.
            </p>
            <p className="mt-2 max-w-4xl text-xs font-bold leading-5 text-zinc-500">
              Progression remains player-side only and does not affect live payments, rankings, discovery score, reviews, badges, seasons, events, Server Wars scoring, or competitive eligibility.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
            <button
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/50 hover:bg-cyan-300/18"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            {embedded ? (
              <Link href="/dashboard/progression-awards" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-violet-300/30 bg-violet-400/10 px-4 py-3 text-xs font-black uppercase text-violet-50">
                Full audit page
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <AuditMetric label="Total" value={counts.total} tone="zinc" loading={loading} />
          <AuditMetric label="Awarded" value={counts.awarded} tone="emerald" loading={loading} />
          <AuditMetric label="Progressed" value={counts.progressed} tone="cyan" loading={loading} />
          <AuditMetric label="Skipped" value={counts.skipped} tone="violet" loading={loading} />
          <AuditMetric label="Failed" value={counts.failed} tone="red" loading={loading} />
          <AuditMetric label="Retry available" value={payload?.retry.available_failed_rows ?? counts.failed} tone="amber" loading={loading} />
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PanelHeader icon={<Filter className="h-5 w-5" />} title="Audit filters" />
          <span className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">
            {payload?.role === "admin" ? "Admin global view" : "Owner private view"}
          </span>
        </div>
        <p className="mt-3 text-xs font-bold leading-5 text-zinc-500">
          Use status, adapter, linked-server, and retry-state filters to inspect verified progression rows without changing awards.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <AuditSelect label="Status" value={statusFilter} onChange={(value) => setStatusFilter(value as ProgressionAwardAuditStatus)}>
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>{filter.label}</option>
            ))}
          </AuditSelect>
          <AuditSelect label="Adapter" value={adapterFilter} onChange={setAdapterFilter}>
            <option value="all">All adapters</option>
            {adapterOptions.map((adapter) => (
              <option key={adapter.value} value={adapter.value}>{adapter.label}</option>
            ))}
          </AuditSelect>
          <AuditSelect label="Linked server" value={linkedServerFilter} onChange={setLinkedServerFilter}>
            <option value="all">All accessible servers</option>
            {linkedServerOptions.map((server) => (
              <option key={server.value} value={server.value}>{server.label}</option>
            ))}
          </AuditSelect>
          <AuditSelect label="Retry" value={retryFilter} onChange={(value) => setRetryFilter(value as ProgressionAwardAuditRetryFilter)}>
            {RETRY_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>{filter.label}</option>
            ))}
          </AuditSelect>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <AuditInfo icon={<ShieldCheck className="h-4 w-4" />} label="Private scope" value={payload?.role === "admin" ? "DZN admin can inspect global source facts." : "Owners can inspect only their own linked-server facts."} />
          <AuditInfo icon={<RotateCcw className="h-4 w-4" />} label="Retry boundary" value="Retry stays cron-secret-only; this dashboard never calls the award job." />
          <AuditInfo icon={<DatabaseZap className="h-4 w-4" />} label="Source proof" value="Rows are verified source records, not self-submitted player rewards." />
        </div>
      </section>

      {message ? <MessagePanel tone="error">{message}</MessagePanel> : null}
      {state === "unauthorized" ? <AccessPanel title="Sign in required" body="Log in with Discord before opening progression award audit history." actionHref="/login?returnTo=%2Fdashboard%2Fprogression-awards" actionLabel="Sign in with Discord" /> : null}
      {state === "plan_required" ? <AccessPanel title="Owner plan required" body="Award-source audit history is an owner server-management surface. Choose Starter or Pro before using owner tools." actionHref={pricingUrl} actionLabel="Open pricing" /> : null}
      {state === "forbidden" ? <AccessPanel title="Access denied" body="This session cannot view progression award audit rows for that scope." /> : null}
      {state === "error" ? <AccessPanel title="Audit unavailable" body="Progression award audit history could not be loaded right now." /> : null}
      {state === "loading" ? <LoadingPanel /> : null}

      {state === "ready" ? (
        <section className="grid gap-3">
          {awards.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-black/28 p-8 text-center">
              <DatabaseZap className="mx-auto h-9 w-9 text-cyan-200" />
              <h2 className="mt-3 text-xl font-black uppercase text-white">No award sources match</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-zinc-500">Try a wider status, adapter, retry, or linked-server filter.</p>
            </div>
          ) : null}
          {awards.map((award) => (
            <AwardAuditCard key={award.id} award={award} />
          ))}
        </section>
      ) : null}
    </div>
  );

  if (embedded) return content;

  return (
    <main className={wrapperClassName}>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(139,92,246,0.16),transparent_32%),radial-gradient(circle_at_82%_12%,rgba(34,211,238,0.13),transparent_30%),linear-gradient(180deg,rgba(2,3,10,0),#02030a_78%)]" />
      <div className="relative z-10">{content}</div>
    </main>
  );
}

function AwardAuditCard({ award }: { award: ProgressionAwardAuditItem }) {
  const status = normalizeStatus(award.result_status);
  const tone = statusTone(status);
  const adapter = adapterLabel(award.adapter_key);
  const sourceLabel = [award.source_table, award.source_type].filter(Boolean).join(" / ") || "Verified source";
  const processedLabel = award.processed_at ? formatDate(award.processed_at) : "Not processed";
  const verifiedLabel = award.verified_at ? formatDate(award.verified_at) : "Not recorded";
  const retryLabel = award.retry_available ? "Protected retry available" : "No retry needed";

  return (
    <article className={`rounded-lg border bg-black/36 p-4 ${tone.border}`}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${award.retry_available ? "border-amber-300/30 bg-amber-400/10 text-amber-100" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"}`}>
              {retryLabel}
            </span>
            <span className="rounded-md border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">
              {adapter}
            </span>
          </div>
          <h2 className="mt-3 text-lg font-black uppercase leading-6 text-white">
            {award.challenge_title ?? titleCaseToken(award.challenge_slug ?? award.challenge_id)}
          </h2>
          <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">
            {award.result_message ?? "Verified source processed through the authoritative progression award pipeline."}
          </p>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <MiniInfo icon={<User className="h-3.5 w-3.5" />} label="Player" value={award.player_name ?? compactId(award.user_id)} />
            <MiniInfo icon={<Server className="h-3.5 w-3.5" />} label="Linked Server" value={award.server_name ?? (award.linked_server_id ? compactId(award.linked_server_id) : "Global source")} />
            <MiniInfo icon={<Activity className="h-3.5 w-3.5" />} label="Progress" value={String(award.progress_value)} />
            <MiniInfo icon={<DatabaseZap className="h-3.5 w-3.5" />} label="Source" value={sourceLabel} />
          </div>
        </div>
        <div className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.035] p-3">
          <MiniInfo icon={<Clock3 className="h-3.5 w-3.5" />} label="Verified" value={verifiedLabel} />
          <MiniInfo icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Processed" value={processedLabel} />
          <MiniInfo icon={<Zap className="h-3.5 w-3.5" />} label="Attempts" value={String(award.attempt_count)} />
          <MiniInfo icon={<RotateCcw className="h-3.5 w-3.5" />} label="Retries" value={`${award.retry_count}${award.last_retried_at ? `, last ${formatDate(award.last_retried_at)}` : ""}`} />
          {award.public_slug ? (
            <Link href={`/servers/profile?slug=${encodeURIComponent(award.public_slug)}`} className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50">
              Public server
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function AuditSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="grid gap-1 rounded-lg border border-white/10 bg-black/28 px-3 py-2">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-9 appearance-none bg-transparent text-sm font-black text-white outline-none"
      >
        {children}
      </select>
    </label>
  );
}

function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">{icon}</span>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100">{title}</p>
    </div>
  );
}

function AuditMetric({ label, value, tone, loading }: { label: string; value: number; tone: "zinc" | "emerald" | "cyan" | "violet" | "red" | "amber"; loading: boolean }) {
  const className = {
    zinc: "border-white/10 bg-white/[0.035] text-zinc-100",
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
    violet: "border-violet-300/25 bg-violet-400/10 text-violet-100",
    red: "border-red-300/25 bg-red-400/10 text-red-100",
    amber: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${className}`}>
      <p className="text-3xl font-black leading-none">{loading ? "..." : formatCount(value)}</p>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">{label}</p>
    </div>
  );
}

function AuditInfo({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-3">
      <div className="flex items-center gap-2 text-cyan-100">
        {icon}
        <p className="text-[10px] font-black uppercase tracking-[0.16em]">{label}</p>
      </div>
      <p className="mt-2 text-xs font-bold leading-5 text-zinc-400">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status);
  const icon = status === "failed" ? <AlertTriangle className="h-3.5 w-3.5" /> : status === "awarded" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-black uppercase ${tone.badge}`}>
      {icon}
      {titleCaseToken(status)}
    </span>
  );
}

function MiniInfo({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/24 px-3 py-2">
      <div className="flex items-center gap-1.5 text-zinc-500">
        {icon}
        <p className="truncate text-[10px] font-black uppercase tracking-[0.14em]">{label}</p>
      </div>
      <p className="mt-1 truncate text-sm font-black text-white" title={value}>{value}</p>
    </div>
  );
}

function MessagePanel({ tone, children }: { tone: "error"; children: ReactNode }) {
  const className = tone === "error" ? "border-red-300/20 bg-red-400/10 text-red-50" : "border-white/10 bg-white/[0.04] text-zinc-100";
  return <p className={`rounded-lg border px-3 py-3 text-sm font-bold leading-6 ${className}`}>{children}</p>;
}

function AccessPanel({ title, body, actionHref, actionLabel }: { title: string; body: string; actionHref?: string; actionLabel?: string }) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/40 p-8 text-center">
      <ShieldCheck className="mx-auto h-10 w-10 text-cyan-200" />
      <h2 className="mt-4 text-2xl font-black uppercase text-white">{title}</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm font-bold leading-6 text-zinc-400">{body}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-xs font-black uppercase text-cyan-50">
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </section>
  );
}

function LoadingPanel() {
  return (
    <section className="grid gap-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-36 animate-pulse rounded-lg border border-white/10 bg-white/[0.035]" />
      ))}
    </section>
  );
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function apiMessage(payload: Record<string, unknown> | null, fallback: string) {
  return typeof payload?.message === "string" && payload.message.trim() ? payload.message : fallback;
}

function displayLinkedServerName(server: LinkedServerOption) {
  return server.display_name ?? server.hostname ?? server.server_name ?? server.nitrado_service_name ?? `Linked server ${compactId(server.id)}`;
}

function adapterLabel(value: string | null) {
  return KNOWN_ADAPTERS.find((adapter) => adapter.value === value)?.label ?? titleCaseToken(value ?? "unknown_adapter");
}

function titleCaseToken(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Unknown";
}

function compactId(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function formatCount(value: number) {
  return Number.isFinite(value) ? String(Math.max(0, Math.trunc(value))) : "0";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeStatus(value: string) {
  return value.trim().toLowerCase() || "unknown";
}

function statusTone(status: string) {
  if (status === "awarded") {
    return {
      border: "border-emerald-300/28",
      badge: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
    };
  }
  if (status === "failed") {
    return {
      border: "border-red-300/30",
      badge: "border-red-300/30 bg-red-400/10 text-red-100",
    };
  }
  if (status === "skipped" || status === "duplicate") {
    return {
      border: "border-violet-300/24",
      badge: "border-violet-300/30 bg-violet-400/10 text-violet-100",
    };
  }
  if (status === "progressed") {
    return {
      border: "border-cyan-300/28",
      badge: "border-cyan-300/30 bg-cyan-400/10 text-cyan-100",
    };
  }
  return {
    border: "border-white/10",
    badge: "border-zinc-300/20 bg-zinc-400/10 text-zinc-100",
  };
}
