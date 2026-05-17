"use client";

import {
  Activity,
  BarChart3,
  ChevronRight,
  Crosshair,
  Flag,
  Globe2,
  Hammer,
  Play,
  Radio,
  Server,
  Shield,
  Skull,
  Swords,
  Trophy,
  Users,
  Wifi,
  Timer,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "framer-motion";
import type { Variants } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { clearClientAuthState, logoutAndRedirect } from "@/components/onboarding/api";
import { DznLogo } from "./dzn-logo";
import type { DznOperationalGlobeNode } from "./dzn-operational-globe";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.68, ease: "easeOut" },
  },
};

const stagger: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
};

type HomeTopServer = {
  public_slug: string | null;
  server_name: string;
  guild_name: string | null;
  server_type: string | null;
  total_kills: number;
  total_deaths?: number;
  unique_players: number;
  total_joins?: number;
  longest_kill?: number;
  stats_active: boolean;
  rank?: number;
  score?: number;
  score_label?: string;
  score_breakdown?: ScoreBreakdown | null;
};

type HomeStats = {
  totals: {
    serversLinked: number;
    statsActiveServers: number;
    playersSeen: number;
    killsTracked: number;
    deathsTracked: number;
    joinsTracked: number;
    longestKill: number;
    recentEventsCount: number;
    structuresBuilt: number;
    buildScore: number;
  };
  network_pulse: {
    active_servers: number;
    events: number;
    top_server: HomeTopServer | null;
    best_kd: number | null;
    current_event: PublicNetworkEvent | null;
  };
  event_leaderboard: PublicEventLeaderboard | null;
  top_build_servers: PublicBuildServer[];
  topServers: HomeTopServer[];
  topPlayers: Array<{
    rank: number;
    playerName: string;
    serverName: string;
    publicSlug: string | null;
    kills: number;
    deaths: number;
    kd: number;
    longestKill: number;
  }>;
  recentActivity: Array<{
    source: "kill" | "player" | "build" | "sync" | "server";
    eventType: string;
    title: string;
    serverName: string | null;
    publicSlug: string | null;
    occurredAt: string | null;
  }>;
  map_nodes: Array<DznOperationalGlobeNode>;
  gameModes: {
    pvp: number;
    pve: number;
    deathmatch: number;
    pvpPve: number;
  };
  syncHealth: {
    active: number;
    pending: number;
  };
  access_level: "full" | "preview";
  is_locked: boolean;
  locked_reason: string | null;
};

type PublicNetworkEvent = {
  id?: string;
  type: "build" | "pvp" | "survival" | "faction" | "activity" | string;
  title: string;
  status?: "active" | "coming_soon" | string;
  description?: string | null;
  ends_at?: string | null;
};

type PublicBuildServer = {
  rank: number;
  server_id: string;
  server_name: string;
  slug: string | null;
  structures_built: number;
  build_items_placed: number;
  storage_items_placed: number;
  traps_placed: number;
  build_score: number;
  top_builder_name: string | null;
  top_builder_count: number;
  last_build_at: string | null;
};

type PublicEventLeaderboard = {
  event_type: string;
  title: string;
  rows: Array<Record<string, unknown>>;
};

type HomeStatsResponse = Partial<HomeStats> & {
  ok?: boolean;
  error?: string;
};

type TopServerPanelRow = {
  rank: number;
  server: string;
  kd: string;
  kills: string;
  score: string;
  scoreTitle: string;
  href: string;
  active: boolean;
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

type ActivityPanelRow = {
  title: string;
  detail: string;
  time: string;
  icon: LucideIcon;
  tone: string;
};

const emptyHomeStats: HomeStats = {
  totals: {
    serversLinked: 0,
    statsActiveServers: 0,
    playersSeen: 0,
    killsTracked: 0,
    deathsTracked: 0,
    joinsTracked: 0,
    longestKill: 0,
    recentEventsCount: 0,
    structuresBuilt: 0,
    buildScore: 0,
  },
  network_pulse: {
    active_servers: 0,
    events: 0,
    top_server: null,
    best_kd: null,
    current_event: null,
  },
  event_leaderboard: null,
  top_build_servers: [],
  topServers: [],
  topPlayers: [],
  recentActivity: [],
  map_nodes: [],
  gameModes: {
    pvp: 0,
    pve: 0,
    deathmatch: 0,
    pvpPve: 0,
  },
  syncHealth: {
    active: 0,
    pending: 0,
  },
  access_level: "full",
  is_locked: false,
  locked_reason: null,
};

const HOME_STATS_REFRESH_MS = 30000;
const CINEMATIC_BG = "/media/dzn-cinematic-survivor.png";
const DZN_DISCORD_INVITE_URL =
  process.env.NEXT_PUBLIC_DZN_DISCORD_INVITE_URL ||
  "https://discord.gg/T2cgcTYPFV";
const DznOperationalGlobe = dynamic(
  () => import("./dzn-operational-globe").then((module) => module.DznOperationalGlobe),
  {
    ssr: false,
    loading: () => <DznOperationalGlobePlaceholder />,
  },
);

const navItems = [
  { label: "Features", href: "#features" },
  { label: "Leaderboards", href: "/leaderboards" },
  { label: "Servers", href: "/servers" },
  { label: "Stats", href: "#stats" },
  { label: "Events", href: "#server-events" },
];

const fallbackTopServers = [
  "Warlords Network",
  "Outbreak RP",
  "Rogue Survival",
  "DeadZone EU",
  "Last Haven",
].map<TopServerPanelRow>((server, index) => ({
  rank: index + 1,
  server,
  kd: "Awaiting data",
  kills: "0",
  score: "Pending",
  scoreTitle: "Score is based on confirmed kills, unique players, joins, longest kill, deaths, and sync health.",
  href: "/servers",
  active: false,
}));

const featureCards = [
  {
    title: "Global Server Leaderboards",
    description: "Rank connected DayZ servers by kills, K/D, activity, survival records, and reputation.",
    icon: Trophy,
    accent: "from-violet-400/25 to-cyan-300/10",
  },
  {
    title: "Server Categories",
    description: "PvP, PvE, Deathmatch, faction worlds, hardcore shards, roleplay, economy, and custom maps.",
    icon: Server,
    accent: "from-cyan-300/20 to-blue-400/10",
  },
  {
    title: "Faction Wars",
    description: "Every player and faction contributes to server ranking, reputation, and event momentum.",
    icon: Flag,
    accent: "from-emerald-300/18 to-cyan-300/10",
  },
  {
    title: "Server Analytics",
    description: "ADM-backed activity, kills, deaths, joins, disconnects, and server health in one control layer.",
    icon: BarChart3,
    accent: "from-fuchsia-400/20 to-violet-500/10",
  },
  {
    title: "Server vs Server Events",
    description: "Monthly server wars and seasonal stat battles are coming soon across kills, K/D, longest kills, factions, activity, and score.",
    icon: Swords,
    accent: "from-orange-300/16 to-violet-500/12",
  },
];

function useHomeStats() {
  const [data, setData] = useState<HomeStats>(emptyHomeStats);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch("/api/public/home-stats", {
          credentials: "include",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as HomeStatsResponse;
        if (!response.ok) throw new Error(payload.error || "Live stats unavailable");
        if (!active) return;
        setData(normalizeHomeStats(payload));
        setLastUpdated(new Date());
        setError("");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (active) setError("Live stats temporarily unavailable.");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        inFlight.current = false;
      }
    }

    load();
    const interval = window.setInterval(load, HOME_STATS_REFRESH_MS);
    return () => {
      active = false;
      abortRef.current?.abort();
      window.clearInterval(interval);
    };
  }, []);

  return { data, lastUpdated, error };
}

