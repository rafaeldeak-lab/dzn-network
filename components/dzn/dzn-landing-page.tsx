"use client";

import {
  Activity,
  BarChart3,
  ChevronRight,
  Crosshair,
  Flag,
  Globe2,
  MessageCircle,
  Play,
  Radio,
  Server,
  Shield,
  Skull,
  Swords,
  Trophy,
  Users,
  Wifi,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "framer-motion";
import type { Variants } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { clearClientAuthState, logoutAndRedirect } from "@/components/onboarding/api";
import { AnimatedBackground } from "./animated-background";
import { DznLogo } from "./dzn-logo";

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

type HomeStats = {
  totals: {
    serversLinked: number;
    statsActiveServers: number;
    playersSeen: number;
    killsTracked: number;
    deathsTracked: number;
    joinsTracked: number;
    recentEventsCount: number;
  };
  topServers: Array<{
    public_slug: string | null;
    server_name: string;
    guild_name: string | null;
    server_type: string | null;
    total_kills: number;
    total_deaths?: number;
    unique_players: number;
    stats_active: boolean;
  }>;
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
    source: "kill" | "player" | "sync" | "server";
    eventType: string;
    title: string;
    serverName: string | null;
    publicSlug: string | null;
    occurredAt: string | null;
  }>;
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
  href: string;
  active: boolean;
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
    recentEventsCount: 0,
  },
  topServers: [],
  topPlayers: [],
  recentActivity: [],
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
};

const HOME_STATS_REFRESH_MS = 30000;

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
    title: "Server Vs Server Events",
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

  useEffect(() => {
    let active = true;

    async function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const response = await fetch("/api/public/home-stats", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const payload = (await response.json().catch(() => ({}))) as HomeStatsResponse;
        if (!response.ok) throw new Error(payload.error || "Live stats unavailable");
        if (!active) return;
        setData(normalizeHomeStats(payload));
        setLastUpdated(new Date());
        setError("");
      } catch {
        if (active) setError("Live stats temporarily unavailable.");
      } finally {
        inFlight.current = false;
      }
    }

    load();
    const interval = window.setInterval(load, HOME_STATS_REFRESH_MS);
    return () => {
      active = false;
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
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsLoading(false), reduceMotion ? 120 : 950);
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate min-h-screen overflow-hidden bg-[#02030a] text-zinc-100">
        <AnimatedBackground />
        <LoadingOverlay isVisible={isLoading} />
        <Navbar />

        <motion.main
          initial="hidden"
          animate="show"
          variants={stagger}
          className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-8 pt-4 sm:px-6 lg:px-8"
        >
          <HeroDashboard
            homeStats={liveStats.data}
            lastUpdated={liveStats.lastUpdated}
            error={liveStats.error}
          />
          <FeatureStrip />
          <GameModeGrid counts={liveStats.data.gameModes} />
          <StatsRow homeStats={liveStats.data} />
          <BottomCta />
        </motion.main>

        <Footer />
      </div>
    </MotionConfig>
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
    fetch("/api/auth/me", { credentials: "include" })
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
      className="sticky top-0 z-50 border-b border-white/10 bg-[#02030a]/72 backdrop-blur-2xl"
    >
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex min-h-[104px] w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8"
      >
        <DznLogo compact className="-ml-2" />
        <div className="hidden flex-1 items-center justify-center gap-1 lg:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.16em] text-zinc-300/78 transition duration-300 hover:bg-white/[0.08] hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
          <a
            href="#"
            className="hidden items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.12em] text-zinc-200 transition duration-300 hover:border-violet-300/45 hover:bg-violet-400/10 hover:text-white md:inline-flex"
          >
            <MessageCircle className="h-4 w-4 text-violet-200" />
            Discord
          </a>
          {authenticated ? (
            <>
              <a
                href="/dashboard"
                className="rounded-lg border border-white/10 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.12em] text-zinc-200 transition duration-300 hover:border-cyan-300/45 hover:bg-cyan-400/10 hover:text-white sm:inline-flex"
              >
                Dashboard
              </a>
              <button
                type="button"
                onClick={signOut}
                className="rounded-lg border border-white/10 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.12em] text-zinc-200 transition duration-300 hover:border-violet-300/45 hover:bg-violet-400/10 hover:text-white"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <a
                href="/login"
                className="rounded-lg border border-white/10 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.12em] text-zinc-200 transition duration-300 hover:border-violet-300/45 hover:bg-violet-400/10 hover:text-white"
              >
                Login
              </a>
              <a
                href="/signup"
                className="rounded-lg border border-violet-300/35 bg-violet-500/20 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.12em] text-white shadow-[0_0_24px_rgba(139,92,246,0.28)] transition duration-300 hover:border-violet-200/70 hover:bg-violet-500/32"
              >
                Sign Up
              </a>
            </>
          )}
        </div>
      </nav>
    </motion.header>
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
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_420px]"
    >
      <motion.div
        variants={fadeUp}
        className="relative overflow-hidden rounded-xl border border-white/10 bg-[#060a15]/64 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-7 lg:min-h-[410px]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(124,58,237,0.18),transparent_32%),radial-gradient(circle_at_78%_14%,rgba(14,165,233,0.1),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_52%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#02030a] via-[#02030a]/54 to-transparent" />

        <div className="relative z-10 flex h-full flex-col justify-between gap-7">
          <div className="max-w-3xl">
            <motion.div
              variants={fadeUp}
              className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-300/25 bg-violet-400/10 px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.22em] text-violet-100"
            >
              <Shield className="h-3.5 w-3.5" />
              The universal DayZ server network
            </motion.div>
            <motion.h1
              variants={fadeUp}
              className="max-w-4xl text-5xl font-black uppercase leading-[0.9] tracking-normal text-white drop-shadow-[0_0_28px_rgba(139,92,246,0.3)] sm:text-6xl lg:text-7xl"
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
                href="/signup"
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

      <motion.div variants={fadeUp} className="grid gap-4">
        <TopServersPanel rows={serverRows} />
        <RecentActivityPanel rows={activityRows} />
        <LiveMapPanel homeStats={homeStats} />
      </motion.div>
    </motion.section>
  );
}

