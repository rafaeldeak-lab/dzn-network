"use client";

import {
  Activity,
  BarChart3,
  ChevronRight,
  Crosshair,
  Flag,
  MessageCircle,
  Radio,
  Server,
  Shield,
  Skull,
  Swords,
  Trophy,
  Users,
  Wifi,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { DznLogo } from "./dzn-logo";

const CINEMATIC_BG = "/media/dzn-cinematic-survivor.png";
const HOME_STATS_REFRESH_MS = 30000;

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.65, ease: "easeOut" },
  },
};

const stagger: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
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

type TopServerRow = {
  rank: number;
  server: string;
  kd: string;
  kills: string;
  score: string;
};

type RecentRow = {
  title: string;
  time: string;
  icon: LucideIcon;
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

const fallbackTopServers: TopServerRow[] = [
  {
    rank: 1,
    server: "DayZQuest Bot Test Server",
    kd: "Awaiting data",
    kills: "0",
    score: "130",
  },
  {
    rank: 2,
    server: "Warlords PvP",
    kd: "Awaiting data",
    kills: "0",
    score: "Pending",
  },
];

const featureCards = [
  {
    title: "Global Server Leaderboards",
    text: "Rank connected DayZ servers by kills, K/D, longest kills, survival records, and reputation.",
    icon: Trophy,
  },
  {
    title: "Server Categories",
    text: "PvP, PvE, Deathmatch, faction worlds, hardcore shards, roleplay, economy, and custom maps.",
    icon: Server,
  },
  {
    title: "Faction Wars",
    text: "Every player and faction contributes to server ranking, reputation, and event momentum.",
    icon: Flag,
  },
  {
    title: "Server Analytics",
    text: "ADM-backed activity, kills, deaths, joins, disconnects, and server health in one control layer.",
    icon: BarChart3,
  },
  {
    title: "Server vs Server Events",
    text: "Monthly server wars and seasonal stat battles are coming soon across kills, K/D, factions, activity, and score.",
    icon: Swords,
  },
];

const navItems = [
  { label: "Features", href: "#features" },
  { label: "Leaderboards", href: "/leaderboards" },
  { label: "Servers", href: "/servers" },
  { label: "Stats", href: "#stats" },
  { label: "Events", href: "#server-events" },
];

export function DznTestLanding() {
  const reducedMotion = useReducedMotion();
  const { data, lastUpdated } = useHomeStats();
  const topServers = useMemo(() => buildTopServers(data), [data]);
  const recentRows = useMemo(() => buildRecentRows(data), [data]);

  useEffect(() => {
    console.log("DZN TEST LANDING PAGE LIVE MOCKUP LOADED");
  }, []);

  return (
    <div
      className="dzn-test-page min-h-screen overflow-x-hidden bg-[#020713] text-slate-100"
      style={
        {
          "--dzn-page-bg": `url("${CINEMATIC_BG}")`,
          "--dzn-hero-bg": `url("${CINEMATIC_BG}")`,
          "--dzn-cta-bg": `url("${CINEMATIC_BG}")`,
        } as CSSProperties
      }
    >
      <AliveBackground reducedMotion={Boolean(reducedMotion)} />
      <TestNavbar />

      <motion.main
        initial="hidden"
        animate="show"
        variants={stagger}
        className="relative z-10 mx-auto flex w-full max-w-[1380px] flex-col gap-4 px-4 pb-8 pt-4 sm:px-6 lg:px-8"
      >
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_430px]">
          <HeroCard lastUpdated={lastUpdated} />
          <aside className="grid gap-3">
            <TopServersPanel rows={topServers} />
            <RecentActivityPanel rows={recentRows} />
            <OperationalMap stats={data} />
          </aside>
        </section>

        <FeatureRow />
        <GameModes stats={data} />
        <StatsRow stats={data} />
        <BottomCta />
      </motion.main>

      <footer className="relative z-10 mx-auto max-w-[1380px] px-4 pb-8 text-[0.68rem] font-semibold text-slate-500 sm:px-6 lg:px-8">
        Copyright 2026 DZN Network. Server competition intelligence for connected DayZ communities.
      </footer>
    </div>
  );
}