export function DznLandingPage() {
  const reduceMotion = useReducedMotion();
  const [isLoading, setIsLoading] = useState(true);
  const liveStats = useHomeStats();

  useEffect(() => {
    console.log("DZN SERVER COMPETITION HOMEPAGE WITH ANIMATED LOGO LOADED");
    console.log("DZN SERVER RANKING SYSTEM LOADED");
    console.log("DZN LIVE HOMEPAGE EXPERIENCE LOADED");
    console.log("DZN HOMEPAGE WORLD MAP LIVE");
    console.log("DZN HOMEPAGE MAP AND LAYOUT FINALIZED");
    console.log("DZN WORLD MAP VISUAL MATCHED");
    console.log("DZN HOMEPAGE PERFORMANCE OPTIMIZED");
    console.log("DZN GAME MODE CARDS UPGRADED");
    console.log("DZN HOMEPAGE STATS ROW UPGRADED");
    console.log("DZN TOP SERVERS PANEL UPGRADED");
    console.log("DZN NAVBAR DISCORD LINK UPGRADED");
    console.log("DZN PUBLIC ACCESS GATING READY");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsLoading(false), reduceMotion ? 120 : 950);
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="dzn-home-page relative isolate min-h-screen overflow-hidden bg-[#02030a] text-zinc-100"
        style={{ "--dzn-home-bg": `url("${CINEMATIC_BG}")` } as CSSProperties}
      >
        <HomeAliveBackground reducedMotion={Boolean(reduceMotion)} />
        <LoadingOverlay isVisible={isLoading} />
        <Navbar />

        <motion.main
          initial="hidden"
          animate="show"
          variants={stagger}
          className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-col gap-[18px] px-4 pb-7 pt-3 sm:px-6 lg:px-8"
        >
          <HeroDashboard
            homeStats={liveStats.data}
            lastUpdated={liveStats.lastUpdated}
            error={liveStats.error}
          />
          {liveStats.data.is_locked ? <HomepagePreviewUnlock /> : null}
          <GameModeGrid counts={liveStats.data.gameModes} />
          <NetworkOverview homeStats={liveStats.data} />
          <NetworkPulse homeStats={liveStats.data} />
          <EventLeaderboardPanel homeStats={liveStats.data} />
          <BottomCta />
        </motion.main>

        <Footer />
      </div>
    </MotionConfig>
  );
}