function TopServersPanel({ rows }: { rows: TopServerPanelRow[] }) {
  return (
    <PanelShell title="Top Servers" href="/servers" icon={Trophy}>
      <div className="grid grid-cols-[28px_minmax(0,1fr)_72px_46px] gap-2 border-b border-white/10 pb-2 text-[0.6rem] font-black uppercase tracking-[0.12em] text-zinc-500 sm:grid-cols-[28px_minmax(136px,1fr)_86px_48px_62px]">
        <span>#</span>
        <span>Server</span>
        <span className="text-right">K/D</span>
        <span className="text-right">Kills</span>
        <span className="hidden text-right sm:block">Score</span>
      </div>
      <div className="mt-2 grid gap-1.5">
        {rows.slice(0, 5).map((row) => (
          <a
            key={`${row.rank}-${row.server}`}
            href={row.href}
            title={row.server}
            className="grid grid-cols-[28px_minmax(0,1fr)_72px_46px] items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2 py-2 text-xs transition duration-300 hover:border-violet-300/35 hover:bg-violet-300/8 sm:grid-cols-[28px_minmax(136px,1fr)_86px_48px_62px]"
          >
            <span className="font-black text-violet-200">{row.rank}</span>
            <span className="min-w-0 break-words text-[0.76rem] font-bold leading-4 text-white sm:max-w-[180px]">{row.server}</span>
            <span className="text-right text-[0.68rem] font-bold leading-3 text-zinc-300">{row.kd}</span>
            <span className="text-right font-bold text-zinc-300">{row.kills}</span>
            <span className={row.active ? "hidden text-right font-black text-emerald-200 sm:block" : "hidden text-right font-bold text-zinc-500 sm:block"}>
              {row.score}
            </span>
          </a>
        ))}
      </div>
    </PanelShell>
  );
}

