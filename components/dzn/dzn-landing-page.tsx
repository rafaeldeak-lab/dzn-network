"use client";

import {
  Activity,
  ChevronRight,
  Clock,
  Crosshair,
  Eye,
  Flag,
  Flame,
  Gamepad2,
  Globe2,
  Hexagon,
  MessageCircle,
  Play,
  Radio,
  Server,
  Shield,
  Skull,
  Star,
  Swords,
  Trophy,
  Users,
  Wifi,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "framer-motion";
import type { Variants } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { AnimatedBackground } from "./animated-background";
import {
  features,
  gameModes as gameModeTemplates,
  navItems,
} from "./data";
import { DznLogo } from "./dzn-logo";
import { clearClientAuthState, logoutAndRedirect } from "@/components/onboarding/api";

const iconMap: Record<string, LucideIcon> = {
  Activity,
  Clock,
  Crosshair,
  Eye,
  Flag,
  Flame,
  Gamepad2,
  Globe2,
  Radio,
  Server,
  Shield,
  Skull,
  Swords,
  Trophy,
  Users,
  Wifi,
  Zap,
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.72, ease: "easeOut" },
  },
};

const stagger: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.06,
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

type HomeStatsResponse = HomeStats & {
  ok?: boolean;
  error?: string;
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
    const timer = window.setTimeout(() => setIsLoading(false), reduceMotion ? 120 : 1050);
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
          className="relative z-10"
        >
          <Hero homeStats={liveStats.data} lastUpdated={liveStats.lastUpdated} error={liveStats.error} />
          <LiveStats homeStats={liveStats.data} />
          <Leaderboards players={liveStats.data.topPlayers} />
          <GameModes counts={liveStats.data.gameModes} />
          <Features />
          <RecentActivity homeStats={liveStats.data} />
          <Community homeStats={liveStats.data} />
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
            className="relative flex w-[min(86vw,360px)] flex-col items-center gap-6"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
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
              Synchronizing global shard telemetry
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
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="sticky top-0 z-50 border-b border-white/10 bg-[#02030a]/68 backdrop-blur-2xl"
    >
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8"
      >
        <DznLogo compact />
        <div className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-4 py-2 text-xs font-bold uppercase text-zinc-300/80 transition duration-300 hover:bg-white/[0.08] hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href="#"
            className="hidden items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-xs font-bold uppercase text-zinc-200 transition duration-300 hover:border-violet-300/45 hover:bg-violet-400/10 hover:text-white sm:inline-flex"
          >
            <MessageCircle className="h-4 w-4" />
            Discord
          </a>
          {authenticated ? (
            <>
              <a
                href="/dashboard"
                className="hidden rounded-lg border border-white/10 px-4 py-2 text-xs font-bold uppercase text-zinc-200 transition duration-300 hover:border-violet-300/45 hover:bg-violet-400/10 hover:text-white sm:inline-flex"
              >
                Dashboard
              </a>
              <button
                type="button"
                onClick={signOut}
                className="hidden rounded-lg border border-white/10 px-4 py-2 text-xs font-bold uppercase text-zinc-200 transition duration-300 hover:border-violet-300/45 hover:bg-violet-400/10 hover:text-white sm:inline-flex"
              >
                Logout
              </button>
            </>
          ) : (
            <a
              href="/login"
              className="hidden rounded-lg border border-white/10 px-4 py-2 text-xs font-bold uppercase text-zinc-200 transition duration-300 hover:border-violet-300/45 hover:bg-violet-400/10 hover:text-white sm:inline-flex"
            >
              Login
            </a>
          )}
          <a
            href="/signup"
            className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-black uppercase text-white shadow-[0_0_28px_rgba(139,92,246,0.55)] transition duration-300 hover:bg-violet-400 hover:shadow-[0_0_42px_rgba(167,139,250,0.7)] sm:px-5"
          >
            Sign up
          </a>
        </div>
      </nav>
    </motion.header>
  );
}