function TestNavbar() {
  return (
    <header className="relative z-30 border-b border-white/10 bg-[#020713]/72 backdrop-blur-2xl">
      <nav className="mx-auto flex min-h-[86px] w-full max-w-[1380px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:flex-nowrap lg:px-8">
        <DznLogo compact className="-ml-2" />

        <div className="order-3 flex w-full flex-wrap items-center justify-center gap-1 lg:order-2 lg:w-auto lg:flex-1">
          {navItems.map((item) => (
            item.href.startsWith("/") ? (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-[0.64rem] font-black uppercase tracking-[0.16em] text-slate-300/80 transition duration-300 hover:bg-white/[0.08] hover:text-white"
              >
                {item.label}
              </Link>
            ) : (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-[0.64rem] font-black uppercase tracking-[0.16em] text-slate-300/80 transition duration-300 hover:bg-white/[0.08] hover:text-white"
              >
                {item.label}
              </a>
            )
          ))}
        </div>

        <div className="order-2 flex items-center justify-end gap-2 lg:order-3">
          <a
            href="#"
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-[0.66rem] font-black uppercase tracking-[0.13em] text-slate-200 transition duration-300 hover:border-violet-300/45 hover:bg-violet-400/10"
          >
            <MessageCircle className="h-4 w-4 text-violet-200" />
            Discord
          </a>
          <Link
            href="/login"
            className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-[0.66rem] font-black uppercase tracking-[0.13em] text-slate-200 transition duration-300 hover:border-cyan-300/45 hover:bg-cyan-300/10"
          >
            Login
          </Link>
        </div>
      </nav>
    </header>
  );
}

function HeroCard({ lastUpdated }: { lastUpdated: Date | null }) {
  return (
    <motion.article
      variants={fadeUp}
      className="dzn-test-hero-card relative min-h-[430px] overflow-hidden rounded-[20px] border border-slate-400/20 bg-[rgba(8,13,29,0.78)] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-8 lg:min-h-[454px]"
    >
      <div className="relative z-10 max-w-[760px]">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-300/25 bg-black/28 px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.2em] text-violet-100">
          <Shield className="h-3.5 w-3.5" />
          The universal DayZ server network
        </div>

        <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-normal text-white drop-shadow-[0_0_28px_rgba(139,92,246,0.42)] sm:text-6xl lg:text-7xl">
          One Network.
          <span className="block bg-gradient-to-r from-violet-100 via-violet-400 to-cyan-200 bg-clip-text text-transparent">
            Every Server.
          </span>
        </h1>

        <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
          Connected servers compete across live stat categories. Track kills,
          K/D, longest kills, survival records, factions, activity, and server
          reputation.
        </p>

        <p className="mt-4 text-lg font-black uppercase text-white">
          Prove your server is the best.
        </p>

        <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center">
          <Link
            href="/leaderboards"
            className="group inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200/45 bg-violet-600 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[0_0_34px_rgba(124,58,237,0.48)] transition duration-300 hover:-translate-y-0.5 hover:bg-violet-500 sm:w-auto"
          >
            <Trophy className="h-4 w-4" />
            View Leaderboards
            <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
          </Link>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-[0.66rem] font-black uppercase tracking-[0.16em] text-slate-400">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1 text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(99,246,167,0.95)]" />
            Live data
          </span>
          <span>
            Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "syncing"}
          </span>
        </div>
      </div>
    </motion.article>
  );
}