function RecentActivityPanel({ rows }: { rows: ActivityPanelRow[] }) {
  return (
    <PanelShell title="Recent Activity" href="/servers" icon={Activity}>
      <div className="grid gap-2">
        {rows.slice(0, 5).map((row, index) => {
          const Icon = row.icon;
          return (
            <div
              key={`${row.title}-${index}`}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2.5"
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${row.tone}`}>
                <Icon className="h-4 w-4" />
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
  const dots = Math.max(homeStats.totals.serversLinked, 1);

  return (
    <div className="relative overflow-hidden rounded-xl border border-cyan-300/15 bg-cyan-300/[0.045] p-4 shadow-[0_0_38px_rgba(14,165,233,0.08)]">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.08),transparent)] opacity-60" />
      <div className="relative flex items-center justify-between gap-3">
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
        <div className="relative h-20 w-28 overflow-hidden rounded-lg border border-white/10 bg-[#02030a]/55">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(34,211,238,0.18),transparent_40%)]" />
          {Array.from({ length: Math.min(dots, 5) }).map((_, index) => (
            <span
              key={index}
              className="absolute h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.9)]"
              style={{
                left: `${18 + index * 15}%`,
                top: `${28 + (index % 3) * 18}%`,
              }}
            />
          ))}
          <span className="absolute inset-4 rounded-full border border-cyan-200/20" />
        </div>
      </div>
      <div className="relative mt-3 grid grid-cols-3 gap-2 text-center">
        <MiniMetric label="Sync Active" value={formatNumber(homeStats.syncHealth.active)} />
        <MiniMetric label="Pending" value={formatNumber(homeStats.syncHealth.pending)} />
        <MiniMetric label="Events" value={formatNumber(homeStats.totals.recentEventsCount)} />
      </div>
    </div>
  );
}

function FeatureStrip() {
  return (
    <motion.section variants={fadeUp} id="features" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {featureCards.map((feature) => {
        const Icon = feature.icon;
        return (
          <motion.article
            key={feature.title}
            id={feature.title === "Server Vs Server Events" ? "server-events" : undefined}
            whileHover={{ y: -4 }}
            className="group relative scroll-mt-28 overflow-hidden rounded-xl border border-white/10 bg-[#070b16]/74 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl transition duration-300 hover:border-violet-300/32"
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
      tint: "from-red-500/20 to-violet-500/8",
    },
    {
      title: "DEATHMATCH",
      count: counts.deathmatch,
      description: "Fast combat communities pushing activity, volume, and clean kill tracking.",
      icon: Skull,
      tint: "from-cyan-400/16 to-blue-500/8",
    },
    {
      title: "PVE",
      count: counts.pve,
      description: "Survival-focused servers building longevity, events, and community reputation.",
      icon: Shield,
      tint: "from-emerald-400/16 to-cyan-500/8",
    },
    {
      title: "PVP / PVE",
      count: counts.pvpPve,
      description: "Hybrid worlds where factions, raids, survival, and competition all count.",
      icon: Swords,
      tint: "from-violet-400/18 to-fuchsia-500/8",
    },
  ];

  return (
    <motion.section variants={fadeUp} className="rounded-xl border border-white/10 bg-[#050914]/66 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-violet-200">Game Modes</p>
          <h2 className="text-xl font-black uppercase text-white">Find your battleground</h2>
        </div>
        <Link href="/servers" className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-cyan-200 hover:text-white">
          View servers
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {modes.map((mode) => {
          const Icon = mode.icon;
          return (
            <Link
              key={mode.title}
              href="/servers"
              className="group relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] p-4 transition duration-300 hover:-translate-y-1 hover:border-violet-300/34 hover:bg-white/[0.06]"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${mode.tint} opacity-80`} />
              <div className="relative z-10">
                <div className="flex items-center justify-between gap-3">
                  <Icon className="h-7 w-7 text-violet-100 transition group-hover:scale-110" />
                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[0.65rem] font-black uppercase text-zinc-200">
                    {formatNumber(mode.count)} servers
                  </span>
                </div>
                <h3 className="mt-6 text-lg font-black uppercase text-white">{mode.title}</h3>
                <p className="mt-2 text-xs leading-5 text-zinc-400">{mode.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </motion.section>
  );
}

function StatsRow({ homeStats }: { homeStats: HomeStats }) {
  const stats = [
    {
      icon: Users,
      label: "Players Seen",
      value: homeStats.totals.playersSeen > 0 ? formatNumber(homeStats.totals.playersSeen) : "Awaiting activity",
    },
    {
      icon: Server,
      label: "Servers Linked",
      value: formatNumber(homeStats.totals.serversLinked),
    },
    {
      icon: Crosshair,
      label: "Kills Tracked",
      value: homeStats.totals.killsTracked > 0 ? formatNumber(homeStats.totals.killsTracked) : "Awaiting PvP data",
    },
    {
      icon: Wifi,
      label: "Active Servers",
      value: homeStats.syncHealth.active > 0 ? `${formatNumber(homeStats.syncHealth.active)} active` : "Live sync active",
    },
  ];

  return (
    <motion.section variants={fadeUp} id="stats" className="grid gap-3 rounded-xl border border-white/10 bg-[#050914]/66 p-4 backdrop-blur-xl sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div key={stat.label} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.035] p-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-cyan-300/18 bg-cyan-300/8 text-cyan-100">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="break-words text-base font-black uppercase leading-tight text-white sm:text-lg">{stat.value}</p>
              <p className="text-[0.67rem] font-bold uppercase tracking-[0.14em] text-zinc-500">{stat.label}</p>
            </div>
          </div>
        );
      })}
    </motion.section>
  );
}

