"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, ArrowRight, Crosshair, Lock, RadioTower, Skull, Trophy, Users } from "lucide-react";
import Link from "next/link";

import { AnimatedBullet, KillProjectileAccent } from "@/components/leaderboards/animated-bullet";
import { SiteHeader } from "@/components/site-header";
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

  const playerContent = payload.is_locked ? (
    <LockedLeaderboardPanel title="Top Players" icon={Users} text="Log in with Discord to unlock ranked players, kills, deaths, K/D, and personal records." />
  ) : (
    <LeaderboardTable
      title="Top Players"
      icon={Skull}
      empty="No ranked players yet."
      actionLabel="View all players"
      actionHref="/login?returnTo=/leaderboards"
      headers={["Rank", "Player", "Server", "Kills", "Deaths", "K/D", "Longest"]}
      rows={payload.top_players.map((player, index) => [
        `#${player.rank}`,
        <PlayerName key="player" name={player.player_name} index={index} />,
        <ServerLink key="server" slug={player.server_slug} label={player.server_name} />,
        formatNumber(player.kills),
        formatNumber(player.deaths),
        formatKd(player),
        formatDistance(player.longest_kill),
      ])}
    />
  );

  const personalBestContent = payload.is_locked ? (
    <LockedLeaderboardPanel title="Personal Bests" icon={Trophy} text="One-best-kill-per-player records unlock after Discord login." />
  ) : (
    <PersonalBestTable personalBests={payload.personal_best_kills.length ? payload.personal_best_kills : payload.longest_kills} />
  );

  return (
    <main className="leaderboard-ref-page leaderboard-reference-page dzn-leaderboard-page relative min-h-screen overflow-hidden bg-[#02030a] px-3 py-2 text-white sm:px-4 lg:px-5">
      <span className="leaderboard-ref-embers" aria-hidden="true" />
      <div className="leaderboard-ref-shell leaderboard-reference-shell relative z-10 mx-auto flex min-h-screen max-w-[1500px] flex-col">
        <SiteHeader active="leaderboards" returnTo="/leaderboards" />

        <section className="leaderboard-ref-hero leaderboard-reference-hero dzn-leaderboard-hero">
          <div className="leaderboard-ref-hero-art" aria-hidden="true" />
          <div className="leaderboard-ref-hero-copy leaderboard-reference-hero-copy dzn-leaderboard-hero__copy">
            <div>
              <p className="leaderboard-ref-live-badge leaderboard-reference-live-badge dzn-leaderboard-live-badge inline-flex border border-violet-300/35 bg-violet-500/20 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-violet-50">
                Live ADM intelligence
              </p>
              <h1 className="leaderboard-ref-title leaderboard-reference-title dzn-leaderboard-title mt-2 font-black uppercase tracking-normal" aria-label="Global Leaderboards">
                <span>Global</span>
                <span>Leaderboards</span>
              </h1>
              <p className="leaderboard-ref-subtitle leaderboard-reference-subtitle mt-3 max-w-3xl text-xs font-bold leading-5 text-zinc-100">
                Ranked connected DayZ servers and players based on synced ADM activity.
              </p>
              <p className="leaderboard-ref-updated leaderboard-reference-updated mt-2 text-[11px] font-bold text-zinc-300">
                Updated: {initialError ? "Unavailable" : payload.updated_at ? formatDateTime(payload.updated_at) : loading ? "Loading live data..." : "Live data pending"}
              </p>
            </div>
          </div>

          <div className="leaderboard-ref-hero-intel leaderboard-reference-hero-intel dzn-leaderboard-hero__intel">
            {!initialError ? (
              <div className="leaderboard-ref-stats leaderboard-reference-stat-grid dzn-leaderboard-stat-grid">
                <StatCard icon={RadioTower} label="Servers Ranked" value={String(payload.top_servers.length)} tone="violet" />
                <StatCard icon={Skull} label="Kills Tracked" value={formatNumber(totalKills)} tone="cyan" />
                <StatCard icon={Users} label="Ranked Players" value={String(totalPlayers)} tone="orange" />
                <StatCard icon={Crosshair} label="Longest Kill" value={formatDistance(longestKill)} tone="red" />
              </div>
            ) : null}
          </div>
        </section>

        {error ? <MessagePanel message={error} onRetry={() => setReloadNonce((value) => value + 1)} /> : null}
        {loading ? <LoadingGrid /> : null}

        {!loading && !initialError ? (
          <div className="leaderboard-ref-grid leaderboard-reference-grid dzn-leaderboard-layout pb-4">
            <div className="leaderboard-ref-main leaderboard-ref-area--servers leaderboard-reference-area leaderboard-reference-area--servers">
              <LeaderboardTable
                title="Top Servers"
                icon={RadioTower}
                empty="No ranked servers yet."
                actionLabel="View all servers"
                actionHref="/servers"
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
            </div>

            <div className="leaderboard-ref-side leaderboard-ref-area--longest leaderboard-reference-area leaderboard-reference-area--longest">
              <LongestKillsSection
                bestOverall={payload.is_locked ? null : payload.best_overall_kill}
                latestKill={payload.is_locked ? null : payload.latest_kill}
                oneShotKill={payload.is_locked ? null : payload.personal_best_kills[0] ?? payload.longest_kills[0] ?? null}
              />
            </div>

            <div className="leaderboard-ref-main leaderboard-ref-area--players leaderboard-reference-area leaderboard-reference-area--players">
              {playerContent}
            </div>

            <div className="leaderboard-ref-main leaderboard-ref-area--personal leaderboard-reference-area leaderboard-reference-area--personal">
              {personalBestContent}
            </div>
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
  return (
    <section className="leaderboard-ref-panel leaderboard-ref-longest dzn-leaderboard-card dzn-longest-kills-card glass-surface animated-border rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          <Skull className="h-6 w-6 text-violet-200" />
          <h2 className="text-2xl font-black uppercase text-white">Longest Kills</h2>
        </div>

        <div className="leaderboard-ref-longest-stack leaderboard-reference-longest-stack mt-3 grid gap-2">
          <KillHighlightCard title="Best Overall" kill={bestOverall} tone="violet" variant="sniper" />
          <KillHighlightCard title="Latest Confirmed" kill={latestKill} tone="cyan" variant="rifle" />
          <KillHighlightCard title="One Shot Kill" kill={oneShotKill} tone="orange" variant="projectile" />
        </div>
      </div>
    </section>
  );
}

function PersonalBestTable({ personalBests }: { personalBests: LongestKill[] }) {
  return (
    <section className="leaderboard-ref-panel leaderboard-reference-panel dzn-leaderboard-card glass-surface animated-border rounded p-4">
      <div className="relative z-10">
        <div className="leaderboard-reference-panel-header flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Trophy className="h-5 w-5 text-violet-200" />
            <h2 className="text-xl font-black uppercase text-white">Personal Bests</h2>
          </div>
          <p className="text-[10px] font-bold uppercase text-zinc-500">One best kill per player</p>
        </div>
        {personalBests.length ? (
          <div className="dzn-leaderboard-table-wrap mt-3 overflow-x-auto">
            <table className="leaderboard-ref-table dzn-leaderboard-table min-w-full border-separate border-spacing-y-2 text-left">
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
                    <td className="border-y border-l border-white/10 px-3 py-2 first:rounded-l">
                      <span className={`leaderboard-ref-rank dzn-rank-badge dzn-rank-badge--${rankTone(index)}`}>#{kill.rank}</span>
                    </td>
                    <td className="border-y border-white/10 px-3 py-2 text-sm font-black text-white">
                      <PlayerName name={kill.player_name} index={index} />
                    </td>
                    <td className="border-y border-white/10 px-3 py-2 text-sm font-bold text-zinc-200">{kill.victim_name}</td>
                    <td className="border-y border-white/10 px-3 py-2 text-sm font-bold text-zinc-200">
                      <ServerLink slug={kill.server_slug} label={kill.server_name} />
                    </td>
                    <td className="border-y border-white/10 px-3 py-2 text-sm font-bold text-zinc-200">{kill.weapon}</td>
                    <td className="border-y border-white/10 px-3 py-2 text-sm font-black text-cyan-100">{formatDistance(kill.distance)}</td>
                    <td className="rounded-r border-y border-r border-white/10 px-3 py-2 text-sm font-bold text-zinc-300">{formatDateTime(kill.occurred_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-3 rounded border border-white/10 bg-black/24 p-4 text-sm font-bold text-zinc-400">
            No personal best long kills yet.
          </div>
        )}
      </div>
    </section>
  );
}

function KillHighlightCard({
  title,
  kill,
  tone,
  variant,
}: {
  title: string;
  kill: Omit<LongestKill, "rank"> | null;
  tone: "violet" | "cyan" | "orange";
  variant: "sniper" | "rifle" | "projectile";
}) {
  const isBulletCard = variant === "projectile";

  return (
    <div className={`leaderboard-ref-kill-card leaderboard-ref-kill-card--${tone} ${isBulletCard ? "leaderboard-ref-kill-card--bullet" : ""} leaderboard-reference-longest-card leaderboard-reference-longest-card--${tone} dzn-long-kill-card dzn-long-kill-card--${tone} rounded border p-3`}>
      {isBulletCard ? (
        <>
          <div className="leaderboard-ref-kill-card-bg" aria-hidden="true" />
          <AnimatedBullet />
        </>
      ) : (
        <KillProjectileAccent tone={tone} variant={variant} />
      )}
      <div className="leaderboard-ref-kill-card-content">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] opacity-80">{title}</p>
        {kill ? (
          <>
            <p className="mt-1 text-2xl font-black text-white">{formatDistance(kill.distance)}</p>
            <p className="mt-1 max-w-[58%] text-[11px] font-bold leading-4 text-zinc-100">
              {kill.player_name} eliminated {kill.victim_name} with {kill.weapon}
            </p>
            <div className="mt-2 flex max-w-[64%] flex-wrap items-center gap-2 text-[10px] font-bold text-zinc-300">
              <ServerLink slug={kill.server_slug} label={kill.server_name} />
              <span>{formatDateTime(kill.occurred_at)}</span>
            </div>
          </>
        ) : (
          <p className="mt-2 max-w-[58%] text-[11px] font-bold leading-4 text-zinc-400">
            No confirmed kill yet.
          </p>
        )}
      </div>
    </div>
  );
}

function LockedLeaderboardPanel({ title, icon: Icon, text }: { title: string; icon: typeof Activity; text: string }) {
  return (
    <section className="leaderboard-ref-panel leaderboard-reference-panel dzn-leaderboard-card glass-surface animated-border rounded p-4">
      <div className="relative z-10">
        <div className="leaderboard-reference-panel-header flex items-center gap-3">
          <Icon className="h-5 w-5 text-violet-200" />
          <h2 className="text-xl font-black uppercase text-white">{title}</h2>
        </div>
        <div className="mt-3 rounded border border-violet-300/20 bg-violet-500/10 p-4">
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
  actionLabel,
  actionHref,
}: {
  title: string;
  icon: typeof Activity;
  headers: string[];
  rows: Array<Array<ReactNode>>;
  empty: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <section className="leaderboard-ref-panel leaderboard-reference-panel dzn-leaderboard-card glass-surface animated-border rounded p-4">
      <div className="relative z-10">
        <div className="leaderboard-reference-panel-header flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Icon className="h-5 w-5 text-violet-200" />
            <h2 className="text-xl font-black uppercase text-white">{title}</h2>
          </div>
          {actionLabel && actionHref ? (
            <Link href={actionHref} className="leaderboard-reference-panel-action inline-flex items-center gap-1 rounded border border-violet-300/20 bg-violet-500/10 px-3 py-2 text-[10px] font-black uppercase text-violet-100">
              {actionLabel}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
        {rows.length ? (
          <div className="dzn-leaderboard-table-wrap mt-3 overflow-x-auto">
            <table className="leaderboard-ref-table dzn-leaderboard-table min-w-full border-separate border-spacing-y-2 text-left">
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
                      <td key={cellIndex} className="border-y border-white/10 px-3 py-2 first:rounded-l last:rounded-r">
                        <span className={cellIndex === 0 ? `leaderboard-ref-rank dzn-rank-badge dzn-rank-badge--${rankTone(rowIndex)}` : "text-sm font-bold text-zinc-100"}>
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
          <div className="mt-3 rounded border border-white/10 bg-black/24 p-4 text-sm font-bold text-zinc-400">
            {empty}
          </div>
        )}
      </div>
    </section>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: string; tone: "violet" | "cyan" | "orange" | "red" }) {
  const longValueClass = value.length > 7 ? " leaderboard-reference-stat-value--long" : "";
  return (
    <div className={`leaderboard-ref-stat-card leaderboard-ref-stat-card--${tone} leaderboard-reference-stat dzn-leaderboard-stat dzn-leaderboard-stat--${tone} flex flex-col items-center justify-center gap-2 rounded border border-white/10 bg-black/24 p-3 text-center`}>
      <Icon className="h-8 w-8 text-cyan-200" />
      <span className={`leaderboard-reference-stat-value${longValueClass} text-3xl font-black text-white`}>{value}</span>
      <span className="leaderboard-reference-stat-label text-[10px] font-black uppercase text-zinc-300">{label}</span>
    </div>
  );
}

function PlayerName({ name, index }: { name: string; index: number }) {
  return (
    <span className="leaderboard-ref-player leaderboard-reference-player inline-flex items-center gap-2">
      <span className={`leaderboard-reference-avatar leaderboard-reference-avatar--${rankTone(index)}`} aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span>{name}</span>
    </span>
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
