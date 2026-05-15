"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Crosshair,
  Crown,
  Flame,
  Gamepad2,
  LogOut,
  Map,
  MapPin,
  Medal,
  RadioTower,
  Search,
  ShieldCheck,
  Skull,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";

import { AnimatedBackground } from "@/components/dzn/animated-background";
import { DznLogo } from "@/components/dzn/dzn-logo";
import { clearClientAuthState, logoutAndRedirect } from "@/components/onboarding/api";

type PublicServer = {
  public_slug: string;
  server_name: string;
  server_type: string;
  tags_json: string;
  status: string;
  nitrado_service_name: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
  adm_status: "Connected" | "Discovered" | "Needs Review";
  stats_sync: "Active" | "Pending" | "Not Started";
  player_slots: number | null;
  current_players: number | null;
  platform: string | null;
  map_name: string | null;
  mission: string | null;
  server_status: string | null;
  is_online: boolean;
  last_sync_at: string | null;
  metadata_last_checked_at: string | null;
  created_at: string | null;
  total_kills: number;
  total_deaths: number;
  total_joins: number;
  total_disconnects: number;
  unique_players: number;
  recent_events: PublicRecentEvent[];
  top_players?: PublicLeaderboardPlayer[];
  pvp_leaderboard?: PublicLeaderboardPlayer[];
};

type PublicRecentEvent = {
  source: "kill" | "player";
  event_type: string;
  label: string;
  player_name: string | null;
  killer_name: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
  created_at: string | null;
};

