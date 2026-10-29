"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, ArrowRight, ChevronDown, Compass, Crosshair, Gamepad2, Hammer, LayoutGrid, Lock, Map, RadioTower, Route, Search, Shield, Skull, Swords, Trees, Trophy, UserRound, Users, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { AnimatedBullet, KillProjectileAccent } from "@/components/leaderboards/animated-bullet";
import { ServerWarsTeaser } from "@/components/server-wars/server-wars-platform";
import { fetchJsonWithRetry } from "@/lib/client-fetch";
import { publicMapLabel, showcasePlanLabel } from "@/lib/showcase-labels";

type LeaderboardServer = {
  rank: number;
  server_id: string;
  server_name: string;
  slug: string | null;
  mode: string;
  category: string;
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
  public_profile_handle?: string | null;
  public_profile_href?: string | null;
  public_profile_avatar_url?: string | null;
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
  player_public_profile_handle?: string | null;
  player_public_profile_href?: string | null;
  player_public_profile_avatar_url?: string | null;
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
  directory?: "servers" | "players" | null;
  directory_cap?: number | null;
  directory_total?: number;
  directory_capped?: boolean;
  error?: string;
};

type AdvancedBoardRow = {
  rank: number;
  serverId?: string;
  serverSlug?: string | null;
  serverName?: string | null;
  serverMode?: string | null;
  mapName?: string | null;
  playerName?: string | null;
  value: number | string | null;
  displayValue: string;
  topPlayer?: string | null;
  supportingStats?: Record<string, number | string | null | boolean>;
  dataFreshness?: string | null;
  isPremiumShowcase?: boolean;
  estimated?: boolean;
};

type AdvancedBoard = {
  metricKey: string;
  title: string;
  description: string;
  category: string;
  packageRequired: "free" | "starter" | "pro" | "premium";
  rows: AdvancedBoardRow[];
  locked?: boolean;
  lockedReason?: string | null;
  estimated?: boolean;
};