function HomeAliveBackground({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="dzn-home-bg-image" />
      <div className="dzn-home-haze" />
      <div className="dzn-home-grid" />
      <div className="dzn-home-horizon-glow" />
      {reducedMotion ? null : (
        <>
          <div className="dzn-home-smoke dzn-home-smoke-one" />
          <div className="dzn-home-smoke dzn-home-smoke-two" />
          {Array.from({ length: 48 }).map((_, index) => (
            <span
              key={index}
              className="dzn-home-particle"
              style={{
                left: `${(index * 29) % 100}%`,
                top: `${(index * 43) % 100}%`,
                animationDelay: `${(index % 16) * 0.32}s`,
                animationDuration: `${12 + (index % 9)}s`,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

function LoadingOverlay({ isVisible }: { isVisible: boolean }) {
  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          className="fixed inset-0 z-[90] grid place-items-center bg-[#02030a]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.55, ease: "easeOut" } }}
        >
          <motion.div
            className="relative flex w-[min(86vw,360px)] flex-col items-center gap-5"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          >
            <DznLogo />
            <div className="h-px w-full overflow-hidden bg-white/10">
              <motion.div
                className="h-full bg-gradient-to-r from-cyan-300 via-violet-300 to-orange-300"
                initial={{ x: "-100%" }}
                animate={{ x: "100%" }}
                transition={{ duration: 0.95, ease: "easeInOut", repeat: Infinity }}
              />
            </div>
            <p className="text-xs font-semibold uppercase text-violet-100/65">
              Synchronizing server competition telemetry
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Navbar() {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
      .then((response) => setAuthenticated(response.ok))
      .catch(() => setAuthenticated(false));
  }, []);

  async function signOut() {
    clearClientAuthState();
    setAuthenticated(false);
    await logoutAndRedirect();
  }

  return (
    <motion.header
      initial={{ opacity: 0, y: -18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, ease: "easeOut" }}
      className="dzn-main-nav"
    >
      <div className="dzn-main-nav-inner">
        <DznLogo compact className="dzn-main-nav-logo" />
        <nav aria-label="Homepage sections" className="dzn-main-nav-links">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="dzn-main-nav-actions">
          <a
            href={DZN_DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="dzn-nav-action dzn-nav-action--discord"
          >
            <DiscordIcon className="dzn-nav-discord-icon" />
            <span>Discord</span>
          </a>
          {authenticated ? (
            <>
              <a
                href="/dashboard"
                className="dzn-nav-action dzn-nav-action--dashboard"
              >
                Dashboard
              </a>
              <button
                type="button"
                onClick={signOut}
                className="dzn-nav-action dzn-nav-action--logout"
              >
                Logout
              </button>
            </>
          ) : (
            <a
              href="/login?returnTo=/"
              className="dzn-nav-action dzn-nav-action--login"
            >
              Login
            </a>
          )}
        </div>
      </div>
    </motion.header>
  );
}

function DiscordIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M20.317 4.369A19.791 19.791 0 0 0 15.558 3c-.206.371-.446.872-.611 1.267a18.27 18.27 0 0 0-5.487 0A12.64 12.64 0 0 0 8.849 3a19.736 19.736 0 0 0-4.762 1.369C1.094 8.873.287 13.265.692 17.595A19.9 19.9 0 0 0 6.533 20.5c.472-.643.892-1.327 1.249-2.044a12.93 12.93 0 0 1-1.966-.944c.165-.12.326-.246.481-.375a14.18 14.18 0 0 0 11.406 0c.157.129.318.255.482.375-.626.37-1.287.687-1.969.945.357.716.777 1.4 1.249 2.043a19.86 19.86 0 0 0 5.844-2.905c.475-5.026-.811-9.377-2.992-13.226ZM8.02 14.934c-1.14 0-2.073-1.04-2.073-2.319 0-1.279.915-2.319 2.073-2.319 1.164 0 2.091 1.049 2.073 2.319 0 1.279-.915 2.319-2.073 2.319Zm7.96 0c-1.14 0-2.073-1.04-2.073-2.319 0-1.279.915-2.319 2.073-2.319 1.164 0 2.091 1.049 2.073 2.319 0 1.279-.909 2.319-2.073 2.319Z" />
    </svg>
  );
}

function HeroDashboard({
  homeStats,
  lastUpdated,
  error,
}: {
  homeStats: HomeStats;
  lastUpdated: Date | null;
  error: string;
}) {
  const serverRows = useMemo(() => buildTopServerRows(homeStats), [homeStats]);
  const activityRows = useMemo(() => buildActivityRows(homeStats), [homeStats]);

  return (
    <motion.section
      variants={stagger}
      className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.85fr)]"
    >
      <motion.div
        variants={fadeUp}
        className="dzn-home-hero-card order-1 relative overflow-hidden rounded-xl border border-violet-300/18 bg-[#060a15]/64 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-7 lg:min-h-[430px] xl:col-start-1 xl:row-start-1"
      >
        <div className="dzn-home-energy-beam" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#02030a] via-[#02030a]/54 to-transparent" />

        <div className="relative z-10 flex h-full flex-col justify-between gap-7">
          <div className="max-w-3xl">
            <motion.div
              variants={fadeUp}
              className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-300/25 bg-violet-400/10 px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.22em] text-violet-100 shadow-[0_0_26px_rgba(139,92,246,0.18)]"
            >
              <Shield className="h-3.5 w-3.5" />
              The universal DayZ server network
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.95)]" />
            </motion.div>
            <motion.h1
              variants={fadeUp}
              className="max-w-4xl text-5xl font-black uppercase leading-[0.9] tracking-normal text-white drop-shadow-[0_0_28px_rgba(139,92,246,0.3)] sm:text-6xl lg:text-7xl xl:text-[5.35rem]"
            >
              One Network.
              <span className="block bg-gradient-to-r from-violet-200 via-violet-400 to-cyan-200 bg-clip-text text-transparent">
                Every Server.
              </span>
            </motion.h1>
            <motion.p
              variants={fadeUp}
              className="mt-5 max-w-2xl text-base leading-7 text-zinc-200/82 sm:text-lg"
            >
              Connected servers compete across live stat categories. Track kills,
              K/D, longest kills, survival records, factions, activity, and server
              reputation.
            </motion.p>
            <motion.p
              variants={fadeUp}
              className="mt-2 text-xl font-black uppercase text-white sm:text-2xl"
            >
              Prove your server is the best.
            </motion.p>
          </div>

          <motion.div variants={fadeUp} className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href="/leaderboards"
                className="group inline-flex items-center justify-center gap-2 rounded-lg border border-violet-200/45 bg-violet-600/86 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[0_0_34px_rgba(124,58,237,0.42)] transition duration-300 hover:-translate-y-0.5 hover:bg-violet-500"
              >
                <Trophy className="h-4 w-4" />
                View Leaderboards
                <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </a>
              <a
                href="/login?returnTo=/setup"
                className="group inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.055] px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-zinc-100 transition duration-300 hover:-translate-y-0.5 hover:border-cyan-200/45 hover:bg-cyan-300/10 hover:text-white"
              >
                <Play className="h-4 w-4" />
                Add Your Server
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-zinc-400">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1 text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.95)]" />
                Live data
              </span>
              <span>
                Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "syncing"}
              </span>
              {error ? <span className="text-amber-200">{error}</span> : null}
            </div>
          </motion.div>
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="order-2 flex flex-col gap-4 xl:col-start-2 xl:row-span-2 xl:row-start-1">
        <TopServersPanel rows={serverRows} />
        <RecentActivityPanel rows={activityRows} />
        <LiveMapPanel homeStats={homeStats} />
      </motion.div>

      <FeatureStrip className="order-3 xl:col-start-1 xl:row-start-2" />
    </motion.section>
  );
}

function HomepagePreviewUnlock() {
  return (
    <motion.section variants={fadeUp} className="rounded-xl border border-violet-300/22 bg-[#050815]/72 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.32),0_0_28px_rgba(139,92,246,0.16)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-100">Preview mode</p>
          <h2 className="mt-1 text-xl font-black text-white">Login with Discord to unlock full network stats</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
            Public visitors can preview top servers and basic activity. Full server profiles, leaderboards, reviews, Discord invites, and detailed player stats unlock after Discord login.
          </p>
        </div>
        <a href="/login?returnTo=/" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-violet-500 px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-white shadow-[0_0_24px_rgba(139,92,246,0.32)] transition hover:bg-violet-400">
          Login with Discord
          <ChevronRight className="h-4 w-4" />
        </a>
      </div>
    </motion.section>
  );
}

function TopServersPanel({ rows }: { rows: TopServerPanelRow[] }) {
  return (
    <section className="dzn-home-panel dzn-top-servers-panel">
      <div className="dzn-top-servers-header">
        <div className="dzn-top-servers-title-group">
          <span className="dzn-top-servers-icon" aria-hidden="true">
            <Trophy className="h-4 w-4" />
          </span>
          <h2>Top Servers</h2>
        </div>
        <a href="/leaderboards" className="dzn-top-servers-view">
          View All <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>

      <div className="dzn-top-servers-table">
        <div className="dzn-top-servers-columns" aria-hidden="true">
          <span>#</span>
          <span>Server</span>
          <span>K/D</span>
          <span>Kills</span>
          <span>Score</span>
        </div>
        <div className="dzn-top-servers-rows">
          {rows.slice(0, 3).map((row) => (
            <a
              key={`${row.rank}-${row.server}`}
              href={row.href}
              title={row.server}
              className="dzn-top-server-row"
            >
              <span className="dzn-top-server-rank">{row.rank}</span>
              <span className="dzn-top-server-name">{row.server}</span>
              <span title={row.kd} className="dzn-top-server-stat dzn-top-server-kd">{row.kd}</span>
              <span className="dzn-top-server-stat dzn-top-server-kills">{row.kills}</span>
              <span
                title={row.scoreTitle}
                className={row.active ? "dzn-top-server-score" : "dzn-top-server-score dzn-top-server-score--pending"}
              >
                {row.score}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function RecentActivityPanel({ rows }: { rows: ActivityPanelRow[] }) {
  return (
    <PanelShell title="Recent Activity" href="/servers" icon={Activity}>
      <div className="grid gap-2">
        {rows.slice(0, 4).map((row, index) => {
          const Icon = row.icon;
          return (
            <div
              key={`${row.title}-${index}`}
              className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2.5 py-1.5"
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border ${row.tone}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-black uppercase text-white">{row.title}</p>
                <p className="truncate text-[0.7rem] text-zinc-400">{row.detail}</p>
              </div>
              <span className="text-[0.68rem] font-semibold text-zinc-500">{row.time}</span>
            </div>
          );
        })}
      </div>
    </PanelShell>
  );
}

function LiveMapPanel({ homeStats }: { homeStats: HomeStats }) {
  const nodes = homeStats.map_nodes;

  return (
    <div className="dzn-home-panel relative overflow-hidden rounded-xl border border-cyan-300/15 bg-cyan-300/[0.045] p-4 shadow-[0_0_38px_rgba(14,165,233,0.08)]">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.08),transparent)] opacity-60" />
      <div className="relative grid gap-3">
        <div>
          <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-cyan-200">
            Live Operational Map
          </p>
          <p className="mt-1 text-sm font-bold text-white">DZN network intelligence online</p>
          <p className="mt-1 text-xs text-zinc-400">
            {homeStats.syncHealth.active > 0
              ? `${homeStats.syncHealth.active} active public sync node${homeStats.syncHealth.active === 1 ? "" : "s"}`
              : "Public server signals connected"}
          </p>
        </div>
        <DznOperationalGlobe nodes={nodes} />
      </div>
      <div className="relative mt-3 grid grid-cols-3 gap-2 text-center">
        <MiniMetric label="Sync Active" value={formatNumber(homeStats.syncHealth.active)} />
        <MiniMetric label="Pending" value={formatNumber(homeStats.syncHealth.pending)} />
        <MiniMetric label="Events" value={formatNumber(homeStats.totals.recentEventsCount)} />
      </div>
    </div>
  );
}

function DznOperationalGlobePlaceholder() {
  return (
    <div
      className="dzn-operational-globe-stage dzn-operational-globe-stage--placeholder"
      role="status"
      aria-live="polite"
      aria-label="Loading live DZN operational globe"
    >
      <span className="dzn-operational-globe-orbit dzn-operational-globe-orbit-one" aria-hidden="true" />
      <span className="dzn-operational-globe-orbit dzn-operational-globe-orbit-two" aria-hidden="true" />
      <span className="dzn-operational-globe-floor-glow" aria-hidden="true" />
      <span className="dzn-operational-globe-placeholder-sphere" aria-hidden="true" />
      <span className="dzn-operational-globe-fallback">Loading live globe...</span>
    </div>
  );
}

function FeatureStrip({ className = "" }: { className?: string }) {
  return (
    <motion.section variants={fadeUp} id="features" className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-5 ${className}`}>
      {featureCards.map((feature) => {
        const Icon = feature.icon;
        return (
          <motion.article
            key={feature.title}
            id={feature.title === "Server vs Server Events" ? "server-events" : undefined}
            whileHover={{ y: -4 }}
            className="dzn-home-card group relative min-h-[176px] scroll-mt-28 overflow-hidden rounded-xl border border-white/10 bg-[#070b16]/74 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl transition duration-300 hover:border-violet-300/32"
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${feature.accent} opacity-0 transition duration-300 group-hover:opacity-100`} />
            <div className="relative z-10">
              <span className="grid h-10 w-10 place-items-center rounded-lg border border-violet-300/20 bg-violet-400/10 text-violet-100 shadow-[0_0_22px_rgba(139,92,246,0.14)]">
                <Icon className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-sm font-black uppercase leading-snug text-white">
                {feature.title}
              </h2>
              <p className="mt-2 text-xs leading-5 text-zinc-400">{feature.description}</p>
            </div>
          </motion.article>
        );
      })}
    </motion.section>
  );
}