type PublicLeaderboardPlayer = {
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

type PublicStats = {
  totalServers: number;
  pvpServers: number;
  pveServers: number;
  deathmatchServers: number;
  statsSyncActive: number;
  statsSyncPending: number;
};

type PublicServersResponse = {
  ok?: boolean;
  server?: PublicServer | null;
  servers?: PublicServer[];
  stats?: PublicStats;
  error?: string;
};

const filters = ["All", "PVP", "DEATHMATCH", "PVE", "PVP / PVE"];

export function PublicNetwork() {
  const slug = useSyncExternalStore(subscribeToPath, getCurrentSlug, getServerSlugSnapshot);
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [server, setServer] = useState<PublicServer | null>(null);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const requestedSlug = slug;

    async function load() {
      setLoading(true);
      setError("");
      setServer(null);
      setServers([]);
      setStats(null);
      try {
        const endpoint = requestedSlug ? `/api/public/servers?slug=${encodeURIComponent(requestedSlug)}` : "/api/public/servers";
        const response = await fetch(endpoint, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
        const data = (await response.json().catch(() => ({}))) as PublicServersResponse;
        if (!response.ok) throw new Error(data.error || "Unable to load public servers");
        if (controller.signal.aborted || requestedSlug !== slug) return;

        if (requestedSlug) {
          const matchedServer = data.server ?? (await fetchPublicServerFallback(requestedSlug, controller.signal));
          if (controller.signal.aborted || requestedSlug !== slug) return;
          setServer(matchedServer);
          setServers([]);
          setStats(null);
          if (matchedServer) console.log("DZN SERVER PROFILE SCOPED DATA LOADED");
        } else {
          setServers(Array.isArray(data.servers) ? data.servers : []);
          setStats(data.stats ?? null);
          setServer(null);
          console.log("DZN PUBLIC SERVERS FRESH DATA LOADED");
        }
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load public servers");
      } finally {
        if (controller.signal.aborted) return;
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [slug]);

  const sortedServers = useMemo(() => [...servers].sort((a, b) => serverSortRank(a) - serverSortRank(b)), [servers]);
  const filteredServers = useMemo(
    () => (filter === "All" ? sortedServers : sortedServers.filter((item) => item.server_type === filter)),
    [filter, sortedServers],
  );
  const calculatedStats = useMemo(() => stats ?? buildStats(servers), [stats, servers]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] text-white">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 sm:px-6 lg:px-8">
        <PublicNav />
        {slug ? (
          <ServerProfileShell server={server} loading={loading} error={error} />
        ) : (
          <ServerBrowser servers={filteredServers} allServers={servers} stats={calculatedStats} filter={filter} setFilter={setFilter} loading={loading} error={error} />
        )}
      </div>
    </main>
  );
}

function PublicNav() {
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
    <nav className="flex min-h-[104px] items-center justify-between">
      <DznLogo href="/" />
      <div className="flex items-center gap-3">
        <Link href="/servers" className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/35 hover:text-white lg:inline-flex">
          Servers
        </Link>
        {authenticated ? (
          <>
            <Link href="/dashboard" className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/35 hover:text-white sm:inline-flex">
              Dashboard
            </Link>
            <button type="button" onClick={signOut} className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/35 hover:text-white md:inline-flex">
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </>
        ) : (
          <Link href="/login" className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/35 hover:text-white sm:inline-flex">
            Login
          </Link>
        )}
        <Link href="/signup" className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-black uppercase text-white shadow-[0_0_26px_rgba(139,92,246,0.35)] transition hover:bg-violet-400">
          Add Your Server
        </Link>
      </div>
    </nav>
  );
}

function ServerBrowser({
  servers,
  allServers,
  stats,
  filter,
  setFilter,
  loading,
  error,
}: {
  servers: PublicServer[];
  allServers: PublicServer[];
  stats: PublicStats;
  filter: string;
  setFilter: (filter: string) => void;
  loading: boolean;
  error: string;
}) {
  return (
    <div className="pb-16 pt-16">
      <motion.header
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="max-w-4xl"
      >
        <h1 className="text-4xl font-black uppercase tracking-normal text-white sm:text-6xl">DZN Network Servers</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-300">
          Browse verified DayZ communities connected to DZN Network.
        </p>
      </motion.header>

      <StatsRow stats={stats} />

      <section className="mt-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {filters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`rounded-lg border px-4 py-2 text-xs font-black uppercase transition ${
                  filter === item
                    ? "border-violet-300/45 bg-violet-500/20 text-white shadow-[0_0_24px_rgba(139,92,246,0.25)]"
                    : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-violet-300/30 hover:text-white"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/28 px-4 py-3 text-sm font-bold text-zinc-300">
            <Search className="h-4 w-4 text-violet-200" />
            {loading ? "Scanning network..." : `${servers.length} visible of ${allServers.length} verified`}
          </div>
        </div>

        {error ? <MessagePanel message={error} /> : null}
        {loading ? <ServerSkeletonGrid /> : null}
        {!loading && !error && servers.length === 0 ? <EmptyPublicState /> : null}
        {!loading && !error && servers.length > 0 ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {servers.map((item, index) => (
              <ServerCard key={item.public_slug} server={item} index={index} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function StatsRow({ stats }: { stats: PublicStats }) {
  const rows = [
    { label: "Total Servers", value: stats.totalServers, icon: RadioTower, tone: "violet" },
    { label: "PvP Servers", value: stats.pvpServers, icon: Crosshair, tone: "red" },
    { label: "PvE Servers", value: stats.pveServers, icon: ShieldCheck, tone: "cyan" },
    { label: "Deathmatch", value: stats.deathmatchServers, icon: Skull, tone: "orange" },
    { label: "Stats Sync", value: null, icon: Activity, tone: "emerald", syncSummary: true },
  ];

  return (
    <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {rows.map((row, index) => (
        <motion.div
          key={row.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: index * 0.04 }}
          className="glass-surface animated-border rounded-lg p-4"
        >
          <div className="relative z-10">
            <row.icon className={`h-6 w-6 ${toneClass(row.tone)}`} />
            {row.syncSummary ? (
              <div aria-label={`${stats.statsSyncActive} Active, ${stats.statsSyncPending} Pending`} className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="whitespace-nowrap rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-sm font-black text-emerald-100">
                  {stats.statsSyncActive} Active
                </span>
                <span className="whitespace-nowrap rounded-md border border-orange-300/25 bg-orange-400/10 px-2.5 py-1 text-sm font-black text-orange-100">
                  {stats.statsSyncPending} Pending
                </span>
              </div>
            ) : (
              <p className="mt-4 text-2xl font-black text-white">{row.value}</p>
            )}
            <p className="mt-1 text-xs font-black uppercase text-zinc-500">{row.label}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function ServerCard({ server, index }: { server: PublicServer; index: number }) {
  const tags = parseTags(server.tags_json);
  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, delay: index * 0.05 }}
      whileHover={{ y: -5 }}
      className="glass-surface animated-border rounded-lg p-5"
    >
      <div className="relative z-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <GuildIcon server={server} size="md" />
            <div className="min-w-0">
              <p className="truncate text-xs font-black uppercase text-violet-200/70">{server.guild_name ?? "Verified Discord"}</p>
              <h2 className="mt-1 truncate text-2xl font-black text-white">{server.server_name}</h2>
              <p className="mt-1 truncate text-sm font-bold text-zinc-400">{server.nitrado_service_name ?? server.server_name}</p>
            </div>
          </div>
          <StatusPill label="Live" tone="emerald" />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <StatusPill label="Verified Owner" tone="cyan" />
          <StatusPill label="DZN Verified" tone="violet" />
          <StatusPill label={server.server_type} tone="violet" />
          <StatusPill label={server.adm_status === "Discovered" ? "ADM Logs Discovered" : `ADM ${server.adm_status}`} tone={server.adm_status === "Connected" ? "emerald" : server.adm_status === "Discovered" ? "cyan" : "orange"} />
          <StatusPill label={`Stats Sync ${server.stats_sync}`} tone={server.stats_sync === "Active" ? "emerald" : server.stats_sync === "Pending" ? "orange" : "zinc"} />
          {server.player_slots ? <StatusPill label={`${server.player_slots} slots`} tone="zinc" /> : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {tags.length ? tags.map((tag) => <span key={tag} className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold text-cyan-100">{tag}</span>) : <span className="text-sm text-zinc-500">No tags listed</span>}
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
          <p className="text-xs font-bold uppercase text-zinc-500">{publicCardFooter(server)}</p>
          <Link href={publicServerProfileHref(server.public_slug)} className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-xs font-black uppercase text-white shadow-[0_0_24px_rgba(139,92,246,0.3)] transition hover:bg-violet-400">
            View Server
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </motion.article>
  );
}

function ServerProfileShell({ server, loading, error }: { server: PublicServer | null; loading: boolean; error: string }) {
  if (loading) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <div className="glass-surface animated-border rounded-lg p-8 text-center">
          <div className="relative z-10">
            <Activity className="mx-auto h-10 w-10 animate-pulse text-violet-200" />
            <p className="mt-4 text-sm font-black uppercase text-zinc-300">Loading public server...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) return <ProfileMessage tone="error" message={error} />;
  if (!server) return <ProfileMessage tone="empty" message="This public DZN server page was not found." />;
  return <ServerProfile server={server} />;
}

function ServerProfile({ server }: { server: PublicServer }) {
  const tags = parseTags(server.tags_json);
  const statsPending = server.stats_sync === "Pending";
  const statsActiveWithoutKills = server.stats_sync === "Active" && server.total_kills === 0;
  const players = server.top_players ?? [];
  const pvpLeaderboard = server.pvp_leaderboard ?? players;
  const kd = calculateServerKd(server.total_kills, server.total_deaths);

  useEffect(() => {
    console.log("DZN LIVE SERVER PROFILE LOADED");
  }, []);

  return (
    <div className="relative pb-12 pt-6">
      <div className="pointer-events-none absolute inset-x-[-12vw] top-10 -z-10 h-[520px] bg-[radial-gradient(circle_at_18%_18%,rgba(139,92,246,0.28),transparent_34%),radial-gradient(circle_at_88%_12%,rgba(34,211,238,0.16),transparent_28%)] blur-2xl" />
      <Link href="/servers" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/35 hover:text-white">
        <ArrowLeft className="h-4 w-4" />
        Back to servers
      </Link>

      <motion.header initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42 }} className="relative mt-5 overflow-hidden rounded-xl border border-white/10 bg-[#050815]/78 shadow-[0_24px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="absolute inset-0 bg-[url('/media/dzn-cinematic-survivor.png')] bg-cover bg-center opacity-28" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(139,92,246,0.32),transparent_30%),linear-gradient(90deg,rgba(2,3,10,0.95),rgba(2,3,10,0.58),rgba(2,3,10,0.9))]" />
        <div className="relative z-10 grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row">
            <ServerHeroAvatar server={server} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-violet-300/25 bg-violet-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-violet-100">DZN Network</span>
                <StatusPill label="Live" tone="emerald" pulse />
              </div>
              <h1 className="mt-3 max-w-full break-words text-4xl font-black uppercase leading-none text-white [overflow-wrap:anywhere] sm:text-5xl lg:text-6xl">
                {server.server_name}
              </h1>
              <p className="mt-3 break-words text-base font-bold text-zinc-300 [overflow-wrap:anywhere]">{server.nitrado_service_name ?? server.guild_name ?? "Verified DZN community"}</p>
              <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold uppercase text-zinc-400">
                <MetaChip icon={Gamepad2} label={server.platform ?? "Platform awaiting data"} />
                <MetaChip icon={Target} label={server.server_type} />
                <MetaChip icon={Map} label={server.map_name ?? server.mission ?? "Map awaiting data"} />
                <MetaChip icon={MapPin} label={server.server_status ?? "Network online"} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusPill label="Verified Owner" tone="cyan" />
                <StatusPill label="DZN Verified" tone="violet" />
                <StatusPill label={server.server_type} tone="violet" />
                <StatusPill label={server.adm_status === "Connected" ? "ADM Connected" : server.adm_status === "Discovered" ? "ADM Discovered" : "ADM Needs Review"} tone={server.adm_status === "Connected" ? "emerald" : server.adm_status === "Discovered" ? "cyan" : "orange"} />
                <StatusPill label={`Stats Sync ${server.stats_sync}`} tone={server.stats_sync === "Active" ? "emerald" : server.stats_sync === "Pending" ? "orange" : "zinc"} />
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border border-white/10 bg-black/38 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <div className="grid grid-cols-2 gap-3">
              <HeroStat label="Players" value={formatPlayers(server)} icon={UserRound} />
              <HeroStat label="Unique Players" value={String(server.unique_players)} icon={Users} />
              <HeroStat label="Server Type" value={server.server_type} icon={Target} />
              <HeroStat label="Total Kills" value={String(server.total_kills)} icon={Crosshair} />
              <HeroStat label="Total Deaths" value={String(server.total_deaths)} icon={Skull} />
              <HeroStat label="K/D Ratio" value={kd} icon={BarChart3} />
            </div>
            <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] p-3">
              <p className="text-[10px] font-black uppercase text-cyan-200/70">Last Sync</p>
              <p className="mt-1 text-sm font-black text-white">{formatRelativeTime(server.last_sync_at ?? server.metadata_last_checked_at)}</p>
            </div>
          </div>
        </div>
      </motion.header>

      {statsPending ? (
        <div className="mt-5 rounded-lg border border-orange-300/20 bg-orange-400/10 p-5 text-sm font-bold leading-6 text-orange-50">
          Stats sync is pending while this server is being prepared.
        </div>
      ) : null}
      {statsActiveWithoutKills ? (
        <div className="mt-5 rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-5 text-sm font-bold leading-6 text-cyan-50">
          Player activity is syncing. PvP kills will appear once detected.
        </div>
      ) : null}

      <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-5">
          <ServerTagsPanel tags={tags} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <PvpLeaderboardPanel players={pvpLeaderboard} />
            <RecentEventsPanel server={server} />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <FeaturePreviewPanel title="Factions" icon={Users} text="Faction profiles and territory status are planned for this public page." variant="faction" />
            <FeaturePreviewPanel title="Achievements" icon={Crown} text="Community milestones will unlock as the DZN sync engine expands." variant="achievement" />
          </div>
        </div>

        <aside className="grid content-start gap-5">
          <GlassPanel title="Top Players" icon={Flame}>
            <TopPlayersPanel players={players} />
          </GlassPanel>
          <NetworkStatusPanel server={server} />
        </aside>
      </section>
    </div>
  );
}

function EmptyPublicState() {
  return (
    <div className="mt-8 glass-surface animated-border rounded-lg p-8 text-center">
      <div className="relative z-10">
        <RadioTower className="mx-auto h-12 w-12 text-violet-200" />
        <h2 className="mt-5 text-2xl font-black uppercase text-white">No public servers yet</h2>
        <p className="mt-3 text-zinc-300">No public servers yet. Be the first to join DZN Network.</p>
        <Link href="/signup" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-5 py-3 text-xs font-black uppercase text-white">
          Add Your Server
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function ServerSkeletonGrid() {
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="glass-surface rounded-lg p-5">
          <div className="h-5 w-28 animate-pulse rounded bg-white/10" />
          <div className="mt-5 h-8 w-2/3 animate-pulse rounded bg-white/10" />
          <div className="mt-5 h-20 animate-pulse rounded bg-white/10" />
        </div>
      ))}
    </div>
  );
}

function ProfileMessage({ tone, message }: { tone: "error" | "empty"; message: string }) {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <div className={`glass-surface animated-border max-w-xl rounded-lg p-8 text-center ${tone === "error" ? "border-red-300/20" : ""}`}>
        <div className="relative z-10">
          <RadioTower className="mx-auto h-12 w-12 text-violet-200" />
          <h1 className="mt-5 text-3xl font-black uppercase text-white">{tone === "error" ? "Server unavailable" : "Server not found"}</h1>
          <p className="mt-3 text-zinc-300">{message}</p>
          <Link href="/servers" className="mt-6 inline-flex rounded-lg bg-violet-500 px-5 py-3 text-xs font-black uppercase text-white">
            Browse servers
          </Link>
        </div>
      </div>
    </div>
  );
}

function MessagePanel({ message }: { message: string }) {
  return (
    <div className="mt-6 rounded-lg border border-red-300/20 bg-red-400/10 p-4 text-sm font-bold text-red-100">
      {message}
    </div>
  );
}

function subscribeToPath(onStoreChange: () => void) {
  ensureHistoryNavigationEvents();
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("dzn:navigation", onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("dzn:navigation", onStoreChange);
  };
}

let historyEventsPatched = false;

function ensureHistoryNavigationEvents() {
  if (historyEventsPatched || typeof window === "undefined") return;
  historyEventsPatched = true;

  const notify = () => window.dispatchEvent(new Event("dzn:navigation"));
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    notify();
    return result;
  };

  window.history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    notify();
    return result;
  };
}

function getCurrentSlug() {
  const querySlug = new URLSearchParams(window.location.search).get("slug");
  if (querySlug) return sanitizePublicSlug(querySlug);
  return getSlugFromPath(window.location.pathname);
}

function getServerSlugSnapshot() {
  return null;
}

function getSlugFromPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "servers" && parts[1] === "profile") return null;
  return parts[0] === "servers" && parts[1] ? decodeURIComponent(parts[1]) : null;
}

