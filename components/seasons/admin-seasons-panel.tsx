"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Award, CalendarDays, CheckCircle, Crown, Eye, ListChecks, RefreshCw, ShieldCheck, Trophy } from "lucide-react";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { fetchJsonWithRetry, FetchJsonError } from "@/lib/client-fetch";

type AdminSeasonEntry = {
  id: string;
  seasonId: string;
  serverId: string;
  category: string;
  joinedAt: string;
  status: string;
  score: number | null;
  rank: number | null;
  lastScoreRefreshAt: string | null;
  hasScoreSnapshot: boolean;
};

type AdminSeasonAward = {
  id: string;
  seasonId: string;
  serverId: string;
  awardCode: string;
  rank: number | null;
  awardedAt: string;
  metadata: Record<string, unknown>;
};

type AdminSeason = {
  id: string;
  slug: string;
  name: string;
  category: string;
  status: string;
  startsAt: string;
  endsAt: string;
  entryCount: number;
  scoredEntryCount: number;
  scoreSnapshotCount: number;
  awardsCount: number;
  lastScoreRefreshAt: string | null;
  awardFinaliseStatus: string;
  canRefresh: boolean;
  canFinalise: boolean;
  warnings: string[];
  entries: AdminSeasonEntry[];
  awards: AdminSeasonAward[];
};

type AdminSeasonsResponse = {
  ok?: boolean;
  role?: string;
  seasons?: AdminSeason[];
  activeSeasons?: AdminSeason[];
  upcomingSeasons?: AdminSeason[];
  completedSeasons?: AdminSeason[];
  warnings?: string[];
  message?: string;
};

type RefreshResponse = {
  ok?: boolean;
  entriesRefreshed?: number;
  snapshotsCreated?: number;
  warnings?: string[];
};

type FinaliseResponse = {
  ok?: boolean;
  entriesFinalised?: number;
  awardsCreated?: number;
  badgesAwarded?: number;
  warnings?: string[];
};

type LoadState = "loading" | "loaded" | "error";
type ActionKind = "refresh" | "finalise";

type ActionState = {
  seasonId: string | null;
  kind: ActionKind | null;
  message: string | null;
  error: string | null;
};

const FINALISE_CONFIRMATION = "FINALISE";

