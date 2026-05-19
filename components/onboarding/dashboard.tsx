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
import { bumpServer, clearClientAuthState, clearMockTestSyncData, clearOldFailedSyncRuns, createCheckoutSession, createPortalSession, deleteAccount, deleteLinkedServer, getAutomationHealth, getBillingPlans, getBillingStatus, getDiscordPostingChannels, getMe, getPostingDestinations, getRecentSyncEvents, getServerAdvertisingStatus, getSyncStatus, logoutAndRedirect, refreshServerMetadata, runLogAccessDiagnostics, runManualSync, savePostingDestination, testOnboarding, updateServerPublicListing } from "./api";
import type { AdmRecentSyncEvent, AdmSyncRunResult, AdmSyncStatus, AdvertisingBumpStatus, AutomationHealth, AuthResponse, BillingPlanSummary, BillingStatus, DiscordChannelsResponse, DiscordPostingChannel, LinkedServer, NitradoLogAccessDiagnostics, PostingChannelSetup, PostingDestinationsResponse, PostingOptionSummary } from "./types";

const SYNC_POLL_INTERVAL_MS = 15000;
let hasLoggedMultiServerReady = false;

export function Dashboard() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then(setAuth)
      .catch(() => setAuth({ authenticated: false }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!loading && auth && !auth.authenticated) {
      window.location.href = "/login?returnTo=/dashboard";
    }
  }, [auth, loading]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    if (!hasLoggedMultiServerReady) {
      console.log("DZN MULTI SERVER LINKING READY");
      console.log("DZN DASHBOARD METADATA REFRESH UI FIXED");
      hasLoggedMultiServerReady = true;
    }
  }, [auth?.authenticated]);

  async function signOut() {
    clearClientAuthState();
    await logoutAndRedirect();
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
            <Link href="/login?returnTo=/dashboard" className="mt-6 inline-flex rounded-lg bg-violet-500 px-5 py-3 text-xs font-black uppercase text-white">
              Login with Discord
            </Link>
          </div>
        </div>
      </DashboardFrame>
    );
  }

  const manageableServers = auth.linkedServers?.length ? auth.linkedServers : auth.linkedServer ? [auth.linkedServer] : [];
  const server = manageableServers.find((item) => item.id === selectedServerId) ?? auth.linkedServer ?? manageableServers[0] ?? null;

  return (
    <DashboardFrame
      onLogout={signOut}
      serverName={server?.server_name ?? server?.guild_name ?? null}
      servers={manageableServers}
      selectedServerId={server?.id ?? null}
      onSelectServer={setSelectedServerId}
    >
      {server ? <ServerDashboard key={server.id} server={server} onRefresh={async () => setAuth(await getMe())} /> : <EmptyDashboard />}
    </DashboardFrame>
  );
}