function GameModeGrid({ counts }: { counts: HomeStats["gameModes"] }) {
  const modes = [
    {
      title: "PVP",
      count: counts.pvp,
      description: "High-risk servers competing on confirmed kills, K/D, and longest shots.",
      icon: Crosshair,
      theme: "pvp",
    },
    {
      title: "DEATHMATCH",
      count: counts.deathmatch,
      description: "Fast combat communities pushing activity, volume, and clean kill tracking.",
      icon: Skull,
      theme: "deathmatch",
    },
    {
      title: "PVE",
      count: counts.pve,
      description: "Survival-focused servers building longevity, events, and community reputation.",
      icon: Shield,
      theme: "pve",
    },
    {
      title: "PVP / PVE",
      count: counts.pvpPve,
      description: "Hybrid worlds where factions, raids, survival, and competition all count.",
      icon: Swords,
      theme: "hybrid",
    },
  ];

  return (
    <motion.section variants={fadeUp} className="dzn-home-panel dzn-game-modes-section rounded-xl border border-white/10 bg-[#050914]/66 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-violet-200">Game Modes</p>
          <h2 className="text-xl font-black uppercase text-white">Find your battleground</h2>
        </div>
        <Link href="/servers" className="dzn-game-modes-view-all text-[0.68rem] font-black uppercase tracking-[0.14em] text-cyan-200 hover:text-white">
          View servers <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const count = numberOrZero(mode.count);
          return (
            <Link
              key={mode.title}
              href="/servers"
              className={`dzn-game-mode-card dzn-game-mode-card--${mode.theme} group`}
            >
              <div className="relative z-10 flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <span className="dzn-game-mode-icon" aria-hidden="true">
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="dzn-game-mode-count">
                    {formatModeServerCount(count)}
                  </span>
                </div>
                <h3 className="dzn-game-mode-title">{mode.title}</h3>
                <span className="dzn-game-mode-rule" aria-hidden="true" />
                <p className="dzn-game-mode-description">{mode.description}</p>
                <span className="dzn-game-mode-action">
                  View servers <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </motion.section>
  );
}

function NetworkOverview({ homeStats }: { homeStats: HomeStats }) {
  const longestKill = numberOrZero(homeStats.totals.longestKill);
  const stats = [
    {
      icon: Users,
      label: "Players",
      value: formatNumber(homeStats.totals.playersSeen),
      theme: "players",
    },
    {
      icon: Server,
      label: "Servers Linked",
      value: formatNumber(homeStats.totals.serversLinked),
      theme: "servers",
    },
    {
      icon: Crosshair,
      label: "Kills",
      value: formatNumber(homeStats.totals.killsTracked),
      theme: "kills",
    },
    {
      icon: Trophy,
      label: "Longest Kill",
      value: longestKill > 0 ? `${formatDecimal(longestKill)}m` : "Awaiting data",
      theme: "longest",
    },
  ];

  return (
    <motion.section variants={fadeUp} id="stats" className="dzn-home-panel dzn-stats-strip rounded-xl border border-white/10 bg-[#050914]/66 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-cyan-200">Network Overview</p>
          <h2 className="text-xl font-black uppercase text-white">Live server intelligence</h2>
        </div>
        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.16em] text-emerald-200">
          Live pulse
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className={`dzn-stat-card dzn-stat-card--${stat.theme}`}>
              <span className="dzn-stat-icon" aria-hidden="true">
                <Icon className="h-5 w-5" />
              </span>
              <div className="dzn-stat-copy">
                <p className="dzn-stat-value">{stat.value}</p>
                <p className="dzn-stat-label">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}

function NetworkPulse({ homeStats }: { homeStats: HomeStats }) {
  const topServer = homeStats.network_pulse.top_server ?? homeStats.topServers[0] ?? null;
  const currentEvent = homeStats.network_pulse.current_event;
  const topKills = numberOrZero(topServer?.total_kills);
  const topDeaths = numberOrZero(topServer?.total_deaths);
  const topKd = topServer ? (topKills === 0 ? "Awaiting data" : topDeaths > 0 ? (topKills / topDeaths).toFixed(2) : "Flawless") : "Pending";
  const pulseCards = [
    {
      icon: Wifi,
      eyebrow: "Active Servers",
      value: `${formatNumber(homeStats.network_pulse.active_servers || homeStats.syncHealth.active)} active`,
      detail: "Live and online right now",
      theme: "active",
    },
    {
      icon: Activity,
      eyebrow: "Events",
      value: `${formatNumber(homeStats.network_pulse.events || homeStats.totals.recentEventsCount)} events`,
      detail: "Tracked across the network",
      theme: "events",
    },
    {
      icon: Trophy,
      eyebrow: "Top Server",
      value: topServer ? formatServerDisplayName(topServer.server_name) : "Pending",
      detail: topServer ? `Score: ${topServer.score_label ?? formatNumber(topServer.score ?? 0)} | K/D: ${topKd}` : "Waiting for leaderboard data",
      theme: "top",
    },
    {
      icon: Timer,
      eyebrow: "Current Event",
      value: currentEvent ? currentEvent.title : "No event live",
      detail: currentEvent?.description ?? "Next event coming soon",
      theme: "event",
    },
  ];

  return (
    <motion.section variants={fadeUp} className="dzn-home-panel dzn-network-pulse rounded-xl border border-white/10 bg-[#050914]/66 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-violet-200">Network Pulse</p>
          <h2 className="text-xl font-black uppercase text-white">Competition modes online</h2>
        </div>
        <span className="dzn-pulse-live-pill">Live</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {pulseCards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.eyebrow} className={`dzn-pulse-card dzn-pulse-card--${card.theme}`}>
              <span className="dzn-pulse-icon" aria-hidden="true">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="dzn-pulse-eyebrow">{card.eyebrow}</p>
                <p className="dzn-pulse-value">{card.value}</p>
                <p className="dzn-pulse-detail">{card.detail}</p>
              </div>
            </article>
          );
        })}
      </div>
    </motion.section>
  );
}