export function AdminSeasonsPanel() {
  const [payload, setPayload] = useState<AdminSeasonsResponse>({ seasons: [], activeSeasons: [], upcomingSeasons: [], completedSeasons: [] });
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [expandedSeasonId, setExpandedSeasonId] = useState<string | null>(null);
  const [confirmSeasonId, setConfirmSeasonId] = useState<string | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [action, setAction] = useState<ActionState>({ seasonId: null, kind: null, message: null, error: null });

  useEffect(() => {
    void loadSeasons();
  }, []);

  async function loadSeasons() {
    setState("loading");
    setError("");
    try {
      const data = await fetchJsonWithRetry<AdminSeasonsResponse>("/api/admin/seasons", {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
        timeoutMs: 12_000,
      });
      setPayload(normalizePayload(data));
      setState("loaded");
    } catch (loadError) {
      setError(errorMessage(loadError, "DZN season admin data could not be loaded."));
      setState("error");
    }
  }

  async function refreshSeason(season: AdminSeason) {
    if (!season.canRefresh || action.seasonId) return;
    setAction({ seasonId: season.id, kind: "refresh", message: null, error: null });
    try {
      const result = await requestJson<RefreshResponse>(`/api/admin/seasons/${encodeURIComponent(season.id)}/refresh`, {
        method: "POST",
        body: JSON.stringify({ limit: 10 }),
      });
      setAction({
        seasonId: null,
        kind: null,
        message: `Refreshed ${result.entriesRefreshed ?? 0} entries and created ${result.snapshotsCreated ?? 0} snapshots.`,
        error: warningMessage(result.warnings),
      });
      await loadSeasons();
    } catch (refreshError) {
      setAction({ seasonId: null, kind: null, message: null, error: errorMessage(refreshError, "Score refresh failed.") });
    }
  }

  async function finaliseSeason(season: AdminSeason) {
    if (!season.canFinalise || action.seasonId || confirmationText.trim() !== FINALISE_CONFIRMATION) return;
    setAction({ seasonId: season.id, kind: "finalise", message: null, error: null });
    try {
      const result = await requestJson<FinaliseResponse>(`/api/admin/seasons/${encodeURIComponent(season.id)}/finalise`, {
        method: "POST",
      });
      setConfirmSeasonId(null);
      setConfirmationText("");
      setAction({
        seasonId: null,
        kind: null,
        message: `Finalised ${result.entriesFinalised ?? 0} entries, stored ${result.awardsCreated ?? 0} awards, and awarded ${result.badgesAwarded ?? 0} badges.`,
        error: warningMessage(result.warnings),
      });
      await loadSeasons();
    } catch (finaliseError) {
      setAction({ seasonId: null, kind: null, message: null, error: errorMessage(finaliseError, "Season finalise failed.") });
    }
  }

  const grouped = useMemo(() => groupSeasons(payload), [payload]);
  const totalSeasons = payload.seasons?.length ?? 0;

  return (
    <main className="min-h-screen bg-[#05070d] px-5 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <nav className="flex min-h-20 items-center justify-between gap-4">
          <DznLogo />
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-cyan-300/35 hover:text-white">
              Dashboard
            </Link>
            <Link href="/seasons" className="rounded-lg border border-violet-300/25 bg-violet-400/10 px-3 py-2 text-xs font-black uppercase text-violet-50 transition hover:bg-violet-400/20">
              Public Seasons
            </Link>
          </div>
        </nav>

        <header className="mt-6 rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-xs font-black uppercase text-cyan-50">
                <ShieldCheck className="h-4 w-4" />
                Admin seasons
              </p>
              <h1 className="mt-4 text-3xl font-black uppercase tracking-normal text-white">DZN Season Admin Panel</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">
                Manage season score snapshots, entries, awards, and manual finalisation from protected admin/support tooling.
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadSeasons()}
              disabled={state === "loading" || Boolean(action.seasonId)}
              className="inline-flex w-fit items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${state === "loading" ? "animate-spin" : ""}`} />
              Reload
            </button>
          </div>
        </header>

        {action.message || action.error ? (
          <div className={`mt-5 rounded-lg border px-4 py-3 text-sm font-bold ${action.error ? "border-amber-300/25 bg-amber-400/10 text-amber-50" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"}`}>
            {action.message ?? action.error}
            {action.message && action.error ? <span className="mt-2 block text-amber-100">{action.error}</span> : null}
          </div>
        ) : null}

        {state === "loading" ? <LoadingGrid /> : null}
        {state === "error" ? <AccessPanel message={error} /> : null}
        {state === "loaded" && totalSeasons === 0 ? <EmptyPanel message="No DZN seasons are configured yet." /> : null}
        {state === "loaded" && totalSeasons > 0 ? (
          <div className="mt-6 grid gap-6">
            <SeasonGroup title="Active seasons" seasons={grouped.active} empty="No active seasons." {...groupProps()} />
            <SeasonGroup title="Upcoming seasons" seasons={grouped.upcoming} empty="No upcoming seasons." {...groupProps()} />
            <SeasonGroup title="Completed seasons" seasons={grouped.completed} empty="No completed seasons." {...groupProps()} />
          </div>
        ) : null}
      </div>
    </main>
  );

  function groupProps() {
    return {
      action,
      expandedSeasonId,
      confirmSeasonId,
      confirmationText,
      onToggleEntries: (seasonId: string) => setExpandedSeasonId((current) => current === seasonId ? null : seasonId),
      onPrepareFinalise: (seasonId: string) => {
        setConfirmSeasonId(seasonId);
        setConfirmationText("");
      },
      onCancelFinalise: () => {
        setConfirmSeasonId(null);
        setConfirmationText("");
      },
      onConfirmationTextChange: setConfirmationText,
      onRefresh: refreshSeason,
      onFinalise: finaliseSeason,
    };
  }
}

