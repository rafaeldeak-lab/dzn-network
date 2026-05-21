"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Crosshair,
  Flag,
  Gauge,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trophy,
  UserPlus,
} from "lucide-react";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { fetchJsonWithRetry } from "@/lib/client-fetch";

type TournamentPhase = "PRE_WAR_ROSTER" | "WAR_PREP_CONFIG" | "BATTLE_ACTIVE" | "CONCLUDED";
type TargetMetric = "KILLS" | "BUILDING";

type TournamentServer = {
  id: string;
  public_slug: string | null;
  server_name: string;
  server_type: string;
  platform: string | null;
  map_name: string | null;
  dynamic_visibility_score: number;
};

type TournamentSubscription = {
  plan_key: string;
  status: string;
  can_use_cross_server_matching: boolean;
  required_plans: string[];
};

type Tournament = {
  id: string;
  tournament_name: string;
  current_phase: TournamentPhase;
  phase_ends_at: string;
  target_metric: TargetMetric;
  target_flag_points: number;
  broadcast_interval_minutes: number;
  grace_period_config: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
};

type Participant = {
  ctf_tournament_id: string;
  linked_server_id: string;
  server_name: string;
  public_slug: string | null;
  server_type: string;
  platform: string | null;
  map_name: string | null;
  accumulated_points: number;
  target_points: number;
  progress_percent: number;
  has_raised_flag: boolean;
  roster_count: number;
  last_broadcasted_at: string | null;
  updated_at: string | null;
  dynamic_visibility_score: number;
  status_marker: TournamentPhase;
};

type RosterEntry = {
  linked_server_id: string;
  server_name: string;
  player_id: string;
  player_name: string;
  registered_at: string | null;
};

type VerifiedFeedEvent = {
  id: string;
  linked_server_id: string;
  server_name: string;
  event_hash: string;
  event_type: string;
  player_id: string | null;
  player_name: string | null;
  point_delta: number;
  accepted: boolean;
  rejected_reason: string | null;
  created_at: string | null;
};

type CompletedMatch = Tournament & {
  participants: Participant[];
  winner: Participant | null;
};

type TournamentDashboardData = {
  server: TournamentServer;
  subscription: TournamentSubscription;
  active_tournament: Tournament | null;
  participants: Participant[];
  roster: RosterEntry[];
  verified_feed: VerifiedFeedEvent[];
  completed_matches: CompletedMatch[];
  safeguards: {
    aggregate_source: string;
    roster_source: string;
    feed_source: string;
    parser_dropout_protected: boolean;
  };
};

type TournamentDashboardResponse = {
  ok: boolean;
  generated_at: string;
  source: string;
  data: TournamentDashboardData;
  message?: string;
};

type LoadState = "loading_initial" | "loaded" | "refreshing" | "refresh_failed" | "error_initial";

type RegistrationResult = {
  ok: boolean;
  registered_at: string;
  roster_count: number;
  player: {
    player_id: string;
    player_name: string;
  };
};

const LAST_GOOD_PREFIX = "dzn:lastGoodTournamentDashboard:";
const LAST_GOOD_MAX_AGE_MS = 10 * 60 * 1000;