function GlassPanel({ title, icon: Icon, children }: { title: string; icon: typeof Activity; children: React.ReactNode }) {
  return (
    <section className="glass-surface animated-border rounded-xl p-4 transition duration-300 hover:-translate-y-0.5 hover:border-violet-300/30 sm:p-5">
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-violet-200" />
          <h2 className="text-xl font-black uppercase text-white">{title}</h2>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}

function ServerHeroAvatar({ server }: { server: PublicServer }) {
  if (server.guild_icon_url) {
    return (
      <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-violet-300/30 bg-black shadow-[0_0_36px_rgba(139,92,246,0.35)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={server.guild_icon_url} alt="" className="h-full w-full object-cover" />
        <span className="absolute inset-0 rounded-xl border border-white/10" />
      </div>
    );
  }

  return (
    <div className="relative grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-xl border border-violet-300/30 bg-black shadow-[0_0_36px_rgba(139,92,246,0.35)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/media/dzn-logo.png" alt="" className="h-20 w-20 object-contain" />
      <span className="absolute inset-0 rounded-xl border border-white/10 bg-[radial-gradient(circle_at_50%_0%,rgba(168,85,247,0.28),transparent_42%)]" />
    </div>
  );
}

function MetaChip({ icon: Icon, label }: { icon: typeof Activity; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/24 px-2.5 py-1.5">
      <Icon className="h-3.5 w-3.5 text-cyan-200" />
      {label}
    </span>
  );
}

function HeroStat({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/28 p-3 transition duration-300 hover:-translate-y-0.5 hover:border-cyan-300/25 hover:bg-cyan-300/[0.06]">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-cyan-200" />
        <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      </div>
      <p className="mt-2 break-words text-sm font-black text-white [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function ServerTagsPanel({ tags }: { tags: string[] }) {
  if (!tags.length) {
    return (
      <GlassPanel title="Server Tags" icon={ShieldCheck}>
        <p className="text-sm text-zinc-500">No tags added yet.</p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel title="Server Tags" icon={ShieldCheck}>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span key={tag} className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-black text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.08)]">
            {tag}
          </span>
        ))}
      </div>
    </GlassPanel>
  );
}

