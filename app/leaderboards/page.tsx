"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, ArrowRight, Crosshair, Lock, RadioTower, Skull, Trophy, Users } from "lucide-react";
import Link from "next/link";

import { AnimatedBackground } from "@/components/dzn/animated-background";
import { DznLogo } from "@/components/dzn/dzn-logo";
import { KillProjectileAccent } from "@/components/leaderboards/animated-bullet";
import { fetchJsonWithRetry } from "@/lib/client-fetch";

type LeaderboardServer = {
  rank: number;
  server_id: string;
  server_name: string;
  slug: string | null;
  mode: string;
  kills: number;
  deaths: number;
  kd: number | null;
  kd_label: string;
  longest_kill: number;
  unique_players?: number;
  joins?: number;
  stats_sync_active?: boolean;
  score: number;
  score_label: string;
  score_breakdown: ScoreBreakdown | null;
};

type ScoreBreakdown = {
  kills_points: number;
  unique_players_points: number;
  joins_points: number;
  longest_kill_points: number;
  sync_bonus: number;
  death_penalty: number;
  final_score: number;
};

type LeaderboardPlayer = {
  rank: number;
  player_name: string;
  player_id: null;
  server_name: string;
  server_slug: string | null;
  kills: number;
  deaths: number;
  kd: number | null;
  kd_label: string;
  longest_kill: number;
  last_seen: string | null;
};

type LongestKill = {
  rank: number;
  player_name: string;
  victim_name: string;
  server_name: string;
  server_slug: string | null;
  weapon: string;
  distance: number;
  occurred_at: string | null;
};

type LeaderboardsPayload = {
  ok?: boolean;
  data?: LeaderboardsPayload;
  top_servers?: LeaderboardServer[];
  top_players?: LeaderboardPlayer[];
  best_overall_kill?: Omit<LongestKill, "rank"> | null;
  latest_kill?: Omit<LongestKill, "rank"> | null;
  personal_best_kills?: LongestKill[];
  longest_kills?: LongestKill[];
  updated_at?: string;
  generated_at?: string;
  stale?: boolean;
  source?: string;
  fallback_reason?: string;
  access_level?: "full" | "preview";
  is_locked?: boolean;
  locked_reason?: string | null;
  error?: string;
};

const emptyPayload = {
  top_servers: [],
  top_players: [],
  best_overall_kill: null,
  latest_kill: null,
  personal_best_kills: [],
  longest_kills: [],
  updated_at: null,
  access_level: "full" as const,
  is_locked: false,
  locked_reason: null,
};

const LEADERBOARD_LAST_GOOD_KEY = "dzn:lastGoodLeaderboard";
const LEADERBOARD_LAST_GOOD_MAX_AGE_MS = 10 * 60 * 1000;
type LeaderboardLoadState = "loading_initial" | "loaded" | "refreshing" | "refresh_failed" | "empty_real_data" | "error_initial";