function BottomCta() {
  return (
    <motion.section
      variants={fadeUp}
      id="events"
      className="relative overflow-hidden rounded-xl border border-violet-300/18 bg-[#080b16]/74 p-5 backdrop-blur-xl sm:p-6"
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
          href="/signup"
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
    <div className="rounded-xl border border-white/10 bg-[#060a15]/72 p-4 shadow-[0_18px_58px_rgba(0,0,0,0.32)] backdrop-blur-xl">
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
    <footer className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-7 pt-3 text-xs text-zinc-500 sm:px-6 lg:px-8">
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
      recentEventsCount: numberOrZero(payload.totals?.recentEventsCount),
    },
    topServers: Array.isArray(payload.topServers)
      ? payload.topServers.map((server) => ({
          public_slug: server.public_slug ?? null,
          server_name: server.server_name || "Unnamed DZN Server",
          guild_name: server.guild_name ?? null,
          server_type: server.server_type ?? null,
          total_kills: numberOrZero(server.total_kills),
          total_deaths: numberOrZero(server.total_deaths),
          unique_players: numberOrZero(server.unique_players),
          stats_active: Boolean(server.stats_active),
        }))
      : [],
    topPlayers: Array.isArray(payload.topPlayers) ? payload.topPlayers : [],
    recentActivity: Array.isArray(payload.recentActivity) ? payload.recentActivity : [],
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
  };
}

function buildTopServerRows(homeStats: HomeStats): TopServerPanelRow[] {
  const rows = homeStats.topServers.slice(0, 5).map((server, index) => {
    const kills = numberOrZero(server.total_kills);
    const deaths = numberOrZero(server.total_deaths);
    const score = kills * 10 + numberOrZero(server.unique_players) * 5 + (server.stats_active ? 100 : 0);
    const kd = kills === 0 ? "Awaiting data" : deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);

    return {
      rank: index + 1,
      server: formatServerDisplayName(server.server_name || server.guild_name || "Unnamed DZN Server"),
      kd,
      kills: formatNumber(kills),
      score: score > 0 ? formatNumber(score) : "Pending",
      href: server.public_slug ? `/servers/profile?slug=${encodeURIComponent(server.public_slug)}` : "/servers",
      active: server.stats_active,
    };
  });

  return rows.length > 0 ? rows : fallbackTopServers;
}

function buildActivityRows(homeStats: HomeStats): ActivityPanelRow[] {
  const liveRows = homeStats.recentActivity.slice(0, 5).map<ActivityPanelRow>((activity) => ({
    title: activity.title || "Server activity synced",
    detail: activity.serverName || "DZN Network",
    time: formatAgo(activity.occurredAt),
    icon: activity.source === "kill" ? Crosshair : activity.source === "sync" ? Radio : activity.source === "server" ? Server : Activity,
    tone:
      activity.source === "kill"
        ? "border-red-300/18 bg-red-400/10 text-red-100"
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