function DashboardFrame({
  children,
  onLogout,
  serverName,
  servers = [],
  selectedServerId,
  onSelectServer,
}: {
  children: React.ReactNode;
  onLogout?: () => void;
  serverName?: string | null;
  servers?: LinkedServer[];
  selectedServerId?: string | null;
  onSelectServer?: (serverId: string) => void;
}) {
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
        <nav className="mb-5 flex flex-col gap-4 rounded-lg border border-white/10 bg-black/20 px-4 py-3 backdrop-blur-xl lg:min-h-[104px] lg:flex-row lg:items-center lg:justify-between">
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
            {servers.length > 1 && onSelectServer ? (
              <label className="relative inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-black uppercase text-zinc-200">
                <select
                  value={selectedServerId ?? ""}
                  onChange={(event) => onSelectServer(event.target.value)}
                  className="max-w-[220px] appearance-none bg-transparent pr-5 text-[11px] font-black uppercase text-white outline-none"
                  aria-label="Select dashboard server"
                >
                  {servers.map((server) => (
                    <option key={server.id} value={server.id} className="bg-[#080b16] text-white">
                      {server.display_name ?? server.hostname ?? server.server_name ?? server.nitrado_service_name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5" />
              </label>
            ) : (
              <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-black uppercase text-zinc-200">
                {serverName ?? "Server"}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            )}
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

function ServerDashboard({ server: serverProp, onRefresh }: { server: LinkedServer; onRefresh: () => Promise<void> }) {
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
  const [refreshingServerInfo, setRefreshingServerInfo] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingPlans, setBillingPlans] = useState<BillingPlanSummary[]>([]);
  const [advertisingStatus, setAdvertisingStatus] = useState<AdvertisingBumpStatus | null>(null);
  const [postingSetups, setPostingSetups] = useState<PostingChannelSetup[]>([]);
  const [postingOptions, setPostingOptions] = useState<PostingOptionSummary[]>([]);
  const [discordPostingChannels, setDiscordPostingChannels] = useState<DiscordPostingChannel[]>([]);
  const [discordChannelsResponse, setDiscordChannelsResponse] = useState<DiscordChannelsResponse | null>(null);
  const [discordChannelsLoading, setDiscordChannelsLoading] = useState(false);
  const [discordChannelsWarning, setDiscordChannelsWarning] = useState("");
  const [automationHealth, setAutomationHealth] = useState<AutomationHealth | null>(null);
  const [billingMessage, setBillingMessage] = useState("");
  const [liveRefreshWarning, setLiveRefreshWarning] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [serverInfoOverride, setServerInfoOverride] = useState<{ serverId: string; patch: Partial<LinkedServer> } | null>(null);
  const syncRefreshInFlightRef = useRef(false);
  const syncRefreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const onRefreshRef = useRef(onRefresh);
  const server = useMemo(
    () => ({
      ...serverProp,
      ...(serverInfoOverride?.serverId === serverProp.id ? serverInfoOverride.patch : {}),
    }),
    [serverInfoOverride, serverProp],
  );

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const tags = useMemo(() => {
    try {
      return JSON.parse(server.tags_json) as string[];
    } catch {
      return [];
    }
  }, [server.tags_json]);

  const refreshDiscordChannels = useCallback(async () => {
    setDiscordChannelsLoading(true);
    try {
      const channels = await getDiscordPostingChannels(server.id);
      setDiscordPostingChannels(channels.channels);
      setDiscordChannelsResponse(channels);
      setDiscordChannelsWarning(channels.warning ?? "");
      return channels;
    } catch (error) {
      setDiscordPostingChannels([]);
      setDiscordChannelsResponse(null);
      setDiscordChannelsWarning(error instanceof Error ? error.message : "DZN could not load Discord channel diagnostics for this server.");
      return null;
    } finally {
      setDiscordChannelsLoading(false);
    }
  }, [server.id]);

  const refreshBilling = useCallback(async () => {
    try {
      const [billing, advertising] = await Promise.all([
        getBillingStatus(),
        getServerAdvertisingStatus(server.id).catch(() => null),
      ]);
      setBillingStatus(billing);
      if (advertising?.advertising) setAdvertisingStatus(advertising.advertising);
      const plans = await getBillingPlans().catch(() => null);
      if (plans?.plans?.length) setBillingPlans(plans.plans);
      const posting = await getPostingDestinations(server.id).catch(() => null);
      if (posting?.setups) setPostingSetups(posting.setups);
      if (posting?.post_type_options) setPostingOptions(posting.post_type_options);
      await refreshDiscordChannels();
      const health = await getAutomationHealth().catch(() => null);
      setAutomationHealth(health);
    } catch (error) {
      setDiscordChannelsLoading(false);
      setBillingMessage(error instanceof Error ? error.message : "Billing status unavailable.");
    }
  }, [refreshDiscordChannels, server.id]);

  useEffect(() => {
    void Promise.resolve().then(refreshBilling);
  }, [refreshBilling]);

  const serverDisplayName = server.display_name ?? server.hostname ?? server.server_name ?? server.nitrado_service_name;
  const effectiveServerMode = server.server_mode ?? server.server_type;
  const normalizedStatus = server.status.toLowerCase();
  const admState = getAdmState(server);
  const isDayzService = [server.game, serverDisplayName, server.nitrado_service_name].some((value) => /dayz/i.test(value ?? ""));
  const discordBotInstalled = discordChannelsResponse?.bot_connected === true;
  const discordChannelsDiscovered = discordPostingChannels.length > 0;
  const coreSetupComplete = Boolean(server.guild_id && discordBotInstalled && discordChannelsDiscovered && server.nitrado_service_id && isDayzService && admState.isDiscovered);
  const progress = coreSetupComplete ? 100 : normalizedStatus === "error" ? 72 : normalizedStatus === "live" ? 92 : 84;
  const networkAddress = server.ip_address ?? server.region ?? "Unknown";
  const networkAddressLabel = looksLikeIpAddress(networkAddress) ? "IP Address" : "Region";
  const syncHasProcessedLines = (syncStatus?.last_processed_line ?? 0) > 0 && syncStatus?.last_sync_status !== "read_pending";
  const statsSyncActive = syncHasProcessedLines || admState.kind === "connected";
  const statsSyncPending = !statsSyncActive && admState.kind === "discovered_read_pending";
  const latestAdmFile = syncStatus?.latest_adm_file ?? server.adm_latest_file ?? "Not detected";
  const effectiveSyncStatus = normalizeDashboardSyncStatus(
    syncStatus?.last_sync_status ?? (statsSyncPending ? "read_pending" : admState.kind === "connected" ? "active" : "not_started"),
    latestAdmFile,
  );
  const lastSyncDuration = syncStatus?.last_sync_duration_ms ?? lastSyncResult?.syncDurationMs ?? null;
  const activityCount = (syncStatus?.total_joins ?? 0) + (syncStatus?.total_disconnects ?? 0) + (syncStatus?.total_deaths ?? 0);
  const noPvpKillsYet = statsSyncActive && (syncStatus?.total_kills ?? 0) === 0;
  const globalRankLabel = formatGlobalRank(server.global_rank ?? server.rank ?? null);
  const scoreLabel = server.score_label ?? (typeof server.score === "number" && server.score > 0 ? String(server.score) : "Pending");
  const scoreTitle = scoreBreakdownTitle(server.score_breakdown ?? null);
  const syncBanner = getSyncBanner({
    active: statsSyncActive,
    readPending: effectiveSyncStatus === "read_pending",
    noPvpKillsYet,
    hasActivity: activityCount > 0,
  });
  const recentEventsAreMock = recentEvents.some((event) => event.is_mock || [event.player_name, event.killer_name, event.victim_name].some((name) => /^Mock(Survivor|Bandit|Runner)/.test(name ?? "")));
  const syncRuns = getPrioritizedSyncRuns(syncStatus?.recent_sync_runs ?? []);
  const syncHealth = getSyncHealth(syncStatus?.recent_sync_runs ?? [], effectiveSyncStatus, syncStatus?.last_sync_message ?? null);
  const dashboardSyncBanner = getDashboardSyncStatusBanner(syncBanner, syncHealth, effectiveSyncStatus);
  const latestAdmReadable = getLatestAdmReadableLabel(effectiveSyncStatus);
  const recentFeedStatus = getRecentFeedStatus(syncStatus, effectiveSyncStatus, recentEvents.length);
  const recentFeedBadge = getRecentFeedBadge(recentEventsAreMock, effectiveSyncStatus);
  const syncHealthPercent = syncHealth.status === "error" ? 72 : effectiveSyncStatus === "read_pending" ? 76 : 100;
  const processedPercent = getProcessedPercent(syncStatus);
  const nextScheduledSync = getNextScheduledSync(syncStatus?.last_scheduled_sync_at ?? null);
  const isOriginalOwner = server.original_owner_is_current_user !== false;
  const metadataCheckedLabel = server.metadata_last_checked_at ? formatRelativeTime(server.metadata_last_checked_at) : "not checked yet";
  const metadataChangedLabel = server.metadata_last_changed_at ? formatRelativeTime(server.metadata_last_changed_at) : null;
  const playerCountCheckedLabel = server.player_count_last_checked_at ? formatRelativeTime(server.player_count_last_checked_at) : "not checked yet";
  const playerCountStatusLabel = formatPlayerCountStatus(server.player_count_status);
  const playerSlotsLabel = formatDashboardPlayerSlots(
    server.current_players,
    server.max_players ?? server.player_slots,
    server.player_count_last_checked_at,
    server.player_count_status,
  );
  const playerCountFreshnessDetail = formatPlayerCountFreshnessDetail(
    server.current_players,
    server.max_players ?? server.player_slots,
    server.player_count_last_checked_at,
    server.player_count_status,
  );

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
      if (active) {
        void refreshSyncData({ warnOnError: true });
        void onRefreshRef.current();
      }
    }, 0);
    const interval = window.setInterval(() => {
      if (active) {
        void refreshSyncData({ warnOnError: true });
        void onRefreshRef.current();
      }
    }, SYNC_POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [refreshSyncData]);

  async function refreshNow() {
    setActionMessage("");
    if (shouldRefreshServerInfo(server.metadata_last_checked_at)) {
      await refreshServerMetadata(server.id).catch(() => null);
      await onRefresh();
    }
    const refreshed = await refreshSyncData({ manual: true, warnOnError: true });
    if (refreshed) setActionMessage("Dashboard sync status refreshed. Use Run Manual Sync to process ADM log lines now.");
  }

  async function refreshServerInfo() {
    setRefreshingServerInfo(true);
    setActionMessage("");
    try {
      const result = await refreshServerMetadata(server.id);
      setServerInfoOverride((current) => ({
        serverId: server.id,
        patch: {
          ...(current?.serverId === server.id ? current.patch : {}),
          ...metadataPatchFromRefreshResult(result),
        },
      }));
      await onRefresh();
      setActionMessage("Server info checked from Nitrado just now.");
    } catch {
      setActionMessage("Could not refresh server info. Try again.");
    } finally {
      setRefreshingServerInfo(false);
    }
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
        serverName: serverDisplayName,
        nitradoServiceId: server.nitrado_service_id,
        nitradoServiceName: server.nitrado_service_name,
        publicSlug: server.public_slug,
        discordGuildName: server.guild_name ?? null,
        serverType: effectiveServerMode,
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
                    <h1 className="truncate text-3xl font-black text-white">{serverDisplayName}</h1>
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
                    {server.guild_name ?? server.guild_id} <span className="text-zinc-600">/</span> {effectiveServerMode} <span className="text-zinc-600">/</span> {server.game ?? "DayZ"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {server.public_slug ? (
                    <Link href={publicServerProfileHref(server.public_slug)} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50">
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
                <HeroMetric icon={<Users className="h-4 w-4" />} label="Players" value={playerSlotsLabel} />
                <HeroMetric icon={<BarChart3 className="h-4 w-4" />} label="Rank" value={globalRankLabel} title={scoreTitle} />
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
          <div className={`rounded-lg border p-4 ${dashboardSyncBanner.className}`}>
            <div className="flex items-start gap-3">
              <Activity className={`mt-1 h-5 w-5 shrink-0 ${dashboardSyncBanner.iconClassName}`} />
              <div>
                <p className="text-xs font-black uppercase opacity-75">{dashboardSyncBanner.title}</p>
                <p className="mt-1 text-sm font-black leading-6 text-white">{dashboardSyncBanner.message}</p>
                <p className="mt-1 text-sm leading-6 text-zinc-300">
                  {dashboardSyncBanner.detail ?? "Player activity, kills, deaths and more update after each successful ADM log check."}
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
                <CompactRow label="Server Name" value={serverDisplayName} />
                <CompactRow label="Service ID" value={server.nitrado_service_id} />
                <CompactRow label="Nitrado Service ID" value={server.nitrado_service_id} />
                <CompactRow label={networkAddressLabel} value={networkAddress} />
                <CompactRow label="Server Type" value={effectiveServerMode} />
                <CompactRow label="Game" value={server.game ?? "DayZ"} />
                <CompactRow label="Player Slots" value={playerSlotsLabel} />
                <CompactRow label="Server Status" value={formatNitradoServerStatus(server.server_status, server.is_online)} />
                <CompactRow label="Player Count Freshness" value={`${playerCountStatusLabel} · ${playerCountCheckedLabel}`} />
                <CompactRow label="Live Count Detail" value={playerCountFreshnessDetail} />
                <CompactRow label="Metadata Last Checked" value={server.metadata_last_checked_at ? formatRelativeTime(server.metadata_last_checked_at) : "Not checked"} />
                <CompactRow label="Latest ADM File" value={latestAdmFile} />
                <CompactRow label="Last ADM Check" value={server.adm_last_checked_at ? formatDashboardDate(server.adm_last_checked_at) : "Not checked"} />
                <CompactRow label="Next Scheduled Sync" value={nextScheduledSync} />
                <CompactRow label="Global Rank" value={globalRankLabel} />
                <CompactRow label="Server Score" value={scoreLabel} />
              </div>
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-cyan-300/15 bg-cyan-400/8 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm font-bold leading-6 text-cyan-50">
                  <p>Server info checked from Nitrado.</p>
                  <p className="text-zinc-300">
                    Last checked {metadataCheckedLabel}.
                    {" "}
                    {metadataChangedLabel ? `Last actual change ${metadataChangedLabel}.` : "No metadata changes detected yet."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={refreshingServerInfo}
                  onClick={refreshServerInfo}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshingServerInfo ? "animate-spin" : ""}`} />
                  {refreshingServerInfo ? "Refreshing..." : "Refresh Server Info"}
                </button>
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
                  {manualRefreshing ? "Refreshing..." : "Refresh Status"}
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <MiniInfo label="Auto-refresh" value="On (15s)" />
                <MiniInfo label="Last Refreshed" value={lastRefreshedAt ? formatClockTime(lastRefreshedAt) : "Starting..."} />
                <MiniInfo label="Status" value={syncHealth.status === "error" ? "Needs Action" : formatSyncStatus(effectiveSyncStatus)} />
                <MiniInfo label="Latest ADM File" value={latestAdmFile} />
                <MiniInfo label="Latest File Readable" value={latestAdmReadable} />
                <MiniInfo label="ADM Health" value={syncStatus?.adm_health_label ?? "Delayed"} />
                <MiniInfo label="Latest ADM Processed" value={syncStatus?.latest_adm_processed ?? "Not processed"} />
                <MiniInfo label="Newest Unprocessed ADM" value={syncStatus?.newest_unprocessed_adm_file ?? "None queued"} />
                <MiniInfo label="Unreadable Files Queued" value={String(syncStatus?.unreadable_files_queued ?? 0)} />
                <MiniInfo label="Last Processed Line" value={String(syncStatus?.last_processed_line ?? 0)} />
                <MiniInfo label="Last Checked" value={syncStatus?.last_sync_at ? formatDashboardDate(syncStatus.last_sync_at) : "Not checked"} />
                <MiniInfo label="Last Successful Feed Sync" value={syncStatus?.last_successful_sync_at ? formatDashboardDate(syncStatus.last_successful_sync_at) : "Not synced"} />
                <MiniInfo label="Last Scheduled Sync" value={syncStatus?.last_scheduled_sync_at ? formatDashboardDate(syncStatus.last_scheduled_sync_at) : "Not synced"} />
                <MiniInfo label="Last Manual Sync" value={syncStatus?.last_manual_sync_at ? formatDashboardDate(syncStatus.last_manual_sync_at) : "Not synced"} />
                <MiniInfo label="Last Sync Trigger" value={formatSyncTrigger(syncStatus?.last_sync_trigger)} />
                <MiniInfo label="Last Sync Duration" value={formatDuration(lastSyncDuration)} />
                <MiniInfo label="Next Action" value={syncHealth.status === "error" ? syncHealth.nextAction : "Continue syncing after fresh ADM activity"} />
                <MiniInfo label="Lines Read This Check" value={String(syncStatus?.last_lines_read ?? lastSyncResult?.linesRead ?? 0)} />
                <MiniInfo label="New Lines Processed" value={String(syncStatus?.last_lines_processed ?? lastSyncResult?.linesProcessed ?? 0)} />
                <MiniInfo label="Events Created" value={String(syncStatus?.last_events_created ?? lastSyncResult?.eventsCreated ?? 0)} />
                <MiniInfo label="Kills Created" value={String(syncStatus?.last_kills_created ?? lastSyncResult?.killsCreated ?? 0)} />
                <MiniInfo label="Raw Kill Lines Found" value={String(syncStatus?.raw_kill_lines_found ?? 0)} />
                <MiniInfo label="Kill Lines Parsed" value={String(syncStatus?.parsed_kill_lines_found ?? 0)} />
                <MiniInfo label="Parser Skipped Lines" value={String(syncStatus?.parser_skipped_lines ?? 0)} />
                <MiniInfo label="Recovery Action" value={syncStatus?.current_recovery_action ?? "ADM sync healthy"} />
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

          <PublicListingEditor
            key={`${server.id}-public-listing`}
            server={server}
            onSaved={(listing) => {
              setServerInfoOverride((current) => ({
                serverId: server.id,
                patch: {
                  ...(current?.serverId === server.id ? current.patch : {}),
                  ...listing,
                },
              }));
            }}
          />

          <DiscordAutoPostsPanel
            serverId={server.id}
            setups={postingSetups}
            options={postingOptions}
            channels={discordPostingChannels}
            channelsResponse={discordChannelsResponse}
            channelsLoading={discordChannelsLoading}
            channelsWarning={discordChannelsWarning}
            connectedServerName={server.guild_name ?? serverDisplayName}
            planName={planLabel(billingStatus?.plan_key ?? "free")}
            onChannelsRefresh={refreshDiscordChannels}
            onSaved={(result) => {
              setPostingSetups(result.setups ?? []);
              if (result.post_type_options) setPostingOptions(result.post_type_options);
            }}
          />

          <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
            <DashboardPanel className="p-4">
              <div className="flex items-center justify-between gap-3">
                <PanelHeader icon={<Activity className="h-5 w-5" />} title="Recent Synced Events" />
                <SmallBadge tone={recentFeedBadge.tone}>{recentFeedBadge.label}</SmallBadge>
              </div>
              {recentFeedStatus ? (
                <p className={`mt-3 rounded-lg border px-3 py-2 text-xs font-bold leading-5 ${recentFeedStatus.className}`}>
                  {recentFeedStatus.message}
                </p>
              ) : null}
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
          <BillingPlanPanel billing={billingStatus} plans={billingPlans} message={billingMessage} onRefresh={refreshBilling} />
          <AdvertisingBoostPanel
            serverId={server.id}
            billing={billingStatus}
            advertising={advertisingStatus}
            onBumped={(next) => {
              setAdvertisingStatus(next);
              setActionMessage("Server bumped. It will appear higher in public discovery.");
              void refreshBilling();
            }}
          />
          {automationHealth ? <AutomationHealthPanel health={automationHealth} /> : null}
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
              <button type="button" disabled={refreshingServerInfo} onClick={refreshServerInfo} className="inline-flex items-center justify-between rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-left text-sm font-bold text-emerald-50 transition hover:border-emerald-300/45 hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-55">
                <span>{refreshingServerInfo ? "Refreshing..." : "Refresh Server Info"}</span>
                <RefreshCw className={`h-4 w-4 ${refreshingServerInfo ? "animate-spin" : ""}`} />
              </button>
              <button type="button" disabled={checkingLogs} onClick={rerunLogCheck} className="inline-flex items-center justify-between rounded-lg border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-left text-sm font-bold text-violet-50 transition hover:border-violet-300/45 hover:bg-violet-400/18 disabled:cursor-not-allowed disabled:opacity-55">
                <span>{checkingLogs ? "Checking logs..." : "Re-run Log Check"}</span>
                <RefreshCw className={`h-4 w-4 ${checkingLogs ? "animate-spin" : ""}`} />
              </button>
              <button type="button" disabled={diagnosingLogs} onClick={runDiagnostics} className="inline-flex items-center justify-between rounded-lg border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-left text-sm font-bold text-violet-50 transition hover:border-violet-300/45 hover:bg-violet-400/18 disabled:cursor-not-allowed disabled:opacity-55">
                <span>{diagnosingLogs ? "Testing Nitrado routes..." : "Run Log Access Diagnostics"}</span>
                <RefreshCw className={`h-4 w-4 ${diagnosingLogs ? "animate-spin" : ""}`} />
              </button>
              {server.public_slug ? <ActionLink href={publicServerProfileHref(server.public_slug)} icon={<ExternalLink className="h-4 w-4" />} label="View Public Page" tone="emerald" /> : null}
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
                <SetupCheck label="Discord Connected" done />
                <SetupCheck label="DZN Bot Installed" done={discordBotInstalled} />
                <SetupCheck label="Channels Discovered" done={discordChannelsDiscovered} />
                <SetupCheck label="ADM Discovered" done={admState.isDiscovered} />
                <SetupCheck label="Log Sync Active" done={statsSyncActive} />
                <SetupCheck label="Events Processing" done={(syncStatus?.last_events_created ?? 0) > 0 || (syncStatus?.total_joins ?? 0) > 0} />
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
          {server.public_slug ? <DashboardPublicReviewsSummary slug={server.public_slug} /> : null}
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
          serverName={serverDisplayName || "DZN server"}
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

function HeroMetric({ icon, label, value, title }: { icon: React.ReactNode; label: string; value: string; title?: string }) {
  return (
    <div title={title} className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
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

type PublicListingForm = {
  public_short_description: string;
  public_description: string;
  public_discord_invite: string;
  public_website_url: string;
  public_rules: string;
  public_language: string;
  public_region_label: string;
};

type DashboardReviewSummary = {
  average_rating: number;
  review_count: number;
  reviews: Array<{
    id: string;
    reviewer_name: string | null;
    rating: number;
    title: string | null;
    body: string;
    created_at: string;
  }>;
};

const billingPlans = [
  { key: "starter", label: "Starter", price: "£4.99/mo", detail: "1 server, listing, reviews, 30 day stats" },
  { key: "pro", label: "Pro", price: "£9.99/mo", detail: "3 servers, events, analytics, 3 bumps/mo" },
  { key: "network", label: "Network", price: "£19.99/mo", detail: "10 servers, multi-server dashboard, 10 bumps/mo" },
  { key: "partner", label: "Partner", price: "£29.99/mo", detail: "25 servers, featured eligibility, 30 bumps/mo" },
] as const;

function BillingPlanPanel({ billing, plans, message, onRefresh }: { billing: BillingStatus | null; plans: BillingPlanSummary[]; message: string; onRefresh: () => Promise<void> }) {
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const planKey = billing?.plan_key ?? "free";
  const displayPlans = plans.length ? plans : billingPlans.map((plan) => fallbackBillingPlan(plan));

  async function upgrade(planKey: "starter" | "pro" | "network" | "partner") {
    setBusyPlan(planKey);
    try {
      const session = await createCheckoutSession(planKey, "/dashboard");
      window.location.assign(session.url);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not start checkout.");
    } finally {
      setBusyPlan(null);
    }
  }

  async function manageBilling() {
    setPortalBusy(true);
    try {
      const session = await createPortalSession();
      window.location.assign(session.url);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not open billing portal.");
    } finally {
      setPortalBusy(false);
    }
  }

  return (
    <DashboardPanel className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <PanelHeader icon={<Gauge className="h-5 w-5" />} title="Billing & Plan" />
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Current plan: <span className="font-black uppercase text-white">{planLabel(planKey)}</span>
          </p>
        </div>
        <button type="button" onClick={onRefresh} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-200">
          Refresh
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniInfo label="Servers Used" value={billing ? `${billing.linked_server_count} / ${billing.entitlements.max_linked_servers}` : "Loading"} />
        <MiniInfo label="Plan Status" value={billing?.plan_status ?? "Loading"} />
        <MiniInfo label="Bumps / Month" value={String(billing?.entitlements.included_bumps_per_month ?? 0)} />
        <MiniInfo label={billing?.cancel_at_period_end ? "Cancels On" : "Renews"} value={billingRenewalLabel(billing)} />
      </div>

      <div className="mt-4 grid gap-2">
        {displayPlans.map((plan) => (
          <div key={plan.plan_key} className="rounded-lg border border-white/10 bg-black/24 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black uppercase text-white">{plan.name} <span className="text-violet-200">{plan.price_label}</span></p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">
                  {plan.max_linked_servers} server{plan.max_linked_servers === 1 ? "" : "s"} · {plan.stat_history_days} day stats · {plan.included_bumps_per_month} bumps/mo
                </p>
                <div className="mt-2 grid gap-1 text-[11px] leading-5 text-zinc-500">
                  <p><span className="font-black uppercase text-zinc-400">Server Status Sync:</span> player count, online/offline, slots, and basic status checked every {plan.server_status_interval_minutes ?? "?"} minute{plan.server_status_interval_minutes === 1 ? "" : "s"}.</p>
                  <p><span className="font-black uppercase text-zinc-400">ADM Log Sync:</span> kills, deaths, K/D, leaderboards, and events checked every {plan.adm_pull_interval_minutes ?? "?"} minutes.</p>
                </div>
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                  {plan.configured ? "Checkout configured" : "Checkout not configured"}
                </p>
              </div>
              <button
                type="button"
                disabled={busyPlan !== null || plan.plan_key === planKey || !plan.configured}
                onClick={() => upgrade(plan.plan_key)}
                className="shrink-0 rounded-lg bg-violet-500 px-3 py-2 text-[10px] font-black uppercase text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {plan.plan_key === planKey ? "Current Plan" : !plan.configured ? "Not configured" : busyPlan === plan.plan_key ? "Opening..." : "Upgrade"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={portalBusy || !billing?.stripe_customer_exists}
        onClick={manageBilling}
        className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {portalBusy ? "Opening portal..." : "Manage Billing"}
      </button>
      {message ? <p className="mt-3 text-sm font-bold text-orange-100">{message}</p> : null}
      <p className="mt-3 text-[11px] leading-5 text-zinc-500">
        Nitrado controls when fresh ADM logs are available. DZN checks automatically based on your plan, but ADM logs can appear 5-45 minutes after a restart.
      </p>
    </DashboardPanel>
  );
}

function AdvertisingBoostPanel({
  serverId,
  billing,
  advertising,
  onBumped,
}: {
  serverId: string;
  billing: BillingStatus | null;
  advertising: AdvertisingBumpStatus | null;
  onBumped: (state: AdvertisingBumpStatus) => void;
}) {
  const [bumping, setBumping] = useState(false);
  const [error, setError] = useState("");
  const entitlements = billing?.entitlements;
  const canBump = Boolean(entitlements?.can_use_ad_bumps);
  const proCheckoutConfigured = Boolean(billing?.checkout_configured?.pro);
  const used = advertising?.bump_count_current_period ?? 0;
  const included = advertising?.included_bumps_per_month ?? entitlements?.included_bumps_per_month ?? 0;
  const nextAvailable = nextBumpLabel(advertising);
  const limitReached = included > 0 && used >= included;
  const cooldownActive = nextAvailable !== "Now" && canBump;
  const nextBumpCopy = nextAvailable === "Now" ? "now" : nextAvailable.toLowerCase();

  async function bump() {
    setBumping(true);
    setError("");
    try {
      const result = await bumpServer(serverId);
      onBumped(result.advertising);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not bump server.");
    } finally {
      setBumping(false);
    }
  }

  return (
    <DashboardPanel className="p-4">
      <PanelHeader icon={<Zap className="h-5 w-5" />} title="Advertising Boost" />
      {canBump ? (
        <>
          {cooldownActive ? (
            <div className="dzn-ad-boost-status dzn-ad-boost-status--active mt-4">
              <div>
                <p className="dzn-ad-boost-status__label">BOOST ACTIVE</p>
                <p className="dzn-ad-boost-status__copy">Your server is currently boosted in public discovery.</p>
              </div>
              <p className="dzn-ad-boost-status__timer">Next bump available {nextBumpCopy}</p>
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MiniInfo label="Bumps Used" value={`${used} / ${included}`} />
            <MiniInfo label="Next Bump" value={nextAvailable} />
            <MiniInfo label="Last Bumped" value={advertising?.last_bumped_at ? formatRelativeTime(advertising.last_bumped_at) : "Never"} />
            <MiniInfo label="Cooldown" value={`${advertising?.bump_cooldown_hours ?? entitlements?.bump_cooldown_hours ?? 24}h`} />
          </div>
          <button
            type="button"
            disabled={bumping || limitReached || cooldownActive}
            onClick={bump}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Zap className="h-4 w-4" />
            {bumping ? "Bumping..." : limitReached ? "Limit reached" : cooldownActive ? "Cooldown active" : "Bump Server"}
          </button>
          <p className="mt-3 text-xs leading-5 text-zinc-400">
            Bumps are paid visibility only. They do not change organic rank or score.
          </p>
        </>
      ) : (
        <div className="mt-4 rounded-lg border border-violet-300/20 bg-violet-400/10 p-4">
          <p className="text-sm font-black uppercase text-white">Upgrade required</p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">Bump your server higher in public discovery with Pro or above.</p>
          <button
            type="button"
            disabled={!proCheckoutConfigured}
            onClick={async () => {
              const session = await createCheckoutSession("pro", "/dashboard");
              window.location.assign(session.url);
            }}
            className="mt-4 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-55"
          >
            {proCheckoutConfigured ? "Upgrade to Pro" : "Checkout not configured"}
          </button>
        </div>
      )}
      {error ? <p className="mt-3 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-sm font-bold text-red-50">{error}</p> : null}
    </DashboardPanel>
  );
}

function DiscordAutoPostsPanel({
  serverId,
  setups,
  options,
  channels,
  channelsResponse,
  channelsLoading,
  channelsWarning,
  connectedServerName,
  planName,
  onChannelsRefresh,
  onSaved,
}: {
  serverId: string;
  setups: PostingChannelSetup[];
  options: PostingOptionSummary[];
  channels: DiscordPostingChannel[];
  channelsResponse: DiscordChannelsResponse | null;
  channelsLoading: boolean;
  channelsWarning: string;
  connectedServerName: string;
  planName: string;
  onChannelsRefresh: () => Promise<DiscordChannelsResponse | null>;
  onSaved: (result: PostingDestinationsResponse) => void;
}) {
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [manualChannelId, setManualChannelId] = useState("");
  const [selectedPostTypes, setSelectedPostTypes] = useState<string[]>([]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recheckingChannel, setRecheckingChannel] = useState(false);
  const [busyChannel, setBusyChannel] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [testTypeByChannel, setTestTypeByChannel] = useState<Record<string, string>>({});

  const effectiveOptions = options.length ? options : fallbackPostingOptions();
  const groupedOptions = useMemo(() => groupPostingOptions(effectiveOptions), [effectiveOptions]);
  const channelById = useMemo(() => new Map(channels.map((channel) => [channel.channel_id, channel])), [channels]);
  const selectedChannel = channelById.get(selectedChannelId) ?? null;
  const selectedChannelPermission = useMemo(() => {
    if (!selectedChannel) {
      return {
        channelId: selectedChannelId || null,
        channelName: null,
        canPost: false,
        missingPermissions: [] as string[],
      };
    }
    return {
      channelId: selectedChannel.channel_id,
      channelName: selectedChannel.channel_name,
      canPost: selectedChannel.can_post === true,
      missingPermissions: Array.isArray(selectedChannel.missing_permissions) ? selectedChannel.missing_permissions : [],
    };
  }, [selectedChannel, selectedChannelId]);
  const channelFetchFailed = Boolean(channelsResponse?.manual_fallback || channelsResponse?.error_code || channelsWarning);
  const showManualFallback = advancedOpen || channelFetchFailed;
  const manualChannelValue = manualChannelId.trim();
  const channelForSave = selectedChannelId || manualChannelValue;
  const selectedLockedCount = selectedPostTypes.filter((postType) => !effectiveOptions.find((option) => option.key === postType)?.allowed_by_plan).length;
  const webhookFallbackConfigured = Boolean(webhookUrl.trim());
  const channelCanPost = selectedChannel ? selectedChannelPermission.canPost || webhookFallbackConfigured : webhookFallbackConfigured;
  const canSave = Boolean(channelForSave && selectedPostTypes.length && selectedLockedCount === 0 && channelCanPost);
  const diagnostics = channelsResponse?.diagnostics;
  const botStatus = channelsResponse?.bot_connected === true
    ? "Connected"
    : channelsResponse?.error_code === "missing_bot_token"
      ? "Bot token missing"
      : channelsResponse?.bot_connected === false
        ? "Not connected"
        : "Unknown";

  function togglePostType(postType: string) {
    setSelectedPostTypes((current) => current.includes(postType)
      ? current.filter((value) => value !== postType)
      : [...current, postType]);
  }

  function selectChannel(channelId: string) {
    setSelectedChannelId(channelId);
    setManualChannelId("");
    setMessage("");
  }

  async function recheckSelectedChannel() {
    if (!selectedChannelId) return;
    setRecheckingChannel(true);
    setMessage("");
    try {
      const response = await onChannelsRefresh();
      const refreshedChannel = response?.channels.find((channel) => channel.channel_id === selectedChannelId);
      if (!refreshedChannel) {
        setMessage("Selected channel was not returned by Discord during recheck. Choose another channel or check bot access.");
      } else if (refreshedChannel.can_post) {
        setMessage("Selected channel rechecked. DZN Bot can post in this channel.");
      } else {
        setMessage(`Selected channel rechecked. Missing: ${refreshedChannel.missing_permissions.join(", ") || "channel permissions"}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not recheck the selected Discord channel.");
    } finally {
      setRecheckingChannel(false);
    }
  }

  async function saveSetup() {
    if (!canSave) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await savePostingDestination(serverId, {
        action: "save",
        channel_id: channelForSave,
        post_types: selectedPostTypes,
        discord_webhook_url: webhookUrl || null,
        enabled: true,
      });
      onSaved(result);
      setMessage("Discord auto-post setup saved.");
      setSelectedChannelId("");
      setManualChannelId("");
      setSelectedPostTypes([]);
      setWebhookUrl("");
      setAdvancedOpen(false);
      setDiagnosticsOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save Discord auto-post setup.");
    } finally {
      setSaving(false);
    }
  }

  async function runSetupAction(setup: PostingChannelSetup, action: "test" | "disable" | "delete") {
    setBusyChannel(`${setup.channel_id}:${action}`);
    setMessage("");
    try {
      const selectedTestType = testTypeByChannel[setup.channel_id] ?? setup.post_types.find((postType) => postType.enabled)?.key ?? setup.post_types[0]?.key;
      const result = await savePostingDestination(serverId, {
        action,
        channel_id: setup.channel_id,
        post_types: setup.post_types.map((postType) => postType.key),
        test_post_type: selectedTestType,
        enabled: action !== "disable",
      });
      onSaved(result);
      if (action === "test") {
        setMessage(result.test_post?.ok
          ? `${formatPostType(selectedTestType)} test posted. Future updates will edit the saved message when possible.`
          : formatPostingError(result.test_post?.error ?? "Discord test post failed.", result.test_post?.missing_permissions));
      } else if (action === "delete") {
        setMessage("Discord auto-post setup deleted.");
      } else {
        setMessage("Discord auto-post setup disabled.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${action} Discord auto-post setup.`);
    } finally {
      setBusyChannel(null);
    }
  }

  function editSetup(setup: PostingChannelSetup) {
    const channelKnown = channelById.has(setup.channel_id);
    setSelectedChannelId(channelKnown ? setup.channel_id : "");
    setManualChannelId(channelKnown ? "" : setup.channel_id);
    setSelectedPostTypes(setup.post_types.map((postType) => postType.key));
    setWebhookUrl("");
    setAdvancedOpen(!channelKnown || setup.has_webhook_url);
    setMessage(`Editing ${resolveSetupChannelLabel(setup, channelById)}.`);
  }

  return (
    <DashboardPanel className="p-4 lg:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <PanelHeader icon={<Bell className="h-5 w-5" />} title="Discord Auto Posts" />
          <p className="mt-3 text-xs leading-5 text-zinc-400">
            DZN already knows your connected Discord server. Choose where each automatic post should go.
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-[10px] font-black uppercase text-zinc-300">
          {setups.filter((setup) => setup.status === "active").length} active setups
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border border-cyan-300/15 bg-cyan-400/5 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniInfo label="Discord Server" value={channelsResponse?.guild_name ?? connectedServerName ?? "Unknown"} />
        <MiniInfo label="Bot" value={botStatus} />
        <MiniInfo label="Channels Found" value={channelsLoading ? "Loading" : String(channels.length)} />
        <MiniInfo label="Plan" value={planName} />
      </div>

      {channelsLoading ? (
        <p className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-50">
          Loading Discord channels...
        </p>
      ) : null}
      {channelsWarning ? (
        <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-3">
          <p className="text-xs font-black uppercase text-amber-100">{channelsResponse?.error_code ?? "Channel fetch warning"}</p>
          <p className="mt-1 text-xs font-bold leading-5 text-amber-50">{channelsWarning}</p>
          {channelsResponse?.error_code === "bot_not_in_guild" && channelsResponse.bot_invite_url ? (
            <a href={channelsResponse.bot_invite_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-200/30 bg-amber-300/15 px-3 py-2 text-[10px] font-black uppercase text-amber-50">
              Invite DZN Bot <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-white/10 bg-black/24 p-4">
        <div className="grid gap-5 lg:grid-cols-[minmax(220px,0.85fr)_minmax(0,1.45fr)_auto]">
          <div className="grid content-start gap-3">
            <p className="text-[10px] font-black uppercase text-zinc-400">Step 1: Choose Channel</p>
            <select
              value={selectedChannelId}
              onChange={(event) => selectChannel(event.target.value)}
              disabled={channelsLoading || channels.length === 0}
              className="min-h-11 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs font-bold text-white outline-none focus:border-cyan-300/40 disabled:opacity-55"
            >
              <option value="">{channels.length ? "Choose channel" : "No channels loaded"}</option>
              {channels.map((channel) => (
                <option key={channel.channel_id} value={channel.channel_id} className="bg-[#080b16] text-white">
                  {formatChannelLabel(channel)}
                </option>
              ))}
            </select>
            {selectedChannel ? (
              <div className="grid gap-2">
                <span className={`text-[11px] font-bold ${selectedChannelPermission.canPost ? "text-emerald-200" : "text-amber-200"}`}>
                  {selectedChannelPermission.canPost
                    ? "DZN Bot can post in this channel."
                    : `DZN can see this channel, but cannot post here yet. Missing: ${selectedChannelPermission.missingPermissions.join(", ") || "channel permissions"}. Make sure you select the DZN Bot role in Discord channel permissions, not @everyone, then allow Send Messages and Embed Links. Channel or category overrides may still block the bot; add the DZN Bot role directly to the channel permissions or choose another channel.`}
                </span>
                <div className="rounded-lg border border-white/10 bg-black/24 p-2 text-[10px] font-bold leading-5 text-zinc-400">
                  <p className="font-black uppercase text-zinc-500">Selected channel debug</p>
                  <p>ID: <span className="text-zinc-200">{selectedChannelPermission.channelId}</span></p>
                  <p>Name: <span className="text-zinc-200">#{selectedChannelPermission.channelName}</span></p>
                  <p>can_post: <span className={selectedChannelPermission.canPost ? "text-emerald-200" : "text-amber-200"}>{String(selectedChannelPermission.canPost)}</span></p>
                  <p>missing_permissions: <span className="text-zinc-200">[{selectedChannelPermission.missingPermissions.join(", ")}]</span></p>
                </div>
                <button
                  type="button"
                  onClick={recheckSelectedChannel}
                  disabled={recheckingChannel || channelsLoading}
                  className="inline-flex w-fit items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <RefreshCw className={`h-3 w-3 ${recheckingChannel ? "animate-spin" : ""}`} />
                  {recheckingChannel ? "Rechecking..." : "Recheck Selected Channel"}
                </button>
              </div>
            ) : (
              <span className="text-[11px] font-bold text-zinc-500">DZN uses the guild selected during onboarding.</span>
            )}
          </div>

          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase text-zinc-400">Step 2: Choose Auto Posts</p>
              <p className="text-[11px] font-bold text-zinc-500">{selectedPostTypes.length} selected</p>
            </div>
            <div className="grid gap-3">
              {groupedOptions.map(([group, groupOptions]) => (
                <div key={group} className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                  <p className="text-[10px] font-black uppercase text-zinc-500">{group}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {groupOptions.map((option) => {
                      const selected = selectedPostTypes.includes(option.key);
                      return (
                        <button
                          key={option.key}
                          type="button"
                          disabled={!option.allowed_by_plan}
                          onClick={() => togglePostType(option.key)}
                          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-black uppercase transition ${selected ? "border-violet-200/50 bg-violet-400/20 text-violet-50" : option.allowed_by_plan ? "border-white/10 bg-black/30 text-zinc-200 hover:border-cyan-200/40 hover:text-cyan-50" : "cursor-not-allowed border-amber-300/15 bg-amber-400/5 text-amber-100/70"}`}
                        >
                          {selected ? <CircleCheck className="h-3 w-3" /> : null}
                          {option.label}
                          {!option.allowed_by_plan ? <span className="text-[9px] text-amber-200">{option.upgrade_label}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-start gap-2 lg:min-w-[190px]">
            <p className="text-[10px] font-black uppercase text-zinc-400">Step 3: Save</p>
            <button
              type="button"
              disabled={!canSave || saving}
              onClick={saveSetup}
              className="min-h-11 rounded-lg bg-violet-500 px-4 py-3 text-[10px] font-black uppercase text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {saving ? "Saving..." : "Save Auto Post Setup"}
            </button>
            {!canSave ? (
              <p className="text-[11px] font-bold leading-5 text-amber-200">
                Choose a channel and allowed posts. If bot mode cannot work, add a webhook fallback.
              </p>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
          className="mt-4 text-[10px] font-black uppercase text-cyan-200"
        >
          {advancedOpen ? "Hide" : "Show"} advanced manual setup
        </button>
        {showManualFallback ? (
          <div className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-black/24 p-3 md:grid-cols-2">
            <label className="grid gap-2 text-[10px] font-black uppercase text-zinc-400">
              Manual Channel ID
              <input
                value={manualChannelId}
                onChange={(event) => {
                  setManualChannelId(event.target.value);
                  setSelectedChannelId("");
                  setMessage("");
                }}
                placeholder="Only use this if DZN cannot fetch channels"
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs font-bold text-white outline-none focus:border-cyan-300/40"
              />
              <span className="text-[11px] font-bold normal-case text-zinc-500">Only use this if DZN cannot fetch your Discord channels automatically.</span>
            </label>
            <label className="grid gap-2 text-[10px] font-black uppercase text-zinc-400">
              Optional Webhook URL
              <input
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                placeholder="Only needed if the bot cannot post directly"
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs font-bold text-white outline-none focus:border-cyan-300/40"
              />
              <span className="text-[11px] font-bold normal-case text-zinc-500">Saved webhooks are hidden. Enter a new URL only to replace the fallback.</span>
            </label>
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-sm font-black uppercase text-white">Saved Auto Post Setups</p>
        <p className="text-[10px] font-black uppercase text-zinc-500">{setups.length} channels configured</p>
      </div>
      <div className="mt-3 grid gap-3">
        {setups.length ? setups.map((setup) => {
          const testType = testTypeByChannel[setup.channel_id] ?? setup.post_types.find((postType) => postType.enabled)?.key ?? setup.post_types[0]?.key ?? "";
          const channel = channelById.get(setup.channel_id) ?? null;
          const channelLabel = resolveSetupChannelLabel(setup, channelById);
          return (
            <div key={setup.channel_id} className="rounded-lg border border-white/10 bg-black/28 p-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(180px,0.7fr)_auto] lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/80 text-white">
                      <Bell className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{channelLabel}</p>
                      {channel?.category_name ? <p className="text-[11px] font-bold text-zinc-500">{channel.category_name}</p> : null}
                      <p className="text-[11px] font-bold text-zinc-500">ID: {setup.channel_id}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {setup.post_types.map((postType) => (
                      <span key={postType.key} className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${postType.allowed_by_plan ? "border-violet-300/20 bg-violet-400/10 text-violet-100" : "border-amber-300/25 bg-amber-400/10 text-amber-100"}`}>
                        {postType.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase ${postingModeClass(setup.posting_mode)}`}>{postingModeLabel(setup.posting_mode)}</span>
                    <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase ${setupStatusClass(setup.status)}`}>{setupStatusLabel(setup.status)}</span>
                  </div>
                  <p className="text-[11px] font-bold text-zinc-400">{setup.last_edited_at ? `Last updated ${formatRelativeTime(setup.last_edited_at)}` : "Waiting for first post"}</p>
                  {setup.missing_permissions.length ? (
                    <p className="text-[11px] font-bold leading-5 text-amber-200">
                      The bot is installed, but this channel blocks posting. Give DZN Bot permission to Send Messages and Embed Links in this channel, or choose another channel. Missing: {setup.missing_permissions.join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                  <select
                    value={testType}
                    onChange={(event) => setTestTypeByChannel((current) => ({ ...current, [setup.channel_id]: event.target.value }))}
                    className="rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-[10px] font-bold text-white outline-none"
                  >
                    {setup.post_types.map((postType) => (
                      <option key={postType.key} value={postType.key} className="bg-[#080b16] text-white">{postType.label}</option>
                    ))}
                  </select>
                  <button type="button" disabled={busyChannel === `${setup.channel_id}:test`} onClick={() => runSetupAction(setup, "test")} className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50 disabled:opacity-55">
                    {busyChannel === `${setup.channel_id}:test` ? "Testing..." : "Test"}
                  </button>
                  <button type="button" onClick={() => editSetup(setup)} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-100">Edit</button>
                  <button type="button" disabled={busyChannel === `${setup.channel_id}:disable`} onClick={() => runSetupAction(setup, "disable")} className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-[10px] font-black uppercase text-amber-50 disabled:opacity-55">Disable</button>
                  <button type="button" disabled={busyChannel === `${setup.channel_id}:delete`} onClick={() => runSetupAction(setup, "delete")} className="rounded-lg border border-red-300/25 bg-red-400/10 px-3 py-2 text-[10px] font-black uppercase text-red-50 disabled:opacity-55">Delete</button>
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="rounded-lg border border-dashed border-white/15 bg-black/20 px-4 py-5 text-sm font-bold text-zinc-400">
            No Discord auto-post setups yet. Choose a channel and select the embeds DZN should keep updated.
          </div>
        )}
      </div>
      <div className="mt-4 rounded-lg border border-violet-300/20 bg-violet-400/10 p-3">
        <p className="text-[10px] font-black uppercase text-violet-100">How Auto Posts Work</p>
        <div className="mt-2 grid gap-2 text-xs font-bold leading-5 text-zinc-300 md:grid-cols-3">
          <p>DZN posts the embed in the selected channel.</p>
          <p>DZN saves the Discord message ID for future updates.</p>
          <p>DZN edits the existing message when data changes. No spam.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDiagnosticsOpen((value) => !value)}
        className="mt-3 text-[10px] font-black uppercase text-zinc-400 hover:text-cyan-100"
      >
        {diagnosticsOpen ? "Hide" : "Show"} Channel Fetch Diagnostics
      </button>
      {diagnosticsOpen ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-bold text-zinc-300 sm:grid-cols-2 lg:grid-cols-4">
          <MiniInfo label="Selected Server ID" value={diagnostics?.selected_server_id ?? serverId} />
          <MiniInfo label="Selected Guild ID" value={diagnostics?.selected_guild_id ?? "Missing"} />
          <MiniInfo label="Guild Name" value={diagnostics?.guild_name ?? channelsResponse?.guild_name ?? "Unknown"} />
          <MiniInfo label="Bot Token Configured" value={diagnostics?.bot_token_configured ? "Yes" : "No"} />
          <MiniInfo label="Bot Connected" value={diagnostics?.bot_connected === true ? "Yes" : diagnostics?.bot_connected === false ? "No" : "Unknown"} />
          <MiniInfo label="Channels Fetched" value={String(diagnostics?.channels_fetched_count ?? channels.length)} />
          <MiniInfo label="Postable Channels" value={String(diagnostics?.postable_channels_count ?? channels.filter((channel) => channel.can_post).length)} />
          <MiniInfo label="Last Fetch Error" value={diagnostics?.last_fetch_error_code ?? "None"} />
          <MiniInfo label="Last Fetch Time" value={diagnostics?.last_fetch_time ? formatDashboardDate(diagnostics.last_fetch_time) : "Waiting"} />
          <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-2 sm:col-span-2 lg:col-span-4">
            <p className="text-[10px] font-black uppercase text-zinc-500">Last Fetch Message</p>
            <p className="mt-1 text-xs font-bold text-zinc-200">{diagnostics?.last_fetch_error_message ?? "Channel fetch is healthy."}</p>
          </div>
        </div>
      ) : null}
      {message ? <p className="mt-3 text-xs font-bold text-cyan-100">{message}</p> : null}
    </DashboardPanel>
  );
}

function AutomationHealthPanel({ health }: { health: AutomationHealth }) {
  const summary = getAutomationHealthSummary(health);
  return (
    <DashboardPanel className="p-4">
      <PanelHeader icon={<Activity className="h-5 w-5" />} title="Automation Health" />
      <p className="mt-3 text-xs leading-5 text-zinc-400">
        Backend cron state from the database. Cloudflare Worker Cron is the primary trigger; GitHub Actions is backup only.
      </p>
      <p className={`mt-3 rounded-lg border px-3 py-2 text-xs font-bold leading-5 ${summary.className}`}>
        {summary.message}
      </p>
      {health.migrationWarning ? (
        <p className="mt-2 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold leading-5 text-amber-100">
          {health.migrationWarningMessage ?? "Automation is running, but D1 migration history needs attention."}
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniInfo label="Last Metadata Run" value={health.last_metadata_sync_run ? formatDashboardDate(health.last_metadata_sync_run) : "Waiting"} />
        <MiniInfo label="Last ADM Run" value={health.last_adm_sync_run ? formatDashboardDate(health.last_adm_sync_run) : "Waiting"} />
        <MiniInfo label="Last Discord Dispatch" value={health.last_discord_dispatcher_run ? formatDashboardDate(health.last_discord_dispatcher_run) : "Waiting"} />
        <MiniInfo label="Last Cron Source" value={formatCronSource(health.last_cron_trigger_source)} />
        <MiniInfo label="Last Cron Trigger" value={health.last_cron_trigger_at ? formatDashboardDate(health.last_cron_trigger_at) : "Waiting"} />
        <MiniInfo label="Cloudflare Cron" value={health.latest_cloudflare_cron_run_at ? formatDashboardDate(health.latest_cloudflare_cron_run_at) : "Waiting"} />
        <MiniInfo label="GitHub Backup" value={health.latest_github_backup_cron_run_at ? formatDashboardDate(health.latest_github_backup_cron_run_at) : "Waiting"} />
        <MiniInfo label="Cron Table" value={health.automation_cron_runs_table_exists ? health.automation_cron_runs_migration_applied ? "Migration applied" : "Runtime-created" : "Missing"} />
        <MiniInfo label="Due Metadata Jobs" value={String(health.due_metadata_jobs)} />
        <MiniInfo label="Due ADM Jobs" value={String(health.due_adm_jobs)} />
        <MiniInfo label="Queued Discord Jobs" value={String(health.queued_discord_post_jobs)} />
        <MiniInfo label="Failed Jobs" value={String(health.failed_jobs)} />
        <MiniInfo label="Stuck Locks" value={`${health.stuck_currently_checking_status_locks + health.stuck_currently_syncing_adm_locks}`} />
      </div>
      <div className="mt-4 grid gap-2">
        <HealthCountLine label="Plans" counts={health.server_count_by_plan} />
        <HealthCountLine label="Subscriptions" counts={health.subscription_count_by_status} />
      </div>
    </DashboardPanel>
  );
}

function HealthCountLine({ label, counts }: { label: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-2">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-xs font-bold text-zinc-200">
        {entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(" | ") : "None"}
      </p>
    </div>
  );
}

function postingModeLabel(mode: string | null | undefined) {
  if (mode === "bot") return "BOT MODE";
  if (mode === "webhook") return "WEBHOOK FALLBACK";
  return "SETUP NEEDED";
}

function formatChannelLabel(channel: Pick<DiscordPostingChannel, "channel_name" | "category_name">) {
  return channel.category_name ? `${channel.category_name} / #${channel.channel_name}` : `#${channel.channel_name}`;
}

function resolveSetupChannelLabel(setup: PostingChannelSetup, channelById: Map<string, DiscordPostingChannel>) {
  const channel = channelById.get(setup.channel_id);
  if (channel) return formatChannelLabel(channel);
  if (setup.channel_name && setup.channel_name !== "Unknown channel" && setup.channel_name !== setup.channel_id) {
    return setup.channel_label || `#${setup.channel_name}`;
  }
  return "Unknown channel";
}

function postingModeClass(mode: string | null | undefined) {
  if (mode === "bot") return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  if (mode === "webhook") return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
  return "border-amber-300/30 bg-amber-400/10 text-amber-100";
}

function setupStatusLabel(status: string | null | undefined) {
  if (status === "active") return "Active";
  if (status === "disabled") return "Disabled";
  if (status === "locked_by_plan") return "Locked by plan";
  if (status === "missing_permissions") return "Missing permissions";
  return "Setup needed";
}

function setupStatusClass(status: string | null | undefined) {
  if (status === "active") return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  if (status === "disabled") return "border-zinc-300/20 bg-zinc-400/10 text-zinc-200";
  if (status === "locked_by_plan" || status === "missing_permissions") return "border-amber-300/30 bg-amber-400/10 text-amber-100";
  return "border-red-300/30 bg-red-400/10 text-red-100";
}

function groupPostingOptions(options: PostingOptionSummary[]) {
  const groups = new Map<string, PostingOptionSummary[]>();
  for (const option of options) {
    const group = groups.get(option.group) ?? [];
    group.push(option);
    groups.set(option.group, group);
  }
  return [...groups.entries()];
}

function fallbackPostingOptions(): PostingOptionSummary[] {
  return [
    ["basic_status_embed", "Basic Server Status", "Basic", "starter", "Upgrade to DZN Starter"],
    ["leaderboard_embed", "Leaderboards", "Stats", "pro", "Upgrade to DZN Pro"],
    ["daily_summary_embed", "Daily Summary", "Stats", "pro", "Upgrade to DZN Pro"],
    ["event_leaderboard_embed", "Event Leaderboard", "Events", "network", "Upgrade to DZN Network"],
    ["server_vs_server_embed", "Server-vs-Server Progress", "Events", "network", "Upgrade to DZN Network"],
    ["network_ranking_embed", "Network Ranking", "Events", "network", "Upgrade to DZN Network"],
    ["killfeed_embed", "Killfeed", "Feeds", "partner", "Upgrade to DZN Partner"],
    ["pve_feed_embed", "PvE Feed", "Feeds", "partner", "Upgrade to DZN Partner"],
    ["hit_feed_embed", "Hit Feed", "Feeds", "partner", "Upgrade to DZN Partner"],
    ["connection_feed_embed", "Connection Feed", "Feeds", "partner", "Upgrade to DZN Partner"],
    ["build_feed_embed", "Build Feed", "Feeds", "partner", "Upgrade to DZN Partner"],
    ["admin_alerts_embed", "Admin Alerts", "Admin", "partner", "Upgrade to DZN Partner"],
    ["admin_logs_embed", "Admin Logs", "Admin", "partner", "Upgrade to DZN Partner"],
    ["partner_featured_embed", "Partner Featured Post", "Partner", "partner", "Upgrade to DZN Partner"],
    ["priority_status_embed", "Priority Status Post", "Partner", "partner", "Upgrade to DZN Partner"],
  ].map(([key, label, group, minPlan, upgrade]) => ({
    key,
    label,
    group,
    min_plan_key: minPlan,
    upgrade_label: upgrade,
    allowed_by_plan: false,
  }));
}

function formatPostingError(message: string, missingPermissions?: string[]) {
  if (!missingPermissions?.length) return message;
  return `${message} Missing: ${missingPermissions.join(", ")}.`;
}

function formatCronSource(value: string | null | undefined) {
  if (value === "cloudflare") return "Cloudflare";
  if (value === "github-backup") return "GitHub backup";
  if (value === "manual") return "Manual";
  if (value === "unknown") return "Unknown";
  return "Waiting";
}

function getAutomationHealthSummary(health: AutomationHealth) {
  const latestCronAgeMs = health.last_cron_trigger_at ? Date.now() - Date.parse(health.last_cron_trigger_at) : Number.POSITIVE_INFINITY;
  const cloudflareAgeMs = health.latest_cloudflare_cron_run_at ? Date.now() - Date.parse(health.latest_cloudflare_cron_run_at) : Number.POSITIVE_INFINITY;
  const githubAgeMs = health.latest_github_backup_cron_run_at ? Date.now() - Date.parse(health.latest_github_backup_cron_run_at) : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(latestCronAgeMs) || latestCronAgeMs > 10 * 60 * 1000) {
    return {
      message: "No recent automation cron check-in detected.",
      className: "border-orange-300/20 bg-orange-400/10 text-orange-50",
    };
  }

  if (Number.isFinite(cloudflareAgeMs) && cloudflareAgeMs <= 3 * 60 * 1000) {
    return {
      message: "Cloudflare Worker Cron is active. Automation is running.",
      className: "border-emerald-300/20 bg-emerald-400/10 text-emerald-50",
    };
  }

  if (Number.isFinite(githubAgeMs) && githubAgeMs <= 10 * 60 * 1000) {
    return {
      message: "GitHub backup cron is running, but Cloudflare 1-minute cron has not checked in recently.",
      className: "border-amber-300/20 bg-amber-400/10 text-amber-50",
    };
  }

  return {
    message: "Automation is running, but Cloudflare Worker Cron has not checked in recently.",
    className: "border-amber-300/20 bg-amber-400/10 text-amber-50",
  };
}

function DashboardPublicReviewsSummary({ slug }: { slug: string }) {
  const [summary, setSummary] = useState<DashboardReviewSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/public/server-reviews?slug=${encodeURIComponent(slug)}`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!controller.signal.aborted) setSummary(payload as DashboardReviewSummary | null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSummary(null);
      });
    return () => controller.abort();
  }, [slug]);

  return (
    <DashboardPanel className="p-4">
      <PanelHeader icon={<Bell className="h-5 w-5" />} title="Public Reviews" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniInfo label="Average Rating" value={summary ? summary.average_rating.toFixed(1) : "Loading"} />
        <MiniInfo label="Review Count" value={String(summary?.review_count ?? 0)} />
      </div>
      <div className="mt-4 grid gap-2">
        {summary?.reviews?.slice(0, 3).map((review) => (
          <div key={review.id} className="rounded-lg border border-white/10 bg-black/24 p-3">
            <p className="text-xs font-black text-white">{review.title || `${review.rating}/5 review`}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">{review.body}</p>
          </div>
        ))}
        {summary && summary.reviews.length === 0 ? <p className="text-sm text-zinc-400">No public reviews yet.</p> : null}
      </div>
      <ActionLink href={publicServerProfileHref(slug)} icon={<ExternalLink className="h-4 w-4" />} label="View Public Page" tone="emerald" />
    </DashboardPanel>
  );
}

function PublicListingEditor({ server, onSaved }: { server: LinkedServer; onSaved: (listing: Partial<LinkedServer>) => void }) {
  const [form, setForm] = useState(() => publicListingFormFromServer(server));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function saveListing() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const result = await updateServerPublicListing(server.id, form);
      onSaved(result.listing);
      setForm((current) => ({ ...current, ...listingFormFromPartial(result.listing) }));
      setMessage("Public listing updated.");
    } catch {
      setError("Could not update listing. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const update = (field: keyof PublicListingForm, value: string) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <DashboardPanel className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <PanelHeader icon={<Settings className="h-5 w-5" />} title="Public Listing & Discord" />
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Update how your server appears on its public DZN profile.
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={saveListing}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white shadow-[0_0_24px_rgba(139,92,246,0.32)] transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Public Listing"}
        </button>
      </div>
      <div className="mt-5 grid gap-4">
        <DashboardListingInput label="Server Tagline" value={form.public_short_description} maxLength={160} placeholder="High-action PvP server with events, traders, factions, and weekend raids." onChange={(value) => update("public_short_description", value)} />
        <DashboardListingTextarea label="Full Description" value={form.public_description} maxLength={1500} rows={4} placeholder="Tell players what makes your community worth joining." onChange={(value) => update("public_description", value)} />
        <div className="grid gap-4 md:grid-cols-2">
          <DashboardListingInput label="Discord Invite Link" value={form.public_discord_invite} maxLength={200} placeholder="https://discord.gg/yourinvite" onChange={(value) => update("public_discord_invite", value)} />
          <DashboardListingInput label="Website / Rules Link (optional)" value={form.public_website_url} maxLength={300} placeholder="https://your-server-rules.com" onChange={(value) => update("public_website_url", value)} />
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
          <DashboardListingTextarea label="Server Rules / Notes (optional)" value={form.public_rules} maxLength={1000} rows={4} placeholder="Raid weekends Friday-Sunday. No cheating/exploits. Respect event rules." onChange={(value) => update("public_rules", value)} />
          <div className="grid content-start gap-4">
            <DashboardListingInput label="Language (optional)" value={form.public_language} maxLength={40} placeholder="English" onChange={(value) => update("public_language", value)} />
            <DashboardListingInput label="Region (optional)" value={form.public_region_label} maxLength={80} placeholder="UK / EU" onChange={(value) => update("public_region_label", value)} />
          </div>
        </div>
      </div>
      {message ? <p className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-3 text-sm font-bold text-emerald-50">{message}</p> : null}
      {error ? <p className="mt-4 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-3 text-sm font-bold text-red-50">{error}</p> : null}
    </DashboardPanel>
  );
}

function DashboardListingInput({ label, value, maxLength, placeholder, onChange }: { label: string; value: string; maxLength: number; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">
        {label}
        <span className={value.length > maxLength ? "text-red-200" : "text-zinc-500"}>{value.length} / {maxLength}</span>
      </span>
      <input
        value={value}
        maxLength={maxLength + 40}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-black/28 px-3 text-sm font-bold text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/45 focus:bg-cyan-300/[0.04]"
      />
    </label>
  );
}

function DashboardListingTextarea({ label, value, maxLength, placeholder, rows, onChange }: { label: string; value: string; maxLength: number; placeholder: string; rows: number; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">
        {label}
        <span className={value.length > maxLength ? "text-red-200" : "text-zinc-500"}>{value.length} / {maxLength}</span>
      </span>
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength + 100}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-black/28 px-3 py-3 text-sm font-bold leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-violet-300/45 focus:bg-violet-300/[0.04]"
      />
    </label>
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
    buildEventsStored: lastSyncResult?.buildEventsStored ?? 0,
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
          <MiniInfo label="Build Events Stored" value={String(values.buildEventsStored)} />
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

function metadataPatchFromRefreshResult(result: Awaited<ReturnType<typeof refreshServerMetadata>>): Partial<LinkedServer> {
  const metadata = result.metadata ?? {};
  const patch: Partial<LinkedServer> = {
    metadata_last_checked_at: stringOrNull(result.metadata_last_checked_at ?? metadata.metadata_last_checked_at) ?? new Date().toISOString(),
  };
  const nextChangedAt = stringOrNull(result.metadata_last_changed_at ?? metadata.metadata_last_changed_at);

  if (result.metadata_last_changed_at !== undefined || "metadata_last_changed_at" in metadata) patch.metadata_last_changed_at = nextChangedAt;
  if ("display_name" in metadata) patch.display_name = stringOrNull(metadata.display_name);
  if ("hostname" in metadata) patch.hostname = stringOrNull(metadata.hostname);
  if ("current_players" in metadata) patch.current_players = numberOrNull(metadata.current_players);
  if ("max_players" in metadata) patch.max_players = numberOrNull(metadata.max_players);
  if (result.player_count_last_checked_at !== undefined || "player_count_last_checked_at" in metadata) {
    patch.player_count_last_checked_at = stringOrNull(result.player_count_last_checked_at ?? metadata.player_count_last_checked_at);
  }
  if (result.player_count_source !== undefined || "player_count_source" in metadata) {
    patch.player_count_source = stringOrNull(result.player_count_source ?? metadata.player_count_source);
  }
  if (result.player_count_status !== undefined || "player_count_status" in metadata) {
    patch.player_count_status = stringOrNull(result.player_count_status ?? metadata.player_count_status);
  }
  if ("server_mode" in metadata) patch.server_mode = stringOrNull(metadata.server_mode);
  if ("server_mode_source" in metadata) patch.server_mode_source = stringOrNull(metadata.server_mode_source);
  if ("server_status" in metadata) patch.server_status = stringOrNull(metadata.server_status);
  if ("game" in metadata) patch.game = stringOrNull(metadata.game);
  if ("platform" in metadata) patch.platform = stringOrNull(metadata.platform);
  if ("map_name" in metadata) patch.map_name = stringOrNull(metadata.map_name);
  if ("mission" in metadata) patch.mission = stringOrNull(metadata.mission);
  if ("is_online" in metadata) patch.is_online = booleanNumberOrNull(metadata.is_online);

  return patch;
}

function formatRelativeTime(value: string) {
  const date = new Date(value);
  const deltaMs = Date.now() - date.getTime();
  if (Number.isNaN(deltaMs)) return value;
  if (Math.abs(deltaMs) < 60_000) return "just now";
  const minutes = Math.round(Math.abs(deltaMs) / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function planLabel(value: string) {
  if (value === "starter") return "Starter";
  if (value === "pro") return "Pro";
  if (value === "network") return "Network";
  if (value === "partner") return "Partner";
  return "Free";
}

function billingRenewalLabel(billing: BillingStatus | null) {
  if (!billing) return "Loading";
  return billing.current_period_end_label || (billing.current_period_end ? formatDashboardDate(billing.current_period_end) : "Awaiting Stripe update");
}

function fallbackBillingPlan(plan: typeof billingPlans[number]): BillingPlanSummary {
  const base = {
    starter: {
      max_linked_servers: 1,
      included_bumps_per_month: 0,
      bump_cooldown_hours: 999,
      stat_history_days: 30,
      can_use_ad_bumps: false,
      can_use_advanced_analytics: false,
      can_join_events: false,
      can_use_featured_slots: false,
      monthly_price_gbp: 4.99,
      server_status_interval_minutes: 7,
      adm_pull_interval_minutes: 60,
      manual_adm_refresh_cooldown_minutes: 60,
      priority_level: 1,
      allowed_auto_posts: ["basic_status_embed"],
    },
    pro: {
      max_linked_servers: 3,
      included_bumps_per_month: 3,
      bump_cooldown_hours: 24,
      stat_history_days: 90,
      can_use_ad_bumps: true,
      can_use_advanced_analytics: true,
      can_join_events: true,
      can_use_featured_slots: false,
      monthly_price_gbp: 9.99,
      server_status_interval_minutes: 5,
      adm_pull_interval_minutes: 30,
      manual_adm_refresh_cooldown_minutes: 30,
      priority_level: 2,
      allowed_auto_posts: ["basic_status_embed", "leaderboard_embed", "daily_summary_embed"],
    },
    network: {
      max_linked_servers: 10,
      included_bumps_per_month: 10,
      bump_cooldown_hours: 12,
      stat_history_days: 180,
      can_use_ad_bumps: true,
      can_use_advanced_analytics: true,
      can_join_events: true,
      can_use_featured_slots: true,
      monthly_price_gbp: 19.99,
      server_status_interval_minutes: 3,
      adm_pull_interval_minutes: 15,
      manual_adm_refresh_cooldown_minutes: 15,
      priority_level: 3,
      allowed_auto_posts: ["basic_status_embed", "leaderboard_embed", "daily_summary_embed", "event_leaderboard_embed", "network_ranking_embed", "server_vs_server_embed"],
    },
    partner: {
      max_linked_servers: 25,
      included_bumps_per_month: 30,
      bump_cooldown_hours: 6,
      stat_history_days: 365,
      can_use_ad_bumps: true,
      can_use_advanced_analytics: true,
      can_join_events: true,
      can_use_featured_slots: true,
      monthly_price_gbp: 29.99,
      server_status_interval_minutes: 1,
      adm_pull_interval_minutes: 10,
      manual_adm_refresh_cooldown_minutes: 10,
      priority_level: 4,
      allowed_auto_posts: ["basic_status_embed", "leaderboard_embed", "daily_summary_embed", "event_leaderboard_embed", "network_ranking_embed", "server_vs_server_embed", "killfeed_embed", "pve_feed_embed", "hit_feed_embed", "connection_feed_embed", "build_feed_embed", "admin_alerts_embed", "admin_logs_embed", "partner_featured_embed", "priority_status_embed"],
    },
  }[plan.key];

  return {
    plan_key: plan.key,
    name: `DZN ${plan.label}`,
    price_label: plan.price,
    monthly_price_gbp: base.monthly_price_gbp,
    configured: false,
    features: [plan.detail],
    max_linked_servers: base.max_linked_servers,
    can_use_reviews: true,
    can_use_public_listing: true,
    can_use_advanced_analytics: base.can_use_advanced_analytics,
    can_join_events: base.can_join_events,
    can_use_ad_bumps: base.can_use_ad_bumps,
    included_bumps_per_month: base.included_bumps_per_month,
    bump_cooldown_hours: base.bump_cooldown_hours,
    can_use_featured_slots: base.can_use_featured_slots,
    stat_history_days: base.stat_history_days,
    server_status_interval_minutes: base.server_status_interval_minutes,
    adm_pull_interval_minutes: base.adm_pull_interval_minutes,
    manual_adm_refresh_cooldown_minutes: base.manual_adm_refresh_cooldown_minutes,
    allowed_auto_posts: base.allowed_auto_posts,
    priority_level: base.priority_level,
  };
}

function nextBumpLabel(advertising: AdvertisingBumpStatus | null) {
  if (!advertising?.last_bumped_at) return "Now";
  const last = new Date(advertising.last_bumped_at);
  if (Number.isNaN(last.getTime())) return "Now";
  const next = last.getTime() + advertising.bump_cooldown_hours * 60 * 60 * 1000;
  if (next <= Date.now()) return "Now";
  const hours = Math.ceil((next - Date.now()) / (60 * 60 * 1000));
  return `In ${hours}h`;
}

function shouldRefreshServerInfo(value: string | null | undefined) {
  if (!value) return true;
  const checkedAt = Date.parse(value);
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt > 2 * 60 * 1000;
}

function formatDashboardPlayerSlots(
  current: number | null | undefined,
  max: number | null | undefined,
  checkedAt: string | null | undefined,
  status: string | null | undefined,
) {
  const fraction = formatPlayerSlots(current, max);
  return isLivePlayerCountFresh(checkedAt, status) ? fraction : `Last known: ${fraction}`;
}

function formatPlayerCountFreshnessDetail(
  current: number | null | undefined,
  max: number | null | undefined,
  checkedAt: string | null | undefined,
  status: string | null | undefined,
) {
  const fraction = formatPlayerSlots(current, max);
  const age = checkedAt ? formatRelativeTime(checkedAt) : "not checked yet";
  if (isLivePlayerCountFresh(checkedAt, status)) return `${fraction} confirmed from Nitrado ${age}`;
  if (isLivePlayerCountWarning(checkedAt, status)) return `Live player count stale. Last known: ${fraction}. Last checked ${age}.`;
  return `Player count stale - Nitrado metadata not refreshed for ${age}. Last known: ${fraction}.`;
}

function isLivePlayerCountFresh(checkedAt: string | null | undefined, status: string | null | undefined) {
  if (status !== "fresh" || !checkedAt) return false;
  const checkedTime = Date.parse(checkedAt);
  return Number.isFinite(checkedTime) && Date.now() - checkedTime <= 10 * 60 * 1000;
}

function isLivePlayerCountWarning(checkedAt: string | null | undefined, status: string | null | undefined) {
  if (status === "unavailable") return true;
  if (!checkedAt) return true;
  const checkedTime = Date.parse(checkedAt);
  return !Number.isFinite(checkedTime) || Date.now() - checkedTime > 30 * 60 * 1000;
}

function formatPlayerSlots(current: number | null | undefined, max: number | null | undefined) {
  const currentValue = typeof current === "number" && Number.isFinite(current) ? current : null;
  const maxValue = typeof max === "number" && Number.isFinite(max) ? max : null;
  if (currentValue !== null && maxValue !== null) return `${currentValue} / ${maxValue}`;
  if (maxValue !== null) return String(maxValue);
  return "Unknown";
}

function formatNitradoServerStatus(status: string | null | undefined, online: boolean | number | null | undefined) {
  if (typeof status === "string" && status.trim()) return status.trim();
  if (online === true || online === 1) return "Online";
  if (online === false || online === 0) return "Offline";
  return "Unknown";
}

function formatPlayerCountStatus(value: string | null | undefined) {
  if (value === "fresh") return "Fresh";
  if (value === "stale") return "Stale";
  if (value === "unavailable") return "Unavailable";
  return "Unknown";
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function booleanNumberOrNull(value: unknown) {
  return typeof value === "boolean" || value === 0 || value === 1 ? value : null;
}

function publicListingFormFromServer(server: LinkedServer): PublicListingForm {
  return {
    public_short_description: server.public_short_description ?? "",
    public_description: server.public_description ?? "",
    public_discord_invite: server.public_discord_invite ?? "",
    public_website_url: server.public_website_url ?? "",
    public_rules: server.public_rules ?? "",
    public_language: server.public_language ?? "",
    public_region_label: server.public_region_label ?? "",
  };
}

function listingFormFromPartial(listing: Partial<LinkedServer>): Partial<PublicListingForm> {
  return {
    public_short_description: listing.public_short_description ?? "",
    public_description: listing.public_description ?? "",
    public_discord_invite: listing.public_discord_invite ?? "",
    public_website_url: listing.public_website_url ?? "",
    public_rules: listing.public_rules ?? "",
    public_language: listing.public_language ?? "",
    public_region_label: listing.public_region_label ?? "",
  };
}

function getManualSyncMessage(result: AdmSyncRunResult) {
  if (result.status === "no_new_lines") {
    return "Latest ADM checked just now. No new ADM lines since last sync.";
  }
  if (result.status === "no_supported_events") {
    return "Latest ADM checked just now. No supported ADM events found.";
  }
  if (result.status === "adm_not_generated_yet" || result.status === "no_adm_file") {
    return "Sync checked Nitrado. Waiting for the next ADM file.";
  }
  if (result.status === "adm_file_unreadable") {
    return "Latest ADM file found, but Nitrado did not return readable log content during this sync.";
  }
  if (["nitrado_down", "nitrado_auth_invalid", "nitrado_rate_limited", "dzn_parser_error", "dzn_write_error", "dzn_scope_blocked", "nitrado_error", "parser_error", "write_error"].includes(result.status)) {
    return result.message || "ADM sync needs attention.";
  }
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

function normalizeDashboardSyncStatus(status: string, latestAdmFile: string) {
  if (status === "no_adm_file" && latestAdmFile && latestAdmFile !== "Not detected") {
    return "adm_file_unreadable";
  }
  return status;
}

function publicServerProfileHref(slug: string) {
  return `/servers/profile?slug=${encodeURIComponent(slug)}`;
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

function getDashboardSyncStatusBanner(
  syncBanner: ReturnType<typeof getSyncBanner>,
  syncHealth: ReturnType<typeof getSyncHealth>,
  currentStatus: string,
) {
  const normalizedStatus = currentStatus.toLowerCase();
  const useStatusBanner =
    syncHealth.status === "error" ||
    syncHealth.status === "pending" ||
    ["no_new_lines", "no_supported_events"].includes(normalizedStatus);

  if (!useStatusBanner) {
    return {
      ...syncBanner,
      iconClassName: "text-cyan-100",
    };
  }

  return {
    title: syncHealth.title,
    message: syncHealth.message,
    detail: syncHealth.detail,
    className: syncHealth.status === "error"
      ? "border-orange-300/25 bg-orange-400/10"
      : syncHealth.status === "pending"
        ? "border-orange-300/20 bg-orange-400/10"
        : "border-cyan-300/20 bg-cyan-400/10",
    iconClassName: syncHealth.status === "error" || syncHealth.status === "pending" ? "text-orange-100" : "text-cyan-100",
  };
}

function getLatestAdmReadableLabel(currentStatus: string) {
  const normalizedStatus = currentStatus.toLowerCase();
  if (["adm_file_unreadable", "nitrado_file_unavailable"].includes(normalizedStatus)) return "Temporarily unavailable";
  if (normalizedStatus === "adm_not_generated_yet" || normalizedStatus === "no_adm_file") return "No ADM file found";
  if (["completed", "no_new_lines", "no_supported_events"].includes(normalizedStatus)) return "Yes";
  if (normalizedStatus === "read_pending") return "Waiting for readable content";
  return "Unknown";
}

function getRecentFeedBadge(recentEventsAreMock: boolean, currentStatus: string): { label: string; tone: "emerald" | "orange" | "zinc" } {
  if (recentEventsAreMock) return { label: "Mock Sync Data", tone: "orange" };
  const normalizedStatus = currentStatus.toLowerCase();
  if (["adm_file_unreadable", "nitrado_file_unavailable", "adm_not_generated_yet", "no_adm_file", "nitrado_down", "nitrado_auth_invalid", "nitrado_rate_limited", "dzn_parser_error", "dzn_write_error", "dzn_scope_blocked", "nitrado_error", "parser_error", "write_error"].includes(normalizedStatus)) {
    return { label: "Feed Check Issue", tone: "orange" };
  }
  if (["no_new_lines", "no_supported_events"].includes(normalizedStatus)) return { label: "Feed Checked", tone: "zinc" };
  return { label: "Live Feed Active", tone: "emerald" };
}

function getRecentFeedStatus(syncStatus: AdmSyncStatus | null, currentStatus: string, recentEventCount: number) {
  const normalizedStatus = currentStatus.toLowerCase();
  const lastChecked = syncStatus?.last_sync_at ? formatRelativeTime(syncStatus.last_sync_at) : "not checked yet";
  const lastSuccessful = syncStatus?.last_successful_sync_at ? formatRelativeTime(syncStatus.last_successful_sync_at) : null;

  if (normalizedStatus === "no_new_lines") {
    return {
      message: `Feed checked ${lastChecked}. No new ADM lines.`,
      className: "border-cyan-300/15 bg-cyan-400/8 text-cyan-50",
    };
  }

  if (normalizedStatus === "no_supported_events") {
    return {
      message: `Feed checked ${lastChecked}. No supported player activity found in the latest lines.`,
      className: "border-cyan-300/15 bg-cyan-400/8 text-cyan-50",
    };
  }

  if (["adm_file_unreadable", "nitrado_file_unavailable"].includes(normalizedStatus)) {
    return {
      message: `Feed last updated ${lastSuccessful ?? "previously"}. Latest ADM file was temporarily unavailable from Nitrado.`,
      className: "border-orange-300/20 bg-orange-400/10 text-orange-50",
    };
  }

  if (normalizedStatus === "adm_not_generated_yet" || normalizedStatus === "no_adm_file") {
    return {
      message: "Waiting for next ADM file from Nitrado. Existing feed data remains preserved.",
      className: "border-orange-300/20 bg-orange-400/10 text-orange-50",
    };
  }

  if (["nitrado_down", "nitrado_auth_invalid", "nitrado_rate_limited", "dzn_parser_error", "dzn_write_error", "dzn_scope_blocked", "nitrado_error", "parser_error", "write_error", "error", "failed"].includes(normalizedStatus)) {
    return {
      message: `Feed last updated ${lastSuccessful ?? "previously"}. Latest ADM sync needs attention.`,
      className: "border-orange-300/20 bg-orange-400/10 text-orange-50",
    };
  }

  if (normalizedStatus === "completed" && recentEventCount <= 0) {
    return {
      message: "ADM sync completed, but no recent player events are available yet.",
      className: "border-white/10 bg-white/[0.04] text-zinc-300",
    };
  }

  return null;
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
  const normalizedStatus = currentStatus.toLowerCase();

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

  if (["nitrado_down", "nitrado_auth_invalid", "nitrado_rate_limited", "dzn_parser_error", "dzn_write_error", "dzn_scope_blocked", "nitrado_error", "parser_error", "write_error", "error", "failed"].includes(normalizedStatus)) {
    return {
      status: "error" as const,
      title: ["nitrado_down", "nitrado_rate_limited", "nitrado_error"].includes(normalizedStatus) ? "Nitrado Log Access Failed" : normalizedStatus === "nitrado_auth_invalid" ? "Nitrado Token/Service Issue" : "Sync Needs Attention",
      message: ["dzn_write_error", "write_error"].includes(normalizedStatus) ? "ADM write failed." : normalizedStatus === "dzn_parser_error" ? "DZN found kill lines but could not parse them." : "Latest sync run needs attention.",
      detail: currentMessage || "Review the latest sync run.",
      nextAction: ["nitrado_down", "nitrado_rate_limited", "nitrado_error"].includes(normalizedStatus) ? "DZN will retry automatically" : normalizedStatus === "nitrado_auth_invalid" ? "Reconnect Nitrado token" : "Review latest sync error",
      latestSuccessTime,
    };
  }

  if (normalizedStatus === "adm_file_unreadable") {
    return {
      status: "pending" as const,
      title: "ADM File Temporarily Unavailable",
      message: "ADM sync checked Nitrado, but the latest ADM file was not readable this time.",
      detail: latestSuccessTime
        ? `The last successful feed sync remains active from ${formatDashboardDate(latestSuccessTime)}.`
        : "The last successful feed sync remains active when available.",
      nextAction: "Wait for the next ADM sync run",
      latestSuccessTime,
    };
  }

  if (normalizedStatus === "adm_not_generated_yet" || normalizedStatus === "no_adm_file") {
    return {
      status: "pending" as const,
      title: "Waiting For ADM File",
      message: "Sync checked Nitrado. No ADM file is available yet.",
      detail: "DZN will process activity when Nitrado exposes the next ADM log file.",
      nextAction: "Waiting for next ADM file",
      latestSuccessTime,
    };
  }

  if (normalizedStatus === "read_pending") {
    return {
      status: "pending" as const,
      title: "Latest ADM Discovered",
      message: "Latest ADM discovered. Waiting for readable log content.",
      detail: "Refresh Server Info only updates metadata. ADM stats update during manual or scheduled ADM sync runs.",
      nextAction: "Waiting for ADM sync runner",
      latestSuccessTime,
    };
  }

  if (normalizedStatus === "no_new_lines") {
    return {
      status: "active" as const,
      title: "Sync Checked",
      message: "ADM sync checked successfully. No new ADM lines since the last sync.",
      detail: "The latest readable ADM file was checked and the previous feed remains current.",
      nextAction: "Continue syncing after fresh ADM activity",
      latestSuccessTime,
    };
  }

  if (normalizedStatus === "no_supported_events") {
    return {
      status: "active" as const,
      title: "Sync Checked",
      message: "ADM sync checked successfully. No supported player activity found in the latest lines.",
      detail: "DZN found readable ADM lines, but none matched supported activity, kill, or build patterns.",
      nextAction: "Continue syncing after fresh ADM activity",
      latestSuccessTime,
    };
  }

  return {
    status: "active" as const,
    title: "ADM Sync Active",
    message: "ADM Sync Active - DZN is reading your server logs and updating player activity.",
    detail: "Player activity, kills, deaths and more update after each successful ADM log check.",
    nextAction: "Continue syncing after fresh ADM activity",
    latestSuccessTime,
  };
}

function getProcessedPercent(syncStatus: AdmSyncStatus | null) {
  if (syncStatus?.last_sync_status === "no_new_lines") return 100;
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
  return ["completed", "idle", "no_new_lines", "no_supported_events"].includes(run.status.toLowerCase());
}

function isFailedRun(run: AdmSyncStatus["recent_sync_runs"][number]) {
  return ["error", "failed", "nitrado_down", "nitrado_auth_invalid", "nitrado_rate_limited", "dzn_parser_error", "dzn_write_error", "dzn_scope_blocked", "nitrado_error", "parser_error", "write_error"].includes(run.status.toLowerCase());
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

function formatPostType(value: string) {
  return value
    .replace(/_embed$/, "")
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
  if (value === "no_new_lines") return "No New Lines";
  if (value === "no_supported_events") return "No Supported Events";
  if (value === "adm_not_generated_yet" || value === "no_adm_file") return "Waiting For ADM File";
  if (value === "adm_file_unreadable") return "ADM File Temporarily Unavailable";
  if (value === "nitrado_down") return "Nitrado Unavailable";
  if (value === "nitrado_auth_invalid") return "Token/Service Issue";
  if (value === "nitrado_rate_limited") return "Nitrado Rate Limited";
  if (value === "dzn_parser_error") return "Parser Attention Needed";
  if (value === "dzn_write_error") return "Write Error";
  if (value === "dzn_scope_blocked") return "Scope Blocked";
  if (value === "nitrado_error") return "Nitrado Error";
  if (value === "parser_error") return "Parser Error";
  if (value === "write_error") return "Write Error";
  if (value === "active") return "Active";
  if (value === "not_started") return "Not Started";
  return value.replace(/_/g, " ");
}

function formatSyncTrigger(value: string | null | undefined) {
  if (value === "manual") return "Manual";
  if (value === "scheduled") return "Scheduled";
  return "Not recorded";
}

function formatGlobalRank(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? `#${value}` : "Pending";
}

function scoreBreakdownTitle(breakdown: LinkedServer["score_breakdown"]) {
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