function EventLeaderboardPanel({ homeStats }: { homeStats: HomeStats }) {
  const currentEvent = homeStats.network_pulse.current_event;
  const buildRows = homeStats.top_build_servers.filter((row) => numberOrZero(row.build_score) > 0).slice(0, 4);
  const shouldShowBuildPreview = !currentEvent && buildRows.length > 0;

  return (
    <motion.section variants={fadeUp} className="dzn-home-panel dzn-event-leaderboard rounded-xl border border-white/10 bg-[#050914]/66 p-4 backdrop-blur-xl">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-orange-200">Event Leaderboard</p>
          <h2 className="text-xl font-black uppercase text-white">
            {currentEvent ? currentEvent.title : shouldShowBuildPreview ? "Build tracking ready" : "Server-vs-server events"}
          </h2>
        </div>
        <span className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-zinc-400">
          {currentEvent ? `${currentEvent.type} event` : "More events coming soon"}
        </span>
      </div>

      {currentEvent?.type === "pvp" && homeStats.topServers.length > 0 ? (
        <div className="dzn-event-table">
          <div className="dzn-event-row dzn-event-row--head">
            <span>Rank</span>
            <span>Server</span>
            <span>Kills</span>
            <span>K/D</span>
            <span>Score</span>
          </div>
          {homeStats.topServers.slice(0, 4).map((server, index) => {
            const kills = numberOrZero(server.total_kills);
            const deaths = numberOrZero(server.total_deaths);
            const kd = kills === 0 ? "Awaiting" : deaths > 0 ? (kills / deaths).toFixed(2) : "Flawless";
            return (
              <a key={`${server.public_slug ?? server.server_name}-${index}`} href={server.public_slug ? `/servers/profile?slug=${encodeURIComponent(server.public_slug)}` : "/servers"} className="dzn-event-row">
                <span>#{numberOrZero(server.rank) || index + 1}</span>
                <span>{formatServerDisplayName(server.server_name)}</span>
                <span>{formatNumber(kills)}</span>
                <span>{kd}</span>
                <span>{server.score_label ?? formatNumber(server.score ?? 0)}</span>
              </a>
            );
          })}
        </div>
      ) : shouldShowBuildPreview || currentEvent?.type === "build" ? (
        <div className="dzn-event-table dzn-event-table--build">
          <div className="dzn-event-row dzn-event-row--head">
            <span>Rank</span>
            <span>Server</span>
            <span>Structures Built</span>
            <span>Build Score</span>
          </div>
          {(buildRows.length ? buildRows : homeStats.top_build_servers.slice(0, 4)).map((row, index) => (
            <a key={row.server_id} href={row.slug ? `/servers/profile?slug=${encodeURIComponent(row.slug)}` : "/servers"} className="dzn-event-row">
              <span>#{row.rank || index + 1}</span>
              <span>{formatServerDisplayName(row.server_name)}</span>
              <span>{formatNumber(row.structures_built)}</span>
              <span>{formatNumber(row.build_score)}</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="dzn-event-empty">
          <Hammer className="h-5 w-5" />
          <div>
            <p>More events coming soon. Stay tuned.</p>
            <span>Build, survival, faction, PvP, and activity events will rank servers here.</span>
          </div>
        </div>
      )}
    </motion.section>
  );
}

function BottomCta() {
  return (
    <motion.section
      variants={fadeUp}
      id="events"
      className="dzn-home-cta relative overflow-hidden rounded-xl border border-violet-300/18 bg-[#080b16]/74 p-5 backdrop-blur-xl sm:p-6"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(124,58,237,0.2),transparent_30%),radial-gradient(circle_at_90%_20%,rgba(34,211,238,0.12),transparent_26%)]" />
      <div className="relative z-10 flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center">
        <div className="max-w-3xl">
          <p className="text-[0.66rem] font-black uppercase tracking-[0.2em] text-violet-200">
            Be part of something bigger
          </p>
          <h2 className="mt-2 text-2xl font-black uppercase text-white sm:text-3xl">
            Join a growing network of DayZ servers and communities.
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-300/82">
            Build your community reputation, let every player and faction contribute to your server ranking, and prove your server is the best.
          </p>
        </div>
        <a
          href="/login?returnTo=/setup"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200/45 bg-violet-600 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[0_0_32px_rgba(124,58,237,0.36)] transition duration-300 hover:-translate-y-0.5 hover:bg-violet-500 sm:w-auto"
        >
          Add Your Server
          <ChevronRight className="h-4 w-4" />
        </a>
      </div>
    </motion.section>
  );
}

function PanelShell({
  title,
  href,
  icon: Icon,
  children,
}: {
  title: string;
  href: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="dzn-home-panel rounded-xl border border-white/10 bg-[#060a15]/72 p-4 shadow-[0_18px_58px_rgba(0,0,0,0.32)] backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-violet-300/18 bg-violet-400/10 text-violet-100">
            <Icon className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-black uppercase tracking-[0.1em] text-white">{title}</h2>
        </div>
        <a href={href} className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-violet-200 hover:text-white">
          View All
        </a>
      </div>
      {children}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/18 px-2 py-2">
      <p className="text-sm font-black text-white">{value}</p>
      <p className="text-[0.62rem] font-bold uppercase tracking-[0.12em] text-zinc-500">{label}</p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 mx-auto w-full max-w-[1440px] border-t border-white/8 px-4 pb-7 pt-4 text-xs text-zinc-500 sm:px-6 lg:px-8">
      <p>Copyright {new Date().getFullYear()} DZN Network. Server competition intelligence for connected DayZ communities.</p>
    </footer>
  );
}

function normalizeHomeStats(payload: HomeStatsResponse): HomeStats {
  return {
    totals: {
      serversLinked: numberOrZero(payload.totals?.serversLinked),
      statsActiveServers: numberOrZero(payload.totals?.statsActiveServers),
      playersSeen: numberOrZero(payload.totals?.playersSeen),
      killsTracked: numberOrZero(payload.totals?.killsTracked),
      deathsTracked: numberOrZero(payload.totals?.deathsTracked),
      joinsTracked: numberOrZero(payload.totals?.joinsTracked),
      longestKill: numberOrZero(payload.totals?.longestKill),
      recentEventsCount: numberOrZero(payload.totals?.recentEventsCount),
      structuresBuilt: numberOrZero(payload.totals?.structuresBuilt),
      buildScore: numberOrZero(payload.totals?.buildScore),
    },
    network_pulse: {
      active_servers: numberOrZero(payload.network_pulse?.active_servers),
      events: numberOrZero(payload.network_pulse?.events),
      top_server: normalizeTopServer(payload.network_pulse?.top_server),
      best_kd: finiteNumberOrNull(payload.network_pulse?.best_kd),
      current_event: normalizeNetworkEvent(payload.network_pulse?.current_event),
    },
    event_leaderboard: normalizeEventLeaderboard(payload.event_leaderboard),
    top_build_servers: Array.isArray(payload.top_build_servers)
      ? payload.top_build_servers.map((row) => ({
          rank: numberOrZero(row.rank),
          server_id: typeof row.server_id === "string" ? row.server_id : "",
          server_name: typeof row.server_name === "string" && row.server_name.trim() ? row.server_name : "Unnamed DZN Server",
          slug: typeof row.slug === "string" && row.slug.trim() ? row.slug : null,
          structures_built: numberOrZero(row.structures_built),
          build_items_placed: numberOrZero(row.build_items_placed),
          storage_items_placed: numberOrZero(row.storage_items_placed),
          traps_placed: numberOrZero(row.traps_placed),
          build_score: numberOrZero(row.build_score),
          top_builder_name: typeof row.top_builder_name === "string" ? row.top_builder_name : null,
          top_builder_count: numberOrZero(row.top_builder_count),
          last_build_at: typeof row.last_build_at === "string" ? row.last_build_at : null,
        }))
      : [],
    topServers: Array.isArray(payload.topServers)
      ? payload.topServers.map((server) => ({
          public_slug: server.public_slug ?? null,
          server_name: server.server_name || "Unnamed DZN Server",
          guild_name: server.guild_name ?? null,
          server_type: server.server_type ?? null,
          total_kills: numberOrZero(server.total_kills),
          total_deaths: numberOrZero(server.total_deaths),
          unique_players: numberOrZero(server.unique_players),
          total_joins: numberOrZero(server.total_joins),
          longest_kill: numberOrZero(server.longest_kill),
          stats_active: Boolean(server.stats_active),
          rank: numberOrZero(server.rank),
          score: numberOrZero(server.score),
          score_label: typeof server.score_label === "string" ? server.score_label : undefined,
          score_breakdown: isScoreBreakdown(server.score_breakdown) ? server.score_breakdown : null,
        }))
      : [],
    topPlayers: Array.isArray(payload.topPlayers) ? payload.topPlayers : [],
    recentActivity: Array.isArray(payload.recentActivity) ? payload.recentActivity : [],
    map_nodes: Array.isArray(payload.map_nodes)
      ? payload.map_nodes.map((node, index) => {
          const rawNode = node as DznOperationalGlobeNode & {
            display_name?: unknown;
            lat?: unknown;
            lng?: unknown;
            server_type?: unknown;
          };
          const displayName =
            typeof rawNode.display_name === "string" && rawNode.display_name.trim()
              ? rawNode.display_name.trim()
              : typeof rawNode.name === "string" && rawNode.name.trim()
                ? rawNode.name.trim()
                : "Unnamed DZN Server";

          return {
            id: typeof rawNode.id === "string" && rawNode.id.trim() ? rawNode.id : `server-${index + 1}`,
            name: displayName,
            display_name: displayName,
            slug: typeof rawNode.slug === "string" && rawNode.slug.trim() ? rawNode.slug : null,
            mode: typeof rawNode.mode === "string" ? rawNode.mode : typeof rawNode.server_type === "string" ? rawNode.server_type : null,
            server_type: typeof rawNode.server_type === "string" ? rawNode.server_type : null,
            status: typeof rawNode.status === "string" ? rawNode.status : "pending",
            sync_status: typeof rawNode.sync_status === "string" ? rawNode.sync_status : "pending",
            region: typeof rawNode.region === "string" && rawNode.region.trim() ? rawNode.region : "Location awaiting metadata",
            country: typeof rawNode.country === "string" ? rawNode.country : null,
            city: typeof rawNode.city === "string" ? rawNode.city : null,
            latitude: finiteNumberOrNull(rawNode.latitude),
            longitude: finiteNumberOrNull(rawNode.longitude),
            lat: finiteNumberOrNull(rawNode.lat),
            lng: finiteNumberOrNull(rawNode.lng),
            x: clamp(numberOrZero(rawNode.x), 5, 95),
            y: clamp(numberOrZero(rawNode.y), 8, 90),
            active: Boolean(rawNode.active) || rawNode.sync_status === "active" || rawNode.status === "active",
            approximate: Boolean(rawNode.approximate),
          };
        })
      : [],
    gameModes: {
      pvp: numberOrZero(payload.gameModes?.pvp),
      pve: numberOrZero(payload.gameModes?.pve),
      deathmatch: numberOrZero(payload.gameModes?.deathmatch),
      pvpPve: numberOrZero(payload.gameModes?.pvpPve),
    },
    syncHealth: {
      active: numberOrZero(payload.syncHealth?.active),
      pending: numberOrZero(payload.syncHealth?.pending),
    },
    access_level: payload.access_level === "preview" ? "preview" : "full",
    is_locked: Boolean(payload.is_locked),
    locked_reason: typeof payload.locked_reason === "string" ? payload.locked_reason : null,
  };
}

function normalizeTopServer(value: unknown): HomeTopServer | null {
  if (!value || typeof value !== "object") return null;
  const server = value as Partial<HomeTopServer>;
  return {
    public_slug: typeof server.public_slug === "string" ? server.public_slug : null,
    server_name: typeof server.server_name === "string" && server.server_name.trim() ? server.server_name : "Unnamed DZN Server",
    guild_name: typeof server.guild_name === "string" ? server.guild_name : null,
    server_type: typeof server.server_type === "string" ? server.server_type : null,
    total_kills: numberOrZero(server.total_kills),
    total_deaths: numberOrZero(server.total_deaths),
    unique_players: numberOrZero(server.unique_players),
    total_joins: numberOrZero(server.total_joins),
    longest_kill: numberOrZero(server.longest_kill),
    stats_active: Boolean(server.stats_active),
    rank: numberOrZero(server.rank),
    score: numberOrZero(server.score),
    score_label: typeof server.score_label === "string" ? server.score_label : undefined,
    score_breakdown: isScoreBreakdown(server.score_breakdown) ? server.score_breakdown : null,
  };
}

function normalizeNetworkEvent(value: unknown): PublicNetworkEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<PublicNetworkEvent>;
  if (typeof event.title !== "string" || !event.title.trim()) return null;
  return {
    id: typeof event.id === "string" ? event.id : undefined,
    type: typeof event.type === "string" && event.type.trim() ? event.type : "activity",
    title: event.title.trim(),
    status: typeof event.status === "string" ? event.status : undefined,
    description: typeof event.description === "string" ? event.description : null,
    ends_at: typeof event.ends_at === "string" ? event.ends_at : null,
  };
}