export default function LeaderboardsPage() {
  const [payload, setPayload] = useState<{
    top_servers: LeaderboardServer[];
    top_players: LeaderboardPlayer[];
    best_overall_kill: Omit<LongestKill, "rank"> | null;
    latest_kill: Omit<LongestKill, "rank"> | null;
    personal_best_kills: LongestKill[];
    longest_kills: LongestKill[];
    updated_at: string | null;
    access_level: "full" | "preview";
    is_locked: boolean;
    locked_reason: string | null;
  }>(() => loadLastGoodLeaderboard() ?? emptyPayload);
  const [loading, setLoading] = useState(() => !loadLastGoodLeaderboard());
  const [loadState, setLoadState] = useState<LeaderboardLoadState>(() => loadLastGoodLeaderboard() ? "loaded" : "loading_initial");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const latestRequestId = useRef(0);
  const visiblePayloadRef = useRef(hasMeaningfulLeaderboard(payload));
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    console.log("DZN LIVE LEADERBOARDS LOADED");
    console.log("DZN CLEAN LONGEST KILLS LEADERBOARD LOADED");
    console.log("DZN SERVER RANKING SYSTEM LOADED");
    console.log("DZN PUBLIC DATA LOADING HARDENED");
    console.log("DZN LAST GOOD PUBLIC DATA PRESERVED");
    console.log("DZN PUBLIC PAGES FIRST LOAD STABILISED");
    console.log("DZN ADM SYSTEM UNTOUCHED");
  }, []);

  useEffect(() => {
    visiblePayloadRef.current = hasMeaningfulLeaderboard(payload);
  }, [payload]);

  useEffect(() => {
    let active = true;

    async function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      const requestId = latestRequestId.current + 1;
      latestRequestId.current = requestId;
      const cached = loadLastGoodLeaderboard();
      const hasVisibleData = Boolean(cached) || visiblePayloadRef.current;
      setLoading(!hasVisibleData);
      setLoadState(!hasVisibleData ? "loading_initial" : "refreshing");
      try {
        const data = await fetchJsonWithRetry<LeaderboardsPayload>("/api/public/leaderboards", {
          cache: "no-store",
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!active || latestRequestId.current !== requestId) return;
        const normalized = normalizePayload(data.data && !data.top_servers ? data.data : data);
        setPayload(normalized);
        if (hasMeaningfulLeaderboard(normalized)) saveLastGoodLeaderboard(normalized);
        setLoadState(hasMeaningfulLeaderboard(normalized) ? "loaded" : "empty_real_data");
        setError("");
      } catch (loadError) {
        if (active) {
          const cached = loadLastGoodLeaderboard();
          if (cached) {
            setPayload(cached);
            setError("");
            setLoadState("loaded");
          } else if (visiblePayloadRef.current) {
            setError("");
            setLoadState("loaded");
          } else {
            setError(loadError instanceof Error ? loadError.message : "Leaderboard data could not be loaded right now.");
            setLoadState("error_initial");
          }
        }
      } finally {
        if (active) setLoading(false);
        inFlight.current = false;
      }
    }

    load();
    const interval = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [reloadNonce]);

  const totalKills = useMemo(() => payload.top_servers.reduce((total, server) => total + server.kills, 0), [payload.top_servers]);
  const totalPlayers = payload.top_players.length;
  const longestKill = payload.best_overall_kill?.distance ?? payload.personal_best_kills[0]?.distance ?? 0;
  const initialError = loadState === "error_initial";

  return (
    <main className="dzn-leaderboard-page relative min-h-screen overflow-hidden bg-[#02030a] px-5 py-6 text-white sm:px-6 lg:px-8">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1540px] flex-col">
        <nav className="flex min-h-[104px] flex-wrap items-center justify-between gap-3">
          <DznLogo />
          <div className="flex items-center gap-3">
            <Link href="/servers" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/35 hover:text-white">
              Servers
            </Link>
            <Link href="/login?returnTo=/setup" className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-black uppercase text-white shadow-[0_0_26px_rgba(139,92,246,0.35)] transition hover:bg-violet-400">
              Add Your Server
            </Link>
          </div>
        </nav>

        <section className="dzn-leaderboard-hero my-5 lg:my-7">
          <div className="dzn-leaderboard-hero__copy">
            <div>
              <p className="dzn-leaderboard-live-badge inline-flex rounded-full border border-violet-300/25 bg-violet-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-violet-100">
                Live ADM intelligence
              </p>
              <h1 className="dzn-leaderboard-title mt-5 text-4xl font-black uppercase tracking-normal text-white sm:text-6xl">Global Leaderboards</h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-zinc-300 sm:text-lg sm:leading-8">
                Ranked connected DayZ servers and players based on synced ADM activity.
              </p>
              <p className="mt-3 text-sm font-bold text-zinc-500">
                Updated: {initialError ? "Unavailable" : payload.updated_at ? formatDateTime(payload.updated_at) : loading ? "Loading live data..." : "Live data pending"}
              </p>
            </div>
          </div>

          <div className="dzn-leaderboard-hero__intel">
            {!initialError ? (
              <div className="dzn-leaderboard-stat-grid">
                <MetricRow icon={RadioTower} label="Servers Ranked" value={String(payload.top_servers.length)} tone="violet" />
                <MetricRow icon={Crosshair} label="Kills Tracked" value={formatNumber(totalKills)} tone="cyan" />
                <MetricRow icon={Users} label="Ranked Players" value={String(totalPlayers)} tone="orange" />
                <MetricRow icon={Trophy} label="Longest Kill" value={formatDistance(longestKill)} tone="red" />
              </div>
            ) : null}
            <div className="dzn-leaderboard-hero__signal" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </section>

        {error ? <MessagePanel message={error} onRetry={() => setReloadNonce((value) => value + 1)} /> : null}
        {!loading && payload.is_locked ? (
          <LockedLeaderboardBanner />
        ) : null}
        {loading ? <LoadingGrid /> : null}

        {!loading && !initialError ? (
          <div className="dzn-leaderboard-layout grid gap-6 pb-14 xl:grid-cols-[minmax(0,1fr)_390px]">
            <div className="grid gap-6">
              <LeaderboardTable
                title="Top Servers"
                icon={Trophy}
                empty="No ranked servers yet."
                headers={["Rank", "Server", "Mode", "Kills", "Deaths", "K/D", "Longest", "Score"]}
                rows={payload.top_servers.map((server) => [
                  `#${server.rank}`,
                  <ServerLink key="server" slug={server.slug} label={server.server_name} />,
                  server.mode,
                  formatNumber(server.kills),
                  formatNumber(server.deaths),
                  formatKd(server),
                  formatDistance(server.longest_kill),
                  <span key="score" title={scoreBreakdownTitle(server.score_breakdown)}>{server.score_label === "Pending" ? "Pending" : formatNumber(server.score)}</span>,
                ])}
              />

              {payload.is_locked ? (
                <LockedLeaderboardPanel title="Top Players" icon={Users} text="Log in with Discord to unlock ranked players, kills, deaths, K/D, and personal records." />
              ) : (
                <LeaderboardTable
                  title="Top Players"
                  icon={Users}
                  empty="No ranked players yet."
                  headers={["Rank", "Player", "Server", "Kills", "Deaths", "K/D", "Longest"]}
                  rows={payload.top_players.map((player) => [
                    `#${player.rank}`,
                    player.player_name,
                    <ServerLink key="server" slug={player.server_slug} label={player.server_name} />,
                    formatNumber(player.kills),
                    formatNumber(player.deaths),
                    formatKd(player),
                    formatDistance(player.longest_kill),
                  ])}
                />

              )}

              {!payload.is_locked ? (
                <PersonalBestTable personalBests={payload.personal_best_kills.length ? payload.personal_best_kills : payload.longest_kills} />
              ) : null}
            </div>

            <aside className="dzn-leaderboard-sidecar grid content-start gap-6">
              {payload.is_locked ? (
                <div className="grid gap-6">
                  <LongestKillsSection bestOverall={null} latestKill={null} oneShotKill={null} />
                  <LockedLeaderboardPanel title="Full Long-Kill Records" icon={Skull} text="Detailed long-kill records and confirmed kill tables are available to logged-in DZN members." />
                </div>
              ) : (
                <LongestKillsSection
                  bestOverall={payload.best_overall_kill}
                  latestKill={payload.latest_kill}
                  oneShotKill={payload.personal_best_kills[0] ?? payload.longest_kills[0] ?? null}
                />
              )}
              <LiveAdmIntelPanel updatedAt={payload.updated_at} loading={loading} />
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function LongestKillsSection({
  bestOverall,
  latestKill,
  oneShotKill,
}: {
  bestOverall: Omit<LongestKill, "rank"> | null;
  latestKill: Omit<LongestKill, "rank"> | null;
  oneShotKill: LongestKill | null;
}) {
  const hasKills = Boolean(bestOverall || latestKill || oneShotKill);
  return (
    <section className="dzn-leaderboard-card dzn-longest-kills-card glass-surface animated-border rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          <Skull className="h-6 w-6 text-violet-200" />
          <h2 className="text-2xl font-black uppercase text-white">Longest Kills</h2>
        </div>

        <div className="mt-5 grid gap-4">
          <KillHighlightCard title="Best Overall" kill={bestOverall} tone="violet" />
          <KillHighlightCard title="Latest Confirmed" kill={latestKill} tone="cyan" />
          {oneShotKill ? <KillHighlightCard title="One Shot Kill" kill={oneShotKill} tone="orange" /> : null}
        </div>
        {!hasKills ? (
          <p className="mt-4 rounded-lg border border-white/10 bg-black/24 p-4 text-sm font-bold text-zinc-400">
            Long-kill records will appear once connected servers sync confirmed PvP kills.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PersonalBestTable({ personalBests }: { personalBests: LongestKill[] }) {
  return (
    <section className="dzn-leaderboard-card glass-surface animated-border rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            <Trophy className="h-6 w-6 text-violet-200" />
            <h2 className="text-2xl font-black uppercase text-white">Personal Bests</h2>
          </div>
          <p className="text-xs font-bold uppercase text-zinc-500">One best kill per player</p>
        </div>
        {personalBests.length ? (
          <div className="dzn-leaderboard-table-wrap mt-5 overflow-x-auto">
            <table className="dzn-leaderboard-table min-w-full border-separate border-spacing-y-2 text-left">
              <thead>
                <tr>
                  {["Rank", "Player", "Victim", "Server", "Weapon", "Best Distance", "Time"].map((header) => (
                    <th key={header} className="px-3 py-2 text-xs font-black uppercase text-zinc-500">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {personalBests.map((kill, index) => (
                  <tr key={`${kill.rank}-${kill.player_name}-${kill.distance}`} className="dzn-leaderboard-row rounded-lg bg-black/24">
                    <td className="border-y border-l border-white/10 px-3 py-3 first:rounded-l-lg">
                      <span className={`dzn-rank-badge dzn-rank-badge--${rankTone(index)}`}>#{kill.rank}</span>
                    </td>
                    <td className="border-y border-white/10 px-3 py-3 text-sm font-black text-white">{kill.player_name}</td>
                    <td className="border-y border-white/10 px-3 py-3 text-sm font-bold text-zinc-200">{kill.victim_name}</td>
                    <td className="border-y border-white/10 px-3 py-3 text-sm font-bold text-zinc-200">
                      <ServerLink slug={kill.server_slug} label={kill.server_name} />
                    </td>
                    <td className="border-y border-white/10 px-3 py-3 text-sm font-bold text-zinc-200">{kill.weapon}</td>
                    <td className="border-y border-white/10 px-3 py-3 text-sm font-black text-cyan-100">{formatDistance(kill.distance)}</td>
                    <td className="rounded-r-lg border-y border-r border-white/10 px-3 py-3 text-sm font-bold text-zinc-300">{formatDateTime(kill.occurred_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-white/10 bg-black/24 p-5 text-sm font-bold text-zinc-400">
            No personal best long kills yet.
          </div>
        )}
      </div>
    </section>
  );
}

function KillHighlightCard({ title, kill, tone }: { title: string; kill: Omit<LongestKill, "rank"> | null; tone: "violet" | "cyan" | "orange" }) {
  return (
    <div className={`dzn-long-kill-card dzn-long-kill-card--${tone} rounded-lg border p-4`}>
      <KillProjectileAccent tone={tone} />
      <p className="text-xs font-black uppercase tracking-[0.16em] opacity-80">{title}</p>
      {kill ? (
        <>
          <p className="mt-3 text-2xl font-black text-white">{formatDistance(kill.distance)}</p>
          <p className="mt-2 text-sm font-bold leading-6 text-zinc-200">
            {kill.player_name} eliminated {kill.victim_name} with {kill.weapon}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-zinc-400">
            <ServerLink slug={kill.server_slug} label={kill.server_name} />
            <span>{formatDateTime(kill.occurred_at)}</span>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm font-bold text-zinc-400">No confirmed kill yet.</p>
      )}
    </div>
  );
}

function LiveAdmIntelPanel({ updatedAt, loading }: { updatedAt: string | null; loading: boolean }) {
  return (
    <section className="dzn-live-intel-card dzn-leaderboard-card glass-surface animated-border rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          <RadioTower className="h-5 w-5 text-cyan-100" />
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100">Live ADM Intelligence</p>
        </div>
        <p className="mt-4 text-2xl font-black uppercase leading-tight text-white">
          Live data. Real players. Real action.
        </p>
        <div className="mt-5 grid gap-2">
          <StatusLine label="Source" value="Synced ADM activity" />
          <StatusLine label="Refresh" value={loading ? "Loading" : "Automatic public feed"} />
          <StatusLine label="Updated" value={updatedAt ? formatDateTime(updatedAt) : "Pending"} />
        </div>
      </div>
    </section>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2 last:border-b-0">
      <span className="text-[10px] font-black uppercase text-zinc-500">{label}</span>
      <span className="text-right text-xs font-black text-zinc-100">{value}</span>
    </div>
  );
}

function LockedLeaderboardBanner() {
  return (
    <section className="dzn-leaderboard-card mb-6 glass-surface animated-border rounded-lg p-5">
      <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-violet-300/25 bg-violet-500/15 text-violet-100">
            <Lock className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-100">Preview mode</p>
            <h2 className="mt-1 text-xl font-black text-white">Login with Discord to unlock full leaderboards</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Logged-out visitors can preview top servers. Full player rankings, long-kill records, and detailed tables require Discord login.
            </p>
          </div>
        </div>
        <Link href="/login?returnTo=/leaderboards" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-violet-500 px-5 py-3 text-xs font-black uppercase text-white transition hover:bg-violet-400">
          Login with Discord
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function LockedLeaderboardPanel({ title, icon: Icon, text }: { title: string; icon: typeof Activity; text: string }) {
  return (
    <section className="dzn-leaderboard-card glass-surface animated-border rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-violet-200" />
          <h2 className="text-2xl font-black uppercase text-white">{title}</h2>
        </div>
        <div className="mt-5 rounded-lg border border-violet-300/20 bg-violet-500/10 p-5">
          <div className="flex gap-3">
            <Lock className="mt-1 h-5 w-5 shrink-0 text-violet-100" />
            <div>
              <p className="text-sm font-black uppercase text-violet-100">Discord login required</p>
              <p className="mt-2 text-sm leading-6 text-zinc-300">{text}</p>
              <Link href="/login?returnTo=/leaderboards" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2.5 text-xs font-black uppercase text-white transition hover:bg-violet-400">
                Login to unlock
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LeaderboardTable({
  title,
  icon: Icon,
  headers,
  rows,
  empty,
}: {
  title: string;
  icon: typeof Activity;
  headers: string[];
  rows: Array<Array<ReactNode>>;
  empty: string;
}) {
  return (
    <section className="dzn-leaderboard-card glass-surface animated-border rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-violet-200" />
          <h2 className="text-2xl font-black uppercase text-white">{title}</h2>
        </div>
        {rows.length ? (
          <div className="dzn-leaderboard-table-wrap mt-5 overflow-x-auto">
            <table className="dzn-leaderboard-table min-w-full border-separate border-spacing-y-2 text-left">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th key={header} className="px-3 py-2 text-xs font-black uppercase text-zinc-500">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="dzn-leaderboard-row rounded-lg bg-black/24">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border-y border-white/10 px-3 py-3 first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r">
                        <span className={cellIndex === 0 ? `dzn-rank-badge dzn-rank-badge--${rankTone(rowIndex)}` : "text-sm font-bold text-zinc-100"}>
                          {cell}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-white/10 bg-black/24 p-5 text-sm font-bold text-zinc-400">
            {empty}
          </div>
        )}
      </div>
    </section>
  );
}

function MetricRow({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: string; tone: "violet" | "cyan" | "orange" | "red" }) {
  return (
    <div className={`dzn-leaderboard-stat dzn-leaderboard-stat--${tone} flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black/24 p-3`}>
      <span className="inline-flex items-center gap-3 text-xs font-black uppercase text-zinc-400">
        <Icon className="h-4 w-4 text-cyan-200" />
        {label}
      </span>
      <span className="text-sm font-black text-white">{value}</span>
    </div>
  );
}

function ServerLink({ slug, label }: { slug: string | null; label: string }) {
  if (!slug) return label;
  return (
    <Link href={`/servers/profile?slug=${encodeURIComponent(slug)}`} className="inline-flex items-center gap-1 text-cyan-100 transition hover:text-white">
      {label}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function MessagePanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-amber-300/20 bg-amber-400/10 p-4 text-sm font-bold text-amber-100 sm:flex-row sm:items-center sm:justify-between">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="inline-flex shrink-0 rounded-lg border border-amber-200/30 bg-amber-300/10 px-3 py-2 text-xs font-black uppercase text-amber-50 transition hover:bg-amber-300/18">
          Retry
        </button>
      ) : null}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-6">
      {[0, 1, 2].map((item) => (
        <div key={item} className="dzn-leaderboard-card glass-surface rounded-lg p-5">
          <div className="h-7 w-52 animate-pulse rounded bg-white/10" />
          <div className="mt-5 h-36 animate-pulse rounded-lg bg-white/10" />
        </div>
      ))}
    </div>
  );
}

function normalizePayload(data: LeaderboardsPayload) {
  const personalBestKills = Array.isArray(data.personal_best_kills)
    ? data.personal_best_kills.map(normalizeLongestKill)
    : Array.isArray(data.longest_kills)
      ? data.longest_kills.map(normalizeLongestKill)
      : [];
  return {
    top_servers: Array.isArray(data.top_servers) ? data.top_servers.map(normalizeServer) : [],
    top_players: Array.isArray(data.top_players) ? data.top_players.map(normalizePlayer) : [],
    best_overall_kill: data.best_overall_kill ? normalizeKillHighlight(data.best_overall_kill) : null,
    latest_kill: data.latest_kill ? normalizeKillHighlight(data.latest_kill) : null,
    personal_best_kills: personalBestKills,
    longest_kills: personalBestKills,
    updated_at: data.updated_at ?? new Date().toISOString(),
    access_level: data.access_level === "preview" ? ("preview" as const) : ("full" as const),
    is_locked: Boolean(data.is_locked),
    locked_reason: data.locked_reason ?? null,
  };
}

function loadLastGoodLeaderboard(): ReturnType<typeof normalizePayload> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEADERBOARD_LAST_GOOD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LeaderboardsPayload;
    const cachedAt = typeof (parsed as { cached_at?: unknown }).cached_at === "string" ? (parsed as { cached_at: string }).cached_at : null;
    if (cachedAt && Date.now() - new Date(cachedAt).getTime() > LEADERBOARD_LAST_GOOD_MAX_AGE_MS) return null;
    const normalized = normalizePayload(parsed.data && !parsed.top_servers ? parsed.data : parsed);
    return hasMeaningfulLeaderboard(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function saveLastGoodLeaderboard(payload: ReturnType<typeof normalizePayload>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEADERBOARD_LAST_GOOD_KEY, JSON.stringify({ ...payload, cached_at: new Date().toISOString() }));
  } catch {
    // Storage can be unavailable in private/hardened contexts.
  }
}

function hasMeaningfulLeaderboard(payload: {
  top_servers: LeaderboardServer[];
  top_players: LeaderboardPlayer[];
  personal_best_kills: LongestKill[];
  best_overall_kill: Omit<LongestKill, "rank"> | null;
  latest_kill: Omit<LongestKill, "rank"> | null;
}) {
  return payload.top_servers.length > 0
    || payload.top_players.length > 0
    || payload.personal_best_kills.length > 0
    || Boolean(payload.best_overall_kill || payload.latest_kill);
}

function normalizeServer(server: LeaderboardServer): LeaderboardServer {
  return {
    rank: numberOrZero(server.rank),
    server_id: server.server_id || "",
    server_name: server.server_name || "Unnamed DZN Server",
    slug: server.slug ?? null,
    mode: server.mode || "UNKNOWN",
    kills: numberOrZero(server.kills),
    deaths: numberOrZero(server.deaths),
    kd: typeof server.kd === "number" && Number.isFinite(server.kd) ? server.kd : null,
    kd_label: server.kd_label || "Awaiting data",
    longest_kill: numberOrZero(server.longest_kill),
    unique_players: numberOrZero(server.unique_players),
    joins: numberOrZero(server.joins),
    stats_sync_active: Boolean(server.stats_sync_active),
    score: numberOrZero(server.score),
    score_label: typeof server.score_label === "string" ? server.score_label : numberOrZero(server.score) > 0 ? String(numberOrZero(server.score)) : "Pending",
    score_breakdown: isScoreBreakdown(server.score_breakdown) ? server.score_breakdown : null,
  };
}

function normalizePlayer(player: LeaderboardPlayer): LeaderboardPlayer {
  return {
    rank: numberOrZero(player.rank),
    player_name: player.player_name || "Unknown Player",
    player_id: null,
    server_name: player.server_name || "Unnamed DZN Server",
    server_slug: player.server_slug ?? null,
    kills: numberOrZero(player.kills),
    deaths: numberOrZero(player.deaths),
    kd: typeof player.kd === "number" && Number.isFinite(player.kd) ? player.kd : null,
    kd_label: player.kd_label || "Awaiting data",
    longest_kill: numberOrZero(player.longest_kill),
    last_seen: player.last_seen ?? null,
  };
}

function normalizeLongestKill(kill: LongestKill): LongestKill {
  return {
    rank: numberOrZero(kill.rank),
    player_name: kill.player_name || "Unknown Player",
    victim_name: kill.victim_name || "Unknown Player",
    server_name: kill.server_name || "Unnamed DZN Server",
    server_slug: kill.server_slug ?? null,
    weapon: kill.weapon || "Unknown weapon",
    distance: numberOrZero(kill.distance),
    occurred_at: kill.occurred_at ?? null,
  };
}

function normalizeKillHighlight(kill: Omit<LongestKill, "rank">): Omit<LongestKill, "rank"> {
  return {
    player_name: kill.player_name || "Unknown Player",
    victim_name: kill.victim_name || "Unknown Player",
    server_name: kill.server_name || "Unnamed DZN Server",
    server_slug: kill.server_slug ?? null,
    weapon: kill.weapon || "Unknown weapon",
    distance: numberOrZero(kill.distance),
    occurred_at: kill.occurred_at ?? null,
  };
}

function formatKd(item: { kd: number | null; kd_label: string }) {
  if (item.kd_label) return item.kd_label;
  return typeof item.kd === "number" ? item.kd.toFixed(2) : "Awaiting data";
}

function formatDistance(value: number) {
  return value > 0 ? `${numberOrZero(value).toFixed(1)}m` : "Awaiting data";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(numberOrZero(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function rankTone(index: number) {
  if (index === 0) return "gold";
  if (index === 1) return "cyan";
  if (index === 2) return "orange";
  return "standard";
}

function isScoreBreakdown(value: unknown): value is ScoreBreakdown {
  return Boolean(value && typeof value === "object" && "final_score" in value);
}

function scoreBreakdownTitle(breakdown: ScoreBreakdown | null) {
  if (!breakdown) {
    return "Score is based on confirmed kills, unique players, joins, longest kill, deaths, and sync health.";
  }
  return [
    "Score is based on confirmed kills, unique players, joins, longest kill, deaths, and sync health.",
    `Kills: ${breakdown.kills_points}`,
    `Unique players: ${breakdown.unique_players_points}`,
    `Joins: ${breakdown.joins_points}`,
    `Longest kill: ${breakdown.longest_kill_points}`,
    `Sync bonus: ${breakdown.sync_bonus}`,
    `Death penalty: -${breakdown.death_penalty}`,
    `Final score: ${breakdown.final_score}`,
  ].join("\n");
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}
