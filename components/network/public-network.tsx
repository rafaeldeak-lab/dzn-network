"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Crosshair,
  Crown,
  Flame,
  LogOut,
  RadioTower,
  Search,
  ShieldCheck,
  Skull,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";

import { AnimatedBackground } from "@/components/dzn/animated-background";
import { DznLogo } from "@/components/dzn/dzn-logo";

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
  latest_adm_file: string | null;
  stats_sync: "Active" | "Pending" | "Not Started";
  read_status: "Readable" | "Read Pending" | "Not Ready";
  player_slots: number | null;
  created_at: string | null;
  latest_sync_at: string | null;
  total_kills: number;
  total_deaths: number;
  total_joins: number;
  total_disconnects: number;
  unique_players: number;
  recent_events: PublicRecentEvent[];
  public_sync_source?: "sync_runs" | "adm_sync_state" | "server_stats" | "linked_server_fallback";
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

type PublicStats = {
  totalServers: number;
  pvpServers: number;
  pveServers: number;
  deathmatchServers: number;
  statsSyncActive: number;
  statsSyncPending: number;
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
    async function load() {
      setLoading(true);
      setError("");
      try {
        const endpoint = slug ? `/api/public/servers?slug=${encodeURIComponent(slug)}` : "/api/public/servers";
        const response = await fetch(endpoint, { headers: { accept: "application/json" } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to load public servers");

        if (slug) {
          setServer(data.server ?? null);
          setServers([]);
          setStats(null);
        } else {
          setServers(Array.isArray(data.servers) ? data.servers : []);
          setStats(data.stats ?? null);
          setServer(null);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load public servers");
      } finally {
        setLoading(false);
      }
    }

    load();
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
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
    }).catch(() => null);
    setAuthenticated(false);
  }

  return (
    <nav className="flex items-center justify-between">
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
    { label: "Stats Sync", value: `${stats.statsSyncActive} Active \u00b7 ${stats.statsSyncPending} Pending`, icon: Activity, tone: "emerald" },
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
            <p className="mt-4 text-2xl font-black text-white">{row.value}</p>
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
          <Link href={`/servers/${server.public_slug}`} className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-xs font-black uppercase text-white shadow-[0_0_24px_rgba(139,92,246,0.3)] transition hover:bg-violet-400">
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

  return (
    <div className="pb-16 pt-10">
      <Link href="/servers" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/35 hover:text-white">
        <ArrowLeft className="h-4 w-4" />
        Back to servers
      </Link>

      <motion.header
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42 }}
        className="mt-8 glass-surface animated-border rounded-lg p-6 sm:p-8"
      >
        <div className="relative z-10 grid gap-7 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <GuildIcon server={server} size="lg" />
              <div>
                <p className="text-xs font-black uppercase text-violet-200/70">{server.guild_name ?? "Verified DZN community"}</p>
                <h1 className="mt-2 text-4xl font-black uppercase text-white sm:text-6xl">{server.server_name}</h1>
                <p className="mt-3 max-w-2xl text-lg leading-8 text-zinc-300">{server.nitrado_service_name ?? server.server_name}</p>
              </div>
            </div>
            <div className="mt-7 flex flex-wrap gap-2">
              <StatusPill label="Live" tone="emerald" />
              <StatusPill label="Verified Owner" tone="cyan" />
              <StatusPill label="DZN Verified" tone="violet" />
              <StatusPill label={server.server_type} tone="violet" />
              <StatusPill label={server.adm_status === "Discovered" ? "ADM Logs Discovered" : `ADM ${server.adm_status}`} tone={server.adm_status === "Connected" ? "emerald" : server.adm_status === "Discovered" ? "cyan" : "orange"} />
              <StatusPill label={`Stats Sync ${server.stats_sync}`} tone={server.stats_sync === "Active" ? "emerald" : server.stats_sync === "Pending" ? "orange" : "zinc"} />
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/26 p-5">
            <p className="text-xs font-black uppercase text-zinc-500">Server Signal</p>
            <div className="mt-4 grid gap-3">
              <MiniMetric label="Player Slots" value={server.player_slots ? String(server.player_slots) : "Not listed"} />
              <MiniMetric label="Latest ADM File" value={server.latest_adm_file ?? "Pending"} />
              <MiniMetric label="Stats Sync" value={server.stats_sync} />
              <MiniMetric label="Read Status" value={server.read_status} />
              <MiniMetric label="Last Sync" value={formatPublicDate(server.latest_sync_at)} />
            </div>
          </div>
        </div>
      </motion.header>

      {statsPending ? (
        <div className="mt-5 rounded-lg border border-orange-300/20 bg-orange-400/10 p-5 text-sm font-bold leading-6 text-orange-50">
          Stats sync is pending while ADM log reading is being finalised.
        </div>
      ) : null}
      {statsActiveWithoutKills ? (
        <div className="mt-5 rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-5 text-sm font-bold leading-6 text-cyan-50">
          No PvP kills synced yet. Player activity is syncing.
        </div>
      ) : null}

      <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-5">
          <GlassPanel title="Server Tags" icon={ShieldCheck}>
            <div className="flex flex-wrap gap-2">
              {tags.length ? tags.map((tag) => <span key={tag} className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-100">{tag}</span>) : <span className="text-sm text-zinc-500">No tags listed yet.</span>}
            </div>
          </GlassPanel>

          <div className="grid gap-5 md:grid-cols-2">
            <PlaceholderPanel title="PvP Leaderboard" icon={Trophy} text="Ranked leaderboards will appear here when stat sync is active." />
            <RecentEventsPanel server={server} />
            <PlaceholderPanel title="Factions" icon={Users} text="Faction profiles and territory status are planned for this public page." />
            <PlaceholderPanel title="Achievements" icon={Crown} text="Community milestones will unlock as the DZN sync engine expands." />
          </div>
        </div>

        <aside className="grid gap-5">
          <GlassPanel title="Top Players" icon={Flame}>
            <PlaceholderRows labels={["No synced events yet", "Player stats will appear after log processing begins", "Killfeed activates once ADM sync is live"]} />
          </GlassPanel>
          <GlassPanel title="Network Status" icon={BarChart3}>
            <div className="grid gap-3">
              <MiniMetric label="ADM Status" value={server.adm_status} />
              <MiniMetric label="Stats Sync" value={server.stats_sync} />
              <MiniMetric label="Total Joins" value={String(server.total_joins)} />
              <MiniMetric label="Unique Players" value={String(server.unique_players)} />
              <MiniMetric label="Public Listing" value="Active" />
            </div>
          </GlassPanel>
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
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getCurrentSlug() {
  return getSlugFromPath(window.location.pathname);
}

function getServerSlugSnapshot() {
  return null;
}

function getSlugFromPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "servers" && parts[1] ? decodeURIComponent(parts[1]) : null;
}

function GlassPanel({ title, icon: Icon, children }: { title: string; icon: typeof Activity; children: React.ReactNode }) {
  return (
    <section className="glass-surface animated-border rounded-lg p-5">
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

function PlaceholderPanel({ title, icon: Icon, text }: { title: string; icon: typeof Activity; text: string }) {
  return (
    <GlassPanel title={title} icon={Icon}>
      <p className="text-sm leading-6 text-zinc-400">{text}</p>
    </GlassPanel>
  );
}

function RecentEventsPanel({ server }: { server: PublicServer }) {
  return (
    <GlassPanel title="Recent Synced Events" icon={Crosshair}>
      {server.recent_events.length ? (
        <div className="grid gap-2">
          {server.recent_events.slice(0, 5).map((event, index) => (
            <div key={`${event.source}-${event.event_type}-${event.occurred_at ?? event.created_at ?? index}`} className="rounded-lg border border-white/10 bg-black/24 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase text-cyan-200">{event.label}</p>
                  <p className="mt-1 truncate text-sm font-bold text-white">{publicEventDetail(event)}</p>
                </div>
                <span className="shrink-0 text-[10px] font-black uppercase text-zinc-500">{formatPublicTime(event.occurred_at ?? event.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm leading-6 text-zinc-400">
          {server.stats_sync === "Active"
            ? "No PvP kills synced yet. Player activity is syncing."
            : "Stats sync is pending while ADM log reading is being finalised."}
        </p>
      )}
    </GlassPanel>
  );
}

function PlaceholderRows({ labels }: { labels: string[] }) {
  return (
    <div className="grid gap-2">
      {labels.map((label, index) => (
        <div key={label} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/24 px-3 py-3">
          <span className="text-sm font-bold text-zinc-300">{label}</span>
          <span className="text-xs font-black uppercase text-zinc-600">#{index + 1}</span>
        </div>
      ))}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-3">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-white">{value}</p>
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

function StatusPill({ label, tone }: { label: string; tone: "emerald" | "cyan" | "violet" | "orange" | "zinc" }) {
  const classes = {
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
    violet: "border-violet-300/25 bg-violet-400/10 text-violet-100",
    orange: "border-orange-300/25 bg-orange-400/10 text-orange-100",
    zinc: "border-white/10 bg-white/[0.04] text-zinc-200",
  }[tone];
  return <span className={`rounded-md border px-3 py-1.5 text-xs font-black uppercase ${classes}`}>{label}</span>;
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

function publicCardFooter(server: PublicServer) {
  if (server.stats_sync === "Active") return "Sync active";
  if (server.adm_status === "Connected" || server.read_status === "Readable") return "ADM connected";
  if (server.adm_status === "Discovered" || server.latest_adm_file) return "ADM discovered";
  return "Awaiting sync data";
}

function publicEventDetail(event: PublicRecentEvent) {
  if (event.source === "kill") {
    const matchup = `${event.killer_name ?? "Unknown player"} to ${event.victim_name ?? "Unknown player"}`;
    const weapon = event.weapon ? ` with ${event.weapon}` : "";
    const distance = typeof event.distance === "number" && Number.isFinite(event.distance) ? ` from ${event.distance.toFixed(1)}m` : "";
    return `${matchup}${weapon}${distance}`;
  }
  return event.player_name ?? "Server activity";
}

function formatPublicTime(value: string | null) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatPublicDate(value: string | null) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