export function TournamentDashboard() {
  const searchParams = useSearchParams();
  const serverId = searchParams.get("server")?.trim() ?? "";
  const [data, setData] = useState<TournamentDashboardData | null>(() => loadLastGood(serverId));
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(() => (serverId && loadLastGood(serverId) ? "loaded" : "loading_initial"));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerId, setPlayerId] = useState("");
  const inFlight = useRef(false);
  const latestRequestId = useRef(0);
  const dataRef = useRef<TournamentDashboardData | null>(data);
  const visibleData = data?.server.id === serverId ? data : null;

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const loadDashboard = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (!serverId || inFlight.current) return;
    inFlight.current = true;
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    const cached = loadLastGood(serverId);
    const currentData = dataRef.current?.server.id === serverId ? dataRef.current : null;
    const hasVisibleData = Boolean(currentData || cached);
    setLoadState(mode === "initial" && !hasVisibleData ? "loading_initial" : "refreshing");
    if (cached && !currentData) setData(cached);

    try {
      const response = await fetchJsonWithRetry<TournamentDashboardResponse>(`/api/servers/${encodeURIComponent(serverId)}/ctf/dashboard`, {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
        timeoutMs: 15_000,
      });
      if (latestRequestId.current !== requestId) return;
      if (!response.ok || !response.data) throw new Error(response.message ?? "Tournament dashboard could not be loaded.");
      setData(response.data);
      setGeneratedAt(response.generated_at);
      saveLastGood(serverId, response.data);
      setError("");
      setLoadState("loaded");
    } catch (loadError) {
      const cachedAfterFailure = loadLastGood(serverId);
      if (cachedAfterFailure) {
        setData(cachedAfterFailure);
        setError("Live tournament refresh failed. Showing last known event data.");
        setLoadState("refresh_failed");
      } else if (hasVisibleData) {
        setError("Live tournament refresh failed. Showing current on-screen data.");
        setLoadState("refresh_failed");
      } else {
        setError(loadError instanceof Error ? loadError.message : "Tournament dashboard could not be loaded.");
        setLoadState("error_initial");
      }
    } finally {
      inFlight.current = false;
    }
  }, [serverId]);

  useEffect(() => {
    if (serverId) void loadDashboard("initial");
  }, [serverId, loadDashboard]);

  const activeTournament = visibleData?.active_tournament ?? null;
  const ownParticipant = useMemo(() => visibleData?.participants.find((item) => item.linked_server_id === serverId) ?? null, [visibleData?.participants, serverId]);
  const canRegister = Boolean(activeTournament && ownParticipant);

  const onRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!serverId || !activeTournament || submitting) return;
    setSubmitting(true);
    setSubmitMessage("");
    try {
      const result = await fetchJsonWithRetry<RegistrationResult>(`/api/servers/${encodeURIComponent(serverId)}/ctf/roster`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tournament_id: activeTournament.id,
          player_name: playerName,
          player_id: playerId,
        }),
      });
      setSubmitMessage(`Registered ${result.player.player_name}. Roster now has ${result.roster_count} verified players.`);
      setPlayerName("");
      setPlayerId("");
      await loadDashboard("refresh");
    } catch (registerError) {
      setSubmitMessage(registerError instanceof Error ? registerError.message : "Roster registration failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!serverId) {
    return (
      <TournamentShell>
        <EmptyNotice title="No Server Selected" detail="Open this page from a connected dashboard server so DZN can load the event aggregate for that community." />
      </TournamentShell>
    );
  }

  if (!data && loadState === "error_initial") {
    return (
      <TournamentShell>
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-6">
          <div className="flex items-center gap-3 text-red-100">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-xl font-semibold">Tournament View Unavailable</h1>
          </div>
          <p className="mt-3 text-sm text-red-100/80">{error}</p>
          <button
            type="button"
            onClick={() => void loadDashboard("initial")}
            className="mt-5 inline-flex items-center gap-2 rounded border border-red-200/30 bg-red-100/10 px-4 py-2 text-sm font-semibold text-red-50 hover:bg-red-100/20"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </TournamentShell>
    );
  }

  return (
    <TournamentShell>
      <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/dashboard" className="mb-4 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
              Event Command
            </span>
            {loadState === "refreshing" ? <StatusChip label="Refreshing cached aggregate" tone="cyan" icon={Loader2} spin /> : null}
            {loadState === "refresh_failed" ? <StatusChip label="Showing last known data" tone="amber" icon={AlertTriangle} /> : null}
          </div>
          <h1 className="mt-4 text-3xl font-black uppercase text-white sm:text-4xl">Event & Tournament View</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            Stable CTF tournament aggregates, locked rosters, verified scoring actions, and completed match records for {visibleData?.server.server_name ?? "this server"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
          <button
            type="button"
            onClick={() => void loadDashboard("refresh")}
            disabled={loadState === "refreshing"}
            className="inline-flex items-center gap-2 rounded border border-white/15 bg-white/5 px-4 py-2 font-semibold text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loadState === "refreshing" ? "animate-spin" : ""}`} />
            Refresh View
          </button>
          <span>{generatedAt ? `Updated ${formatDate(generatedAt)}` : "Awaiting fresh aggregate"}</span>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      ) : null}

      {visibleData && !visibleData.subscription.can_use_cross_server_matching ? <UpgradeAlert subscription={visibleData.subscription} /> : null}

      {visibleData && activeTournament ? (
        <VersusGrid tournament={activeTournament} participants={visibleData.participants} selectedServerId={serverId} />
      ) : (
        <EmptyNotice title="No Active Tournament" detail="DZN did not find a PRE_WAR_ROSTER or BATTLE_ACTIVE tournament for this server in the cached tournament aggregate." />
      )}

      {visibleData ? (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <RosterRegistration
            tournament={activeTournament}
            serverId={serverId}
            canRegister={canRegister}
            playerName={playerName}
            playerId={playerId}
            submitMessage={submitMessage}
            submitting={submitting}
            onPlayerNameChange={setPlayerName}
            onPlayerIdChange={setPlayerId}
            onRegister={onRegister}
          />
          <VerifiedActionFeed events={visibleData.verified_feed} />
        </div>
      ) : (
        <LoadingGrid />
      )}

      {visibleData ? <CompletedMatchHistory matches={visibleData.completed_matches} /> : null}

      {visibleData ? (
        <details className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-400">
          <summary className="cursor-pointer font-semibold text-zinc-200">Cached aggregate safeguards</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <span>Aggregate source: {visibleData.safeguards.aggregate_source}</span>
            <span>Roster source: {visibleData.safeguards.roster_source}</span>
            <span>Feed source: {visibleData.safeguards.feed_source}</span>
            <span>Parser dropout protected: {visibleData.safeguards.parser_dropout_protected ? "yes" : "no"}</span>
          </div>
        </details>
      ) : null}
    </TournamentShell>
  );
}

function TournamentShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen overflow-hidden bg-[#03050d] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(244,63,94,0.12),transparent_35%)]" />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <DznLogo className="h-10 w-auto" />
        {children}
      </div>
    </main>
  );
}

function VersusGrid({ tournament, participants, selectedServerId }: { tournament: Tournament; participants: Participant[]; selectedServerId: string }) {
  const ordered = orderParticipants(participants, selectedServerId);
  const left = ordered[0] ?? null;
  const right = ordered[1] ?? null;

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4 shadow-2xl shadow-black/30">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black uppercase text-white">{tournament.tournament_name}</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Target: {tournament.target_flag_points.toLocaleString()} {tournament.target_metric === "KILLS" ? "kill velocity points" : "building points"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip label={tournament.current_phase} tone={tournament.current_phase === "BATTLE_ACTIVE" ? "green" : "amber"} icon={Flag} />
          <StatusChip label={tournament.target_metric} tone="cyan" icon={Crosshair} />
          <StatusChip label={`Ends ${formatDate(tournament.phase_ends_at)}`} tone="zinc" icon={Clock3} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
        <LiveAggregateProgress participant={left} side="left" />
        <div className="flex items-center justify-center">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-white/15 bg-black/40 text-lg font-black text-zinc-200">VS</div>
        </div>
        <LiveAggregateProgress participant={right} side="right" />
      </div>
    </section>
  );
}