type AdvancedLeaderboardsPayload = {
  ok?: boolean;
  generated_at?: string;
  categories?: string[];
  boards?: AdvancedBoard[];
  notes?: string[];
  error?: string;
  message?: string;
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
type LeaderboardBoard = "servers" | "players" | "records";
type LeaderboardMode = "all" | "deathmatch" | "pvp" | "pve" | "survival";
type LeaderboardDirectory = "servers" | "players";
type LeaderboardDirectoryState = "idle" | "loading" | "loaded" | "error";

const DIRECTORY_MAX_RANKS = 250;
const DIRECTORY_INITIAL_VISIBLE = 25;
const DIRECTORY_VISIBLE_STEP = 25;

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
  }>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [loadState, setLoadState] = useState<LeaderboardLoadState>("loading_initial");
  const [error, setError] = useState("");
  const inFlight = useRef<AbortController | null>(null);
  const payloadMode = useRef<LeaderboardMode | null>(null);
  const [displayedMode, setDisplayedMode] = useState<LeaderboardMode | null>(null);
  const latestRequestId = useRef(0);
  const visiblePayloadRef = useRef(hasMeaningfulLeaderboard(payload));
  const [reloadNonce, setReloadNonce] = useState(0);
  const [advancedPayload, setAdvancedPayload] = useState<AdvancedLeaderboardsPayload | null>(null);
  const [advancedLoading, setAdvancedLoading] = useState(true);
  const [advancedError, setAdvancedError] = useState("");
  const [activeBoard, setActiveBoard] = useState<LeaderboardBoard>("servers");
  const [activeMode, setActiveMode] = useState<LeaderboardMode>("all");
  const [serverModeError, setServerModeError] = useState("");
  const [directoryPayload, setDirectoryPayload] = useState<ReturnType<typeof normalizeDirectoryPayload> | null>(null);
  const [directoryLoadState, setDirectoryLoadState] = useState<LeaderboardDirectoryState>("idle");
  const [directoryError, setDirectoryError] = useState("");
  const [directoryReloadNonce, setDirectoryReloadNonce] = useState(0);
  const [directorySearch, setDirectorySearch] = useState("");
  const [directoryVisible, setDirectoryVisible] = useState(DIRECTORY_INITIAL_VISIBLE);
  const directoryRequest = useRef<AbortController | null>(null);
  const activeDirectory: LeaderboardDirectory | null = activeBoard === "servers" ? "servers" : activeBoard === "players" ? "players" : null;
  const activeDirectoryMode = activeDirectory === "servers" ? activeMode : "all";

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
      const controller = new AbortController();
      inFlight.current = controller;
      const requestId = latestRequestId.current + 1;
      latestRequestId.current = requestId;
      const cached = activeMode === "all" ? loadLastGoodLeaderboard() : null;
      const hasDisplayedPayload = payloadMode.current !== null;
      const hasAnyVisibleData = Boolean(cached) || hasDisplayedPayload;
      // The server and first browser render must agree before restoring local data.
      if (cached && payloadMode.current !== "all") {
        payloadMode.current = "all";
        setDisplayedMode("all");
        setPayload(cached);
      }
      setLoading(!hasAnyVisibleData);
      setLoadState(!hasAnyVisibleData ? "loading_initial" : "refreshing");
      try {
        const query = activeMode === "all" ? "" : `?mode=${encodeURIComponent(activeMode)}`;
        const data = await fetchJsonWithRetry<LeaderboardsPayload>(`/api/public/leaderboards${query}`, {
          cache: "no-store",
          credentials: "include",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!active || latestRequestId.current !== requestId) return;
        const responsePayload = data.data && !data.top_servers ? data.data : data;
        if (responsePayload.source === "empty_no_cache") {
          throw new Error("Leaderboard data is temporarily unavailable.");
        }
        const normalized = normalizePayload(responsePayload);
        payloadMode.current = activeMode;
        setDisplayedMode(activeMode);
        setPayload(normalized);
        if (activeMode === "all" && hasMeaningfulLeaderboard(normalized)) saveLastGoodLeaderboard(normalized);
        setLoadState(hasMeaningfulLeaderboard(normalized) ? "loaded" : "empty_real_data");
        setError("");
        setServerModeError("");
      } catch (loadError) {
        if (active) {
          const cached = activeMode === "all" ? loadLastGoodLeaderboard() : null;
          if (activeMode !== "all") {
            setError("");
            if (payloadMode.current !== activeMode) {
              setLoadState("refresh_failed");
              setServerModeError(`${formatModeFilter(activeMode)} rankings could not be loaded right now.`);
            } else {
              setLoadState(visiblePayloadRef.current ? "loaded" : "empty_real_data");
            }
          } else if (cached) {
            setPayload(cached);
            setError("");
            setLoadState("loaded");
          } else if (payloadMode.current === activeMode) {
            setError("");
            setLoadState(visiblePayloadRef.current ? "loaded" : "empty_real_data");
          } else {
            setError(loadError instanceof Error ? loadError.message : "Leaderboard data could not be loaded right now.");
            setLoadState("error_initial");
          }
        }
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          if (active) setLoading(false);
        }
      }
    }

    load();
    const interval = window.setInterval(load, 30_000);
    return () => {
      active = false;
      inFlight.current?.abort();
      inFlight.current = null;
      window.clearInterval(interval);
    };
  }, [activeMode, reloadNonce]);

  useEffect(() => {
    let active = true;

    async function loadAdvanced() {
      setAdvancedLoading(true);
      try {
        const data = await fetchJsonWithRetry<AdvancedLeaderboardsPayload>("/api/public/leaderboards/advanced", {
          cache: "no-store",
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!active) return;
        setAdvancedPayload(data);
        setAdvancedError("");
      } catch (loadError) {
        if (!active) return;
        setAdvancedError(loadError instanceof Error ? loadError.message : "Advanced showcase data could not be loaded right now.");
      } finally {
        if (active) setAdvancedLoading(false);
      }
    }

    loadAdvanced();
    return () => {
      active = false;
    };
  }, []);

  const totalKills = useMemo(() => payload.top_servers.reduce((total: number, server) => total + server.kills, 0), [payload.top_servers]);
  const totalPlayers = payload.top_players.length;
  const playerRankingSummary = payload.is_locked
    ? { label: "Player rankings", value: "Locked" }
    : { label: "Ranked Players", value: String(totalPlayers) };
  const longestKill = payload.best_overall_kill?.distance ?? payload.personal_best_kills[0]?.distance ?? 0;
  const initialError = loadState === "error_initial";
  const directoryBaseReady = loadState !== "loading_initial" && !initialError;
  const modeTransitionLoading = displayedMode !== activeMode && !serverModeError;
  const filteredServers = useMemo(
    () => payload.top_servers.filter((server) => matchesLeaderboardMode(server.category, activeMode)),
    [activeMode, payload.top_servers],
  );
  const directoryServers = useMemo(() => {
    if (directoryPayload?.directory !== "servers") return [];
    const term = directorySearch.trim().toLowerCase();
    return directoryPayload.top_servers.filter((server) => !term || [server.server_name, server.mode, server.category].some((value) => value.toLowerCase().includes(term)));
  }, [directoryPayload, directorySearch]);
  const directoryPlayers = useMemo(() => {
    if (directoryPayload?.directory !== "players") return [];
    const term = directorySearch.trim().toLowerCase();
    return directoryPayload.top_players.filter((player) => !term || [player.player_name, player.server_name].some((value) => value.toLowerCase().includes(term)));
  }, [directoryPayload, directorySearch]);
  const serverPodium = useMemo(() => filteredServers.slice(0, 3).map((server) => ({
    id: server.server_id,
    rank: server.rank,
    label: server.server_name,
    detail: `${server.mode} · ${formatNumber(server.unique_players ?? 0)} players`,
    href: server.slug ? `/servers/profile?slug=${encodeURIComponent(server.slug)}` : null,
    primaryLabel: "Kills",
    primaryValue: formatNumber(server.kills),
    secondaryLabel: "K/D total",
    secondaryValue: formatKd(server),
  })), [filteredServers]);
  const playerPodium = useMemo(() => payload.top_players.slice(0, 3).map((player, index) => ({
    id: `${player.rank}-${player.player_name}`,
    rank: player.rank,
    label: player.player_name,
    detail: player.server_name,
    href: safePublicProfileHref(player.public_profile_href),
    avatarUrl: safePublicProfileAvatarUrl(player.public_profile_avatar_url),
    avatarIndex: index,
    primaryLabel: "PvP kills",
    primaryValue: formatNumber(player.kills),
    secondaryLabel: "PvP K/D",
    secondaryValue: formatKd(player),
  })), [payload.top_players]);

  useEffect(() => {
    if (!activeDirectory || !directoryBaseReady || payload.is_locked) {
      directoryRequest.current?.abort();
      directoryRequest.current = null;
      return;
    }

    const directory = activeDirectory;
    const directoryMode = activeDirectoryMode;
    let active = true;
    const controller = new AbortController();
    directoryRequest.current?.abort();
    directoryRequest.current = controller;

    async function loadDirectory() {
      try {
        // Keep the effect asynchronous so changing tabs cannot synchronously cascade another render.
        await Promise.resolve();
        if (!active) return;
        setDirectoryPayload(null);
        setDirectorySearch("");
        setDirectoryVisible(DIRECTORY_INITIAL_VISIBLE);
        setDirectoryLoadState("loading");
        setDirectoryError("");
        const params = new URLSearchParams({
          directory,
          full: "true",
          page_size: String(DIRECTORY_MAX_RANKS),
        });
        if (directory === "servers" && directoryMode !== "all") params.set("mode", directoryMode);
        const data = await fetchJsonWithRetry<LeaderboardsPayload>(`/api/public/leaderboards?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!active) return;
        const responsePayload = data.data && !data.top_servers ? data.data : data;
        if (responsePayload.source === "empty_no_cache") throw new Error("The full ranking is temporarily unavailable.");
        setDirectoryPayload(normalizeDirectoryPayload(responsePayload, directory));
        setDirectoryLoadState("loaded");
      } catch (loadError) {
        if (!active || controller.signal.aborted) return;
        setDirectoryError(loadError instanceof Error ? loadError.message : "The full ranking could not be loaded right now.");
        setDirectoryLoadState("error");
      }
    }

    void loadDirectory();
    return () => {
      active = false;
      controller.abort();
      if (directoryRequest.current === controller) directoryRequest.current = null;
    };
  }, [activeDirectory, activeDirectoryMode, directoryBaseReady, directoryReloadNonce, payload.is_locked]);

  const playerContent = payload.is_locked ? (
    <LockedLeaderboardPanel title="Top Players" icon={Users} text="Log in with Discord to unlock ranked players, PvP kills, PvP deaths, PvP K/D, and personal records." />
  ) : (
    <LeaderboardTable
      title="Top Players"
      icon={Skull}
      empty="No ranked players yet."
      actionLabel="Browse full ranking"
      actionHref="#full-player-ranking-title"
      headers={["Rank", "Player", "Server", "Kills", "PvP deaths", "PvP K/D", "Longest"]}
      rankValues={payload.top_players.map((player) => player.rank)}
      rows={payload.top_players.map((player, index) => [
        `#${player.rank}`,
        <PlayerName key="player" name={player.player_name} index={index} href={player.public_profile_href} avatarUrl={player.public_profile_avatar_url} />,
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
                <StatCard icon={Users} label={playerRankingSummary.label} value={playerRankingSummary.value} tone="orange" />
                <StatCard icon={Crosshair} label="Longest Kill" value={formatDistance(longestKill)} tone="red" />
              </div>
            ) : null}
          </div>
        </section>

        {error ? <MessagePanel message={error} onRetry={() => setReloadNonce((value) => value + 1)} /> : null}
        {loading ? <LoadingGrid /> : null}

        {!loading && !initialError ? (
          <div className="leaderboard-ref-board-shell pb-4">
            <section className="leaderboard-ref-command-deck" aria-label="Leaderboard controls">
              <div className="leaderboard-ref-command-copy">
                <p>Browse the network</p>
                <h2>{activeBoard === "servers" ? "Server command board" : activeBoard === "players" ? "Player command board" : "Record command board"}</h2>
              </div>
              <div className="leaderboard-ref-command-controls">
                <LeaderboardBoardSwitcher activeBoard={activeBoard} onChange={setActiveBoard} />
                {activeBoard === "servers" ? (
                  <LeaderboardModeSwitcher
                    activeMode={activeMode}
                    onChange={(mode) => {
                      if (mode === activeMode) {
                        if (serverModeError) setReloadNonce((value) => value + 1);
                        return;
                      }
                      setServerModeError("");
                      setActiveMode(mode);
                    }}
                  />
                ) : (
                  <p className="leaderboard-ref-command-status">
                    {activeBoard === "players"
                      ? payload.is_locked ? "Sign in to view player-ranking detail." : "Browse confirmed player activity across connected servers."
                      : payload.is_locked ? "Sign in to view player record detail." : "Browse confirmed distance records and personal bests."}
                  </p>
                )}
              </div>
            </section>

            {activeBoard === "servers" ? (
              <div id="leaderboard-servers-panel" role="tabpanel" className="leaderboard-ref-board-view" data-board-view="servers">
                {modeTransitionLoading ? (
                  <LoadingGrid />
                ) : serverModeError ? (
                  <MessagePanel message={serverModeError} onRetry={() => setReloadNonce((value) => value + 1)} />
                ) : (
                  <>
                    <div className="leaderboard-ref-primary-grid">
                      <LeaderboardTable
                      title="Top Servers"
                      icon={RadioTower}
                      empty={activeMode === "all" ? "No ranked servers yet." : `No ranked ${formatModeFilter(activeMode)} servers yet.`}
                      actionLabel="Browse full ranking"
                      actionHref="#full-server-ranking-title"
                      headers={["Rank", "Server", "Mode", "Players", "Kills", "Total deaths", "K/D (total)", "Score"]}
                      rankValues={filteredServers.map((server) => server.rank)}
                      rows={filteredServers.map((server) => [
                        `#${server.rank}`,
                        <ServerLink key="server" slug={server.slug} label={server.server_name} />,
                        <ModeBadge key="mode" mode={server.mode} />,
                        formatNumber(server.unique_players ?? 0),
                        formatNumber(server.kills),
                        formatNumber(server.deaths),
                        formatKd(server),
                        <span key="score" className="leaderboard-ref-score" title={scoreBreakdownTitle(server.score_breakdown)}>{server.score_label === "Pending" ? "Pending" : formatNumber(server.score)}</span>,
                      ])}
                      />
                      <aside className="leaderboard-ref-live-sidecar" aria-label="Server leaderboard highlights">
                        <LeaderboardPodium title="Server podium" eyebrow="Current leaders" items={serverPodium} />
                        <LeaderboardRecordSummary locked={payload.is_locked} bestOverall={payload.best_overall_kill} latestKill={payload.latest_kill} onViewRecords={() => setActiveBoard("records")} />
                      </aside>
                    </div>
                    {!payload.is_locked ? (
                    <FullLeaderboardDirectory
                      title="Full Server Ranking"
                      icon={RadioTower}
                      searchLabel="Search ranked servers"
                      searchPlaceholder="Search a server or mode"
                      headers={["Rank", "Server", "Mode", "Players", "Kills", "K/D (total)", "Score"]}
                      rows={directoryServers.map((server) => [
                        `#${server.rank}`,
                        <ServerLink key="server" slug={server.slug} label={server.server_name} />,
                        <ModeBadge key="mode" mode={server.mode} />,
                        formatNumber(server.unique_players ?? 0),
                        formatNumber(server.kills),
                        formatKd(server),
                        <span key="score" className="leaderboard-ref-score" title={scoreBreakdownTitle(server.score_breakdown)}>{server.score_label === "Pending" ? "Pending" : formatNumber(server.score)}</span>,
                      ])}
                      rankValues={directoryServers.map((server) => server.rank)}
                      search={directorySearch}
                      onSearchChange={setDirectorySearch}
                      visibleCount={directoryVisible}
                      onShowMore={() => setDirectoryVisible((count) => count + DIRECTORY_VISIBLE_STEP)}
                      loading={directoryLoadState === "loading"}
                      error={directoryError}
                      onRetry={() => setDirectoryReloadNonce((value) => value + 1)}
                      total={directoryPayload?.directory === "servers" ? directoryPayload.directory_total : 0}
                      capped={directoryPayload?.directory === "servers" ? directoryPayload.directory_capped : false}
                      empty="No ranked servers match this search."
                    />
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {activeBoard === "players" ? (
              <div id="leaderboard-players-panel" role="tabpanel" className="leaderboard-ref-board-view leaderboard-ref-area--players" data-board-view="players">
                <div className="leaderboard-ref-primary-grid">
                  {playerContent}
                  <aside className="leaderboard-ref-live-sidecar" aria-label="Player leaderboard highlights">
                    <LeaderboardPodium
                      title="Player podium"
                      eyebrow={payload.is_locked ? "Protected ranking" : "Current leaders"}
                      items={payload.is_locked ? [] : playerPodium}
                      locked={payload.is_locked}
                      lockedText="Sign in with Discord to view the current player podium."
                    />
                    <LeaderboardRecordSummary locked={payload.is_locked} bestOverall={payload.best_overall_kill} latestKill={payload.latest_kill} onViewRecords={() => setActiveBoard("records")} />
                  </aside>
                </div>
                {!payload.is_locked ? (
                  <FullLeaderboardDirectory
                    title="Full Player Ranking"
                    icon={Users}
                    searchLabel="Search ranked players"
                    searchPlaceholder="Search a player or server"
                    headers={["Rank", "Player", "Server", "Kills", "PvP deaths", "PvP K/D", "Longest"]}
                    rows={directoryPlayers.map((player, index) => [
                      `#${player.rank}`,
                      <PlayerName key="player" name={player.player_name} index={index} href={player.public_profile_href} avatarUrl={player.public_profile_avatar_url} />,
                      <ServerLink key="server" slug={player.server_slug} label={player.server_name} />,
                      formatNumber(player.kills),
                      formatNumber(player.deaths),
                      formatKd(player),
                      formatDistance(player.longest_kill),
                    ])}
                    rankValues={directoryPlayers.map((player) => player.rank)}
                    search={directorySearch}
                    onSearchChange={setDirectorySearch}
                    visibleCount={directoryVisible}
                    onShowMore={() => setDirectoryVisible((count) => count + DIRECTORY_VISIBLE_STEP)}
                    loading={directoryLoadState === "loading"}
                    error={directoryError}
                    onRetry={() => setDirectoryReloadNonce((value) => value + 1)}
                    total={directoryPayload?.directory === "players" ? directoryPayload.directory_total : 0}
                    capped={directoryPayload?.directory === "players" ? directoryPayload.directory_capped : false}
                    empty="No ranked players match this search."
                  />
                ) : null}
              </div>
            ) : null}

            {activeBoard === "records" ? (
              <div id="leaderboard-records-panel" role="tabpanel" className="leaderboard-ref-records-grid" data-board-view="records">
                <div className="leaderboard-ref-area--longest">
                  <LongestKillsSection
                    bestOverall={payload.is_locked ? null : payload.best_overall_kill}
                    latestKill={payload.is_locked ? null : payload.latest_kill}
                    oneShotKill={payload.is_locked ? null : payload.personal_best_kills[0] ?? payload.longest_kills[0] ?? null}
                  />
                </div>
                <div className="leaderboard-ref-area--personal">
                  {personalBestContent}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {!initialError ? <div className="leaderboard-ref-wars"><ServerWarsTeaser /></div> : null}

        {!initialError ? (
          <AdvancedShowcaseSection payload={advancedPayload} loading={advancedLoading} error={advancedError} />
        ) : null}
      </div>
    </main>
  );
}

function LeaderboardBoardSwitcher({
  activeBoard,
  onChange,
}: {
  activeBoard: LeaderboardBoard;
  onChange: (board: LeaderboardBoard) => void;
}) {
  const boards: Array<{ id: LeaderboardBoard; label: string; icon: typeof Activity }> = [
    { id: "servers", label: "Servers", icon: RadioTower },
    { id: "players", label: "Players", icon: UserRound },
    { id: "records", label: "Records", icon: Trophy },
  ];

  return (
    <div className="leaderboard-ref-board-tabs" role="tablist" aria-label="Leaderboard boards">
      {boards.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeBoard === id}
          aria-controls={`leaderboard-${id}-panel`}
          className="leaderboard-ref-board-tab"
          onClick={() => onChange(id)}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

type LeaderboardPodiumItem = {
  id: string;
  rank: number;
  label: string;
  detail: string;
  href: string | null;
  avatarUrl?: string | null;
  avatarIndex?: number;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
};

function LeaderboardPodium({
  title,
  eyebrow,
  items,
  locked = false,
  lockedText,
}: {
  title: string;
  eyebrow: string;
  items: LeaderboardPodiumItem[];
  locked?: boolean;
  lockedText?: string;
}) {
  return (
    <section className="leaderboard-ref-podium leaderboard-ref-panel" aria-label={title}>
      <div className="leaderboard-ref-podium-head">
        <div>
          <p>{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        <Trophy aria-hidden="true" />
      </div>
      {locked ? (
        <div className="leaderboard-ref-podium-locked">
          <Lock aria-hidden="true" />
          <p>{lockedText ?? "Sign in to view this ranked data."}</p>
          <Link href="/login?returnTo=/leaderboards">Login to unlock <ArrowRight aria-hidden="true" /></Link>
        </div>
      ) : items.length ? (
        <ol className="leaderboard-ref-podium-list">
          {items.map((item, index) => {
            const content = (
              <>
                <span className={`leaderboard-ref-podium-rank leaderboard-ref-podium-rank--${rankTone(index)}`}>#{item.rank}</span>
                {item.avatarUrl ? <PlayerAvatar name={item.label} index={item.avatarIndex ?? index} avatarUrl={item.avatarUrl} /> : null}
                <span className="leaderboard-ref-podium-copy">
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className="leaderboard-ref-podium-metric">
                  <small>{item.primaryLabel}</small>
                  <b>{item.primaryValue}</b>
                </span>
                <span className="leaderboard-ref-podium-metric leaderboard-ref-podium-metric--secondary">
                  <small>{item.secondaryLabel}</small>
                  <b>{item.secondaryValue}</b>
                </span>
                {item.href ? <ArrowRight aria-hidden="true" /> : null}
              </>
            );

            return (
              <li key={item.id} className={`leaderboard-ref-podium-item leaderboard-ref-podium-item--${rankTone(index)}`}>
                {item.href ? <Link href={item.href} prefetch={false} aria-label={`View ${item.label}`}>{content}</Link> : <div>{content}</div>}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="leaderboard-ref-podium-empty">No current ranking entries match this view.</p>
      )}
    </section>
  );
}

function LeaderboardRecordSummary({
  locked,
  bestOverall,
  latestKill,
  onViewRecords,
}: {
  locked: boolean;
  bestOverall: Omit<LongestKill, "rank"> | null;
  latestKill: Omit<LongestKill, "rank"> | null;
  onViewRecords: () => void;
}) {
  return (
    <section className="leaderboard-ref-record-summary leaderboard-ref-panel" aria-labelledby="leaderboard-record-summary-title">
      <div className="leaderboard-ref-record-summary-head">
        <div>
          <p>Distance records</p>
          <h3 id="leaderboard-record-summary-title">Record highlights</h3>
        </div>
        <Crosshair aria-hidden="true" />
      </div>
      {locked ? (
        <p className="leaderboard-ref-record-summary-locked">Player record detail is available after Discord login.</p>
      ) : (
        <dl>
          <div>
            <dt>Best overall</dt>
            <dd>{bestOverall ? formatDistance(bestOverall.distance) : "Awaiting data"}</dd>
          </div>
          <div>
            <dt>Latest confirmed</dt>
            <dd>{latestKill ? formatDistance(latestKill.distance) : "Awaiting data"}</dd>
          </div>
        </dl>
      )}
      <button type="button" onClick={onViewRecords}>View records <ArrowRight aria-hidden="true" /></button>
    </section>
  );
}

function LeaderboardModeSwitcher({
  activeMode,
  onChange,
}: {
  activeMode: LeaderboardMode;
  onChange: (mode: LeaderboardMode) => void;
}) {
  const modes: Array<{ id: LeaderboardMode; label: string; icon: typeof Activity }> = [
    { id: "all", label: "All Modes", icon: LayoutGrid },
    { id: "deathmatch", label: "Deathmatch", icon: Skull },
    { id: "pvp", label: "PvP", icon: Swords },
    { id: "pve", label: "PvE", icon: Users },
    { id: "survival", label: "Survival", icon: Trees },
  ];

  return (
    <div className="leaderboard-ref-mode-tabs" role="group" aria-label="Filter servers by game mode">
      {modes.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={activeMode === id}
          className="leaderboard-ref-mode-tab"
          onClick={() => onChange(id)}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function AdvancedShowcaseSection({ payload, loading, error }: { payload: AdvancedLeaderboardsPayload | null; loading: boolean; error: string }) {
  const boards = (payload?.boards ?? []).filter((board) => board.rows.length > 0 || board.locked).slice(0, 10);
  const categories = payload?.categories?.length
    ? payload.categories
    : ["overall", "pvp", "builds", "hybrid", "premium_showcase"];

  return (
    <section className="dzn-advanced-showcase leaderboard-ref-panel glass-surface animated-border rounded p-4" aria-labelledby="advanced-showcase-title">
      <div className="dzn-advanced-showcase__header">
        <div>
          <p className="dzn-advanced-showcase__eyebrow">Advanced Server Stats</p>
          <h2 id="advanced-showcase-title">Server-first ADM intelligence beyond K/D</h2>
          <p>
            Plan-neutral global server rankings for combat, builds, and hybrid activity. Server-specific travel and map coverage remain available where supported.
          </p>
        </div>
        <div className="dzn-advanced-showcase__meta">
          <span>Raw coordinates hidden</span>
          <span>Bounded queries</span>
          <span>{payload?.generated_at ? `Updated ${formatDateTime(payload.generated_at)}` : "Awaiting snapshot"}</span>
        </div>
      </div>

      <div className="dzn-advanced-tabs" aria-label="Advanced showcase categories">
        {categories.map((category) => (
          <span key={category}>{formatCategory(category)}</span>
        ))}
      </div>

      {loading ? (
        <div className="dzn-advanced-grid">
          {[0, 1, 2].map((item) => (
            <div key={item} className="dzn-advanced-board dzn-advanced-board--loading" />
          ))}
        </div>
      ) : error ? (
        <div className="dzn-advanced-state">{error}</div>
      ) : boards.length ? (
        <div className="dzn-advanced-grid">
          {boards.map((board) => (
            <AdvancedBoardCard key={board.metricKey} board={board} />
          ))}
        </div>
      ) : (
        <div className="dzn-advanced-state">Advanced ADM showcase data is awaiting enough imported events.</div>
      )}

      {payload?.notes?.length ? (
        <div className="dzn-advanced-notes">
          {payload.notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AdvancedBoardCard({ board }: { board: AdvancedBoard }) {
  return (
    <article className={`dzn-advanced-board dzn-advanced-board--${board.packageRequired}`}>
      <div className="dzn-advanced-board__head">
        <AdvancedCategoryIcon category={board.category} />
        <div>
          <h3>{board.title}</h3>
          <p>{board.description}</p>
        </div>
      </div>
      <div className="dzn-advanced-board__badges">
        <span>{formatCategory(board.category)}</span>
        <span>{showcasePlanLabel(board.packageRequired)}</span>
        {board.estimated ? <span>Estimated</span> : null}
      </div>
      {board.locked ? (
        <div className="dzn-advanced-board__locked">
          <Lock className="h-4 w-4" />
          <span>{board.lockedReason ?? "A higher DZN package is required."}</span>
        </div>
      ) : board.rows.length ? (
        <ol className="dzn-advanced-board__rows">
          {board.rows.slice(0, 5).map((row) => (
            <li key={`${board.metricKey}-${row.rank}-${row.serverId ?? row.playerName ?? row.serverName}`}>
              <span className={`leaderboard-ref-rank dzn-rank-badge dzn-rank-badge--${rankTone(row.rank - 1)}`}>#{row.rank}</span>
              <div>
                <strong>{row.serverName ?? row.playerName ?? "Awaiting data"}</strong>
                <small>
                  {[row.serverMode, row.mapName ? publicMapLabel(row.mapName) : null, row.topPlayer ? `Top: ${row.topPlayer}` : null].filter(Boolean).join(" · ")}
                </small>
              </div>
              <b>{row.displayValue}</b>
              {row.serverSlug ? (
                <Link href={`/servers/profile?slug=${encodeURIComponent(row.serverSlug)}`} aria-label={`View ${row.serverName ?? "server"} advanced stats`}>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="dzn-advanced-board__locked">Awaiting enough data.</div>
      )}
    </article>
  );
}

function AdvancedCategoryIcon({ category }: { category: string }) {
  if (category === "builds" || category === "pve") return <Hammer className="h-5 w-5" />;
  if (category === "travel") return <Route className="h-5 w-5" />;
  if (category === "exploration") return <Map className="h-5 w-5" />;
  if (category === "premium_showcase") return <Shield className="h-5 w-5" />;
  if (category === "hybrid" || category === "overall") return <Compass className="h-5 w-5" />;
  return <Crosshair className="h-5 w-5" />;
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
    <section className="leaderboard-ref-panel leaderboard-reference-panel dzn-leaderboard-card glass-surface animated-border rounded p-3 sm:p-4">
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
            <table role="table" aria-label="Personal best kills" className="leaderboard-ref-table dzn-leaderboard-table min-w-full border-separate border-spacing-y-2 text-left">
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
                    <td data-label="Rank" className="border-y border-l border-white/10 px-3 py-2 first:rounded-l">
                      <span className={`leaderboard-ref-rank dzn-rank-badge dzn-rank-badge--${rankTone(index)}`}>#{kill.rank}</span>
                    </td>
                    <td data-label="Player" className="border-y border-white/10 px-3 py-2 text-sm font-black text-white">
                      <PlayerName name={kill.player_name} index={index} href={kill.player_public_profile_href} avatarUrl={kill.player_public_profile_avatar_url} />
                    </td>
                    <td data-label="Victim" className="border-y border-white/10 px-3 py-2 text-sm font-bold text-zinc-200">{kill.victim_name}</td>
                    <td data-label="Server" className="border-y border-white/10 px-3 py-2 text-sm font-bold text-zinc-200">
                      <ServerLink slug={kill.server_slug} label={kill.server_name} />
                    </td>
                    <td data-label="Weapon" className="border-y border-white/10 px-3 py-2 text-sm font-bold text-zinc-200">{kill.weapon}</td>
                    <td data-label="Best Distance" className="border-y border-white/10 px-3 py-2 text-sm font-black text-cyan-100">{formatDistance(kill.distance)}</td>
                    <td data-label="Time" className="rounded-r border-y border-r border-white/10 px-3 py-2 text-sm font-bold text-zinc-300">{formatDateTime(kill.occurred_at)}</td>
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
              <InlinePlayerProfileLink name={kill.player_name} href={kill.player_public_profile_href} avatarUrl={kill.player_public_profile_avatar_url} /> eliminated {kill.victim_name} with {kill.weapon}
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
  rankValues,
}: {
  title: string;
  icon: typeof Activity;
  headers: string[];
  rows: Array<Array<ReactNode>>;
  empty: string;
  actionLabel?: string;
  actionHref?: string;
  rankValues?: number[];
}) {
  return (
    <section className="leaderboard-ref-panel leaderboard-reference-panel dzn-leaderboard-card glass-surface animated-border rounded p-4">
      <div className="relative z-10">
        <div className="leaderboard-reference-panel-header flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <Icon className="h-5 w-5 text-violet-200" />
            <h2 className="text-xl font-black uppercase text-white">{title}</h2>
          </div>
          {actionLabel && actionHref ? (
            <Link href={actionHref} className="leaderboard-reference-panel-action inline-flex items-center gap-1 rounded border border-violet-300/20 bg-violet-500/10 px-2.5 py-1.5 text-[10px] font-black uppercase text-violet-100">
              {actionLabel}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
        {rows.length ? (
          <div className="dzn-leaderboard-table-wrap mt-2.5 overflow-x-auto">
            <table role="table" aria-label={title} className="leaderboard-ref-table dzn-leaderboard-table min-w-full border-separate border-spacing-y-1 text-left">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th key={header} className="px-2.5 py-1.5 text-xs font-black uppercase text-zinc-500">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => {
                  const rowRank = rankValues?.[rowIndex] ?? rowIndex + 1;
                  const rowTone = rankTone(rowRank - 1);
                  return (
                  <tr key={rowIndex} className={`dzn-leaderboard-row dzn-leaderboard-row--${rowTone} rounded-lg bg-black/24`}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} data-label={headers[cellIndex]} className="border-y border-white/10 px-2.5 py-1.5 first:rounded-l last:rounded-r">
                        <span className={cellIndex === 0 ? `leaderboard-ref-rank dzn-rank-badge dzn-rank-badge--${rowTone}` : "text-sm font-bold text-zinc-100"}>
                          {cell}
                        </span>
                      </td>
                    ))}
                  </tr>
                  );
                })}
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

function FullLeaderboardDirectory({
  title,
  icon: Icon,
  headers,
  rows,
  rankValues,
  search,
  onSearchChange,
  searchLabel,
  searchPlaceholder,
  visibleCount,
  onShowMore,
  loading,
  error,
  onRetry,
  total,
  capped,
  empty,
}: {
  title: string;
  icon: typeof Activity;
  headers: string[];
  rows: Array<Array<ReactNode>>;
  rankValues: number[];
  search: string;
  onSearchChange: (value: string) => void;
  searchLabel: string;
  searchPlaceholder: string;
  visibleCount: number;
  onShowMore: () => void;
  loading: boolean;
  error: string;
  onRetry: () => void;
  total: number;
  capped: boolean;
  empty: string;
}) {
  const shownRows = rows.slice(0, visibleCount);
  const searching = search.trim().length > 0;
  const visibleLabel = loading ? "Loading ranked entries..." : `${shownRows.length} of ${rows.length}${searching ? " matching" : " shown"}`;
  const id = `${title.toLowerCase().replaceAll(" ", "-")}-title`;

  return (
    <section className="leaderboard-ref-directory leaderboard-ref-panel leaderboard-reference-panel dzn-leaderboard-card glass-surface animated-border rounded p-3 sm:p-4" aria-labelledby={id}>
      <div className="relative z-10">
        <div className="leaderboard-reference-panel-header flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-3">
            <Icon className="h-5 w-5 text-cyan-200" />
            <div>
              <p className="leaderboard-ref-directory-eyebrow">Browse the ranking</p>
              <h2 id={id} className="text-xl font-black uppercase text-white">{title}</h2>
            </div>
          </div>
          <p className="leaderboard-ref-directory-cap">{capped ? `First ${DIRECTORY_MAX_RANKS} public ranks` : `${total} ranked entries`}</p>
        </div>

        <div className="leaderboard-ref-directory-toolbar">
          <label className="leaderboard-ref-directory-search">
            <Search aria-hidden="true" />
            <span className="sr-only">{searchLabel}</span>
            <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} type="search" />
            {search ? (
              <button type="button" aria-label="Clear leaderboard search" onClick={() => onSearchChange("")}>
                <X aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <p className="leaderboard-ref-directory-count" aria-live="polite">{visibleLabel}</p>
        </div>

        {loading ? (
          <div className="leaderboard-ref-directory-state" aria-live="polite">Loading the full public ranking...</div>
        ) : error ? (
          <div className="leaderboard-ref-directory-state leaderboard-ref-directory-state--error">
            <span>{error}</span>
            <button type="button" onClick={onRetry}>Retry</button>
          </div>
        ) : rows.length ? (
          <>
            <div className="leaderboard-ref-directory-scroll dzn-leaderboard-table-wrap">
              <table role="table" aria-label={title} className="leaderboard-ref-table dzn-leaderboard-table min-w-full border-separate border-spacing-y-1 text-left">
                <thead>
                  <tr>
                    {headers.map((header) => <th key={header}>{header}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((row, rowIndex) => {
                    const rowRank = rankValues[rowIndex] ?? rowIndex + 1;
                    const rowTone = rankTone(rowRank - 1);
                    return (
                      <tr key={rowRank} className={`dzn-leaderboard-row dzn-leaderboard-row--${rowTone} rounded-lg bg-black/24`}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} data-label={headers[cellIndex]}>
                            <span className={cellIndex === 0 ? `leaderboard-ref-rank dzn-rank-badge dzn-rank-badge--${rowTone}` : "text-sm font-bold text-zinc-100"}>{cell}</span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="leaderboard-ref-directory-footer">
              <span>{capped ? `Rankings are capped at the first ${DIRECTORY_MAX_RANKS} public positions.` : "Every available public rank is shown."}</span>
              {shownRows.length < rows.length ? (
                <button type="button" onClick={onShowMore} className="leaderboard-ref-directory-more">
                  Show {Math.min(DIRECTORY_VISIBLE_STEP, rows.length - shownRows.length)} more
                  <ChevronDown aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="leaderboard-ref-directory-state">{empty}</div>
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

function PlayerName({ name, index, href, avatarUrl }: { name: string; index: number; href?: string | null; avatarUrl?: string | null }) {
  const safeHref = safePublicProfileHref(href);
  const nameContent = (
    <>
      <PlayerAvatar key={`${name}:${avatarUrl ?? ""}`} name={name} index={index} avatarUrl={avatarUrl} />
      <span className="leaderboard-ref-player-copy">
        <strong>{name}</strong>
        {safeHref ? <small>DZN public profile</small> : <small>Leaderboard player</small>}
      </span>
    </>
  );

  if (!safeHref) {
    return (
      <span className="leaderboard-ref-player leaderboard-reference-player inline-flex items-center gap-2">
        {nameContent}
      </span>
    );
  }

  return (
    <Link
      href={safeHref}
      prefetch={false}
      aria-label={`View public profile for ${name}`}
      className="leaderboard-ref-player leaderboard-reference-player inline-flex items-center gap-2 text-white transition hover:text-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
    >
      {nameContent}
    </Link>
  );
}

function PlayerAvatar({ name, index, avatarUrl, compact = false }: { name: string; index: number; avatarUrl?: string | null; compact?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const safeAvatarUrl = safePublicProfileAvatarUrl(avatarUrl);
  const className = `leaderboard-reference-avatar leaderboard-reference-avatar--${rankTone(index)}${compact ? " leaderboard-reference-avatar--compact" : ""}`;

  return (
    <span className={className} aria-hidden="true">
      {safeAvatarUrl && !imageFailed ? (
        <Image src={safeAvatarUrl} alt="" width={48} height={48} unoptimized onError={() => setImageFailed(true)} />
      ) : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function InlinePlayerProfileLink({ name, href, avatarUrl }: { name: string; href?: string | null; avatarUrl?: string | null }) {
  const safeHref = safePublicProfileHref(href);
  if (!safeHref) return <>{name}</>;
  return (
    <Link href={safeHref} prefetch={false} className="leaderboard-ref-inline-player text-cyan-100 transition hover:text-white" aria-label={`View public profile for ${name}`}>
      <PlayerAvatar key={`${name}:${avatarUrl ?? ""}`} name={name} index={3} avatarUrl={avatarUrl} compact />
      {name}
    </Link>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const normalized = mode.trim() || "Unknown";
  return (
    <span className={`leaderboard-ref-mode-badge leaderboard-ref-mode-badge--${modeTone(normalized)}`}>
      <Gamepad2 aria-hidden="true" />
      {normalized}
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

function normalizeDirectoryPayload(data: LeaderboardsPayload, directory: LeaderboardDirectory) {
  const normalized = normalizePayload(data);
  const rows = directory === "servers" ? normalized.top_servers : normalized.top_players;
  return {
    ...normalized,
    directory,
    directory_cap: Math.max(0, numberOrZero(data.directory_cap) || DIRECTORY_MAX_RANKS),
    directory_total: Math.max(rows.length, numberOrZero(data.directory_total)),
    directory_capped: Boolean(data.directory_capped),
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
    if (normalized.access_level !== "preview" || normalized.is_locked !== true) {
      window.localStorage.removeItem(LEADERBOARD_LAST_GOOD_KEY);
      return null;
    }
    return hasMeaningfulLeaderboard(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function saveLastGoodLeaderboard(payload: ReturnType<typeof normalizePayload>) {
  if (typeof window === "undefined") return;
  if (payload.access_level !== "preview" || payload.is_locked !== true) return;
  try {
    const snapshot = stripVolatileLeaderboardProfileLinks({ ...payload, cached_at: new Date().toISOString() });
    window.localStorage.setItem(LEADERBOARD_LAST_GOOD_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable in private/hardened contexts.
  }
}

function stripVolatileLeaderboardProfileLinks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileLeaderboardProfileLinks);
  if (!value || typeof value !== "object") return value;

  const stripped: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isVolatilePublicProfileLinkKey(key)) continue;
    stripped[key] = stripVolatileLeaderboardProfileLinks(child);
  }
  return stripped;
}

function isVolatilePublicProfileLinkKey(key: string) {
  return key === "public_profile_handle"
    || key === "public_profile_href"
    || key === "public_profile_avatar_url"
    || key === "player_public_profile_handle"
    || key === "player_public_profile_href"
    || key === "player_public_profile_avatar_url";
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
    category: server.category || server.mode || "UNKNOWN",
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
    public_profile_handle: typeof player.public_profile_handle === "string" ? player.public_profile_handle : null,
    public_profile_href: safePublicProfileHref(player.public_profile_href),
    public_profile_avatar_url: safePublicProfileAvatarUrl(player.public_profile_avatar_url),
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
    player_public_profile_handle: typeof kill.player_public_profile_handle === "string" ? kill.player_public_profile_handle : null,
    player_public_profile_href: safePublicProfileHref(kill.player_public_profile_href),
    player_public_profile_avatar_url: safePublicProfileAvatarUrl(kill.player_public_profile_avatar_url),
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
    player_public_profile_handle: typeof kill.player_public_profile_handle === "string" ? kill.player_public_profile_handle : null,
    player_public_profile_href: safePublicProfileHref(kill.player_public_profile_href),
    player_public_profile_avatar_url: safePublicProfileAvatarUrl(kill.player_public_profile_avatar_url),
  };
}

function safePublicProfileHref(value: string | null | undefined) {
  return typeof value === "string" && /^\/players\/[a-z0-9-]{3,48}$/.test(value) ? value : null;
}

function safePublicProfileAvatarUrl(value: string | null | undefined) {
  return typeof value === "string" && /^\/api\/public\/players\/[a-z0-9-]{3,48}\/avatar$/.test(value) ? value : null;
}

function matchesLeaderboardMode(mode: string, filter: LeaderboardMode) {
  if (filter === "all") return true;
  const category = mode.trim().toLowerCase();
  const normalized = mode.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const tokens = normalized.trim().split(/\s+/);
  if (filter === "deathmatch") return normalized.includes("deathmatch") || tokens.includes("dm");
  if (filter === "survival") return category === "pve" || category === "pvp_pve";
  return tokens.includes(filter);
}

function formatModeFilter(mode: LeaderboardMode) {
  if (mode === "pvp") return "PvP";
  if (mode === "pve") return "PvE";
  return mode.replace(/^./, (letter) => letter.toUpperCase());
}

function modeTone(mode: string) {
  const normalized = mode.toLowerCase();
  if (normalized.includes("deathmatch")) return "deathmatch";
  if (normalized.includes("pvp")) return "pvp";
  if (normalized.includes("pve")) return "pve";
  if (normalized.includes("survival")) return "survival";
  return "standard";
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

function formatCategory(value: string) {
  if (value === "premium_showcase") return "Advanced Showcase";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