function PvpLeaderboardPanel({ players }: { players: PublicLeaderboardPlayer[] }) {
  return (
    <GlassPanel title="PvP Leaderboard" icon={Trophy}>
      {players.length ? (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 text-left">
              <thead>
                <tr className="text-[10px] font-black uppercase text-zinc-500">
                  <th className="px-2 py-1">Rank</th>
                  <th className="px-2 py-1">Player</th>
                  <th className="px-2 py-1 text-right">Kills</th>
                  <th className="px-2 py-1 text-right">Deaths</th>
                  <th className="px-2 py-1 text-right">K/D</th>
                  <th className="px-2 py-1 text-right">Longest Kill</th>
                </tr>
              </thead>
              <tbody>
                {players.slice(0, 6).map((player) => (
                  <tr key={`pvp-${player.rank}-${player.player_name}`} className="bg-black/24">
                    <td className="rounded-l-lg border-y border-l border-white/10 px-2 py-2 text-sm font-black text-violet-200">#{player.rank}</td>
                    <td className="border-y border-white/10 px-2 py-2 text-sm font-black text-white">{player.player_name}</td>
                    <td className="border-y border-white/10 px-2 py-2 text-right text-sm font-bold text-zinc-200">{player.kills}</td>
                    <td className="border-y border-white/10 px-2 py-2 text-right text-sm font-bold text-zinc-300">{player.deaths}</td>
                    <td className="border-y border-white/10 px-2 py-2 text-right text-sm font-bold text-cyan-100">{formatKdLabel(player)}</td>
                    <td className="rounded-r-lg border-y border-r border-white/10 px-2 py-2 text-right text-sm font-bold text-violet-100">{formatDistance(player.longest_kill)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link href="/leaderboards" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300/35 bg-violet-500/12 px-4 py-3 text-xs font-black uppercase text-violet-100 transition hover:border-violet-200/70 hover:bg-violet-500/22">
            View Full PvP Leaderboard
            <ArrowRight className="h-4 w-4" />
          </Link>
        </>
      ) : (
        <p className="text-sm leading-6 text-zinc-400">No ranked players yet.</p>
      )}
    </GlassPanel>
  );
}

function RecentEventsPanel({ server }: { server: PublicServer }) {
  return (
    <GlassPanel title="Recent Synced Events" icon={Crosshair}>
      {server.recent_events.length ? (
        <>
          <div className="max-h-[420px] overflow-y-auto pr-1">
            <div className="grid gap-2">
              {server.recent_events.slice(0, 8).map((event, index) => {
                const EventIcon = eventIcon(event);
                return (
            <div key={`${event.source}-${event.event_type}-${event.occurred_at ?? event.created_at ?? index}`} className="rounded-lg border border-white/10 bg-black/24 p-3 transition duration-300 hover:border-cyan-300/25 hover:bg-cyan-300/[0.055]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-red-300/20 bg-red-400/10 text-red-100">
                    <EventIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                  <p className="text-xs font-black uppercase text-cyan-200">{event.label}</p>
                    <p className="mt-1 text-sm font-bold leading-5 text-white">{publicEventDetail(event)}</p>
                  </div>
                </div>
                    <span className="shrink-0 text-[10px] font-black uppercase text-zinc-500">{formatRelativeTime(event.occurred_at ?? event.created_at)}</span>
              </div>
            </div>
                );
              })}
            </div>
          </div>
          <Link href="/leaderboards" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300/35 bg-violet-500/12 px-4 py-3 text-xs font-black uppercase text-violet-100 transition hover:border-violet-200/70 hover:bg-violet-500/22">
            View All Activity
            <ArrowRight className="h-4 w-4" />
          </Link>
        </>
      ) : (
        <p className="text-sm leading-6 text-zinc-400">
          {server.stats_sync === "Active"
            ? "Player activity is syncing. PvP kills will appear once detected."
            : "Stats sync is pending while this server is being prepared."}
        </p>
      )}
    </GlassPanel>
  );
}

function TopPlayersPanel({ players }: { players: PublicLeaderboardPlayer[] }) {
  if (!players.length) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/24 p-4">
        <p className="text-sm font-black uppercase text-white">No ranked players yet</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Player rankings will appear after kills are detected.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {players.slice(0, 5).map((player) => (
        <div key={`${player.rank}-${player.player_name}`} className="group rounded-xl border border-white/10 bg-black/24 p-3 transition duration-300 hover:-translate-y-0.5 hover:border-violet-300/35 hover:bg-violet-400/[0.07]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <PlayerAvatar player={player} />
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase text-violet-200">#{player.rank}</p>
                <p className="mt-1 break-words text-sm font-black text-white [overflow-wrap:anywhere]">{player.player_name}</p>
              </div>
            </div>
            <span className="rounded-md border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-xs font-black text-emerald-100">
              {player.kills} kills
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniMetric label="Deaths" value={String(player.deaths)} />
            <MiniMetric label="K/D" value={formatKdLabel(player)} />
            <MiniMetric label="Longest Kill" value={formatDistance(player.longest_kill)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayerAvatar({ player }: { player: PublicLeaderboardPlayer }) {
  const initials = player.player_name
    .split(/[\s_-]+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-violet-300/25 bg-[radial-gradient(circle_at_50%_10%,rgba(168,85,247,0.36),rgba(8,13,29,0.94)_58%)] text-sm font-black text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.22)]">
      <span className="absolute inset-x-2 bottom-0 h-7 rounded-t-full bg-black/42" />
      <UserRound className="relative h-6 w-6 opacity-45" />
      <span className="absolute right-1 top-1 rounded bg-black/55 px-1 text-[9px] text-white">#{player.rank}</span>
      <span className="sr-only">{initials}</span>
    </span>
  );
}

function NetworkStatusPanel({ server }: { server: PublicServer }) {
  return (
    <GlassPanel title="Network Status" icon={BarChart3}>
      <div className="grid gap-2">
        <StatusRow label="ADM Status" value={server.adm_status} tone={server.adm_status === "Connected" ? "good" : server.adm_status === "Discovered" ? "warn" : "bad"} />
        <StatusRow label="Stats Sync" value={server.stats_sync} tone={server.stats_sync === "Active" ? "good" : server.stats_sync === "Pending" ? "warn" : "bad"} />
        <StatusRow label="Total Joins" value={String(server.total_joins)} tone="neutral" />
        <StatusRow label="Unique Players" value={String(server.unique_players)} tone="neutral" />
        <StatusRow label="Public Listing" value="Active" tone="good" />
        <StatusRow label="Last Sync" value={formatRelativeTime(server.last_sync_at ?? server.metadata_last_checked_at)} tone="neutral" />
        <StatusRow label="Sync Health" value={server.stats_sync === "Active" ? "Online" : "Watching"} tone={server.stats_sync === "Active" ? "good" : "warn"} />
      </div>
    </GlassPanel>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  const toneClassName = {
    good: "text-emerald-200",
    warn: "text-orange-200",
    bad: "text-red-200",
    neutral: "text-cyan-100",
  }[tone];
  const Icon = tone === "good" ? CheckCircle2 : tone === "warn" ? Clock3 : tone === "bad" ? Skull : Activity;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/10 py-2.5 last:border-b-0">
      <div>
        <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
        <p className="mt-1 text-sm font-bold text-white">{value}</p>
      </div>
      <Icon className={`h-4 w-4 ${toneClassName}`} />
    </div>
  );
}

function FeaturePreviewPanel({ title, text, icon: Icon, variant }: { title: string; text: string; icon: typeof Activity; variant: "faction" | "achievement" }) {
  return (
    <GlassPanel title={title} icon={Icon}>
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-[220px] text-sm leading-6 text-zinc-400">{text}</p>
        <span className="relative grid h-20 w-20 shrink-0 place-items-center rounded-xl border border-violet-300/25 bg-violet-500/12 text-violet-100 shadow-[0_0_34px_rgba(139,92,246,0.28)]">
          {variant === "faction" ? <Sparkles className="h-9 w-9" /> : <Medal className="h-9 w-9" />}
          <span className="absolute inset-2 rounded-lg border border-violet-200/10" />
        </span>
      </div>
    </GlassPanel>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/24 p-3">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 max-w-full break-words text-sm font-bold text-white [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function GuildIcon({ server, size }: { server: PublicServer; size: "md" | "lg" }) {
  const className = size === "lg" ? "h-20 w-20 text-3xl" : "h-14 w-14 text-xl";
  if (server.guild_icon_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={server.guild_icon_url} alt="" className={`${className} rounded-lg object-cover`} />;
  }
  return (
    <span className={`${className} grid shrink-0 place-items-center rounded-lg border border-violet-300/25 bg-violet-500/15 font-black text-violet-100 shadow-[0_0_28px_rgba(139,92,246,0.26)]`}>
      {(server.guild_name ?? server.server_name ?? "D")[0]}
    </span>
  );
}

function StatusPill({ label, tone, pulse = false }: { label: string; tone: "emerald" | "cyan" | "violet" | "orange" | "zinc"; pulse?: boolean }) {
  const classes = {
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
    violet: "border-violet-300/25 bg-violet-400/10 text-violet-100",
    orange: "border-orange-300/25 bg-orange-400/10 text-orange-100",
    zinc: "border-white/10 bg-white/[0.04] text-zinc-200",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-black uppercase ${classes}`}>
      {pulse ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.95)]" /> : null}
      {label}
    </span>
  );
}

function toneClass(tone: string) {
  if (tone === "emerald") return "text-emerald-200";
  if (tone === "cyan") return "text-cyan-200";
  if (tone === "orange") return "text-orange-200";
  if (tone === "red") return "text-red-200";
  return "text-violet-200";
}

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function serverSortRank(server: PublicServer) {
  if (server.stats_sync === "Active") return 0;
  if (server.adm_status === "Connected") return 1;
  if (server.adm_status === "Discovered") return 2;
  if (server.stats_sync === "Pending") return 3;
  return 4;
}

function publicServerProfileHref(slug: string) {
  return `/servers/profile?slug=${encodeURIComponent(slug)}`;
}

async function fetchPublicServerFallback(slug: string, signal?: AbortSignal) {
  const response = await fetch("/api/public/servers", { cache: "no-store", headers: { accept: "application/json" }, signal });
  const data = (await response.json().catch(() => ({}))) as PublicServersResponse;
  if (!response.ok || !Array.isArray(data.servers)) return null;
  return data.servers.find((server) => publicServerMatchesSlug(server, slug)) ?? null;
}

function publicServerMatchesSlug(server: PublicServer, slug: string) {
  const candidates = publicSlugCandidates(server.public_slug, server.server_name, server.nitrado_service_name, server.guild_name);
  return slugCandidates(slug).some((candidate) => candidates.has(candidate));
}

function publicSlugCandidates(...values: Array<string | null>) {
  const candidates = new Set<string>();
  for (const value of values) {
    for (const candidate of slugCandidates(value)) {
      candidates.add(candidate);
    }
  }
  return candidates;
}

function slugCandidates(value: string | null) {
  if (!value) return [];
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "").slice(0, 90);
  const hyphenated = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
  const preservedHyphen = normalized.replace(/[^a-z0-9-]/g, "").slice(0, 90);
  return Array.from(new Set([compact, hyphenated, preservedHyphen].filter(Boolean)));
}

function sanitizePublicSlug(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90);
  return slug || null;
}

function publicCardFooter(server: PublicServer) {
  if (server.stats_sync === "Active") return "Sync active";
  if (server.adm_status === "Connected") return "ADM connected";
  if (server.adm_status === "Discovered") return "ADM discovered";
  return "Awaiting sync data";
}

function publicEventDetail(event: PublicRecentEvent) {
  if (event.source === "kill") {
    const matchup = `${event.killer_name ?? "Unknown player"} eliminated ${event.victim_name ?? "Unknown player"}`;
    const weapon = event.weapon ? ` with ${event.weapon}` : "";
    const distance = typeof event.distance === "number" && Number.isFinite(event.distance) ? ` from ${event.distance.toFixed(1)}m` : "";
    return `${matchup}${weapon}${distance}`;
  }
  return event.player_name ?? "Server activity";
}

function eventIcon(event: PublicRecentEvent) {
  if (event.source === "kill") return Crosshair;
  if (event.event_type === "player_connected" || event.event_type === "player_disconnected") return UserRound;
  if (event.event_type === "player_hit" || event.event_type === "player_hit_explosion" || event.event_type === "player_hit_unknown_attacker") return Target;
  if (event.event_type === "player_unconscious") return Activity;
  return RadioTower;
}

function formatKdLabel(player: PublicLeaderboardPlayer) {
  return player.kd_label || (typeof player.kd === "number" ? player.kd.toFixed(2) : "Awaiting data");
}

function calculateServerKd(kills: number, deaths: number) {
  if (kills === 0 && deaths === 0) return "Awaiting data";
  if (kills > 0 && deaths === 0) return "Flawless";
  return deaths > 0 ? (kills / deaths).toFixed(2) : "0.00";
}

function formatPlayers(server: PublicServer) {
  const current = typeof server.current_players === "number" ? server.current_players : 0;
  return server.player_slots ? `${current} / ${server.player_slots}` : "Awaiting data";
}

function formatDistance(value: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? `${value.toFixed(1)}m` : "Awaiting data";
}

function formatRelativeTime(value: string | null) {
  if (!value) return "Awaiting data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Awaiting data";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildStats(servers: PublicServer[]): PublicStats {
  return {
    totalServers: servers.length,
    pvpServers: servers.filter((server) => server.server_type === "PVP").length,
    pveServers: servers.filter((server) => server.server_type === "PVE").length,
    deathmatchServers: servers.filter((server) => server.server_type === "DEATHMATCH").length,
    statsSyncActive: servers.filter((server) => server.stats_sync === "Active").length,
    statsSyncPending: servers.filter((server) => server.stats_sync !== "Active").length,
  };
}