function LiveAggregateProgress({ participant, side }: { participant: Participant | null; side: "left" | "right" }) {
  if (!participant) {
    return (
      <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-5">
        <p className="text-sm font-semibold text-zinc-300">Waiting for matched community</p>
        <p className="mt-2 text-sm text-zinc-500">A second participant will appear once matchmaking locks the event pairing.</p>
      </div>
    );
  }
  const accent = side === "left" ? "from-cyan-400 to-blue-500" : "from-rose-400 to-orange-400";
  const progress = clampProgress(participant.progress_percent);
  return (
    <article className="rounded-lg border border-white/10 bg-black/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-black text-white">{participant.server_name}</h3>
          <p className="mt-1 text-sm text-zinc-400">
            {[participant.platform, participant.server_type, participant.map_name].filter(Boolean).join(" / ") || "Server profile awaiting data"}
          </p>
        </div>
        {participant.has_raised_flag ? <StatusChip label="Flag raised" tone="green" icon={Trophy} /> : <StatusChip label={participant.status_marker} tone="zinc" icon={ShieldCheck} />}
      </div>
      <div className="mt-6">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-black text-white">{participant.accumulated_points.toLocaleString()}</p>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Current points</p>
          </div>
          <p className="text-sm font-semibold text-zinc-300">{progress.toFixed(1)}%</p>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full bg-gradient-to-r ${accent}`} style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
          <span>{participant.target_points.toLocaleString()} point target</span>
          <span>/</span>
          <span>{participant.roster_count} verified roster players</span>
          <span>/</span>
          <span>Visibility {participant.dynamic_visibility_score}</span>
        </div>
      </div>
    </article>
  );
}

function RosterRegistration(props: {
  tournament: Tournament | null;
  serverId: string;
  canRegister: boolean;
  playerName: string;
  playerId: string;
  submitMessage: string;
  submitting: boolean;
  onPlayerNameChange: (value: string) => void;
  onPlayerIdChange: (value: string) => void;
  onRegister: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section role="dialog" aria-modal="false" aria-labelledby="roster-registration-title" className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="roster-registration-title" className="flex items-center gap-2 text-lg font-black uppercase text-white">
            <UserPlus className="h-5 w-5 text-cyan-200" />
            Roster Registration
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Register exact, case-sensitive DayZ gamertags against the locked roster ledger before battle scoring starts.
          </p>
        </div>
        <StatusChip label={props.tournament?.current_phase ?? "No event"} tone={props.canRegister ? "green" : "zinc"} icon={Lock} />
      </div>

      <div className="mt-4 rounded border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
        Anti-alt policy: only roster-verified account GUID hashes are counted during BATTLE_ACTIVE. Alternate profiles, late swaps, and mismatched gamertag casing are ignored by tournament scoring.
      </div>

      <form onSubmit={props.onRegister} className="mt-5 grid gap-4">
        <label className="grid gap-2 text-sm font-semibold text-zinc-200">
          Exact case-sensitive gamertag
          <input
            value={props.playerName}
            onChange={(event) => props.onPlayerNameChange(event.target.value)}
            disabled={!props.canRegister || props.submitting}
            placeholder="ExamplePlayer_01"
            className="rounded border border-white/15 bg-black/35 px-3 py-2 text-zinc-100 outline-none ring-cyan-300/30 placeholder:text-zinc-600 focus:ring-2 disabled:opacity-60"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-zinc-200">
          Unique account GUID hash
          <input
            value={props.playerId}
            onChange={(event) => props.onPlayerIdChange(event.target.value)}
            disabled={!props.canRegister || props.submitting}
            placeholder="Nitrado/DayZ account id hash"
            className="rounded border border-white/15 bg-black/35 px-3 py-2 text-zinc-100 outline-none ring-cyan-300/30 placeholder:text-zinc-600 focus:ring-2 disabled:opacity-60"
          />
        </label>
        <button
          type="submit"
          disabled={!props.canRegister || props.submitting}
          className="inline-flex items-center justify-center gap-2 rounded border border-cyan-300/40 bg-cyan-300/15 px-4 py-2 text-sm font-black uppercase tracking-[0.12em] text-cyan-50 hover:bg-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {props.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {props.submitting ? "Registering" : "Lock Roster Entry"}
        </button>
        {props.submitMessage ? <p className="text-sm text-zinc-300">{props.submitMessage}</p> : null}
      </form>
    </section>
  );
}

function VerifiedActionFeed({ events }: { events: VerifiedFeedEvent[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-black uppercase text-white">
          <Gauge className="h-5 w-5 text-green-200" />
          Verified Action Feed
        </h2>
        <StatusChip label={`${events.length} accepted`} tone="green" icon={ShieldCheck} />
      </div>
      <div className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1">
        {events.length ? events.map((event) => (
          <div key={event.id} className="rounded border border-white/10 bg-black/25 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-white">{event.player_name ?? "Verified player"}</p>
              <span className="text-sm font-black text-green-200">+{event.point_delta}</span>
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              {event.event_type.replaceAll("_", " ")} / {event.server_name}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{formatDate(event.created_at)}</p>
          </div>
        )) : (
          <EmptyNotice title="No Verified Actions Yet" detail="Accepted roster-verified KILL or BUILDING actions will appear here from the cached CTF event audit." compact />
        )}
      </div>
    </section>
  );
}

function CompletedMatchHistory({ matches }: { matches: CompletedMatch[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-black uppercase text-white">
          <Trophy className="h-5 w-5 text-amber-200" />
          Completed Match Log
        </h2>
        <StatusChip label={`${matches.length} archived`} tone="zinc" icon={Clock3} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase tracking-[0.16em] text-zinc-500">
            <tr>
              <th className="py-3 pr-4">Match</th>
              <th className="py-3 pr-4">Metric</th>
              <th className="py-3 pr-4">Target</th>
              <th className="py-3 pr-4">Winner</th>
              <th className="py-3 pr-4">Final Scores</th>
              <th className="py-3 pr-4">Ended</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 text-zinc-300">
            {matches.length ? matches.map((match) => (
              <tr key={match.id}>
                <td className="py-3 pr-4 font-semibold text-white">{match.tournament_name}</td>
                <td className="py-3 pr-4">{match.target_metric}</td>
                <td className="py-3 pr-4">{match.target_flag_points.toLocaleString()}</td>
                <td className="py-3 pr-4">{match.winner?.server_name ?? "No flag raised"}</td>
                <td className="py-3 pr-4">{match.participants.map((item) => `${item.server_name}: ${item.accumulated_points}`).join(" / ") || "No points recorded"}</td>
                <td className="py-3 pr-4">{formatDate(match.phase_ends_at)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="py-8">
                  <EmptyNotice title="No Completed Matches" detail="Concluded tournament aggregates will appear here after an event closes." compact />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UpgradeAlert({ subscription }: { subscription: TournamentSubscription }) {
  return (
    <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-amber-50">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-5 w-5" />
        <div>
          <h2 className="font-black uppercase">PRO or DZN_PARTNER required</h2>
          <p className="mt-1 text-sm text-amber-100/80">
            Cross-server matching and live tournament registration are reserved for active PRO and DZN_PARTNER subscriptions. Current plan: {subscription.plan_key.toUpperCase()} ({subscription.status}).
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyNotice({ title, detail, compact = false }: { title: string; detail: string; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-white/10 bg-white/[0.03] ${compact ? "p-4" : "p-6"}`}>
      <p className="font-semibold text-zinc-200">{title}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{detail}</p>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="h-72 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
      <div className="h-72 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
    </div>
  );
}

