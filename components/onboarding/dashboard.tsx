"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  ChevronDown,
  CircleCheck,
  Crosshair,
  DatabaseZap,
  Download,
  ExternalLink,
  Gamepad2,
  Gauge,
  LifeBuoy,
  ListChecks,
  LogOut,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { clearMockTestSyncData, clearOldFailedSyncRuns, deleteAccount, deleteLinkedServer, getMe, getRecentSyncEvents, getSyncStatus, logout, runLogAccessDiagnostics, runManualSync, testOnboarding } from "./api";
import type { AdmRecentSyncEvent, AdmSyncRunResult, AdmSyncStatus, AuthResponse, LinkedServer, NitradoLogAccessDiagnostics } from "./types";

const SYNC_POLL_INTERVAL_MS = 15000;

export function Dashboard() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then(setAuth)
      .catch(() => setAuth({ authenticated: false }))
      .finally(() => setLoading(false));
  }, []);

  async function signOut() {
    await logout().catch(() => null);
    window.location.href = "/";
  }

  if (loading) {
    return <DashboardFrame><p className="text-zinc-300">Loading dashboard...</p></DashboardFrame>;
  }

  if (!auth?.authenticated) {
    return (
      <DashboardFrame>
        <div className="glass-surface animated-border max-w-2xl rounded-lg p-8 text-center">
          <div className="relative z-10">
            <ShieldCheck className="mx-auto h-12 w-12 text-violet-200" />
            <h1 className="mt-5 text-3xl font-black uppercase text-white">Login required</h1>
            <p className="mt-3 text-zinc-300">Connect Discord to view verified server onboarding progress.</p>
            <Link href="/login" className="mt-6 inline-flex rounded-lg bg-violet-500 px-5 py-3 text-xs font-black uppercase text-white">
              Login with Discord
            </Link>
          </div>
        </div>
      </DashboardFrame>
    );
  }

  const server = auth.linkedServer;
  return (
    <DashboardFrame onLogout={signOut} serverName={server?.server_name ?? server?.guild_name ?? null}>
      {server ? <ServerDashboard server={server} onRefresh={async () => setAuth(await getMe())} /> : <EmptyDashboard />}
    </DashboardFrame>
  );
}

function DashboardFrame({ children, onLogout, serverName }: { children: React.ReactNode; onLogout?: () => void; serverName?: string | null }) {
  const navItems = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Servers", href: "/servers" },
    { label: "Analytics", href: "/leaderboards" },
    { label: "Players", href: "/leaderboards" },
    { label: "Settings", href: "/setup" },
    { label: "Support", href: "#" },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(139,92,246,0.26),transparent_30%),radial-gradient(circle_at_78%_18%,rgba(14,165,233,0.14),transparent_28%),linear-gradient(180deg,#02030a_0%,#07101f_52%,#02030a_100%)]" />
      <div className="scanline absolute inset-0 opacity-20" />
      <div className="relative z-10 mx-auto max-w-[1500px]">
        <nav className="mb-5 flex flex-col gap-4 rounded-lg border border-white/10 bg-black/20 px-4 py-3 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <DznLogo compact />
            <div className="rounded-lg border border-violet-300/20 bg-violet-400/10 px-3 py-2">
              <p className="text-[10px] font-black uppercase text-violet-200/75">Owner Dashboard</p>
              <p className="mt-0.5 max-w-[220px] truncate text-xs font-black uppercase text-white">{serverName ?? "Server Console"}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {navItems.map((item) => (
              <Link key={item.label} href={item.href} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-black uppercase text-zinc-200 transition hover:border-cyan-300/35 hover:text-white">
                {item.label}
              </Link>
            ))}
            <button type="button" aria-label="Notifications" className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200">
              <Bell className="h-4 w-4" />
            </button>
            <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-black uppercase text-zinc-200">
              {serverName ?? "Server"}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {onLogout ? (
              <button type="button" onClick={onLogout} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-black uppercase text-zinc-200">
                <LogOut className="inline h-4 w-4" /> Logout
              </button>
            ) : null}
          </div>
        </nav>
        {children}
      </div>
    </main>
  );
}

