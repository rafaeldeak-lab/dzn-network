"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, ArrowRight, Crosshair, RadioTower, Skull, Trophy, Users } from "lucide-react";
import Link from "next/link";

import { AnimatedBackground } from "@/components/dzn/animated-background";
import { DznLogo } from "@/components/dzn/dzn-logo";

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
  top_servers?: LeaderboardServer[];
  top_players?: LeaderboardPlayer[];
  best_overall_kill?: Omit<LongestKill, "rank"> | null;
  latest_kill?: Omit<LongestKill, "rank"> | null;
  personal_best_kills?: LongestKill[];
  longest_kills?: LongestKill[];
  updated_at?: string;
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
};

export default function LeaderboardsPage() {
  const [payload, setPayload] = useState<{
    top_servers: LeaderboardServer[];
    top_players: LeaderboardPlayer[];
    best_overall_kill: Omit<LongestKill, "rank"> | null;
    latest_kill: Omit<LongestKill, "rank"> | null;
    personal_best_kills: LongestKill[];
    longest_kills: LongestKill[];
    updated_at: string | null;
  }>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    console.log("DZN LIVE LEADERBOARDS LOADED");
    console.log("DZN CLEAN LONGEST KILLS LEADERBOARD LOADED");
    console.log("DZN SERVER RANKING SYSTEM LOADED");
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const response = await fetch("/api/public/leaderboards", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const data = (await response.json().catch(() => ({}))) as LeaderboardsPayload;
        if (!response.ok) throw new Error(data.error || "Unable to load leaderboards");
        if (!active) return;
        setPayload(normalizePayload(data));
        setError("");
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load leaderboards");
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
  }, []);

  const totalKills = useMemo(() => payload.top_servers.reduce((total, server) => total + server.kills, 0), [payload.top_servers]);
  const totalPlayers = payload.top_players.length;
  const longestKill = payload.best_overall_kill?.distance ?? payload.personal_best_kills[0]?.distance ?? 0;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-5 py-6 text-white sm:px-6 lg:px-8">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col">
        <nav className="flex min-h-[104px] items-center justify-between">
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

        <section className="py-12">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <p className="inline-flex rounded-full border border-violet-300/25 bg-violet-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-violet-100">
                Live ADM intelligence
              </p>
              <h1 className="mt-5 text-4xl font-black uppercase tracking-normal text-white sm:text-6xl">Global Leaderboards</h1>
              <p className="mt-4 max-w-3xl text-lg leading-8 text-zinc-300">
                Ranked connected DayZ servers and players based on synced ADM activity.
              </p>
              <p className="mt-3 text-sm font-bold text-zinc-500">
                Updated: {payload.updated_at ? formatDateTime(payload.updated_at) : loading ? "Loading live data..." : "Live data pending"}
              </p>
            </div>

            <div className="glass-surface animated-border rounded-lg p-5">
              <div className="relative z-10 grid gap-3">
                <MetricRow icon={RadioTower} label="Servers Ranked" value={String(payload.top_servers.length)} />
                <MetricRow icon={Crosshair} label="Kills Tracked" value={formatNumber(totalKills)} />
                <MetricRow icon={Users} label="Ranked Players" value={String(totalPlayers)} />
                <MetricRow icon={Trophy} label="Longest Kill" value={formatDistance(longestKill)} />
              </div>
            </div>
          </div>
        </section>

        {error ? <MessagePanel message={error} /> : null}
        {loading ? <LoadingGrid /> : null}

        {!loading ? (
          <div className="grid gap-6 pb-14">
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

            <LongestKillsSection
              bestOverall={payload.best_overall_kill}
              latestKill={payload.latest_kill}
              personalBests={payload.personal_best_kills.length ? payload.personal_best_kills : payload.longest_kills}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}

function LongestKillsSection({
  bestOverall,
  latestKill,
  personalBests,
}: {
  bestOverall: Omit<LongestKill, "rank"> | null;
  latestKill: Omit<LongestKill, "rank"> | null;
  personalBests: LongestKill[];
}) {
  const hasKills = Boolean(bestOverall || latestKill || personalBests.length);
  return (
    <section className="glass-surface animated-border rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          <Skull className="h-6 w-6 text-violet-200" />
          <h2 className="text-2xl font-black uppercase text-white">Longest Kills</h2>
        </div>

        {hasKills ? (
          <>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <KillHighlightCard title="Best Overall" kill={bestOverall} tone="violet" />
              <KillHighlightCard title="Latest Confirmed" kill={latestKill} tone="cyan" />
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black uppercase tracking-[0.16em] text-zinc-300">Personal Bests</h3>
                <p className="text-xs font-bold uppercase text-zinc-500">One best kill per player</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-2 text-left">
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
                    {personalBests.map((kill) => (
                      <tr key={`${kill.rank}-${kill.player_name}-${kill.distance}`} className="rounded-lg bg-black/24">
                        <td className="border-y border-l border-white/10 px-3 py-3 first:rounded-l-lg">
                          <span className="inline-flex rounded-md border border-violet-300/25 bg-violet-400/10 px-2 py-1 text-xs font-black text-violet-100">#{kill.rank}</span>
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
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-lg border border-white/10 bg-black/24 p-5 text-sm font-bold text-zinc-400">
            No confirmed long kills yet. Long-kill records will appear once connected servers sync PvP kills.
          </div>
        )}
      </div>
    </section>
  );
}

function KillHighlightCard({ title, kill, tone }: { title: string; kill: Omit<LongestKill, "rank"> | null; tone: "violet" | "cyan" }) {
  const toneClass = tone === "violet"
    ? "border-violet-300/25 bg-violet-500/10 text-violet-100"
    : "border-cyan-300/25 bg-cyan-400/10 text-cyan-100";
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
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
    <section className="glass-surface animated-border rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-violet-200" />
          <h2 className="text-2xl font-black uppercase text-white">{title}</h2>
        </div>
        {rows.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 text-left">
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
                  <tr key={rowIndex} className="rounded-lg bg-black/24">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border-y border-white/10 px-3 py-3 first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r">
                        <span className={cellIndex === 0 ? "text-sm font-black text-violet-200" : "text-sm font-bold text-zinc-100"}>
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

function MetricRow({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black/24 p-3">
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

function MessagePanel({ message }: { message: string }) {
  return (
    <div className="mb-6 rounded-lg border border-red-300/20 bg-red-400/10 p-4 text-sm font-bold text-red-100">
      {message}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-6">
      {[0, 1, 2].map((item) => (
        <div key={item} className="glass-surface rounded-lg p-5">
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
  };
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