function TopServersPanel({ rows }: { rows: TopServerRow[] }) {
  return (
    <Panel title="Top Servers" icon={Trophy} actionHref="/servers">
      <div className="grid grid-cols-[28px_minmax(0,1fr)_74px_44px_58px] gap-2 border-b border-white/10 pb-2 text-[0.58rem] font-black uppercase tracking-[0.11em] text-slate-500">
        <span>#</span>
        <span>Server</span>
        <span className="text-right">K/D</span>
        <span className="text-right">Kills</span>
        <span className="text-right">Score</span>
      </div>
      <div className="mt-2 grid gap-1.5">
        {rows.map((row) => (
          <div
            key={`${row.rank}-${row.server}`}
            title={row.server}
            className="grid grid-cols-[28px_minmax(0,1fr)_74px_44px_58px] items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2 py-2 text-xs"
          >
            <span className="font-black text-violet-200">{row.rank}</span>
            <span className="min-w-0 break-words text-[0.72rem] font-bold leading-4 text-white">{row.server}</span>
            <span className="text-right text-[0.62rem] font-bold leading-3 text-slate-300">{row.kd}</span>
            <span className="text-right font-bold text-slate-300">{row.kills}</span>
            <span className="text-right font-black text-emerald-200">{row.score}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RecentActivityPanel({ rows }: { rows: RecentRow[] }) {
  return (
    <Panel title="Recent Activity" icon={Activity} actionHref="/servers">
      <div className="grid gap-2">
        {rows.map((row, index) => {
          const Icon = row.icon;
          return (
            <div
              key={`${row.title}-${index}`}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-cyan-300/18 bg-cyan-300/10 text-cyan-100">
                <Icon className="h-4 w-4" />
              </span>
              <p className="min-w-0 flex-1 text-[0.7rem] font-black uppercase leading-4 text-white">
                {row.title}
              </p>
              <span className="text-[0.66rem] font-bold text-slate-500">{row.time}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function OperationalMap({ stats }: { stats: HomeStats }) {
  const active = stats.syncHealth.active || 1;
  const pending = stats.syncHealth.pending || 1;
  const events = stats.totals.recentEventsCount || 82;

  return (
    <Panel title="Live Operational Map" icon={Radio}>
      <div className="grid gap-4 sm:grid-cols-[1fr_138px]">
        <div>
          <p className="text-sm font-bold text-white">DZN network intelligence online</p>
          <p className="mt-1 text-xs text-slate-400">
            {active} active public sync node{active === 1 ? "" : "s"}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <MiniMetric label="Sync Active" value={formatNumber(active)} />
            <MiniMetric label="Pending" value={formatNumber(pending)} />
            <MiniMetric label="Events" value={formatNumber(events)} />
          </div>
        </div>
        <div className="dzn-test-radar mx-auto h-28 w-28 rounded-full border border-emerald-300/20 bg-[#03110f]/80" aria-hidden="true">
          <span className="dzn-test-radar-ring" />
          <span className="dzn-test-radar-ring dzn-test-radar-ring-two" />
          <span className="dzn-test-radar-sweep" />
          <span className="dzn-test-radar-dot dzn-test-radar-dot-one" />
          <span className="dzn-test-radar-dot dzn-test-radar-dot-two" />
          <span className="dzn-test-radar-dot dzn-test-radar-dot-three" />
        </div>
      </div>
    </Panel>
  );
}

function FeatureRow() {
  return (
    <motion.section variants={fadeUp} id="features" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {featureCards.map((card) => {
        const Icon = card.icon;
        return (
          <motion.article
            key={card.title}
            id={card.title === "Server vs Server Events" ? "server-events" : undefined}
            whileHover={{ y: -4 }}
            className="dzn-test-card group relative scroll-mt-28 overflow-hidden rounded-[18px] border border-slate-400/15 bg-[rgba(8,13,29,0.78)] p-4 shadow-[0_16px_54px_rgba(0,0,0,0.26)] backdrop-blur-xl transition duration-300 hover:border-violet-300/35"
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-violet-300/22 bg-violet-500/14 text-violet-100 shadow-[0_0_22px_rgba(139,92,246,0.18)]">
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-sm font-black uppercase leading-snug text-white">{card.title}</h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">{card.text}</p>
          </motion.article>
        );
      })}
    </motion.section>
  );
}

function GameModes({ stats }: { stats: HomeStats }) {
  const modes = [
    {
      title: "PvP",
      count: stats.gameModes.pvp,
      text: "High-risk servers competing on confirmed kills, K/D, and longest shots.",
      icon: Crosshair,
      tint: "from-red-500/22 to-violet-500/12",
    },
    {
      title: "Deathmatch",
      count: stats.gameModes.deathmatch,
      text: "Fast combat communities pushing activity, volume, and clean kill tracking.",
      icon: Skull,
      tint: "from-cyan-400/18 to-blue-500/12",
    },
    {
      title: "PvE",
      count: stats.gameModes.pve,
      text: "Survival-focused servers building longevity, events, and community reputation.",
      icon: Shield,
      tint: "from-emerald-400/18 to-cyan-500/12",
    },
    {
      title: "PvP / PvE",
      count: stats.gameModes.pvpPve,
      text: "Hybrid worlds where factions, raids, survival, and competition all count.",
      icon: Swords,
      tint: "from-violet-400/22 to-fuchsia-500/12",
    },
  ];

  return (
    <motion.section variants={fadeUp} className="rounded-[20px] border border-slate-400/15 bg-[rgba(8,13,29,0.74)] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[0.66rem] font-black uppercase tracking-[0.18em] text-violet-200">Game Modes</p>
          <h2 className="text-xl font-black uppercase text-white">Find your battleground</h2>
        </div>
        <Link href="/servers" className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-cyan-200 hover:text-white">
          View Servers
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {modes.map((mode) => {
          const Icon = mode.icon;
          return (
            <Link
              key={mode.title}
              href="/servers"
              className="group relative overflow-hidden rounded-[16px] border border-white/10 bg-white/[0.035] p-4 transition duration-300 hover:-translate-y-1 hover:border-violet-300/34"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${mode.tint}`} />
              <div className="relative z-10">
                <div className="flex items-center justify-between gap-3">
                  <Icon className="h-7 w-7 text-violet-100 transition group-hover:scale-110" />
                  <span className="rounded-full border border-white/10 bg-black/24 px-2 py-1 text-[0.62rem] font-black uppercase text-slate-200">
                    {formatNumber(mode.count)} servers
                  </span>
                </div>
                <h3 className="mt-6 text-lg font-black uppercase text-white">{mode.title}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">{mode.text}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </motion.section>
  );
}

function StatsRow({ stats }: { stats: HomeStats }) {
  const items = [
    {
      label: "Players Seen",
      value: stats.totals.playersSeen > 0 ? formatNumber(stats.totals.playersSeen) : "6",
      icon: Users,
    },
    {
      label: "Servers Linked",
      value: stats.totals.serversLinked > 0 ? formatNumber(stats.totals.serversLinked) : "2",
      icon: Server,
    },
    {
      label: "Kills Tracked",
      value: stats.totals.killsTracked > 0 ? formatNumber(stats.totals.killsTracked) : "Awaiting PvP Data",
      icon: Crosshair,
    },
    {
      label: "Active Servers",
      value: stats.syncHealth.active > 0 ? formatNumber(stats.syncHealth.active) : "1",
      icon: Wifi,
    },
  ];

  return (
    <motion.section variants={fadeUp} id="stats" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="flex items-center gap-3 rounded-[16px] border border-slate-400/15 bg-[rgba(8,13,29,0.78)] p-4 shadow-[0_14px_46px_rgba(0,0,0,0.22)] backdrop-blur-xl"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-cyan-300/18 bg-cyan-300/8 text-cyan-100">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="break-words text-base font-black uppercase leading-tight text-white sm:text-lg">{item.value}</p>
              <p className="text-[0.66rem] font-bold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
            </div>
          </div>
        );
      })}
    </motion.section>
  );
}

function BottomCta() {
  return (
    <motion.section variants={fadeUp} className="dzn-test-cta relative overflow-hidden rounded-[20px] border border-violet-300/22 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.36)] sm:p-8">
      <div className="relative z-10 max-w-4xl">
        <p className="text-[0.66rem] font-black uppercase tracking-[0.2em] text-violet-200">
          Be part of something bigger
        </p>
        <h2 className="mt-2 max-w-3xl text-2xl font-black uppercase leading-tight text-white sm:text-4xl">
          Join a growing network of DayZ servers and communities.
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Build your community reputation, let every player and faction contribute to your server ranking, and prove your server is the best.
        </p>
        <Link
          href="/signup"
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200/45 bg-violet-600 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[0_0_34px_rgba(124,58,237,0.5)] transition duration-300 hover:-translate-y-0.5 hover:bg-violet-500 sm:w-auto"
        >
          Add Your Server
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </motion.section>
  );
}

function Panel({
  title,
  icon: Icon,
  actionHref,
  children,
}: {
  title: string;
  icon: LucideIcon;
  actionHref?: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      variants={fadeUp}
      className="rounded-[20px] border border-slate-400/15 bg-[rgba(8,13,29,0.78)] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-violet-300/18 bg-violet-400/10 text-violet-100">
            <Icon className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-black uppercase tracking-[0.1em] text-white">{title}</h2>
        </div>
        {actionHref ? (
          <Link href={actionHref} className="text-[0.62rem] font-black uppercase tracking-[0.13em] text-violet-200 hover:text-white">
            View All
          </Link>
        ) : null}
      </div>
      {children}
    </motion.section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/18 px-2 py-2">
      <p className="text-sm font-black text-white">{value}</p>
      <p className="text-[0.58rem] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p>
    </div>
  );
}

function AliveBackground({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="dzn-test-bg-image" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_64%_12%,rgba(139,92,246,0.2),transparent_30%),radial-gradient(circle_at_22%_78%,rgba(14,165,233,0.12),transparent_34%),linear-gradient(90deg,rgba(2,7,19,0.96),rgba(5,8,22,0.66),rgba(2,7,19,0.94))]" />
      <div className="dzn-test-haze" />
      {reducedMotion ? null : (
        <>
          <div className="dzn-test-smoke dzn-test-smoke-one" />
          <div className="dzn-test-smoke dzn-test-smoke-two" />
          {Array.from({ length: 36 }).map((_, index) => (
            <span
              key={index}
              className="dzn-test-particle"
              style={{
                left: `${(index * 37) % 100}%`,
                top: `${(index * 23) % 100}%`,
                animationDelay: `${(index % 12) * 0.42}s`,
                animationDuration: `${12 + (index % 8)}s`,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

function useHomeStats() {
  const [data, setData] = useState<HomeStats>(emptyHomeStats);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
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
      } catch {
        if (active) {
          setData(emptyHomeStats);
          setLastUpdated(new Date());
        }
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

  return { data, lastUpdated };
}

function buildTopServers(stats: HomeStats): TopServerRow[] {
  const rows = stats.topServers.slice(0, 5).map((server, index) => {
    const kills = numberOrZero(server.total_kills);
    const deaths = numberOrZero(server.total_deaths);
    const score = kills * 10 + numberOrZero(server.unique_players) * 5 + (server.stats_active ? 100 : 0);
    return {
      rank: index + 1,
      server: formatServerDisplayName(server.server_name || server.guild_name || "Unnamed DZN Server"),
      kd: kills === 0 ? "Awaiting data" : deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2),
      kills: formatNumber(kills),
      score: score > 0 ? formatNumber(score) : "Pending",
    };
  });

  if (rows.length === 0) return fallbackTopServers;

  const merged = [...rows];
  for (const fallback of fallbackTopServers) {
    const exists = merged.some((row) => row.server.toLowerCase() === fallback.server.toLowerCase());
    if (!exists && merged.length < 5) {
      merged.push({ ...fallback, rank: merged.length + 1 });
    }
  }

  return merged;
}

function buildRecentRows(stats: HomeStats): RecentRow[] {
  const rows = stats.recentActivity.slice(0, 5).map<RecentRow>((activity) => ({
    title: (activity.title || `${activity.serverName ?? "DZN server"} sync completed`).toUpperCase(),
    time: formatAgo(activity.occurredAt),
    icon: activity.source === "kill" ? Crosshair : activity.source === "sync" ? Radio : activity.source === "server" ? Server : Activity,
  }));

  if (rows.length > 0) return rows;

  return [3, 8, 13, 18, 23].map((minutes) => ({
    title: "DAYZQUESTBOTTESTSERVER SYNC COMPLETED",
    time: `${minutes}m`,
    icon: Radio,
  }));
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