function normalizeEventLeaderboard(value: unknown): PublicEventLeaderboard | null {
  if (!value || typeof value !== "object") return null;
  const leaderboard = value as Partial<PublicEventLeaderboard>;
  if (typeof leaderboard.event_type !== "string" || typeof leaderboard.title !== "string") return null;
  return {
    event_type: leaderboard.event_type,
    title: leaderboard.title,
    rows: Array.isArray(leaderboard.rows) ? leaderboard.rows : [],
  };
}

function buildTopServerRows(homeStats: HomeStats): TopServerPanelRow[] {
  const rows = homeStats.topServers.slice(0, 5).map((server, index) => {
    const kills = numberOrZero(server.total_kills);
    const deaths = numberOrZero(server.total_deaths);
    const kd = kills === 0 ? "Awaiting data" : deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
    const scoreLabel = server.score_label ?? (numberOrZero(server.score) > 0 ? formatNumber(numberOrZero(server.score)) : "Pending");

    return {
      rank: numberOrZero(server.rank) || index + 1,
      server: formatServerDisplayName(server.server_name || server.guild_name || "Unnamed DZN Server"),
      kd,
      kills: formatNumber(kills),
      score: scoreLabel === "Pending" ? "Pending" : formatNumber(numberOrZero(server.score)),
      scoreTitle: scoreBreakdownTitle(server.score_breakdown),
      href: server.public_slug ? `/servers/profile?slug=${encodeURIComponent(server.public_slug)}` : "/servers",
      active: server.stats_active,
    };
  });

  return rows.length > 0 ? rows : fallbackTopServers;
}