function StatusChip({ label, tone, icon: Icon, spin = false }: { label: string; tone: "green" | "amber" | "cyan" | "zinc"; icon: ComponentType<{ className?: string }>; spin?: boolean }) {
  const styles = {
    green: "border-green-300/25 bg-green-300/10 text-green-100",
    amber: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    cyan: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
    zinc: "border-white/15 bg-white/5 text-zinc-200",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-2 rounded border px-2.5 py-1 text-xs font-semibold ${styles}`}>
      <Icon className={`h-3.5 w-3.5 ${spin ? "animate-spin" : ""}`} />
      {label}
    </span>
  );
}

function orderParticipants(participants: Participant[], selectedServerId: string) {
  const selected = participants.find((item) => item.linked_server_id === selectedServerId);
  const others = participants.filter((item) => item.linked_server_id !== selectedServerId);
  return selected ? [selected, ...others] : participants;
}

function clampProgress(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Awaiting timestamp";
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}

function lastGoodKey(serverId: string) {
  return `${LAST_GOOD_PREFIX}${serverId}`;
}

function loadLastGood(serverId: string) {
  if (!serverId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(lastGoodKey(serverId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cached_at?: string; data?: TournamentDashboardData };
    const cachedAt = parsed.cached_at ? new Date(parsed.cached_at).getTime() : 0;
    if (!cachedAt || Date.now() - cachedAt > LAST_GOOD_MAX_AGE_MS) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

function saveLastGood(serverId: string, data: TournamentDashboardData) {
  if (!serverId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lastGoodKey(serverId), JSON.stringify({ cached_at: new Date().toISOString(), data }));
  } catch {
    // Last-good cache is opportunistic. Rendering must not depend on storage availability.
  }
}