function EmptyDashboard() {
  return (
    <div className="glass-surface animated-border rounded-lg p-8">
      <div className="relative z-10">
        <Server className="h-12 w-12 text-violet-200" />
        <h2 className="mt-5 text-2xl font-black uppercase text-white">No server linked yet</h2>
        <p className="mt-3 max-w-2xl text-zinc-300">
          Finish onboarding to verify your Discord guild, connect Nitrado, and publish your DayZ server.
        </p>
        <Link href="/setup" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-5 py-3 text-xs font-black uppercase text-white">
          Continue setup
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function ServerDashboard({ server, onRefresh }: { server: LinkedServer; onRefresh: () => Promise<void> }) {
  const [checkingLogs, setCheckingLogs] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<AdmSyncStatus | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<AdmSyncRunResult | null>(null);
  const [recentEvents, setRecentEvents] = useState<AdmRecentSyncEvent[]>([]);
  const [logDiagnostics, setLogDiagnostics] = useState<NitradoLogAccessDiagnostics | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [diagnosingLogs, setDiagnosingLogs] = useState(false);
  const [clearingTestData, setClearingTestData] = useState(false);
  const [clearingFailedRuns, setClearingFailedRuns] = useState(false);
  const [dangerAction, setDangerAction] = useState<"server" | "account" | null>(null);
  const [deletingDangerAction, setDeletingDangerAction] = useState(false);
  const [refreshingSyncData, setRefreshingSyncData] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [liveRefreshWarning, setLiveRefreshWarning] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const syncRefreshInFlightRef = useRef(false);
  const syncRefreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const tags = useMemo(() => {
    try {
      return JSON.parse(server.tags_json) as string[];
    } catch {
      return [];
    }
  }, [server.tags_json]);

  const normalizedStatus = server.status.toLowerCase();
  const admState = getAdmState(server);
  const isDayzService = [server.game, server.server_name, server.nitrado_service_name].some((value) => /dayz/i.test(value ?? ""));
  const coreSetupComplete = Boolean(server.guild_id && server.nitrado_service_id && isDayzService && admState.isDiscovered);
  const progress = coreSetupComplete ? 100 : normalizedStatus === "error" ? 72 : normalizedStatus === "live" ? 92 : 84;
  const networkAddress = server.ip_address ?? server.region ?? "Unknown";
  const networkAddressLabel = looksLikeIpAddress(networkAddress) ? "IP Address" : "Region";
  const syncHasProcessedLines = (syncStatus?.last_processed_line ?? 0) > 0 && syncStatus?.last_sync_status !== "read_pending";
  const statsSyncActive = syncHasProcessedLines || admState.kind === "connected";
  const statsSyncPending = !statsSyncActive && admState.kind === "discovered_read_pending";
  const effectiveSyncStatus = syncStatus?.last_sync_status ?? (statsSyncPending ? "read_pending" : admState.kind === "connected" ? "active" : "not_started");
  const latestAdmFile = syncStatus?.latest_adm_file ?? server.adm_latest_file ?? "Not detected";
  const lastSyncDuration = syncStatus?.last_sync_duration_ms ?? lastSyncResult?.syncDurationMs ?? null;
  const activityCount = (syncStatus?.total_joins ?? 0) + (syncStatus?.total_disconnects ?? 0) + (syncStatus?.total_deaths ?? 0);
  const noPvpKillsYet = statsSyncActive && (syncStatus?.total_kills ?? 0) === 0;
  const syncBanner = getSyncBanner({
    active: statsSyncActive,
    readPending: effectiveSyncStatus === "read_pending",
    noPvpKillsYet,
    hasActivity: activityCount > 0,
  });
  const recentEventsAreMock = recentEvents.some((event) => event.is_mock || [event.player_name, event.killer_name, event.victim_name].some((name) => /^Mock(Survivor|Bandit|Runner)/.test(name ?? "")));
  const syncRuns = getPrioritizedSyncRuns(syncStatus?.recent_sync_runs ?? []);
  const syncHealth = getSyncHealth(syncStatus?.recent_sync_runs ?? [], syncStatus?.last_sync_status ?? effectiveSyncStatus, syncStatus?.last_sync_message ?? null);
  const syncHealthPercent = syncHealth.status === "error" ? 72 : effectiveSyncStatus === "read_pending" ? 76 : 100;
  const processedPercent = getProcessedPercent(syncStatus);
  const nextScheduledSync = getNextScheduledSync(syncStatus?.last_scheduled_sync_at ?? null);
  const isOriginalOwner = server.original_owner_is_current_user !== false;

  const refreshSyncData = useCallback(async (options: { manual?: boolean; warnOnError?: boolean; queueIfBusy?: boolean } = {}) => {
    if (syncRefreshInFlightRef.current) {
      if (options.queueIfBusy && syncRefreshPromiseRef.current) {
        await syncRefreshPromiseRef.current.catch(() => false);
        if (syncRefreshInFlightRef.current) return false;
        options = { ...options, queueIfBusy: false };
      } else {
        return false;
      }
    }

    syncRefreshInFlightRef.current = true;
    if (options.manual) setManualRefreshing(true);
    setRefreshingSyncData(true);

    const refreshPromise = Promise.all([getSyncStatus(server.id), getRecentSyncEvents(server.id)])
      .then(([statusResult, eventsResult]) => {
        setSyncStatus(statusResult.status);
        setRecentEvents(eventsResult.events);
        setLastRefreshedAt(new Date().toISOString());
        setLiveRefreshWarning("");
        return true;
      })
      .catch(() => {
        if (options.warnOnError !== false) {
          setLiveRefreshWarning("Live refresh temporarily failed. Retrying...");
        }
        return false;
      });

    syncRefreshPromiseRef.current = refreshPromise;

    try {
      return await refreshPromise;
    } finally {
      syncRefreshInFlightRef.current = false;
      syncRefreshPromiseRef.current = null;
      setRefreshingSyncData(false);
      if (options.manual) setManualRefreshing(false);
    }
  }, [server.id]);

  useEffect(() => {
    let active = true;
    const initialRefresh = window.setTimeout(() => {
      if (active) void refreshSyncData({ warnOnError: true });
    }, 0);
    const interval = window.setInterval(() => {
      if (active) void refreshSyncData({ warnOnError: true });
    }, SYNC_POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [refreshSyncData]);

  async function refreshNow() {
    setActionMessage("");
    const refreshed = await refreshSyncData({ manual: true, warnOnError: true });
    if (refreshed) setActionMessage("Dashboard sync data refreshed.");
  }

  async function rerunLogCheck() {
    setCheckingLogs(true);
    setActionMessage("");
    try {
      await testOnboarding();
      await onRefresh();
      await refreshSyncData({ warnOnError: false, queueIfBusy: true });
      setActionMessage("Log check refreshed. Dashboard status is up to date.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to re-run log check.");
    } finally {
      setCheckingLogs(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    setActionMessage("");
    try {
      const result = await runManualSync(server.id);
      setLastSyncResult(result);
      await refreshSyncData({ warnOnError: false, queueIfBusy: true });
      await onRefresh();
      setActionMessage(getManualSyncMessage(result));
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to run manual sync.");
    } finally {
      setSyncing(false);
    }
  }

  async function runDiagnostics() {
    setDiagnosingLogs(true);
    setActionMessage("");
    try {
      const result = await runLogAccessDiagnostics();
      setLogDiagnostics(result.diagnostics);
      setDiagnosticsOpen(true);
      await refreshSyncData({ warnOnError: false, queueIfBusy: true });
      setActionMessage(result.diagnostics.readable.message);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to run log access diagnostics.");
    } finally {
      setDiagnosingLogs(false);
    }
  }

  async function clearTestData() {
    setClearingTestData(true);
    setActionMessage("");
    try {
      await clearMockTestSyncData(server.id);
      setLastSyncResult(null);
      await refreshSyncData({ warnOnError: false, queueIfBusy: true });
      await onRefresh();
      setActionMessage("Mock/test sync rows cleared for this linked server.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to clear mock/test sync data.");
    } finally {
      setClearingTestData(false);
    }
  }

  async function clearFailedRuns() {
    setClearingFailedRuns(true);
    setActionMessage("");
    try {
      const result = await clearOldFailedSyncRuns(server.id);
      await refreshSyncData({ warnOnError: false, queueIfBusy: true });
      setActionMessage(result.deletedCount > 0 ? "Old failed sync runs cleared." : "No old failed sync runs needed clearing.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to clear old failed sync runs.");
    } finally {
      setClearingFailedRuns(false);
    }
  }

  async function confirmDangerAction(action: "server" | "account", confirmationText: string, finalConfirmed: boolean) {
    setDeletingDangerAction(true);
    setActionMessage("");
    try {
      const result = action === "server"
        ? await deleteLinkedServer({ linkedServerId: server.id, confirmationText, finalConfirmed })
        : await deleteAccount({ confirmationText, finalConfirmed });
      setDangerAction(null);
      setActionMessage(result.message);
      window.setTimeout(() => {
        window.location.href = result.redirectTarget;
      }, 900);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to complete deletion.");
    } finally {
      setDeletingDangerAction(false);
    }
  }

  function downloadDataSummary() {
    const summary = {
      exportedAt: new Date().toISOString(),
      note: "Safe DZN data summary. No tokens, credentials, OAuth secrets, FTP/MySQL credentials, or player IDs are included.",
      server: {
        id: server.id,
        serverName: server.server_name,
        nitradoServiceId: server.nitrado_service_id,
        nitradoServiceName: server.nitrado_service_name,
        publicSlug: server.public_slug,
        discordGuildName: server.guild_name ?? null,
        serverType: server.server_type,
        tags,
        status: server.status,
        game: server.game ?? null,
        platform: server.platform ?? null,
        ipAddress: server.ip_address ?? null,
        playerSlots: server.player_slots ?? null,
        latestAdmFile,
        lastAdmCheck: server.adm_last_checked_at ?? null,
      },
      sync: {
        status: syncStatus?.last_sync_status ?? effectiveSyncStatus,
        latestAdmFile: syncStatus?.latest_adm_file ?? latestAdmFile,
        lastProcessedLine: syncStatus?.last_processed_line ?? 0,
        lastSyncAt: syncStatus?.last_sync_at ?? null,
        totalKills: syncStatus?.total_kills ?? 0,
        totalDeaths: syncStatus?.total_deaths ?? 0,
        totalJoins: syncStatus?.total_joins ?? 0,
        totalDisconnects: syncStatus?.total_disconnects ?? 0,
        uniquePlayers: syncStatus?.unique_players ?? 0,
      },
    };
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dzn-data-summary-${server.public_slug || server.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(440px,0.95fr)]">
        <DashboardPanel className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
            {server.guild_icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={server.guild_icon_url} alt="" className="h-28 w-full rounded-lg object-cover md:h-auto md:w-32" />
            ) : (
              <span className="grid h-28 w-full place-items-center rounded-lg border border-violet-300/20 bg-violet-500/15 text-4xl font-black md:h-auto md:w-32">
                {(server.guild_name ?? "D")[0]}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-3xl font-black text-white">{server.server_name || server.nitrado_service_name}</h1>
                    <span className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">
                      {statsSyncActive ? "Synced" : formatServerStatus(server.status)}
                    </span>
                    {server.public_slug ? (
                      <span className="rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">
                        Public Listing Active
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-bold text-zinc-300">
                    {server.guild_name ?? server.guild_id} <span className="text-zinc-600">/</span> {server.server_type} <span className="text-zinc-600">/</span> {server.game ?? "DayZ"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {server.public_slug ? (
                    <Link href={`/servers/${server.public_slug}`} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50">
                      View Public Page
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                  <Link href="/setup" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-100">
                    Server Settings
                    <Settings className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <HeroMetric icon={<Gauge className="h-4 w-4" />} label={networkAddressLabel} value={networkAddress} />
                <HeroMetric icon={<Users className="h-4 w-4" />} label="Players" value={server.player_slots ? `0 / ${server.player_slots}` : "Tracking"} />
                <HeroMetric icon={<BarChart3 className="h-4 w-4" />} label="Rank" value="#--" />
                <HeroMetric icon={<CircleCheck className="h-4 w-4" />} label="Status" value={statsSyncActive ? "Synced" : formatSyncStatus(effectiveSyncStatus)} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {tags.length ? tags.slice(0, 6).map((tag) => <TagPill key={tag}>{tag}</TagPill>) : <span className="text-sm text-zinc-400">No tags selected</span>}
                {tags.length > 6 ? <TagPill>+{tags.length - 6}</TagPill> : null}
              </div>
            </div>
          </div>
        </DashboardPanel>

        <div className="grid content-start gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <HealthCard icon={<Server className="h-4 w-4" />} label="Server" value={formatServerStatus(server.status)} tone="emerald" />
            <HealthCard icon={<Gamepad2 className="h-4 w-4" />} label="Discord" value="Connected" tone="violet" />
            <HealthCard icon={<DatabaseZap className="h-4 w-4" />} label="Nitrado" value="Connected" tone="amber" />
            <HealthCard icon={<ListChecks className="h-4 w-4" />} label="ADM" value={admState.badge} tone="cyan" />
            <HealthCard icon={<Zap className="h-4 w-4" />} label="Sync Engine" value={syncHealth.status === "error" ? "Needs Action" : "Active"} tone="violet" />
          </div>
          <div className={`rounded-lg border p-4 ${syncHealth.status === "error" ? "border-orange-300/25 bg-orange-400/10" : syncBanner.className}`}>
            <div className="flex items-start gap-3">
              <Activity className={`mt-1 h-5 w-5 shrink-0 ${syncHealth.status === "error" ? "text-orange-100" : "text-cyan-100"}`} />
              <div>
                <p className="text-xs font-black uppercase opacity-75">{syncHealth.status === "error" ? syncHealth.title : syncBanner.title}</p>
                <p className="mt-1 text-sm font-black leading-6 text-white">{syncHealth.status === "error" ? syncHealth.message : syncBanner.message}</p>
                <p className="mt-1 text-sm leading-6 text-zinc-300">
                  {syncHealth.status === "error" ? syncHealth.detail : syncBanner.detail ?? "Player activity, kills, deaths and more are being synced in real time."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="grid gap-5">
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <DashboardPanel className="p-4">
              <PanelHeader icon={<Server className="h-5 w-5" />} title="Server Overview" />
              <div className="mt-4 grid gap-x-4 gap-y-1 md:grid-cols-2">
                <CompactRow label="Server Name" value={server.server_name || server.nitrado_service_name} />
                <CompactRow label="Service ID" value={server.nitrado_service_id} />
                <CompactRow label="Nitrado Service ID" value={server.nitrado_service_id} />
                <CompactRow label={networkAddressLabel} value={networkAddress} />
                <CompactRow label="Server Type" value={server.server_type} />
                <CompactRow label="Game" value={server.game ?? "DayZ"} />
                <CompactRow label="Player Slots" value={server.player_slots ? String(server.player_slots) : "Unknown"} />
                <CompactRow label="Latest ADM File" value={latestAdmFile} />
                <CompactRow label="Last ADM Check" value={server.adm_last_checked_at ? formatDashboardDate(server.adm_last_checked_at) : "Not checked"} />
                <CompactRow label="Next Scheduled Sync" value={nextScheduledSync} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {tags.length ? tags.map((tag) => <TagPill key={tag}>{tag}</TagPill>) : <span className="text-sm text-zinc-400">No tags selected</span>}
              </div>
            </DashboardPanel>

            <DashboardPanel className="p-4">
              <div className="flex items-start justify-between gap-3">
                <PanelHeader icon={<DatabaseZap className={`h-5 w-5 ${refreshingSyncData ? "animate-pulse" : ""}`} />} title="Sync Engine Status" />
                <button
                  type="button"
                  disabled={refreshingSyncData}
                  onClick={refreshNow}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 hover:bg-cyan-400/18 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? "animate-spin" : ""}`} />
                  {manualRefreshing ? "Refreshing..." : "Refresh Now"}
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <MiniInfo label="Auto-refresh" value="On (15s)" />
                <MiniInfo label="Last Refreshed" value={lastRefreshedAt ? formatClockTime(lastRefreshedAt) : "Starting..."} />
                <MiniInfo label="Sync Status" value={syncHealth.status === "error" ? "Needs Action" : formatSyncStatus(effectiveSyncStatus)} />
                <MiniInfo label="Latest ADM File" value={latestAdmFile} />
                <MiniInfo label="Last Processed Line" value={String(syncStatus?.last_processed_line ?? 0)} />
                <MiniInfo label="Last Sync Time" value={syncStatus?.last_sync_at ? formatDashboardDate(syncStatus.last_sync_at) : "Not synced"} />
                <MiniInfo label="Last Scheduled Sync" value={syncStatus?.last_scheduled_sync_at ? formatDashboardDate(syncStatus.last_scheduled_sync_at) : "Not synced"} />
                <MiniInfo label="Last Manual Sync" value={syncStatus?.last_manual_sync_at ? formatDashboardDate(syncStatus.last_manual_sync_at) : "Not synced"} />
                <MiniInfo label="Last Sync Trigger" value={formatSyncTrigger(syncStatus?.last_sync_trigger)} />
                <MiniInfo label="Last Sync Duration" value={formatDuration(lastSyncDuration)} />
                <MiniInfo label="Next Action" value={syncHealth.status === "error" ? syncHealth.nextAction : "Continue syncing after fresh ADM activity"} />
                <MiniInfo label="Lines Read" value={String(syncStatus?.last_lines_read ?? lastSyncResult?.linesRead ?? 0)} />
                <MiniInfo label="Lines Processed" value={String(syncStatus?.last_lines_processed ?? lastSyncResult?.linesProcessed ?? 0)} />
                <MiniInfo label="Events Created" value={String(syncStatus?.last_events_created ?? lastSyncResult?.eventsCreated ?? 0)} />
                <MiniInfo label="Kills Created" value={String(syncStatus?.last_kills_created ?? lastSyncResult?.killsCreated ?? 0)} />
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px]">
                <div className="space-y-3">
                  <ProgressLine label="Read Status" value={`${processedPercent.toFixed(1)}%`} percent={processedPercent} />
                  <ProgressLine label="Sync Health" value={`${syncHealthPercent}%`} percent={syncHealthPercent} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-1">
                  <MetricTile label="Kills" value={syncStatus?.total_kills ?? 0} />
                  <MetricTile label="Deaths" value={syncStatus?.total_deaths ?? 0} />
                  <MetricTile label="Joins" value={syncStatus?.total_joins ?? 0} />
                  <MetricTile label="Disconnects" value={syncStatus?.total_disconnects ?? 0} />
                  <MetricTile label="Unique Players" value={syncStatus?.unique_players ?? 0} />
                </div>
              </div>
              {liveRefreshWarning ? (
                <p className="mt-4 rounded-lg border border-orange-300/20 bg-orange-400/10 px-3 py-3 text-sm font-bold leading-6 text-orange-50">
                  {liveRefreshWarning}
                </p>
              ) : null}
              <LastSyncDetails open={syncDetailsOpen} onToggle={() => setSyncDetailsOpen((value) => !value)} latestAdmFile={latestAdmFile} syncStatus={syncStatus} lastSyncResult={lastSyncResult} />
            </DashboardPanel>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
            <DashboardPanel className="p-4">
              <div className="flex items-center justify-between gap-3">
                <PanelHeader icon={<Activity className="h-5 w-5" />} title="Recent Synced Events" />
                {recentEventsAreMock ? <SmallBadge tone="orange">Mock Sync Data</SmallBadge> : <SmallBadge tone="emerald">Live Feed Active</SmallBadge>}
              </div>
              <div className="mt-4 grid max-h-[430px] gap-2 overflow-auto pr-1">
                {recentEvents.length ? (
                  recentEvents.map((event, index) => <RecentSyncEventRow key={`${event.source}-${event.created_at ?? index}-${event.event_type}`} event={event} />)
                ) : (
                  <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-3 text-sm font-bold text-zinc-300">
                    No synced events yet. Activity will appear after players join or events happen in-game.
                  </div>
                )}
              </div>
            </DashboardPanel>

            <DashboardPanel className="p-4">
              <SyncRunsHistory runs={syncRuns} latestSuccessTime={syncHealth.latestSuccessTime} onClearFailedRuns={clearFailedRuns} clearingFailedRuns={clearingFailedRuns} />
            </DashboardPanel>
          </div>
        </div>

        <aside className="grid content-start gap-5">
          <DashboardPanel className="p-4">
            <PanelHeader icon={<Wrench className="h-5 w-5" />} title="Quick Actions & Setup" />
            <div className="mt-4 grid gap-3">
              <ActionLink href="/leaderboards" icon={<Crosshair className="h-4 w-4" />} label="View Kill Feed" />
              <ActionLink href="/setup" icon={<Settings className="h-4 w-4" />} label="Edit Server" />
              <ActionLink href="/setup" icon={<Gauge className="h-4 w-4" />} label="Server Settings" />
              <ActionLink href="/setup#review-test" icon={<LifeBuoy className="h-4 w-4" />} label="Setup Guide" />
              <button type="button" disabled={syncing} onClick={runSync} className="inline-flex items-center justify-between rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-left text-sm font-bold text-cyan-50 transition hover:border-cyan-300/45 hover:bg-cyan-400/18 disabled:cursor-not-allowed disabled:opacity-55">
                <span>{syncing ? "Syncing..." : "Run Manual Sync"}</span>
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              </button>
              <button type="button" disabled={checkingLogs} onClick={rerunLogCheck} className="inline-flex items-center justify-between rounded-lg border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-left text-sm font-bold text-violet-50 transition hover:border-violet-300/45 hover:bg-violet-400/18 disabled:cursor-not-allowed disabled:opacity-55">
                <span>{checkingLogs ? "Checking logs..." : "Re-run Log Check"}</span>
                <RefreshCw className={`h-4 w-4 ${checkingLogs ? "animate-spin" : ""}`} />
              </button>
              <button type="button" disabled={diagnosingLogs} onClick={runDiagnostics} className="inline-flex items-center justify-between rounded-lg border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-left text-sm font-bold text-violet-50 transition hover:border-violet-300/45 hover:bg-violet-400/18 disabled:cursor-not-allowed disabled:opacity-55">
                <span>{diagnosingLogs ? "Testing Nitrado routes..." : "Run Log Access Diagnostics"}</span>
                <RefreshCw className={`h-4 w-4 ${diagnosingLogs ? "animate-spin" : ""}`} />
              </button>
              {server.public_slug ? <ActionLink href={`/servers/${server.public_slug}`} icon={<ExternalLink className="h-4 w-4" />} label="View Public Page" tone="emerald" /> : null}
              <ActionLink href="/servers" icon={<Server className="h-4 w-4" />} label="View Network" />
              <button type="button" disabled={clearingTestData} onClick={clearTestData} className="inline-flex items-center justify-between rounded-lg border border-orange-300/20 bg-orange-400/10 px-4 py-3 text-left text-sm font-bold text-orange-50 transition hover:border-orange-300/45 hover:bg-orange-400/18 disabled:cursor-not-allowed disabled:opacity-55">
                <span>{clearingTestData ? "Clearing..." : "Clear Mock/Test Sync Data"}</span>
                <Trash2 className={`h-4 w-4 ${clearingTestData ? "animate-pulse" : ""}`} />
              </button>
            </div>
            <div className="mt-5 rounded-lg border border-white/10 bg-black/24 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase text-zinc-300">Setup Progress</p>
                <span className="text-xs font-black uppercase text-emerald-100">{progress}% Complete</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-sm bg-white/10">
                <div className="h-full bg-gradient-to-r from-violet-300 via-cyan-300 to-emerald-300" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-3 grid gap-2">
                <SetupCheck label="ADM Discovered" done={admState.isDiscovered} />
                <SetupCheck label="Log Sync Active" done={statsSyncActive} />
                <SetupCheck label="Events Processing" done={(syncStatus?.last_events_created ?? 0) > 0 || (syncStatus?.total_joins ?? 0) > 0} />
                <SetupCheck label="Discord Connected" done />
                <SetupCheck label="Stats Sync Active" done={statsSyncActive} />
              </div>
            </div>
            {actionMessage ? (
              <p className="mt-4 rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-sm font-bold text-zinc-200">
                {actionMessage}
              </p>
            ) : null}
            {logDiagnostics ? (
              <LogDiagnosticsPanel diagnostics={logDiagnostics} open={diagnosticsOpen} onToggle={() => setDiagnosticsOpen((value) => !value)} />
            ) : null}
          </DashboardPanel>
          <DangerZonePanel
            isOriginalOwner={isOriginalOwner}
            onRemoveServer={() => setDangerAction("server")}
            onCloseAccount={() => setDangerAction("account")}
            onDownloadSummary={downloadDataSummary}
          />
        </aside>
      </section>
      {dangerAction ? (
        <DangerZoneModal
          action={dangerAction}
          serverName={server.server_name || server.nitrado_service_name || "DZN server"}
          deleting={deletingDangerAction}
          onClose={() => {
            if (!deletingDangerAction) setDangerAction(null);
          }}
          onDownloadSummary={downloadDataSummary}
          onConfirm={confirmDangerAction}
        />
      ) : null}
    </div>
  );
}

function DashboardPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`glass-surface animated-border rounded-lg ${className}`}>
      <div className="relative z-10">{children}</div>
    </section>
  );
}

function DangerZonePanel({
  isOriginalOwner,
  onRemoveServer,
  onCloseAccount,
  onDownloadSummary,
}: {
  isOriginalOwner: boolean;
  onRemoveServer: () => void;
  onCloseAccount: () => void;
  onDownloadSummary: () => void;
}) {
  return (
    <DashboardPanel className="border-red-300/20 p-4">
      <PanelHeader icon={<AlertTriangle className="h-5 w-5 text-red-200" />} title="Danger Zone" />
      <div className="mt-4 rounded-lg border border-white/10 bg-black/24 p-3">
        <p className="text-[10px] font-black uppercase text-zinc-500">Original DZN Owner</p>
        <p className="mt-1 text-sm font-black text-white">{isOriginalOwner ? "You" : "Hidden"}</p>
        <p className="mt-2 text-xs font-bold leading-5 text-zinc-400">
          {isOriginalOwner ? "Permanent deletion is available only to the original DZN owner who linked this server." : "Permanent deletion: Owner only. Only the original DZN server owner can permanently remove this server."}
        </p>
      </div>
      <div className="mt-4 grid gap-3">
        <div className="rounded-lg border border-red-300/20 bg-red-500/10 p-4">
          <h3 className="text-sm font-black uppercase text-red-100">Remove This Server From DZN</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            This permanently removes this server from DZN Network. The public listing, synced ADM data, player stats, kill history, sync history, and server metadata for this server will be deleted. Your Discord server and Nitrado server are not deleted.
          </p>
          <button type="button" disabled={!isOriginalOwner} onClick={onRemoveServer} className="mt-4 inline-flex w-full items-center justify-between rounded-lg border border-red-300/30 bg-red-500/15 px-4 py-3 text-left text-sm font-black text-red-50 transition hover:border-red-300/55 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50">
            <span>Remove Server From DZN</span>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded-lg border border-red-300/20 bg-red-500/10 p-4">
          <h3 className="text-sm font-black uppercase text-red-100">Close My DZN Account</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            This permanently closes your DZN account and removes your DZN user data, sessions, linked servers, saved Nitrado connections, public listings, synced logs, player stats, kill events, and dashboard data. Your Discord account, Discord server, and Nitrado account are not deleted.
          </p>
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={onDownloadSummary} className="inline-flex items-center justify-between rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-left text-sm font-bold text-cyan-50 transition hover:border-cyan-300/45">
              <span>Download My DZN Data Summary</span>
              <Download className="h-4 w-4" />
            </button>
            <button type="button" disabled={!isOriginalOwner} onClick={onCloseAccount} className="inline-flex items-center justify-between rounded-lg border border-red-300/30 bg-red-500/15 px-4 py-3 text-left text-sm font-black text-red-50 transition hover:border-red-300/55 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50">
              <span>Close DZN Account</span>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </DashboardPanel>
  );
}

function DangerZoneModal({
  action,
  serverName,
  deleting,
  onClose,
  onDownloadSummary,
  onConfirm,
}: {
  action: "server" | "account";
  serverName: string;
  deleting: boolean;
  onClose: () => void;
  onDownloadSummary: () => void;
  onConfirm: (action: "server" | "account", confirmationText: string, finalConfirmed: boolean) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [confirmationText, setConfirmationText] = useState("");
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const isServerDelete = action === "server";
  const requiredText = isServerDelete ? "DELETE SERVER" : "DELETE MY DZN ACCOUNT";
  const confirmationValid = isServerDelete
    ? confirmationText.trim() === "DELETE SERVER" || confirmationText.trim() === serverName
    : confirmationText.trim() === requiredText;
  const canDelete = confirmationValid && finalConfirmed && !deleting;
  const deletedItems = isServerDelete ? SERVER_DELETE_ITEMS : ACCOUNT_DELETE_ITEMS;
  const preservedItems = isServerDelete ? SERVER_NOT_DELETED_ITEMS : ACCOUNT_NOT_DELETED_ITEMS;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg border border-red-300/25 bg-[#070b16] p-5 shadow-[0_0_80px_rgba(239,68,68,0.18)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-red-200">Permanent deletion</p>
            <h2 className="mt-1 text-2xl font-black uppercase text-white">
              {isServerDelete ? "Remove This Server From DZN" : "Close My DZN Account"}
            </h2>
          </div>
          <button type="button" disabled={deleting} onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-300 disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex gap-2">
          {[1, 2, 3, 4].map((item) => (
            <span key={item} className={`h-1.5 flex-1 rounded-sm ${item <= step ? "bg-red-300" : "bg-white/10"}`} />
          ))}
        </div>

        {step === 1 ? (
          <div className="mt-5 rounded-lg border border-red-300/20 bg-red-500/10 p-4">
            <div className="flex gap-3">
              <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-red-200" />
              <div>
                <p className="text-sm font-black uppercase text-red-100">This cannot be undone.</p>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {isServerDelete
                    ? "This will permanently delete this server's DZN listing, metadata, synced logs, stats, and history. DZN will not touch your real Discord or Nitrado server."
                    : "This will permanently close your DZN account and delete your DZN-owned user/server data. DZN will not touch your real Discord or Nitrado accounts or servers."}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Checklist title="Will be deleted" tone="danger" items={deletedItems} />
            <Checklist title="Will not be deleted" tone="safe" items={preservedItems} />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-5 rounded-lg border border-white/10 bg-black/24 p-4">
            <label className="text-xs font-black uppercase text-zinc-400" htmlFor="delete-confirmation">
              Type confirmation
            </label>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              {isServerDelete ? (
                <>Type the exact public server name <span className="font-black text-white">{serverName}</span> or <span className="font-black text-white">DELETE SERVER</span>.</>
              ) : (
                <>Type <span className="font-black text-white">DELETE MY DZN ACCOUNT</span>.</>
              )}
            </p>
            <input
              id="delete-confirmation"
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              className="mt-4 w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-red-300/45"
              placeholder={requiredText}
            />
          </div>
        ) : null}

        {step === 4 ? (
          <div className="mt-5 grid gap-4">
            <button type="button" onClick={onDownloadSummary} className="inline-flex items-center justify-between rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-left text-sm font-bold text-cyan-50">
              <span>Download My DZN Data Summary</span>
              <Download className="h-4 w-4" />
            </button>
            <label className="flex items-start gap-3 rounded-lg border border-red-300/20 bg-red-500/10 p-4 text-sm font-bold leading-6 text-red-50">
              <input
                type="checkbox"
                checked={finalConfirmed}
                onChange={(event) => setFinalConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 accent-red-500"
              />
              <span>I understand this is permanent and cannot be undone.</span>
            </label>
            {!confirmationValid ? (
              <p className="rounded-lg border border-orange-300/20 bg-orange-400/10 p-3 text-sm font-bold text-orange-50">
                Go back and enter the required confirmation text before deletion is enabled.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" disabled={deleting} onClick={step === 1 ? onClose : () => setStep((value) => Math.max(1, value - 1))} className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black uppercase text-zinc-200 disabled:opacity-50">
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 4 ? (
            <button type="button" disabled={step === 3 && !confirmationValid} onClick={() => setStep((value) => Math.min(4, value + 1))} className="rounded-lg border border-red-300/25 bg-red-500/15 px-4 py-3 text-sm font-black uppercase text-red-50 disabled:cursor-not-allowed disabled:opacity-50">
              Continue
            </button>
          ) : (
            <button type="button" disabled={!canDelete} onClick={() => void onConfirm(action, confirmationText.trim(), finalConfirmed)} className="rounded-lg border border-red-300/40 bg-red-600 px-4 py-3 text-sm font-black uppercase text-white shadow-[0_0_32px_rgba(239,68,68,0.28)] disabled:cursor-not-allowed disabled:opacity-50">
              {deleting ? "Deleting..." : isServerDelete ? "Permanently Remove Server" : "Permanently Close Account"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Checklist({ title, items, tone }: { title: string; items: string[]; tone: "danger" | "safe" }) {
  return (
    <div className={`rounded-lg border p-4 ${tone === "danger" ? "border-red-300/20 bg-red-500/10" : "border-emerald-300/20 bg-emerald-400/10"}`}>
      <h3 className={`text-xs font-black uppercase ${tone === "danger" ? "text-red-100" : "text-emerald-100"}`}>{title}</h3>
      <ul className="mt-3 grid gap-2 text-sm leading-5 text-zinc-300">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className={tone === "danger" ? "text-red-200" : "text-emerald-200"}>{tone === "danger" ? "Delete" : "Keep"}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SERVER_DELETE_ITEMS = [
  "Public server listing",
  "Server metadata",
  "Server slug and aliases",
  "ADM sync state",
  "ADM raw event rows",
  "Player events",
  "Kill events",
  "Player profiles for this linked server",
  "Server stats",
  "Sync runs",
  "Server metadata version history",
  "Saved Nitrado token/connection for this server",
];

const SERVER_NOT_DELETED_ITEMS = [
  "Your Discord account",
  "Your Discord server",
  "Your Nitrado account",
  "Your actual Nitrado game server",
  "Any other DZN server owned by you",
];

const ACCOUNT_DELETE_ITEMS = [
  "User profile in DZN",
  "Sessions",
  "Discord guild links owned by this DZN user where applicable",
  "All linked servers owned by you",
  "All Nitrado connections saved by you",
  "All synced logs/events/stats for those linked servers",
  "All public server listings owned by you",
  "All metadata versions/aliases for those linked servers",
  "Sync runs for those linked servers",
];

const ACCOUNT_NOT_DELETED_ITEMS = [
  "Your actual Discord account",
  "Your actual Discord server",
  "Your actual Nitrado account",
  "Your actual Nitrado game server",
];

function PanelHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-cyan-100">
      {icon}
      <h2 className="text-sm font-black uppercase tracking-normal text-white">{title}</h2>
    </div>
  );
}

function HeroMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <p className="text-[10px] font-black uppercase">{label}</p>
      </div>
      <p className="mt-2 truncate text-sm font-black text-white">{value}</p>
    </div>
  );
}

function HealthCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "emerald" | "violet" | "amber" | "cyan";
}) {
  const classes = {
    emerald: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
    violet: "border-violet-300/30 bg-violet-400/10 text-violet-100",
    amber: "border-amber-300/35 bg-amber-400/10 text-amber-100",
    cyan: "border-cyan-300/30 bg-cyan-400/10 text-cyan-100",
  }[tone];

  return (
    <div className={`rounded-lg border px-3 py-3 ${classes}`}>
      <div className="flex items-center justify-between gap-2">
        {icon}
        <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_14px_currentColor]" />
      </div>
      <p className="mt-4 text-[10px] font-black uppercase opacity-70">{label}</p>
      <p className="mt-1 truncate text-xs font-black uppercase">{value}</p>
    </div>
  );
}

function CompactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="max-w-[62%] truncate text-right text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function TagPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1.5 text-[11px] font-bold text-cyan-100">
      {children}
    </span>
  );
}

function ProgressLine({ label, value, percent }: { label: string; value: string; percent: number }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
        <p className="text-[10px] font-black uppercase text-cyan-100">{value}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-sm bg-white/10">
        <div className="h-full bg-gradient-to-r from-violet-300 via-cyan-300 to-emerald-300" style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
      </div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-2">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-black text-white">{value.toLocaleString()}</p>
    </div>
  );
}

function ActionLink({ href, icon, label, tone = "zinc" }: { href: string; icon: React.ReactNode; label: string; tone?: "zinc" | "emerald" }) {
  const className = tone === "emerald"
    ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-50 hover:border-emerald-300/45"
    : "border-white/10 bg-white/[0.04] text-zinc-100 hover:border-cyan-300/35";

  return (
    <Link href={href} className={`inline-flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-bold transition ${className}`}>
      <span className="inline-flex items-center gap-2">{icon}{label}</span>
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function SetupCheck({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="text-xs font-bold text-zinc-200">{label}</span>
      <CircleCheck className={`h-4 w-4 ${done ? "text-emerald-200" : "text-zinc-600"}`} />
    </div>
  );
}

function SmallBadge({ children, tone }: { children: React.ReactNode; tone: "emerald" | "orange" | "cyan" | "zinc" }) {
  const classes = {
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    orange: "border-orange-300/25 bg-orange-400/10 text-orange-100",
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
    zinc: "border-white/10 bg-white/[0.04] text-zinc-300",
  }[tone];

  return <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${classes}`}>{children}</span>;
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-3">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function LastSyncDetails({
  open,
  onToggle,
  latestAdmFile,
  syncStatus,
  lastSyncResult,
}: {
  open: boolean;
  onToggle: () => void;
  latestAdmFile: string;
  syncStatus: AdmSyncStatus | null;
  lastSyncResult: AdmSyncRunResult | null;
}) {
  const values = {
    linesRead: syncStatus?.last_lines_read ?? lastSyncResult?.linesRead ?? 0,
    linesProcessed: syncStatus?.last_lines_processed ?? lastSyncResult?.linesProcessed ?? 0,
    rawEventsStored: syncStatus?.last_raw_events_stored ?? lastSyncResult?.rawEventsStored ?? 0,
    playerEventsStored: syncStatus?.last_player_events_stored ?? lastSyncResult?.playerEventsStored ?? 0,
    killEventsStored: syncStatus?.last_kill_events_stored ?? lastSyncResult?.killEventsStored ?? 0,
    unknownLines: syncStatus?.last_unknown_lines ?? lastSyncResult?.unknownLines ?? 0,
    duplicateLines: syncStatus?.last_duplicate_lines ?? lastSyncResult?.skippedDuplicateLines ?? 0,
  };

  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-black/24">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-3 text-left text-xs font-black uppercase text-zinc-200"
      >
        <span>Last Sync Details</span>
        <span className="text-cyan-200">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-white/10 p-3">
          <MiniInfo label="Latest ADM File" value={latestAdmFile} />
          <MiniInfo label="Lines Read" value={String(values.linesRead)} />
          <MiniInfo label="Lines Processed" value={String(values.linesProcessed)} />
          <MiniInfo label="Raw Events Stored" value={String(values.rawEventsStored)} />
          <MiniInfo label="Player Events Stored" value={String(values.playerEventsStored)} />
          <MiniInfo label="Kill Events Stored" value={String(values.killEventsStored)} />
          <MiniInfo label="Parser Unknown Lines" value={String(values.unknownLines)} />
          <MiniInfo label="Skipped Duplicate Lines" value={String(values.duplicateLines)} />
        </div>
      ) : null}
    </div>
  );
}

function SyncRunsHistory({
  runs,
  latestSuccessTime,
  onClearFailedRuns,
  clearingFailedRuns,
}: {
  runs: AdmSyncStatus["recent_sync_runs"];
  latestSuccessTime: string | null;
  onClearFailedRuns: () => void;
  clearingFailedRuns: boolean;
}) {
  const hasHistoricalErrors = runs.some((run) => isHistoricalFailedRun(run, latestSuccessTime));
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <PanelHeader icon={<ListChecks className="h-5 w-5" />} title="Sync Runs History" />
        <div className="flex items-center gap-2">
          {hasHistoricalErrors ? <SmallBadge tone="orange">Historical errors</SmallBadge> : null}
          <span className="text-[10px] font-black uppercase text-zinc-500">Last 5</span>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
        {runs.length ? (
          runs.map((run) => (
            <div key={run.id} className="grid min-w-[720px] grid-cols-[1.2fr_0.8fr_0.9fr_0.8fr_0.8fr_0.7fr] items-center gap-3 border-b border-white/10 bg-black/20 px-3 py-3 text-xs last:border-b-0">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <SmallBadge tone={isFailedRun(run) ? "orange" : isSuccessfulRun(run) ? "emerald" : "zinc"}>{formatSyncStatus(run.status)}</SmallBadge>
                  {isHistoricalFailedRun(run, latestSuccessTime) ? <SmallBadge tone="orange">Historical error</SmallBadge> : null}
                </div>
                <p className="mt-2 line-clamp-2 text-[11px] font-bold leading-5 text-zinc-400">{run.message ?? "Sync run recorded"}</p>
              </div>
              <HistoryCell label="Type" value={formatSyncTrigger(run.trigger_type)} />
              <HistoryCell label="Started" value={formatCompactDate(run.started_at ?? run.created_at)} />
              <HistoryCell label="Duration" value={formatDuration(run.duration_ms)} />
              <HistoryCell label="Lines Read" value={String(run.lines_read)} />
              <HistoryCell label="Events" value={String(run.events_created)} />
            </div>
          ))
        ) : (
          <div className="bg-white/[0.03] px-3 py-3 text-sm font-bold text-zinc-400">
            No sync runs recorded yet.
          </div>
        )}
      </div>
      {latestSuccessTime ? (
        <button type="button" disabled={clearingFailedRuns} onClick={onClearFailedRuns} className="mt-3 inline-flex w-full items-center justify-between rounded-lg border border-orange-300/20 bg-orange-400/10 px-4 py-3 text-left text-sm font-bold text-orange-50 transition hover:border-orange-300/45 hover:bg-orange-400/18 disabled:cursor-not-allowed disabled:opacity-55">
          <span>{clearingFailedRuns ? "Clearing..." : "Clear Old Failed Sync Runs"}</span>
          <Trash2 className={`h-4 w-4 ${clearingFailedRuns ? "animate-pulse" : ""}`} />
        </button>
      ) : null}
    </div>
  );
}

function HistoryCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase text-zinc-600">{label}</p>
      <p className="mt-1 truncate font-bold text-zinc-200">{value}</p>
    </div>
  );
}

function RecentSyncEventRow({ event }: { event: AdmRecentSyncEvent }) {
  const isKill = event.source === "kill";
  const secondary = getRecentEventSecondary(event, isKill);
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
            {getEventIcon(event.event_type, isKill)}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-zinc-500">{event.event_label || formatEventType(event.event_type)}</p>
            <p className="mt-1 truncate text-sm font-bold leading-5 text-white">
              {event.detail ?? (isKill ? `${event.killer_name ?? "Unknown"} -> ${event.victim_name ?? "Unknown"}` : event.player_name ?? "Unknown player")}
            </p>
            {secondary ? (
              <p className="mt-1 truncate text-xs font-bold text-zinc-400">
                {secondary}
              </p>
            ) : null}
          </div>
        </div>
        <p className="shrink-0 text-right text-[10px] font-black uppercase text-zinc-500">
          {formatCompactDate(event.occurred_at ?? event.created_at)}
        </p>
      </div>
    </div>
  );
}

function LogDiagnosticsPanel({
  diagnostics,
  open,
  onToggle,
}: {
  diagnostics: NitradoLogAccessDiagnostics;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-black/24">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-3 text-left text-xs font-black uppercase text-zinc-200"
      >
        <span>ADM API Diagnostics</span>
        <span className={diagnostics.readable.found ? "text-emerald-200" : "text-orange-200"}>
          {diagnostics.readable.found ? "Readable" : "Pending"}
        </span>
      </button>
      {open ? (
        <div className="border-t border-white/10 p-3">
          <div className="grid gap-2 text-xs font-bold text-zinc-300">
            <p>Newest ADM: {diagnostics.newestAdmFileName ?? "Not found"}</p>
            <p>game_specific.log_files: {diagnostics.gameSpecificLogFilesFound ? `${diagnostics.gameSpecificLogFilesReturned} returned` : "not found"}</p>
            <p>Readable route: {diagnostics.readable.routeRecommendation ?? "not found"}</p>
            <p>Message: {diagnostics.readable.message}</p>
          </div>
          <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-white/10">
            <table className="min-w-[760px] w-full border-collapse text-left text-[11px]">
              <thead className="bg-white/[0.04] text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-black uppercase">Endpoint</th>
                  <th className="px-3 py-2 font-black uppercase">Status</th>
                  <th className="px-3 py-2 font-black uppercase">Keys</th>
                  <th className="px-3 py-2 font-black uppercase">Token</th>
                  <th className="px-3 py-2 font-black uppercase">Log Text</th>
                  <th className="px-3 py-2 font-black uppercase">ADM Files</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.attempts.map((attempt, index) => (
                  <tr key={`${attempt.label}-${index}`} className="border-t border-white/10 text-zinc-200">
                    <td className="px-3 py-2 align-top">
                      <p className="font-black text-white">{attempt.label}</p>
                      <p className="mt-1 break-all text-zinc-500">{attempt.requestUrlPathOnly}</p>
                    </td>
                    <td className="px-3 py-2 align-top">{attempt.httpStatusCode ?? attempt.status}</td>
                    <td className="px-3 py-2 align-top">{[...attempt.topLevelJsonKeys, ...attempt.dataKeys.map((key) => `data.${key}`)].slice(0, 8).join(", ") || "none"}</td>
                    <td className="px-3 py-2 align-top">{attempt.hasDownloadTokenFields ? "yes" : "no"}</td>
                    <td className="px-3 py-2 align-top">{attempt.containsLogLikeText || attempt.sampleReadSucceeded ? "yes" : "no"}</td>
                    <td className="px-3 py-2 align-top">{attempt.containsAdmFilenames ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatDashboardDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getManualSyncMessage(result: AdmSyncRunResult) {
  if (result.status === "completed" && result.killsCreated === 0) {
    return result.eventsCreated > 0
      ? "Player activity synced successfully. No PvP kills found in the latest processed lines."
      : "ADM synced successfully. No PvP kills found in the latest processed lines.";
  }
  if (result.status === "completed" && result.eventsCreated > 0) {
    return "Player activity synced successfully.";
  }
  return result.message;
}

function getSyncBanner(values: {
  active: boolean;
  readPending: boolean;
  noPvpKillsYet: boolean;
  hasActivity: boolean;
}) {
  if (values.readPending) {
    return {
      title: "ADM Discovered",
      message: "ADM discovered, waiting for readable log content.",
      detail: null,
      className: "border-orange-300/20 bg-orange-400/10",
    };
  }

  if (values.active) {
    return {
      title: "ADM Sync Active",
      message: "ADM Sync Active - DZN is reading your server logs and updating player activity.",
      detail: values.noPvpKillsYet && values.hasActivity
        ? "Player activity synced successfully. No PvP kills found yet. Kills will appear once they happen in-game."
        : values.noPvpKillsYet
        ? "No PvP kills found yet. Kills will appear once they happen in-game."
        : values.hasActivity
          ? "Player activity synced successfully."
          : null,
      className: "border-emerald-300/20 bg-emerald-400/10",
    };
  }

  return {
    title: "Stats Sync Not Started",
    message: "Run a manual sync after ADM activity appears in your latest server log.",
    detail: null,
    className: "border-white/10 bg-white/[0.04]",
  };
}

function getRecentEventSecondary(event: AdmRecentSyncEvent, isKill: boolean) {
  if (isKill) {
    return [event.weapon, event.distance !== null ? `${event.distance.toFixed(1)}m` : null].filter(Boolean).join(" / ") || "Credited PvP kill";
  }
  if (event.event_type === "player_killed_environment" || event.event_type === "player_died_stats" || event.event_type === "player_suicide") {
    return event.cause ? `Death type: ${event.cause}` : "Death event";
  }
  if (event.event_type === "player_hit" || event.event_type === "player_hit_explosion" || event.event_type === "player_hit_unknown_attacker") {
    return [event.weapon, event.distance !== null ? `${event.distance.toFixed(1)}m` : null].filter(Boolean).join(" / ") || "Damage event";
  }
  if (event.object_type) return event.object_type;
  return null;
}

function getEventIcon(eventType: string, isKill: boolean) {
  if (isKill) return <Crosshair className="h-4 w-4" />;
  if (eventType === "player_connected" || eventType === "player_connecting") return <Users className="h-4 w-4" />;
  if (eventType === "player_disconnected") return <LogOut className="h-4 w-4" />;
  if (eventType === "player_suicide" || eventType === "player_killed_environment" || eventType === "player_died_stats") return <Activity className="h-4 w-4" />;
  if (eventType.startsWith("player_hit")) return <Zap className="h-4 w-4" />;
  if (eventType === "player_placed_object") return <Wrench className="h-4 w-4" />;
  return <Activity className="h-4 w-4" />;
}

function getPrioritizedSyncRuns(runs: AdmSyncStatus["recent_sync_runs"]) {
  const sorted = [...runs].sort((a, b) => getSyncRunTimestamp(b) - getSyncRunTimestamp(a));
  const latestSuccess = sorted.find(isSuccessfulRun);
  if (!latestSuccess) return sorted.slice(0, 5);
  return [latestSuccess, ...sorted.filter((run) => run.id !== latestSuccess.id)].slice(0, 5);
}

function getSyncHealth(runs: AdmSyncStatus["recent_sync_runs"], currentStatus: string, currentMessage: string | null) {
  const sorted = [...runs].sort((a, b) => getSyncRunTimestamp(b) - getSyncRunTimestamp(a));
  const latestSuccess = sorted.find(isSuccessfulRun) ?? null;
  const latestFailure = sorted.find(isFailedRun) ?? null;
  const latestSuccessTime = latestSuccess ? syncRunComparableTime(latestSuccess) : null;
  const latestFailureTime = latestFailure ? syncRunComparableTime(latestFailure) : null;
  const failureIsCurrent = Boolean(latestFailureTime && (!latestSuccessTime || Date.parse(latestFailureTime) > Date.parse(latestSuccessTime)));
  const message = latestFailure?.message ?? currentMessage ?? "";
  const reconnectRequired = failureIsCurrent && /decrypt|cipher|padding|cryptokey|aes-gcm|token/i.test(message);

  if (failureIsCurrent) {
    return {
      status: "error" as const,
      title: reconnectRequired ? "Nitrado Reconnect Required" : "Sync Needs Attention",
      message: reconnectRequired ? "Reconnect Nitrado token to resume scheduled syncing." : "Latest sync run needs attention.",
      detail: reconnectRequired ? "Your latest successful sync remains preserved, but scheduled sync needs a fresh readable token." : message || "Review the latest sync run.",
      nextAction: reconnectRequired ? "Reconnect Nitrado token" : "Review latest sync error",
      latestSuccessTime,
    };
  }

  if (currentStatus === "read_pending") {
    return {
      status: "pending" as const,
      title: "ADM Read Pending",
      message: "ADM discovered, waiting for readable log content.",
      detail: "Your server can stay live while DZN waits for readable ADM data.",
      nextAction: "Waiting for readable ADM content",
      latestSuccessTime,
    };
  }

  return {
    status: "active" as const,
    title: "ADM Sync Active",
    message: "ADM Sync Active - DZN is reading your server logs and updating player activity.",
    detail: "Player activity, kills, deaths and more are being synced in real time.",
    nextAction: "Continue syncing after fresh ADM activity",
    latestSuccessTime,
  };
}

function getProcessedPercent(syncStatus: AdmSyncStatus | null) {
  const linesRead = syncStatus?.last_lines_read ?? 0;
  const linesProcessed = syncStatus?.last_lines_processed ?? 0;
  if (linesRead > 0) return Math.min(100, (linesProcessed / linesRead) * 100);
  return (syncStatus?.last_processed_line ?? 0) > 0 ? 100 : 0;
}

function getNextScheduledSync(lastScheduledSync: string | null) {
  if (!lastScheduledSync) return "Pending";
  const date = new Date(lastScheduledSync);
  if (Number.isNaN(date.getTime())) return "Pending";
  return formatDashboardDate(new Date(date.getTime() + SYNC_POLL_INTERVAL_MS * 20).toISOString());
}

function isSuccessfulRun(run: AdmSyncStatus["recent_sync_runs"][number]) {
  return ["completed", "idle"].includes(run.status.toLowerCase());
}

function isFailedRun(run: AdmSyncStatus["recent_sync_runs"][number]) {
  return ["error", "failed"].includes(run.status.toLowerCase());
}

function isHistoricalFailedRun(run: AdmSyncStatus["recent_sync_runs"][number], latestSuccessTime: string | null) {
  if (!latestSuccessTime || !isFailedRun(run)) return false;
  return getSyncRunTimestamp(run) < Date.parse(latestSuccessTime);
}

function getSyncRunTimestamp(run: AdmSyncStatus["recent_sync_runs"][number]) {
  return Date.parse(syncRunComparableTime(run) ?? "") || 0;
}

function syncRunComparableTime(run: AdmSyncStatus["recent_sync_runs"][number]) {
  return run.finished_at ?? run.started_at ?? run.created_at;
}

function formatDuration(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Not recorded";
  if (value < 1000) return `${Math.max(0, Math.round(value))}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatCompactDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatClockTime(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatEventType(value: string) {
  return value
    .replace(/^player_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function looksLikeIpAddress(value: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

function formatServerStatus(status: LinkedServer["status"]) {
  const normalized = status.toLowerCase();
  if (normalized === "live") return "Live";
  if (normalized === "error") return "Error";
  return "Pending";
}

function formatSyncStatus(value: string) {
  if (value === "read_pending") return "Read Pending";
  if (value === "completed") return "Completed";
  if (value === "idle") return "Idle";
  if (value === "active") return "Active";
  if (value === "not_started") return "Not Started";
  return value.replace(/_/g, " ");
}

function formatSyncTrigger(value: string | null | undefined) {
  if (value === "manual") return "Manual";
  if (value === "scheduled") return "Scheduled";
  return "Not recorded";
}

function getAdmState(server: LinkedServer) {
  const raw = String(server.adm_status ?? "").toLowerCase().replace(/[\s,-]+/g, "_");
  const hasAdmFile = Boolean(server.adm_latest_file || server.adm_path);

  if (Number(server.adm_logs_found) === 1 || raw.includes("connected")) {
    return {
      kind: "connected" as const,
      title: "ADM Logs Connected",
      badge: "Connected",
      readStatus: "Connected",
      nextAction: "Stat sync active.",
      isDiscovered: true,
    };
  }

  if (hasAdmFile || raw.includes("discovered") || raw.includes("read_pending")) {
    return {
      kind: "discovered_read_pending" as const,
      title: "ADM Logs Discovered",
      badge: "Discovered",
      readStatus: "Read Pending",
      nextAction: "Waiting for API-readable ADM sample.",
      isDiscovered: true,
    };
  }

  return {
    kind: "needs_review" as const,
    title: "ADM Logs Need Review",
    badge: "Needs Review",
    readStatus: "Not Ready",
    nextAction: "Run the log check from Review & Test.",
    isDiscovered: false,
  };
}