function isScoreBreakdown(value: unknown): value is ScoreBreakdown {
  return Boolean(value && typeof value === "object" && "final_score" in value);
}

function scoreBreakdownTitle(breakdown: ScoreBreakdown | null | undefined) {
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

function buildActivityRows(homeStats: HomeStats): ActivityPanelRow[] {
  const liveRows = homeStats.recentActivity.slice(0, 5).map<ActivityPanelRow>((activity) => ({
    title: activity.title || "Server activity synced",
    detail: activity.serverName || "DZN Network",
    time: formatAgo(activity.occurredAt),
    icon: activity.source === "kill" ? Crosshair : activity.source === "build" ? Hammer : activity.source === "sync" ? Radio : activity.source === "server" ? Server : Activity,
    tone:
      activity.source === "kill"
        ? "border-red-300/18 bg-red-400/10 text-red-100"
        : activity.source === "build"
          ? "border-orange-300/18 bg-orange-300/10 text-orange-100"
        : activity.source === "sync"
          ? "border-cyan-300/18 bg-cyan-300/10 text-cyan-100"
          : activity.source === "server"
            ? "border-emerald-300/18 bg-emerald-300/10 text-emerald-100"
            : "border-violet-300/18 bg-violet-300/10 text-violet-100",
  }));

  if (liveRows.length > 0) return liveRows;

  return [
    {
      title: "Server sync active",
      detail: "DZN sync network online",
      time: "Live",
      icon: Radio,
      tone: "border-cyan-300/18 bg-cyan-300/10 text-cyan-100",
    },
    {
      title: "Waiting for first PvP kill",
      detail: "Kills appear once detected",
      time: "Queued",
      icon: Crosshair,
      tone: "border-violet-300/18 bg-violet-300/10 text-violet-100",
    },
    {
      title: "New server activity syncing",
      detail: "Public events will appear here",
      time: "Ready",
      icon: Zap,
      tone: "border-emerald-300/18 bg-emerald-300/10 text-emerald-100",
    },
    {
      title: "Public servers connected",
      detail: "Server reputation graph building",
      time: "Online",
      icon: Globe2,
      tone: "border-orange-300/18 bg-orange-300/10 text-orange-100",
    },
  ];
}

function formatServerDisplayName(value: string) {
  const cleaned = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (/^dayzquestbottestserver$/i.test(cleaned.replace(/\s+/g, ""))) {
    return "DayZQuest Bot Test Server";
  }

  return cleaned
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bDay Z\b/g, "DayZ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(numberOrZero(value));
}

function formatDecimal(value: number) {
  const safe = numberOrZero(value);
  return safe % 1 === 0 ? formatNumber(safe) : safe.toFixed(1);
}

function formatModeServerCount(value: number) {
  const count = numberOrZero(value);
  return `${formatNumber(count)} ${count === 1 ? "SERVER" : "SERVERS"}`;
}

function formatAgo(value: string | null) {
  if (!value) return "Live";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Live";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function finiteNumberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