function SeasonGroup({
  title,
  seasons,
  empty,
  action,
  expandedSeasonId,
  confirmSeasonId,
  confirmationText,
  onToggleEntries,
  onPrepareFinalise,
  onCancelFinalise,
  onConfirmationTextChange,
  onRefresh,
  onFinalise,
}: {
  title: string;
  seasons: AdminSeason[];
  empty: string;
  action: ActionState;
  expandedSeasonId: string | null;
  confirmSeasonId: string | null;
  confirmationText: string;
  onToggleEntries: (seasonId: string) => void;
  onPrepareFinalise: (seasonId: string) => void;
  onCancelFinalise: () => void;
  onConfirmationTextChange: (value: string) => void;
  onRefresh: (season: AdminSeason) => void;
  onFinalise: (season: AdminSeason) => void;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-4 flex items-center gap-3">
        <Trophy className="h-5 w-5 text-violet-200" />
        <h2 className="text-lg font-black uppercase text-white">{title}</h2>
      </div>
      {seasons.length ? (
        <div className="grid gap-4">
          {seasons.map((season) => (
            <SeasonAdminRow
              key={season.id}
              season={season}
              action={action}
              expanded={expandedSeasonId === season.id}
              confirming={confirmSeasonId === season.id}
              confirmationText={confirmationText}
              onToggleEntries={onToggleEntries}
              onPrepareFinalise={onPrepareFinalise}
              onCancelFinalise={onCancelFinalise}
              onConfirmationTextChange={onConfirmationTextChange}
              onRefresh={onRefresh}
              onFinalise={onFinalise}
            />
          ))}
        </div>
      ) : (
        <EmptyPanel message={empty} />
      )}
    </section>
  );
}

