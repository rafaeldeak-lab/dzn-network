"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, DatabaseZap, LogOut, RefreshCw, Server, ShieldCheck, Wrench } from "lucide-react";
import Link from "next/link";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { clearMockTestSyncData, getMe, getRecentSyncEvents, getSyncStatus, logout, runLogAccessDiagnostics, runManualSync, testOnboarding } from "./api";
import type { AdmRecentSyncEvent, AdmSyncRunResult, AdmSyncStatus, AuthResponse, LinkedServer, NitradoLogAccessDiagnostics } from "./types";

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
    <DashboardFrame onLogout={signOut}>
      <div className="mb-8">
        <p className="text-xs font-black uppercase text-violet-200/70">DZN owner console</p>
        <h1 className="mt-2 text-4xl font-black uppercase text-white">Dashboard</h1>
      </div>
      {server ? <ServerDashboard server={server} onRefresh={async () => setAuth(await getMe())} /> : <EmptyDashboard />}
    </DashboardFrame>
  );
}

function DashboardFrame({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-5 py-8 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(139,92,246,0.26),transparent_30%),radial-gradient(circle_at_78%_18%,rgba(14,165,233,0.14),transparent_28%),linear-gradient(180deg,#02030a_0%,#07101f_52%,#02030a_100%)]" />
      <div className="scanline absolute inset-0 opacity-20" />
      <div className="relative z-10 mx-auto max-w-7xl">
        <nav className="mb-8 flex items-center justify-between">
          <DznLogo />
          <div className="flex items-center gap-3">
            <Link href="/servers" className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 sm:inline-flex">
              Servers
            </Link>
            <Link href="/signup" className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 md:inline-flex">
              Add Your Server
            </Link>
            <Link href="/setup" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200">
              Setup
            </Link>
            {onLogout ? (
              <button type="button" onClick={onLogout} className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200">
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
  const [actionMessage, setActionMessage] = useState("");
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
  const admFolder = getFolderFromPath(server.adm_path);
  const syncHasProcessedLines = (syncStatus?.last_processed_line ?? 0) > 0 && syncStatus?.last_sync_status !== "read_pending";
  const statsSyncActive = syncHasProcessedLines || admState.kind === "connected";
  const statsSyncPending = !statsSyncActive && admState.kind === "discovered_read_pending";
  const statsSyncLabel = statsSyncActive ? "Stats Sync Active" : statsSyncPending ? "Stats Sync Pending" : "Stats Sync Not Started";
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

  useEffect(() => {
    let active = true;
    Promise.all([getSyncStatus(server.id), getRecentSyncEvents(server.id)])
      .then(([statusResult, eventsResult]) => {
        if (!active) return;
        setSyncStatus(statusResult.status);
        setRecentEvents(eventsResult.events);
      })
      .catch(() => {
        if (!active) return;
        setSyncStatus(null);
        setRecentEvents([]);
      });
    return () => {
      active = false;
    };
  }, [server.id]);

  async function rerunLogCheck() {
    setCheckingLogs(true);
    setActionMessage("");
    try {
      await testOnboarding();
      await onRefresh();
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
      const [status, events] = await Promise.all([getSyncStatus(server.id), getRecentSyncEvents(server.id)]);
      setLastSyncResult(result);
      setSyncStatus(status.status);
      setRecentEvents(events.events);
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
      const [status, events] = await Promise.all([getSyncStatus(server.id), getRecentSyncEvents(server.id)]);
      setLastSyncResult(null);
      setSyncStatus(status.status);
      setRecentEvents(events.events);
      await onRefresh();
      setActionMessage("Mock/test sync rows cleared for this linked server.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Unable to clear mock/test sync data.");
    } finally {
      setClearingTestData(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <section className="glass-surface animated-border rounded-lg p-6">
        <div className="relative z-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {server.guild_icon_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={server.guild_icon_url} alt="" className="h-16 w-16 rounded-lg" />
              ) : (
                <span className="grid h-16 w-16 place-items-center rounded-lg bg-violet-500/20 text-2xl font-black">
                  {(server.guild_name ?? "D")[0]}
                </span>
              )}
              <div>
                <p className="text-xs font-black uppercase text-violet-200/70">Discord guild</p>
                <h2 className="text-2xl font-black text-white">{server.guild_name ?? server.guild_id}</h2>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {server.public_slug ? <StatusBadge label="Public Listing" value="Active" tone="cyan" /> : null}
              <Status status={server.status} />
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatusBadge label="Server" value={formatServerStatus(server.status)} tone={normalizedStatus === "live" ? "emerald" : normalizedStatus === "error" ? "red" : "orange"} />
            <StatusBadge label="Discord" value="Connected" tone="cyan" />
            <StatusBadge label="Nitrado" value="Connected" tone="violet" />
            <StatusBadge label="ADM" value={admState.badge} tone={admState.kind === "connected" ? "emerald" : admState.kind === "discovered_read_pending" ? "cyan" : "orange"} />
            <StatusBadge label="Stats Sync" value={statsSyncActive ? "Active" : statsSyncPending ? "Pending" : "Not Started"} tone={statsSyncActive ? "emerald" : statsSyncPending ? "orange" : "zinc"} />
          </div>

          <div className={`mt-5 rounded-lg border p-4 ${syncBanner.className}`}>
            <p className="text-xs font-black uppercase opacity-75">{syncBanner.title}</p>
            <p className="mt-2 text-sm font-bold leading-6 text-white">{syncBanner.message}</p>
            {syncBanner.detail ? <p className="mt-1 text-sm leading-6 text-zinc-300">{syncBanner.detail}</p> : null}
          </div>

          {statsSyncPending ? (
            <div className="mt-6 rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-5">
              <p className="text-xs font-black uppercase text-cyan-100/80">ADM Logs Discovered</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h3 className="text-2xl font-black text-white">Read Pending</h3>
                <span className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-black uppercase text-cyan-100">
                  Production safe
                </span>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">
                DZN can see your latest ADM log file, but full stat syncing is not active yet. Your server can remain live while log reading is finalised.
              </p>
            </div>
          ) : null}

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <Info label="Nitrado DayZ server" value={server.server_name || server.nitrado_service_name} />
            <Info label="Service ID" value={server.nitrado_service_id} />
            <Info label="Server type" value={server.server_type} />
            <Info label={networkAddressLabel} value={networkAddress} />
            {server.game ? <Info label="Game" value={server.game} /> : null}
            {server.platform ? <Info label="Platform" value={server.platform} /> : null}
            {server.player_slots ? <Info label="Player Slots" value={String(server.player_slots)} /> : null}
            <Info label="ADM Status" value={admState.title} />
            <Info label="Stats Sync" value={statsSyncActive ? "Active" : statsSyncPending ? "Pending" : "Not Started"} />
            <Info label="Latest ADM File" value={latestAdmFile} />
            <Info label="Last ADM Check" value={server.adm_last_checked_at ? formatDashboardDate(server.adm_last_checked_at) : "Not checked"} />
          </div>

          <div className="mt-6">
            <p className="text-xs font-black uppercase text-zinc-500">Tags</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.length ? tags.map((tag) => <span key={tag} className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-100">{tag}</span>) : <span className="text-sm text-zinc-400">No tags selected</span>}
            </div>
          </div>
        </div>
      </section>

      <aside className="grid gap-5">
        <div className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <DatabaseZap className="h-8 w-8 text-cyan-200" />
            <h3 className="mt-4 text-xl font-black uppercase text-white">Sync Engine Status</h3>
            <div className="mt-4 grid gap-3">
              <MiniInfo label="Sync Status" value={formatSyncStatus(effectiveSyncStatus)} />
              <MiniInfo label="Latest ADM File" value={latestAdmFile} />
              <MiniInfo label="Last Processed Line" value={String(syncStatus?.last_processed_line ?? 0)} />
              <MiniInfo label="Last Sync Time" value={syncStatus?.last_sync_at ? formatDashboardDate(syncStatus.last_sync_at) : "Not synced"} />
              <MiniInfo label="Lines Read" value={String(syncStatus?.last_lines_read ?? lastSyncResult?.linesRead ?? 0)} />
              <MiniInfo label="Lines Processed" value={String(syncStatus?.last_lines_processed ?? lastSyncResult?.linesProcessed ?? 0)} />
              <MiniInfo label="Events Created" value={String(syncStatus?.last_events_created ?? lastSyncResult?.eventsCreated ?? 0)} />
              <MiniInfo label="Kills Created" value={String(syncStatus?.last_kills_created ?? lastSyncResult?.killsCreated ?? 0)} />
              <MiniInfo label="Last Sync Result" value={syncStatus?.last_sync_message ?? lastSyncResult?.message ?? "Not synced"} />
              <MiniInfo label="Last Sync Duration" value={formatDuration(lastSyncDuration)} />
              <MiniInfo label="Total Kills" value={String(syncStatus?.total_kills ?? 0)} />
              <MiniInfo label="Total Deaths" value={String(syncStatus?.total_deaths ?? 0)} />
              <MiniInfo label="Total Joins" value={String(syncStatus?.total_joins ?? 0)} />
              <MiniInfo label="Total Disconnects" value={String(syncStatus?.total_disconnects ?? 0)} />
              <MiniInfo label="Unique Players" value={String(syncStatus?.unique_players ?? 0)} />
              <MiniInfo label="ADM Folder" value={admFolder ?? "Not detected"} />
              <MiniInfo label="Read Status" value={syncHasProcessedLines ? "Readable" : admState.readStatus} />
              <MiniInfo label="Next Action" value={syncHasProcessedLines ? "Continue syncing after fresh ADM activity" : admState.nextAction} />
            </div>
            {syncStatus?.last_sync_status === "completed" ? (
              <p className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-3 text-sm font-bold leading-6 text-cyan-50">
                {syncStatus.last_kills_created === 0
                  ? activityCount > 0
                    ? "Player activity synced successfully. No PvP kills found in the latest processed lines."
                    : "ADM synced successfully. No PvP kills found in the latest processed lines."
                  : "Player activity synced successfully."}
              </p>
            ) : null}
            <LastSyncDetails
              open={syncDetailsOpen}
              onToggle={() => setSyncDetailsOpen((value) => !value)}
              latestAdmFile={latestAdmFile}
              syncStatus={syncStatus}
              lastSyncResult={lastSyncResult}
            />
            <button
              type="button"
              disabled={syncing}
              onClick={runSync}
              className="mt-4 inline-flex w-full items-center justify-between rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-left text-sm font-bold text-cyan-50 transition hover:border-cyan-300/45 hover:bg-cyan-400/18 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span>{syncing ? "Syncing..." : "Run Manual Sync"}</span>
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              disabled={diagnosingLogs}
              onClick={runDiagnostics}
              className="mt-3 inline-flex w-full items-center justify-between rounded-lg border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-left text-sm font-bold text-violet-50 transition hover:border-violet-300/45 hover:bg-violet-400/18 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span>{diagnosingLogs ? "Testing Nitrado routes..." : "Run Log Access Diagnostics"}</span>
              <RefreshCw className={`h-4 w-4 ${diagnosingLogs ? "animate-spin" : ""}`} />
            </button>
            {logDiagnostics ? (
              <LogDiagnosticsPanel
                diagnostics={logDiagnostics}
                open={diagnosticsOpen}
                onToggle={() => setDiagnosticsOpen((value) => !value)}
              />
            ) : null}
            {effectiveSyncStatus === "read_pending" ? (
              <p className="mt-4 rounded-lg border border-orange-300/20 bg-orange-400/10 px-3 py-3 text-sm font-bold leading-6 text-orange-50">
                ADM file is discovered but DZN cannot read file contents through the current Nitrado API method yet.
              </p>
            ) : null}
            {statsSyncPending ? (
              <div className="mt-4 rounded-lg border border-orange-300/20 bg-orange-400/10 p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-100" />
                  <p className="text-sm font-bold leading-6 text-orange-50">
                    PvP rankings and player stats are not syncing yet. Your server is live, but kill tracking will activate once ADM log reading is available.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <Activity className="h-8 w-8 text-emerald-200" />
            <h3 className="mt-4 text-xl font-black uppercase text-white">Setup progress</h3>
            <div className="mt-5 h-2 overflow-hidden rounded-sm bg-white/10">
              <div className="h-full bg-gradient-to-r from-violet-300 to-emerald-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-3 text-sm font-bold text-zinc-300">{progress}% complete</p>
            <p className={`mt-2 text-xs font-black uppercase ${statsSyncPending ? "text-orange-100" : admState.kind === "connected" ? "text-emerald-100" : "text-zinc-400"}`}>
              {statsSyncLabel}
            </p>
          </div>
        </div>
        <div className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <Wrench className="h-8 w-8 text-violet-200" />
            <h3 className="mt-4 text-xl font-black uppercase text-white">Quick actions</h3>
            <div className="mt-4 grid gap-3">
              <button
                type="button"
                disabled={checkingLogs}
                onClick={rerunLogCheck}
                className="inline-flex items-center justify-between rounded-lg border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-left text-sm font-bold text-violet-50 transition hover:border-violet-300/45 hover:bg-violet-400/18 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <span>{checkingLogs ? "Checking logs..." : "Re-run Log Check"}</span>
                <RefreshCw className={`h-4 w-4 ${checkingLogs ? "animate-spin" : ""}`} />
              </button>
              <Link href="/setup#review-test" className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm font-bold text-cyan-50">Go to Review & Test</Link>
              {server.public_slug ? (
                <Link href={`/servers/${server.public_slug}`} className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-50">View public page</Link>
              ) : null}
              <Link href="/setup" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-zinc-100">Edit setup</Link>
              <Link href="/servers" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-zinc-100">View network</Link>
              <button
                type="button"
                disabled={clearingTestData}
                onClick={clearTestData}
                className="inline-flex items-center justify-between rounded-lg border border-orange-300/20 bg-orange-400/10 px-4 py-3 text-left text-sm font-bold text-orange-50 transition hover:border-orange-300/45 hover:bg-orange-400/18 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <span>{clearingTestData ? "Clearing..." : "Clear Mock/Test Sync Data"}</span>
                <RefreshCw className={`h-4 w-4 ${clearingTestData ? "animate-spin" : ""}`} />
              </button>
            </div>
            {actionMessage ? (
              <p className="mt-4 rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-sm font-bold text-zinc-200">
                {actionMessage}
              </p>
            ) : null}
          </div>
        </div>
        <div className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <Activity className="h-8 w-8 text-cyan-200" />
            <div className="mt-4 flex items-center justify-between gap-3">
              <h3 className="text-xl font-black uppercase text-white">Recent Synced Events</h3>
              {recentEventsAreMock ? (
                <span className="rounded-md border border-orange-300/25 bg-orange-400/10 px-2 py-1 text-[10px] font-black uppercase text-orange-100">
                  Mock Sync Data
                </span>
              ) : null}
            </div>
            <div className="mt-4 grid gap-2">
              {recentEvents.length ? (
                recentEvents.map((event, index) => <RecentSyncEventRow key={`${event.source}-${event.created_at ?? index}-${event.event_type}`} event={event} />)
              ) : (
                ["No synced events yet", "Killfeed activates once ADM sync is live", "Player stats will appear after log processing begins"].map((item) => (
                  <div key={item} className="rounded-lg border border-white/10 bg-black/24 px-3 py-3 text-sm font-bold text-zinc-300">
                    {item}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Status({ status }: { status: LinkedServer["status"] }) {
  const normalizedStatus = status.toLowerCase();
  const className =
    normalizedStatus === "live"
      ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
      : normalizedStatus === "error"
        ? "border-red-300/30 bg-red-400/10 text-red-100"
        : "border-orange-300/30 bg-orange-400/10 text-orange-100";
  return (
    <span className={`rounded-lg border px-4 py-2 text-xs font-black uppercase ${className}`}>
      {formatServerStatus(status)}
    </span>
  );
}

function StatusBadge({ label, value, tone }: { label: string; value: string; tone: "emerald" | "cyan" | "violet" | "orange" | "red" | "zinc" }) {
  const classes = {
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
    violet: "border-violet-300/25 bg-violet-400/10 text-violet-100",
    orange: "border-orange-300/25 bg-orange-400/10 text-orange-100",
    red: "border-red-300/25 bg-red-400/10 text-red-100",
    zinc: "border-white/10 bg-white/[0.04] text-zinc-200",
  }[tone];
  return (
    <div className={`rounded-lg border px-3 py-3 ${classes}`}>
      <p className="text-[10px] font-black uppercase opacity-70">{label}</p>
      <p className="mt-1 text-xs font-black uppercase">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <p className="text-xs font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-2 font-bold text-white">{value}</p>
    </div>
  );
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

function RecentSyncEventRow({ event }: { event: AdmRecentSyncEvent }) {
  const isKill = event.source === "kill";
  const secondary = getRecentEventSecondary(event, isKill);
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase text-zinc-500">{event.event_label || formatEventType(event.event_type)}</p>
          <p className="mt-1 text-sm font-bold leading-5 text-white">
            {event.detail ?? (isKill ? `${event.killer_name ?? "Unknown"} -> ${event.victim_name ?? "Unknown"}` : event.player_name ?? "Unknown player")}
          </p>
          {secondary ? (
            <p className="mt-1 text-xs font-bold text-zinc-400">
              {secondary}
            </p>
          ) : null}
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

function getFolderFromPath(path?: string | null) {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join("/");
}