function Hero({ homeStats, lastUpdated, error }: { homeStats: HomeStats; lastUpdated: Date | null; error: string }) {
  const heroCards = buildHeroStatCards(homeStats);
  const operationalNodes = homeStats.topServers.slice(0, 3);

  return (
    <section
      id="hero"
      className="relative mx-auto flex min-h-[92svh] w-full max-w-7xl scroll-mt-28 items-center px-5 pb-16 pt-14 sm:px-6 lg:px-8"
    >
      <div className="grid w-full gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-end">
        <motion.div variants={stagger} className="max-w-4xl">
          <motion.div variants={fadeUp} className="mb-6 inline-flex items-center gap-3 text-sm font-semibold text-cyan-100/80">
            <span className="h-px w-12 bg-gradient-to-r from-violet-300 to-cyan-300" />
            Global DayZ survival platform
          </motion.div>
          <motion.h1
            variants={fadeUp}
            className="max-w-3xl text-5xl font-black uppercase leading-[0.94] text-white sm:text-6xl md:text-7xl lg:text-8xl"
          >
            DZN Network
          </motion.h1>
          <motion.p
            variants={fadeUp}
            className="mt-6 max-w-2xl text-xl font-semibold leading-8 text-violet-100 sm:text-2xl"
          >
            One network for every survivor, every faction, and every server worth fighting for.
          </motion.p>
          <motion.p
            variants={fadeUp}
            className="mt-4 max-w-2xl text-base leading-7 text-zinc-300/80 sm:text-lg"
          >
            Discover elite DayZ communities, track live server intelligence, climb seasonal leaderboards, and command a global survival identity from one cinematic hub.
          </motion.p>
          <motion.div
            variants={fadeUp}
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            <ButtonLink href="/leaderboards" icon={Trophy}>
              View leaderboards
            </ButtonLink>
            <ButtonLink href="/signup" icon={Server} variant="secondary">
              Add your server
            </ButtonLink>
          </motion.div>

          <motion.div
            variants={stagger}
            className="mt-10 grid gap-3 sm:grid-cols-3"
          >
            {heroCards.map((card) => (
              <motion.div
                key={card.label}
                variants={fadeUp}
                className="glass-surface rounded-lg px-4 py-4"
              >
                <span className={`block font-black text-white ${card.compact ? "text-lg leading-6" : "text-2xl"}`}>{card.value}</span>
                <span className="mt-1 block text-xs font-semibold uppercase text-zinc-400">
                  {card.label}
                </span>
              </motion.div>
            ))}
          </motion.div>
          <motion.div variants={fadeUp} className="mt-5 flex flex-wrap items-center gap-3 text-xs font-black uppercase text-zinc-400">
            <span className="inline-flex items-center gap-2 text-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
              Live data
            </span>
            <span>Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Loading"}</span>
            {error ? <span className="text-orange-200">{error}</span> : null}
          </motion.div>
        </motion.div>

        <motion.aside
          variants={fadeUp}
          className="glass-surface animated-border hidden rounded-lg p-5 lg:block"
        >
          <div className="relative z-10">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-violet-200/70">
                  Network command
                </p>
                <h2 className="mt-2 text-2xl font-black uppercase text-white">
                  Live operational map
                </h2>
              </div>
              <motion.span
                className="grid h-11 w-11 place-items-center rounded-lg border border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
                animate={{ boxShadow: ["0 0 0 rgba(52,211,153,0)", "0 0 34px rgba(52,211,153,0.35)", "0 0 0 rgba(52,211,153,0)"] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <Wifi className="h-5 w-5" />
              </motion.span>
            </div>
            <div className="relative h-72 overflow-hidden rounded-lg border border-white/10 bg-[#050916]/70">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_36%,rgba(139,92,246,0.35),transparent_18%),radial-gradient(circle_at_66%_52%,rgba(14,165,233,0.24),transparent_18%),linear-gradient(135deg,rgba(255,255,255,0.04)_0_1px,transparent_1px_18px)]" />
              {(operationalNodes.length ? operationalNodes : [{ server_name: "DZN sync network", stats_active: homeStats.syncHealth.active > 0 }]).map((node, index) => (
                <div
                  key={`${node.server_name}-${index}`}
                  className={`absolute h-3 w-3 rounded-full ${node.stats_active ? "bg-emerald-300 shadow-[0_0_22px_rgba(52,211,153,0.9)]" : "bg-orange-300 shadow-[0_0_22px_rgba(251,146,60,0.9)]"}`}
                  style={mapDotPosition(index)}
                />
              ))}
              <div className="absolute left-4 top-4 rounded-lg border border-cyan-300/15 bg-black/34 px-4 py-3">
                <p className="text-xs font-black uppercase text-cyan-100">DZN sync network online</p>
                <p className="mt-1 text-sm font-bold text-zinc-300">{plural(homeStats.syncHealth.active, "active sync node")}</p>
              </div>
              <div className="absolute bottom-4 left-4 right-4 grid grid-cols-3 gap-2">
                {[
                  ["Sync Active", String(homeStats.syncHealth.active)],
                  ["Pending", String(homeStats.syncHealth.pending)],
                  ["24h Events", String(homeStats.totals.recentEventsCount)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-md border border-white/10 bg-black/28 px-3 py-2"
                  >
                    <span className="block text-xs font-bold uppercase text-zinc-300">
                      {label}
                    </span>
                    <span className="mt-1 block text-sm font-black text-emerald-200">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
              <motion.div
                className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-cyan-200/10 to-transparent"
                animate={{ x: [-120, 520] }}
                transition={{ duration: 4.8, repeat: Infinity, ease: "linear" }}
              />
            </div>
          </div>
        </motion.aside>
      </div>
    </section>
  );
}

function LiveStats({ homeStats }: { homeStats: HomeStats }) {
  const stats = buildLiveServerStats(homeStats);

  return (
    <Section id="servers" title="Live Server Stats" description="A real-time command layer for population, kills, factions, and community growth across the DZN ecosystem.">
      <motion.div variants={stagger} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <GlassCard key={stat.label} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <IconBadge icon={stat.icon} />
              <span className="rounded-md border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-xs font-black text-emerald-200">
                {stat.status}
              </span>
            </div>
            <div className="mt-6">
              <p className="text-3xl font-black text-white">{stat.value}</p>
              <p className="mt-2 text-sm font-bold uppercase text-zinc-300">
                {stat.label}
              </p>
              <p className="mt-1 text-sm text-zinc-400">{stat.detail}</p>
            </div>
            <div className="mt-5 h-1 overflow-hidden rounded-sm bg-white/[0.08]">
              <motion.div
                className="h-full bg-gradient-to-r from-violet-300 via-cyan-300 to-emerald-300"
                initial={{ width: "22%" }}
                whileInView={{ width: "86%" }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              />
            </div>
          </GlassCard>
        ))}
      </motion.div>
    </Section>
  );
}

function Leaderboards({ players }: { players: HomeStats["topPlayers"] }) {
  return (
    <Section
      id="leaderboards"
      title="Leaderboards"
      description="Seasonal survivor rankings built for PvP dominance, faction credibility, and server reputation."
    >
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <GlassCard className="overflow-hidden p-0" hover={false}>
          <div className="relative z-10 flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-xs font-bold uppercase text-violet-200/70">
                Top PvP players
              </p>
              <h3 className="mt-1 text-xl font-black uppercase text-white">
                Global season board
              </h3>
            </div>
            <ButtonLink href="#community" icon={ChevronRight} variant="ghost">
              View all
            </ButtonLink>
          </div>
          <div className="relative z-10 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[0.08] text-xs font-bold uppercase text-zinc-500">
                  <th className="px-5 py-3">#</th>
                  <th className="px-5 py-3">Player</th>
                  <th className="px-5 py-3">Kills</th>
                  <th className="px-5 py-3">Deaths</th>
                  <th className="px-5 py-3">K/D</th>
                  <th className="px-5 py-3">Longest Kill</th>
                </tr>
              </thead>
              <tbody>
                {players.length ? players.map((row) => (
                  <motion.tr
                    key={`${row.serverName}-${row.playerName}`}
                    variants={fadeUp}
                    className="border-b border-white/[0.08] text-sm transition duration-300 hover:bg-violet-300/[0.08]"
                  >
                    <td className="px-5 py-4 font-black text-violet-200">
                      {row.rank}
                    </td>
                    <td className="px-5 py-4">
                      <span className="font-black text-white">{row.playerName}</span>
                      <span className="mt-1 block text-xs font-semibold uppercase text-zinc-500">{row.serverName}</span>
                    </td>
                    <td className="px-5 py-4 font-black text-white">{formatNumber(row.kills)}</td>
                    <td className="px-5 py-4 text-zinc-300">{formatNumber(row.deaths)}</td>
                    <td className="px-5 py-4 font-semibold text-zinc-200">{row.kd}</td>
                    <td className="px-5 py-4 text-zinc-300">{row.longestKill > 0 ? `${row.longestKill.toFixed(1)}m` : "Pending"}</td>
                  </motion.tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center">
                      <p className="text-lg font-black uppercase text-white">PvP leaderboard waiting for kill data.</p>
                      <p className="mt-2 text-sm text-zinc-400">Player activity is syncing from connected servers.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase text-violet-200/70">
                Faction pulse
              </p>
              <h3 className="mt-1 text-xl font-black uppercase text-white">
                War pressure
              </h3>
            </div>
            <IconBadge icon="Swords" />
          </div>
          <div className="mt-6 space-y-5">
            {players.length ? players.slice(0, 3).map((player, index) => (
              <div key={`${player.playerName}-${player.serverName}`}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-bold text-zinc-200">{player.playerName}</span>
                  <span className="font-black text-white">{formatNumber(player.kills)} kills</span>
                </div>
                <div className="h-2 overflow-hidden rounded-sm bg-white/[0.08]">
                  <motion.div
                    className={`h-full bg-gradient-to-r ${["from-violet-300 to-cyan-300", "from-red-300 to-orange-300", "from-emerald-300 to-teal-300"][index]}`}
                    initial={{ width: "18%" }}
                    whileInView={{ width: `${Math.max(12, Math.min(100, player.kills * 10))}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, ease: "easeOut" }}
                  />
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-white/10 bg-black/24 p-4">
                <p className="text-sm font-bold text-zinc-200">No PvP kills synced yet.</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">This panel will activate when credited PvP kills are detected.</p>
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </Section>
  );
}

function GameModes({ counts }: { counts: HomeStats["gameModes"] }) {
  const modes = gameModeTemplates.map((mode) => ({
    ...mode,
    stat: `${modeCountForTitle(mode.title, counts)} connected ${modeCountForTitle(mode.title, counts) === 1 ? "server" : "servers"}`,
  }));

  return (
    <Section id="modes" title="Game Mode Cards" description="Every server type gets a cinematic identity, a score model, and a discoverable path for the right player.">
      <motion.div variants={stagger} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {modes.map((mode) => (
          <GlassCard key={mode.title} className="group min-h-[270px] overflow-hidden p-5">
            <div className={`absolute inset-0 bg-gradient-to-br ${mode.glow} opacity-80 transition duration-500 group-hover:opacity-100`} />
            <div className="relative z-10 flex h-full flex-col">
              <IconBadge icon={mode.icon} size="large" />
              <div className="mt-auto">
                <h3 className="text-2xl font-black uppercase text-white">
                  {mode.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {mode.description}
                </p>
                <p className="mt-5 text-xs font-black uppercase text-violet-200">
                  {mode.stat}
                </p>
              </div>
            </div>
          </GlassCard>
        ))}
      </motion.div>
    </Section>
  );
}

function Features() {
  return (
    <Section
      id="features"
      title="Feature Cards"
      description="The network layer DayZ communities need: discovery, telemetry, rankings, reputation, and live operations in one place."
    >
      <motion.div variants={stagger} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {features.map((feature) => (
          <GlassCard key={feature.title} className="p-5">
            <IconBadge icon={feature.icon} />
            <h3 className="mt-6 text-xl font-black uppercase text-white">
              {feature.title}
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-300/80">
              {feature.description}
            </p>
          </GlassCard>
        ))}
      </motion.div>
    </Section>
  );
}

function RecentActivity({ homeStats }: { homeStats: HomeStats }) {
  const activity = homeStats.recentActivity;

  return (
    <Section
      id="activity"
      title="Recent Activity Feed"
      description="A live pulse of captures, killstreaks, population spikes, server launches, and faction events."
    >
      <div className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase text-violet-200/70">
                Operations watch
              </p>
              <h3 className="mt-1 text-xl font-black uppercase text-white">
                Server heartbeat
              </h3>
            </div>
            <motion.span
              className="grid h-12 w-12 place-items-center rounded-lg border border-cyan-300/25 bg-cyan-400/10 text-cyan-200"
              animate={{ rotate: [0, 6, -6, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <Activity className="h-5 w-5" />
            </motion.span>
          </div>
          <div className="mt-6 grid gap-3">
            {[
              `${plural(homeStats.syncHealth.active, "active sync server")}`,
              `${plural(homeStats.totals.recentEventsCount, "public event")} in 24h`,
              homeStats.totals.serversLinked > 0 ? "Public servers connected" : "Awaiting first public server",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.9)]" />
                <span className="text-sm font-semibold text-zinc-200">{item}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-0" hover={false}>
          <div className="relative z-10 border-b border-white/10 px-5 py-4">
            <h3 className="text-xl font-black uppercase text-white">
              Live network feed
            </h3>
          </div>
          <div className="relative z-10 divide-y divide-white/[0.08]">
            {activity.length ? activity.map((item) => (
              <motion.div
                key={`${item.source}-${item.eventType}-${item.occurredAt}-${item.title}`}
                variants={fadeUp}
                className="flex items-center gap-4 px-5 py-4 transition duration-300 hover:bg-white/[0.04]"
              >
                <IconBadge icon={activityIcon(item)} tone={activityTone(item)} compact />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-zinc-100">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs font-semibold uppercase text-zinc-500">
                    {formatRelativeTime(item.occurredAt)}
                  </p>
                </div>
                <Clock className="h-4 w-4 shrink-0 text-zinc-500" />
              </motion.div>
            )) : (
              <div className="px-5 py-10">
                <p className="text-lg font-black uppercase text-white">No public activity yet.</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">Sync engine is online and waiting for server events.</p>
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </Section>
  );
}

function Community({ homeStats }: { homeStats: HomeStats }) {
  const communityStats = [
    { value: formatNumber(homeStats.totals.serversLinked), label: "Connected servers" },
    { value: formatNumber(homeStats.totals.statsActiveServers), label: "Active sync servers" },
    { value: homeStats.totals.playersSeen > 0 ? formatNumber(homeStats.totals.playersSeen) : "Awaiting activity", label: "Players seen" },
  ];

  return (
    <Section
      id="community"
      title="Community"
      description="Bring your server, squad, and faction into a global network built for competition and discovery."
    >
      <GlassCard className="overflow-hidden p-0" hover={false}>
        <div className="relative z-10 grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_0.72fr] lg:items-center">
          <div>
            <div className="mb-6 flex items-center gap-3">
              <div className="grid h-14 w-14 place-items-center rounded-lg border border-violet-300/25 bg-violet-400/10 text-violet-100 shadow-[0_0_36px_rgba(139,92,246,0.4)]">
                <Globe2 className="h-7 w-7" />
              </div>
              <div>
                <p className="text-sm font-bold uppercase text-violet-200/70">
                  DZN Alliance
                </p>
                <h3 className="text-2xl font-black uppercase text-white">
                  Be part of something bigger
                </h3>
              </div>
            </div>
            <p className="max-w-2xl text-base leading-7 text-zinc-300">
              Add your server, publish your season, connect your Discord, and let survivors find your world through verified stats, mode filters, and live activity.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/signup" icon={Zap}>
                Add your server
              </ButtonLink>
              <ButtonLink href="/servers" icon={Play} variant="secondary">
                Explore network
              </ButtonLink>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {communityStats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-white/10 bg-black/24 p-5"
              >
                <p className="text-3xl font-black text-white">{stat.value}</p>
                <p className="mt-2 text-xs font-black uppercase text-zinc-400">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </GlassCard>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/10 bg-[#02030a]/78 px-5 py-10 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <DznLogo compact />
        <p className="text-sm text-zinc-500">
          DZN Network is an independent DayZ community platform for server discovery, rankings, and live survival intelligence.
        </p>
        <div className="flex items-center gap-3 text-zinc-500">
          <Star className="h-4 w-4" />
          <span className="text-xs font-black uppercase">Season 08 live</span>
        </div>
      </div>
    </footer>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      id={id}
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.18 }}
      className="relative mx-auto w-full max-w-7xl scroll-mt-28 px-5 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20"
    >
      <div className="mb-8 flex flex-col gap-3 md:mb-10 md:max-w-3xl">
        <motion.div variants={fadeUp} className="flex items-center gap-3 text-violet-200/75">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-violet-300/25 bg-violet-400/10">
            <Hexagon className="h-4 w-4" />
          </span>
          <span className="text-xs font-black uppercase">DZN Network</span>
        </motion.div>
        <motion.h2
          variants={fadeUp}
          className="text-3xl font-black uppercase leading-tight text-white sm:text-4xl md:text-5xl"
        >
          {title}
        </motion.h2>
        <motion.p variants={fadeUp} className="text-base leading-7 text-zinc-300/80 sm:text-lg">
          {description}
        </motion.p>
      </div>
      {children}
    </motion.section>
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
    topServers: Array.isArray(payload.topServers) ? payload.topServers : [],
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

function buildHeroStatCards(homeStats: HomeStats) {
  return [
    {
      value: formatNumber(homeStats.totals.serversLinked),
      label: "Servers linked",
      compact: false,
    },
    {
      value: homeStats.totals.killsTracked > 0 ? formatNumber(homeStats.totals.killsTracked) : "Waiting for first PvP kill",
      label: "Kills tracked",
      compact: homeStats.totals.killsTracked === 0,
    },
    {
      value: homeStats.totals.playersSeen > 0 ? formatNumber(homeStats.totals.playersSeen) : "Awaiting synced player activity",
      label: "Players seen",
      compact: homeStats.totals.playersSeen === 0,
    },
  ];
}

function buildLiveServerStats(homeStats: HomeStats) {
  return [
    {
      label: "Players seen",
      value: homeStats.totals.playersSeen > 0 ? formatNumber(homeStats.totals.playersSeen) : "0",
      detail: homeStats.totals.playersSeen > 0 ? "synced public profiles" : "awaiting synced player activity",
      icon: "Users",
      status: "Live",
    },
    {
      label: "Servers linked",
      value: formatNumber(homeStats.totals.serversLinked),
      detail: "public connected servers",
      icon: "Server",
      status: `${homeStats.syncHealth.active} active`,
    },
    {
      label: "Kills tracked",
      value: homeStats.totals.killsTracked > 0 ? formatNumber(homeStats.totals.killsTracked) : "0",
      detail: homeStats.totals.killsTracked > 0 ? "credited PvP kills" : "waiting for first PvP kill",
      icon: "Crosshair",
      status: "Public",
    },
    {
      label: "Joins tracked",
      value: homeStats.totals.joinsTracked > 0 ? formatNumber(homeStats.totals.joinsTracked) : "0",
      detail: homeStats.totals.joinsTracked > 0 ? "synced player joins" : "waiting for activity",
      icon: "Shield",
      status: "ADM",
    },
  ];
}

function modeCountForTitle(title: string, counts: HomeStats["gameModes"]) {
  if (title === "PvP") return counts.pvp;
  if (title === "PvE") return counts.pve;
  if (title === "Deathmatch") return counts.deathmatch;
  return counts.pvpPve;
}

function mapDotPosition(index: number) {
  const positions = [
    { left: "18%", top: "28%" },
    { left: "53%", top: "44%" },
    { right: "18%", top: "23%" },
    { left: "72%", top: "62%" },
    { left: "34%", top: "66%" },
    { right: "28%", top: "38%" },
  ];
  return positions[index % positions.length];
}

function activityIcon(item: HomeStats["recentActivity"][number]) {
  if (item.source === "kill") return "Crosshair";
  if (item.source === "sync") return "Activity";
  if (item.source === "server") return "Radio";
  if (item.eventType === "player_connected" || item.eventType === "player_disconnected") return "Users";
  return "Radio";
}

function activityTone(item: HomeStats["recentActivity"][number]) {
  if (item.source === "kill") return "text-red-300";
  if (item.source === "sync") return "text-emerald-300";
  if (item.source === "server") return "text-violet-300";
  return "text-sky-300";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(numberOrZero(value));
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function plural(count: number, label: string) {
  return `${formatNumber(count)} ${label}${count === 1 ? "" : "s"}`;
}

function formatRelativeTime(value: string | null) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function GlassCard({
  children,
  className = "",
  hover = true,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={
        hover
          ? {
              y: -7,
              scale: 1.01,
              transition: { duration: 0.26, ease: "easeOut" },
            }
          : undefined
      }
      className={`glass-surface animated-border relative rounded-lg ${className}`}
    >
      {children}
    </motion.div>
  );
}

function ButtonLink({
  href,
  children,
  icon: Icon,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  icon: LucideIcon;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const classes = {
    primary:
      "border-violet-300/30 bg-violet-500 text-white shadow-[0_0_34px_rgba(139,92,246,0.55)] hover:bg-violet-400 hover:shadow-[0_0_48px_rgba(167,139,250,0.76)]",
    secondary:
      "border-white/[0.14] bg-white/[0.04] text-zinc-100 hover:border-cyan-300/[0.42] hover:bg-cyan-300/10 hover:text-white",
    ghost:
      "border-white/10 bg-white/[0.03] text-violet-100 hover:border-violet-300/35 hover:bg-violet-400/10",
  }[variant];

  return (
    <motion.a
      href={href}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-lg border px-5 text-xs font-black uppercase transition duration-300 ${classes}`}
    >
      <Icon className="h-4 w-4" />
      {children}
      {variant !== "ghost" ? <ChevronRight className="h-4 w-4" /> : null}
    </motion.a>
  );
}

function IconBadge({
  icon,
  size = "normal",
  tone = "text-violet-100",
  compact = false,
}: {
  icon: string;
  size?: "normal" | "large";
  tone?: string;
  compact?: boolean;
}) {
  const Icon = iconMap[icon] ?? Hexagon;
  const sizeClass = compact
    ? "h-10 w-10"
    : size === "large"
      ? "h-14 w-14"
      : "h-12 w-12";
  const iconClass = compact
    ? "h-4 w-4"
    : size === "large"
      ? "h-7 w-7"
      : "h-5 w-5";

  return (
    <motion.span
      className={`grid ${sizeClass} shrink-0 place-items-center rounded-lg border border-violet-300/25 bg-violet-400/10 ${tone} shadow-[0_0_26px_rgba(139,92,246,0.32)]`}
      whileHover={{ rotate: 3, scale: 1.05 }}
      transition={{ duration: 0.22 }}
    >
      <Icon className={iconClass} />
    </motion.span>
  );
}