function SeasonAdminRow({
  season,
  action,
  expanded,
  confirming,
  confirmationText,
  onToggleEntries,
  onPrepareFinalise,
  onCancelFinalise,
  onConfirmationTextChange,
  onRefresh,
  onFinalise,
}: {
  season: AdminSeason;
  action: ActionState;
  expanded: boolean;
  confirming: boolean;
  confirmationText: string;
  onToggleEntries: (seasonId: string) => void;
  onPrepareFinalise: (seasonId: string) => void;
  onCancelFinalise: () => void;
  onConfirmationTextChange: (value: string) => void;
  onRefresh: (season: AdminSeason) => void;
  onFinalise: (season: AdminSeason) => void;
}) {
  const busy = action.seasonId === season.id;
  const finaliseReady = confirmationText.trim() === FINALISE_CONFIRMATION;
  return (
    <article className="rounded-lg border border-white/10 bg-black/25 p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={statusLabel(season.status)} />
            <CategoryPill category={season.category} />
            <FinaliseStatusPill status={season.awardFinaliseStatus} />
          </div>
          <h3 className="mt-3 text-xl font-black text-white">{season.name}</h3>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Entries" value={`${season.entryCount}`} />
            <Metric label="Scored" value={`${season.scoredEntryCount}`} />
            <Metric label="Awards" value={`${season.awardsCount}`} />
            <Metric label="Last refresh" value={season.lastScoreRefreshAt ? formatDate(season.lastScoreRefreshAt) : "Pending"} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <InfoLine icon={CalendarDays} label="Starts" value={formatDate(season.startsAt)} />
            <InfoLine icon={CalendarDays} label="Ends" value={formatDate(season.endsAt)} />
          </div>
          {season.warnings.length ? (
            <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-400/10 p-3 text-xs font-bold leading-5 text-amber-50">
              {season.warnings.join(" ")}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onRefresh(season)}
              disabled={!season.canRefresh || Boolean(action.seasonId)}
              aria-busy={busy && action.kind === "refresh"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${busy && action.kind === "refresh" ? "animate-spin" : ""}`} />
              Refresh scores
            </button>
            <button
              type="button"
              onClick={() => onToggleEntries(season.id)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-100"
            >
              <ListChecks className="h-4 w-4" />
              View entries
            </button>
            <Link href={`/seasons/${encodeURIComponent(season.slug)}`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-300/25 bg-violet-400/10 px-3 py-2 text-xs font-black uppercase text-violet-50">
              <Eye className="h-4 w-4" />
              View leaderboard
            </Link>
            <button
              type="button"
              onClick={() => onPrepareFinalise(season.id)}
              disabled={!season.canFinalise || Boolean(action.seasonId)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs font-black uppercase text-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Crown className="h-4 w-4" />
              Finalise season
            </button>
          </div>
          {!season.canFinalise ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-bold leading-5 text-zinc-400">
              Finalise is blocked until the season has ended and has scored entries.
            </p>
          ) : null}
          {confirming ? (
            <div className="rounded-lg border border-amber-300/25 bg-amber-400/10 p-3">
              <div className="flex items-start gap-2 text-xs font-bold leading-5 text-amber-50">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Finalise awards permanent seasonal badges. Type FINALISE to confirm.</span>
              </div>
              <input
                value={confirmationText}
                onChange={(event) => onConfirmationTextChange(event.target.value)}
                className="mt-3 w-full rounded-lg border border-amber-300/25 bg-black/40 px-3 py-2 text-sm font-bold text-white outline-none focus:border-amber-200"
                placeholder={FINALISE_CONFIRMATION}
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onFinalise(season)}
                  disabled={!finaliseReady || Boolean(action.seasonId)}
                  aria-busy={busy && action.kind === "finalise"}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-300/30 bg-amber-400/20 px-3 py-2 text-xs font-black uppercase text-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Crown className="h-4 w-4" />
                  Confirm finalise
                </button>
                <button
                  type="button"
                  onClick={onCancelFinalise}
                  disabled={Boolean(action.seasonId)}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-200 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {expanded ? <SeasonInspection season={season} /> : null}
    </article>
  );
}

function SeasonInspection({ season }: { season: AdminSeason }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <p className="flex items-center gap-2 text-xs font-black uppercase text-zinc-300">
          <ListChecks className="h-4 w-4 text-cyan-200" />
          Entries
        </p>
        {season.entries.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  {["Rank", "Server ID", "Score", "Snapshot"].map((header) => (
                    <th key={header} className="px-2 py-2 font-black uppercase">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {season.entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-white/10">
                    <td className="px-2 py-2 font-black text-violet-100">#{entry.rank ?? "-"}</td>
                    <td className="px-2 py-2 font-mono text-zinc-200">{entry.serverId}</td>
                    <td className="px-2 py-2 font-mono text-white">{entry.score ?? "pending"}</td>
                    <td className="px-2 py-2 text-zinc-300">{entry.lastScoreRefreshAt ? formatDate(entry.lastScoreRefreshAt) : "Waiting"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm font-bold text-zinc-400">No entries yet.</p>
        )}
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <p className="flex items-center gap-2 text-xs font-black uppercase text-zinc-300">
          <Award className="h-4 w-4 text-amber-200" />
          Awards stored
        </p>
        {season.awards.length ? (
          <div className="mt-3 grid gap-2">
            {season.awards.map((award) => (
              <div key={award.id} className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-3">
                <p className="text-xs font-black uppercase text-amber-100">Rank #{award.rank ?? "-"} - {award.awardCode.replace(/_/g, " ")}</p>
                <p className="mt-1 font-mono text-xs text-zinc-300">{award.serverId}</p>
                <p className="mt-1 text-xs font-bold text-zinc-400">{formatDate(award.awardedAt)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm font-bold text-zinc-400">No awards stored yet.</p>
        )}
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="mt-6 grid gap-4">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
          <div className="mt-4 h-8 w-72 max-w-full animate-pulse rounded bg-white/10" />
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((metric) => <div key={metric} className="h-16 animate-pulse rounded-lg bg-white/10" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function AccessPanel({ message }: { message: string }) {
  return (
    <div className="mt-6 rounded-lg border border-red-300/20 bg-red-400/10 p-5 text-sm font-bold leading-6 text-red-50">
      {message}
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm font-bold text-zinc-400">
      {message}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-black text-white">{value}</p>
    </div>
  );
}

function InfoLine({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase text-zinc-500">
        <Icon className="h-4 w-4 text-cyan-200" />
        {label}
      </span>
      <span className="text-right text-xs font-bold text-zinc-200">{value}</span>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-100">
      {label}
    </span>
  );
}

function CategoryPill({ category }: { category: string }) {
  return (
    <span className="rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-black uppercase text-cyan-100">
      {categoryLabel(category)}
    </span>
  );
}

function FinaliseStatusPill({ status }: { status: string }) {
  const ready = status === "ready_to_finalise";
  const finalised = status.startsWith("finalised");
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase ${ready ? "border-amber-300/25 bg-amber-400/10 text-amber-100" : finalised ? "border-violet-300/25 bg-violet-400/10 text-violet-100" : "border-white/10 bg-white/[0.04] text-zinc-300"}`}>
      {finalised ? <CheckCircle className="h-3.5 w-3.5" /> : null}
      {statusLabel(status)}
    </span>
  );
}

function normalizePayload(payload: AdminSeasonsResponse): AdminSeasonsResponse {
  const seasons = Array.isArray(payload.seasons) ? payload.seasons : [];
  return {
    ...payload,
    seasons,
    activeSeasons: Array.isArray(payload.activeSeasons) ? payload.activeSeasons : seasons.filter((season) => ["live", "active"].includes(String(season.status).toLowerCase())),
    upcomingSeasons: Array.isArray(payload.upcomingSeasons) ? payload.upcomingSeasons : seasons.filter((season) => ["registration_open", "upcoming"].includes(String(season.status).toLowerCase())),
    completedSeasons: Array.isArray(payload.completedSeasons) ? payload.completedSeasons : seasons.filter((season) => String(season.status).toLowerCase().startsWith("completed") || String(season.status).toLowerCase().startsWith("final")),
  };
}

function groupSeasons(payload: AdminSeasonsResponse) {
  const seasons = payload.seasons ?? [];
  return {
    active: payload.activeSeasons?.length ? payload.activeSeasons : seasons.filter((season) => ["live", "active"].includes(String(season.status).toLowerCase())),
    upcoming: payload.upcomingSeasons?.length ? payload.upcomingSeasons : seasons.filter((season) => ["registration_open", "upcoming"].includes(String(season.status).toLowerCase())),
    completed: payload.completedSeasons?.length ? payload.completedSeasons : seasons.filter((season) => String(season.status).toLowerCase().startsWith("completed") || String(season.status).toLowerCase().startsWith("final")),
  };
}

async function requestJson<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    throw new Error(typeof record.message === "string" ? record.message : `Request failed: ${response.status}`);
  }
  return data as T;
}

function warningMessage(warnings: unknown) {
  return Array.isArray(warnings) && warnings.length ? warnings.map((warning) => String(warning)).join(" ") : null;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof FetchJsonError && error.status === 401) return "Admin season access requires login.";
  if (error instanceof FetchJsonError && error.status === 403) return "Admin season access is limited to admin, support, or dev users.";
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function categoryLabel(category: string) {
  const normalized = String(category).toLowerCase();
  if (normalized === "deathmatch") return "Deathmatch";
  if (normalized === "pvp") return "PvP";
  if (normalized === "pve") return "PvE";
  if (normalized === "survival") return "Survival";
  return category || "Unknown";
}

function statusLabel(value: string) {
  return String(value || "pending").replace(/_/g, " ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
