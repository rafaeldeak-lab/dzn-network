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
  Upload,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { backfillMissingAdm, bulkImportAdmFiles, bumpServer, cancelAdmImportJob, clearClientAuthState, clearMockTestSyncData, clearOldFailedSyncRuns, continueAdmImportJob, createCheckoutSession, createPortalSession, deleteAccount, deleteLinkedServer, finishAdmImportJob, forceProcessLatestAdm, getAdmAutomationStatus, getAdmFileDiscoveryDebug, getAdmImportJobStatus, getAutomationHealth, getBillingPlans, getBillingStatus, getDashboardHealth, getDiscordPostingChannels, getLatestAdmImportJob, getMe, getNitradoLogSettings, getPostingDestinations, getPublicCacheDebug, getRecentSyncEvents, getServerAdvertisingStatus, getSyncStatus, importManualAdmText, logoutAndRedirect, previewManualAdmText, rebuildPublicCache, recoverStuckSyncLocks, refreshServerMetadata, runAutoPostDispatcherNow, runLogAccessDiagnostics, runManualSync, saveNitradoLogSettings, savePostingDestination, sendAdmImportJobChunk, startAdmImportJob, testOnboarding, updateServerPublicListing } from "./api";
import type { AdmAutomationStatusResult, AdmBackfillPlanResult, AdmFileDiscoveryDebug, AdmImportJobProgressResult, AdmRecentSyncEvent, AdmSyncRunResult, AdmSyncStatus, AdvertisingBumpStatus, AutomationCronRunSummary, AutomationHealth, AutoPostDispatchNowResult, AuthResponse, BillingPlanSummary, BillingStatus, BulkAdmFileResult, BulkAdmImportResult, DashboardHealthResult, DiscordChannelsResponse, DiscordPostingChannel, LinkedServer, ManualAdmImportErrorResult, ManualAdmImportResult, ManualAdmParsePreviewResult, NitradoLogAccessDiagnostics, NitradoLogSettingsCheckResponse, NitradoLogSettingsConfirmation, PostingChannelSetup, PostingDestinationsResponse, PostingOptionSummary, PublicCacheDebug, PublicCacheRebuildResult, SyncLockRecoveryResult } from "./types";

const SYNC_POLL_INTERVAL_MS = 15000;
const ADM_IMPORT_JOB_POLL_INTERVAL_MS = 3000;
let hasLoggedMultiServerReady = false;

type DiscordChannelCache = {
  server_id: string;
  channels: DiscordPostingChannel[];
  last_channel_fetch_success_at: string;
  last_channel_count: number;
  last_postable_channel_count: number;
  last_bot_connected_state: boolean | null;
  guild_name: string | null;
};

type DiscordChannelFetchFailure = {
  error_code: string | null;
  message: string;
  status: number | null;
  retryable: boolean;
  attempted_at: string;
};

type AdmUploadFile = {
  filename: string;
  admText: string;
  size: number;
  preview: AdmUploadFilePreview;
};

type AdmUploadFilePreview = {
  lineCount: number;
  chunkCount: number;
  parsedKills: number;
  joins: number;
  disconnects: number;
  playerlistSnapshots: number;
  firstLinePreview: string;
};

type AdmBulkProgress = {
  current: number;
  total: number;
  filename: string | null;
  chunkCurrent?: number;
  chunkTotal?: number;
  status?: string;
  writtenKills?: number;
  duplicateSkips?: number;
  chunksPerMinute?: number | null;
  estimatedRemainingSeconds?: number | null;
  lastChunkAt?: string | null;
  activeInBrowser?: boolean;
  runnerState?: "running" | "paused" | "finishing";
};

type DashboardActionStatus = "queued" | "running" | "polling" | "completed" | "failed" | "cancelled" | "warning";

type DashboardActionProgress = {
  actionKey: string;
  title: string;
  status: DashboardActionStatus;
  progress: number | null;
  currentStepIndex: number;
  totalSteps: number;
  currentStep: string;
  detail: string | null;
  startedAt: string;
  lastUpdatedAt: string;
  errorMessage?: string | null;
  successSummary?: string | null;
  warningMessage?: string | null;
  indeterminate?: boolean;
  stats?: Record<string, string | number | null | undefined>;
  major?: boolean;
};

type DashboardActionRefreshScope = "full" | "sync" | "billing" | "public-cache" | "discord" | "dashboard-health" | "none";

type DashboardActionHelpers = {
  setStep: (stepIndex: number, detail?: string, progress?: number | null) => void;
  setDetail: (detail: string, progress?: number | null) => void;
  setProgress: (progress: number | null, detail?: string) => void;
  setStats: (stats: DashboardActionProgress["stats"]) => void;
  setPolling: (detail?: string, progress?: number | null) => void;
  setWarning: (message: string, detail?: string) => void;
};

type RunDashboardActionInput<T> = {
  actionKey: string;
  title: string;
  steps: string[];
  run: (helpers: DashboardActionHelpers) => Promise<T>;
  onSuccess?: (result: T) => Promise<void> | void;
  onError?: (error: unknown) => Promise<void> | void;
  refreshAfterSuccess?: DashboardActionRefreshScope | DashboardActionRefreshScope[] | boolean;
  successSummary?: (result: T) => string;
  major?: boolean;
  autoHardRefreshOnComplete?: boolean;
};

type DashboardTotalsSnapshot = {
  kills: number;
  deaths: number;
  joins: number;
  disconnects: number;
  uniquePlayers: number;
  serverScore: string;
};

type DashboardTotalsDelta = {
  before: DashboardTotalsSnapshot;
  after: DashboardTotalsSnapshot;
  changed: boolean;
};

const ADM_IMPORT_UPLOAD_CHUNK_SIZE = 10;
const ADM_IMPORT_RETRY_CHUNK_SIZES = [5, 1] as const;
const ADM_IMPORT_PREVIOUS_LINE_CONTEXT = 5;
const ADM_CHUNK_RUNNER_DELAY_MS = 300;
const ADM_CHUNK_RUNNER_RATE_LIMIT_DELAY_MS = 1500;
const ADM_CHUNK_RUNNER_MAX_BROWSER_CHUNKS = 1200;
const DASHBOARD_ACTION_STORAGE_PREFIX = "dzn:activeDashboardAction:";
const autoHardRefreshOnComplete = false;
const ADM_PROGRESS_ACTION_KEYS = new Set([
  "import-adm-files",
  "continue-import",
  "resume-import",
  "force-process-latest-adm",
  "backfill-missing-adm",
  "run-manual-sync",
]);

function dashboardActionStorageKey(serverId: string) {
  return `${DASHBOARD_ACTION_STORAGE_PREFIX}${serverId}`;
}

function loadDashboardActionState(serverId: string): DashboardActionProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(dashboardActionStorageKey(serverId)) ?? window.sessionStorage.getItem(dashboardActionStorageKey(serverId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardActionProgress;
    if (!parsed?.actionKey || !parsed.title || !parsed.status) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDashboardActionState(serverId: string, action: DashboardActionProgress | null) {
  if (typeof window === "undefined") return;
  const key = dashboardActionStorageKey(serverId);
  try {
    if (!action) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
      return;
    }
    const payload = JSON.stringify(action);
    window.localStorage.setItem(key, payload);
    window.sessionStorage.setItem(key, payload);
  } catch {
    // Storage is best-effort only; visible in-memory progress still works.
  }
}

function isActiveDashboardActionStatus(status?: DashboardActionStatus | null) {
  return status === "queued" || status === "running" || status === "polling";
}

function clampActionProgress(progress: number | null | undefined) {
  if (progress === null || progress === undefined || Number.isNaN(progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export function Dashboard() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const lastGoodAuthRef = useRef<AuthResponse | null>(null);

  useEffect(() => {
    getMe()
      .then((nextAuth) => {
        setAuth(nextAuth);
        if (nextAuth.authenticated) lastGoodAuthRef.current = nextAuth;
      })
      .catch(() => {
        if (lastGoodAuthRef.current?.authenticated) setAuth(lastGoodAuthRef.current);
        else setAuth({ authenticated: false });
      })
      .finally(() => setLoading(false));
  }, []);

  async function refreshAuthPreservingLastGood() {
    try {
      const nextAuth = await getMe();
      if (nextAuth.authenticated) {
        lastGoodAuthRef.current = nextAuth;
        setAuth(nextAuth);
      } else if (!lastGoodAuthRef.current?.authenticated) {
        setAuth(nextAuth);
      }
    } catch {
      if (lastGoodAuthRef.current?.authenticated) setAuth(lastGoodAuthRef.current);
    }
  }

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
    <DashboardFrame>
      {server ? (
        <ServerDashboard
          key={server.id}
          server={server}
          servers={manageableServers}
          selectedServerId={server.id}
          onSelectServer={setSelectedServerId}
          onLogout={signOut}
          onRefresh={refreshAuthPreservingLastGood}
        />
      ) : <EmptyDashboard />}
    </DashboardFrame>
  );
}

function DashboardFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(139,92,246,0.26),transparent_30%),radial-gradient(circle_at_78%_18%,rgba(14,165,233,0.14),transparent_28%),linear-gradient(180deg,#02030a_0%,#07101f_52%,#02030a_100%)]" />
      <div className="scanline absolute inset-0 opacity-20" />
      <div className="relative z-10">
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

type DashboardTabKey = "overview" | "sync-health" | "public-listing" | "billing" | "discord-posts" | "settings-danger";

function ServerDashboard({
  server: serverProp,
  servers,
  selectedServerId,
  onSelectServer,
  onLogout,
  onRefresh,
}: {
  server: LinkedServer;
  servers: LinkedServer[];
  selectedServerId: string | null;
  onSelectServer: (serverId: string) => void;
  onLogout: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<DashboardTabKey>("overview");
  const [checkingLogs, setCheckingLogs] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<AdmSyncStatus | null>(null);
  const [lastGoodSyncStatus, setLastGoodSyncStatus] = useState<AdmSyncStatus | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<AdmSyncRunResult | null>(null);
  const [dashboardHealth, setDashboardHealth] = useState<DashboardHealthResult | null>(() => loadDashboardHealthCache(serverProp.id));
  const [lastGoodDashboardHealth, setLastGoodDashboardHealth] = useState<DashboardHealthResult | null>(() => loadDashboardHealthCache(serverProp.id));
  const [recentEvents, setRecentEvents] = useState<AdmRecentSyncEvent[]>([]);
  const [lastGoodRecentEvents, setLastGoodRecentEvents] = useState<AdmRecentSyncEvent[]>([]);
  const [logDiagnostics, setLogDiagnostics] = useState<NitradoLogAccessDiagnostics | null>(null);
  const [admFileDiscoveryDebug, setAdmFileDiscoveryDebug] = useState<AdmFileDiscoveryDebug | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(false);
  const [admFileDiscoveryOpen, setAdmFileDiscoveryOpen] = useState(false);
  const [diagnosingLogs, setDiagnosingLogs] = useState(false);
  const [checkingAdmFileDiscovery, setCheckingAdmFileDiscovery] = useState(false);
  const [clearingTestData, setClearingTestData] = useState(false);
  const [clearingFailedRuns, setClearingFailedRuns] = useState(false);
  const [dangerAction, setDangerAction] = useState<"server" | "account" | null>(null);
  const [deletingDangerAction, setDeletingDangerAction] = useState(false);
  const [refreshingSyncData, setRefreshingSyncData] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [refreshingServerInfo, setRefreshingServerInfo] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [lastGoodBilling, setLastGoodBilling] = useState<BillingStatus | null>(null);
  const [billingPlans, setBillingPlans] = useState<BillingPlanSummary[]>([]);
  const [advertisingStatus, setAdvertisingStatus] = useState<AdvertisingBumpStatus | null>(null);
  const [postingSetups, setPostingSetups] = useState<PostingChannelSetup[]>([]);
  const [postingOptions, setPostingOptions] = useState<PostingOptionSummary[]>([]);
  const [discordChannelCache, setDiscordChannelCache] = useState<DiscordChannelCache | null>(() => loadDiscordChannelCache(serverProp.id));
  const [discordPostingChannels, setDiscordPostingChannels] = useState<DiscordPostingChannel[]>(() => loadDiscordChannelCache(serverProp.id)?.channels ?? []);
  const [discordChannelsResponse, setDiscordChannelsResponse] = useState<DiscordChannelsResponse | null>(null);
  const [discordChannelsLoading, setDiscordChannelsLoading] = useState(false);
  const [discordChannelsWarning, setDiscordChannelsWarning] = useState("");
  const [discordChannelFetchFailure, setDiscordChannelFetchFailure] = useState<DiscordChannelFetchFailure | null>(null);
  const [automationHealth, setAutomationHealth] = useState<AutomationHealth | null>(null);
  const [lastGoodAutomationHealth, setLastGoodAutomationHealth] = useState<AutomationHealth | null>(null);
  const [publicCacheDebug, setPublicCacheDebug] = useState<PublicCacheDebug | null>(null);
  const [lastGoodPublicCache, setLastGoodPublicCache] = useState<PublicCacheDebug | null>(null);
  const [publicCacheRebuildResult, setPublicCacheRebuildResult] = useState<PublicCacheRebuildResult | null>(null);
  const [rebuildingPublicCache, setRebuildingPublicCache] = useState(false);
  const [recoveringSyncLocks, setRecoveringSyncLocks] = useState(false);
  const [syncLockRecoveryResult, setSyncLockRecoveryResult] = useState<SyncLockRecoveryResult | null>(null);
  const [nitradoLogSettings, setNitradoLogSettings] = useState<NitradoLogSettingsConfirmation | null>(null);
  const [nitradoLogSettingsCheck, setNitradoLogSettingsCheck] = useState<NitradoLogSettingsCheckResponse | null>(null);
  const [savingNitradoLogSettings, setSavingNitradoLogSettings] = useState(false);
  const [checkingNitradoLogSettings, setCheckingNitradoLogSettings] = useState(false);
  const [manualAdmFilename, setManualAdmFilename] = useState("");
  const [manualAdmText, setManualAdmText] = useState("");
  const [manualAdmFiles, setManualAdmFiles] = useState<AdmUploadFile[]>([]);
  const [manualAdmImportHitLines, setManualAdmImportHitLines] = useState(false);
  const [manualAdmImporting, setManualAdmImporting] = useState(false);
  const [manualAdmPreviewing, setManualAdmPreviewing] = useState(false);
  const [manualAdmImportResult, setManualAdmImportResult] = useState<ManualAdmImportResult | null>(null);
  const [manualAdmImportError, setManualAdmImportError] = useState<ManualAdmImportErrorResult | null>(null);
  const [manualAdmParsePreview, setManualAdmParsePreview] = useState<ManualAdmParsePreviewResult | null>(null);
  const [bulkAdmImportResult, setBulkAdmImportResult] = useState<BulkAdmImportResult | null>(null);
  const [bulkAdmImportError, setBulkAdmImportError] = useState<ManualAdmImportErrorResult | null>(null);
  const [bulkAdmImportProgress, setBulkAdmImportProgress] = useState<AdmBulkProgress | null>(null);
  const [admChunkRunnerPaused, setAdmChunkRunnerPaused] = useState(false);
  const [admChunkRunnerJob, setAdmChunkRunnerJob] = useState<{ jobId: string; filename: string } | null>(null);
  const [lastGoodAdmJob, setLastGoodAdmJob] = useState<AdmImportJobProgressResult | null>(null);
  const [admImportTotalsDelta, setAdmImportTotalsDelta] = useState<DashboardTotalsDelta | null>(null);
  const [forceLatestAdmRunning, setForceLatestAdmRunning] = useState(false);
  const [forceLatestAdmResult, setForceLatestAdmResult] = useState<AdmSyncRunResult | null>(null);
  const [admBackfillRunning, setAdmBackfillRunning] = useState(false);
  const [admBackfillResult, setAdmBackfillResult] = useState<AdmBackfillPlanResult | null>(null);
  const [admAutomationStatus, setAdmAutomationStatus] = useState<AdmAutomationStatusResult | null>(null);
  const [verifyingAdmAutomation, setVerifyingAdmAutomation] = useState(false);
  const [manualAdmRefreshFailed, setManualAdmRefreshFailed] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");
  const [liveRefreshWarning, setLiveRefreshWarning] = useState("");
  const [liveRefreshStatus, setLiveRefreshStatus] = useState<"ok" | "retrying" | "failed" | "stale">("ok");
  const [lastRefreshError, setLastRefreshError] = useState<string | null>(null);
  const [failedEndpoint, setFailedEndpoint] = useState<string | null>(null);
  const [failedRefreshCount, setFailedRefreshCount] = useState(0);
  const [lastSyncStatusRefreshAt, setLastSyncStatusRefreshAt] = useState<string | null>(null);
  const [lastRecentEventsRefreshAt, setLastRecentEventsRefreshAt] = useState<string | null>(null);
  const [lastBillingRefreshAt, setLastBillingRefreshAt] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [dashboardAction, setDashboardAction] = useState<DashboardActionProgress | null>(() => loadDashboardActionState(serverProp.id));
  const [serverInfoOverride, setServerInfoOverride] = useState<{ serverId: string; patch: Partial<LinkedServer> } | null>(null);
  const syncRefreshInFlightRef = useRef(false);
  const syncRefreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const dashboardHealthRequestIdRef = useRef(0);
  const lastGoodDashboardHealthRef = useRef(lastGoodDashboardHealth);
  const onRefreshRef = useRef(onRefresh);
  const dashboardActionRef = useRef<DashboardActionProgress | null>(dashboardAction);
  const admChunkRunnerControlRef = useRef({ paused: false, cancelled: false, runId: 0 });
  const server = useMemo(
    () => ({
      ...serverProp,
      ...(serverInfoOverride?.serverId === serverProp.id ? serverInfoOverride.patch : {}),
    }),
    [serverInfoOverride, serverProp],
  );

  function updateDashboardAction(patch: Partial<DashboardActionProgress>) {
    setDashboardAction((current) => {
      if (!current) return current;
      const next: DashboardActionProgress = {
        ...current,
        ...patch,
        progress: patch.progress === undefined ? current.progress : clampActionProgress(patch.progress),
        stats: patch.stats === undefined ? current.stats : patch.stats,
        lastUpdatedAt: new Date().toISOString(),
      };
      dashboardActionRef.current = next;
      saveDashboardActionState(server.id, next);
      return next;
    });
  }

  function clearDashboardAction() {
    dashboardActionRef.current = null;
    setDashboardAction(null);
    saveDashboardActionState(server.id, null);
  }

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    lastGoodDashboardHealthRef.current = lastGoodDashboardHealth;
  }, [lastGoodDashboardHealth]);

  useEffect(() => {
    dashboardActionRef.current = dashboardAction;
    if (dashboardAction && isActiveDashboardActionStatus(dashboardAction.status)) {
      saveDashboardActionState(server.id, dashboardAction);
    }
  }, [dashboardAction, server.id]);

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
      setDiscordChannelsResponse(channels);
      const errorCode = channels.error_code ?? channels.errorCode ?? null;
      if (channels.ok === false || errorCode) {
        const failure = buildChannelFetchFailure(channels);
        setDiscordChannelFetchFailure(failure);
        setDiscordChannelsWarning(friendlyChannelFetchWarning(channels, postingSetups.length > 0));
        return channels;
      }

      setDiscordPostingChannels(channels.channels);
      setDiscordChannelsWarning(channels.warning ?? "");
      setDiscordChannelFetchFailure(null);
      const nextCache = buildDiscordChannelCache(server.id, channels);
      setDiscordChannelCache(nextCache);
      saveDiscordChannelCache(server.id, nextCache);
      return channels;
    } catch {
      const failure: DiscordChannelFetchFailure = {
        error_code: "channel_fetch_unavailable",
        message: "Discord channel refresh is temporarily unavailable. Existing saved setups remain active.",
        status: null,
        retryable: true,
        attempted_at: new Date().toISOString(),
      };
      setDiscordChannelFetchFailure(failure);
      setDiscordChannelsWarning(postingSetups.length > 0
        ? `${failure.message} Saved auto-post setups continue running even if channel refresh temporarily fails.`
        : failure.message);
      return null;
    } finally {
      setDiscordChannelsLoading(false);
    }
  }, [postingSetups.length, server.id]);

  const refreshBilling = useCallback(async () => {
    try {
      const [billing, advertising] = await Promise.all([
        getBillingStatus(),
        getServerAdvertisingStatus(server.id).catch(() => null),
      ]);
      setBillingStatus(billing);
      setLastGoodBilling(billing);
      setLastBillingRefreshAt(new Date().toISOString());
      if (advertising?.advertising) setAdvertisingStatus(advertising.advertising);
      const plans = await getBillingPlans().catch(() => null);
      if (plans?.plans?.length) setBillingPlans(plans.plans);
      const posting = await getPostingDestinations(server.id).catch(() => null);
      if (posting?.setups) setPostingSetups(posting.setups);
      if (posting?.post_type_options) setPostingOptions(posting.post_type_options);
      await refreshDiscordChannels();
      const logSettings = await getNitradoLogSettings(server.id).catch(() => null);
      if (logSettings?.saved_settings) {
        setNitradoLogSettings(logSettings.saved_settings);
        setNitradoLogSettingsCheck(logSettings);
      }
      const health = await getAutomationHealth().catch(() => null);
      if (health) {
        setAutomationHealth(health);
        setLastGoodAutomationHealth(health);
      }
      const cacheDebug = await getPublicCacheDebug(server.id).catch(() => null);
      if (cacheDebug) {
        setPublicCacheDebug(cacheDebug);
        setLastGoodPublicCache(cacheDebug);
      }
    } catch (error) {
      setDiscordChannelsLoading(false);
      setBillingMessage(error instanceof Error ? error.message : "Billing status unavailable.");
    }
  }, [refreshDiscordChannels, server.id]);

  useEffect(() => {
    void Promise.resolve().then(refreshBilling);
  }, [refreshBilling]);

  const refreshDashboardHealth = useCallback(async () => {
    const requestId = dashboardHealthRequestIdRef.current + 1;
    dashboardHealthRequestIdRef.current = requestId;
    try {
      const response = await getDashboardHealth(server.id);
      if (!response.ok || dashboardHealthRequestIdRef.current !== requestId) return false;
      setDashboardHealth(response);
      setLastGoodDashboardHealth(response);
      saveDashboardHealthCache(server.id, response);
      if (response.latest_events.length && !recentEvents.length) {
        setRecentEvents(response.latest_events);
        setLastGoodRecentEvents(response.latest_events);
      }
      if (response.sync.active_job && !lastGoodAdmJob) {
        setLastGoodAdmJob(dashboardHealthJobToAdmJob(response.sync.active_job));
      }
      setLastRefreshedAt(response.generated_at);
      return true;
    } catch (error) {
      setFailedEndpoint("dashboard-health");
      setLastRefreshError(error instanceof Error ? error.message : "Dashboard health snapshot failed.");
      setFailedRefreshCount((count) => count + 1);
      const cached = lastGoodDashboardHealthRef.current;
      if (cached) {
        setLiveRefreshStatus("stale");
        setLiveRefreshWarning(`Live refresh failed. Showing last successful data from ${formatClockTime(cached.generated_at)}. Retrying...`);
      }
      return false;
    }
  }, [lastGoodAdmJob, recentEvents.length, server.id]);

  useEffect(() => {
    void Promise.resolve().then(refreshDashboardHealth);
  }, [refreshDashboardHealth]);

  async function rebuildPublicProfileCache() {
    await runDashboardAction({
      actionKey: "rebuild-public-cache",
      title: "Rebuilding Public Cache",
      steps: ["Requesting public cache rebuild", "Saving public snapshot", "Refreshing dashboard"],
      refreshAfterSuccess: ["public-cache", "dashboard-health"],
      run: async (action) => {
        setRebuildingPublicCache(true);
        setActionMessage("");
        try {
          action.setStep(1, "Rebuilding the public profile cache from current stats.");
          const result = await rebuildPublicCache(server.id);
          setPublicCacheRebuildResult(result);
          setPublicCacheDebug(result.after);
          setLastGoodPublicCache(result.after);
          action.setStep(2, "Public cache snapshot saved.", 72);
          return result;
        } finally {
          setRebuildingPublicCache(false);
        }
      },
      successSummary: () => "Public profile cache rebuilt from current server, stats, and sync data.",
    });
  }

  async function recoverSyncLocks() {
    await runDashboardAction({
      actionKey: "recover-stuck-sync-jobs",
      title: "Recovering Stuck Sync Jobs",
      steps: ["Finding stale locks/jobs", "Releasing or retrying jobs", "Refreshing automation state"],
      refreshAfterSuccess: ["sync", "public-cache", "dashboard-health"],
      run: async (action) => {
        setRecoveringSyncLocks(true);
        setActionMessage("");
        try {
          action.setStep(1, "Finding stale locks and chunk jobs.");
          const result = await recoverStuckSyncLocks(server.id);
          setSyncLockRecoveryResult(result);
          action.setStep(2, result.recovered ? "Recovered stale sync locks." : "No stale sync locks needed recovery.", 70);
          return result;
        } finally {
          setRecoveringSyncLocks(false);
        }
      },
      successSummary: (result) => result.recovered
        ? "Recovered stale sync locks for this server."
        : "No stale sync locks needed recovery.",
    });
  }

  const serverDisplayName = server.display_name ?? server.hostname ?? server.server_name ?? server.nitrado_service_name;
  const effectiveServerMode = server.server_mode ?? server.server_type;
  const normalizedStatus = server.status.toLowerCase();
  const admState = getAdmState(server);
  const isDayzService = [server.game, serverDisplayName, server.nitrado_service_name].some((value) => /dayz/i.test(value ?? ""));
  const effectiveDiscordPostingChannels = discordPostingChannels.length ? discordPostingChannels : discordChannelCache?.channels ?? [];
  const discordBotInstalled = discordChannelsResponse?.bot_connected === true || discordChannelCache?.last_bot_connected_state === true;
  const discordChannelsDiscovered = effectiveDiscordPostingChannels.length > 0;
  const coreSetupComplete = Boolean(server.guild_id && discordBotInstalled && discordChannelsDiscovered && server.nitrado_service_id && isDayzService && admState.isDiscovered);
  const progress = coreSetupComplete ? 100 : normalizedStatus === "error" ? 72 : normalizedStatus === "live" ? 92 : 84;
  const networkAddress = server.ip_address ?? server.region ?? "Unknown";
  const networkAddressLabel = looksLikeIpAddress(networkAddress) ? "IP Address" : "Region";
  const effectiveDashboardHealth = dashboardHealth ?? lastGoodDashboardHealth;
  const effectiveSyncData = syncStatus ?? lastGoodSyncStatus;
  const healthAdmJob = effectiveDashboardHealth?.sync.active_job ? dashboardHealthJobToAdmJob(effectiveDashboardHealth.sync.active_job) : null;
  const effectiveRecentEvents = lastRecentEventsRefreshAt
    ? recentEvents
    : recentEvents.length
      ? recentEvents
      : lastGoodRecentEvents.length
        ? lastGoodRecentEvents
        : effectiveDashboardHealth?.latest_events ?? [];
  const syncHasProcessedLines = (effectiveSyncData?.last_processed_line ?? 0) > 0 && effectiveSyncData?.last_sync_status !== "read_pending";
  const statsSyncActive = syncHasProcessedLines || admState.kind === "connected" || Boolean(effectiveDashboardHealth && (effectiveDashboardHealth.stats.kills > 0 || effectiveDashboardHealth.stats.joins > 0 || effectiveDashboardHealth.stats.unique_players > 0));
  const statsSyncPending = !statsSyncActive && admState.kind === "discovered_read_pending";
  const latestAdmFile = effectiveSyncData?.latest_adm_file ?? effectiveDashboardHealth?.sync.last_processed_adm_filename ?? server.adm_latest_file ?? "Not detected";
  const syncStatusActiveAdmImportJob = effectiveSyncData?.active_adm_import_job && isActiveAdmImportJobStatus(effectiveSyncData.active_adm_import_job.status)
    ? effectiveSyncData.active_adm_import_job
    : healthAdmJob && isActiveAdmImportJobStatus(healthAdmJob.status)
      ? healthAdmJob
    : null;
  const effectiveSyncStatus = syncStatusActiveAdmImportJob
    ? "processing_in_chunks"
    : normalizeDashboardSyncStatus(
      effectiveSyncData?.last_sync_status ?? effectiveDashboardHealth?.sync.status ?? (statsSyncPending ? "read_pending" : admState.kind === "connected" ? "active" : "not_started"),
      latestAdmFile,
    );
  const lastSyncDuration = syncStatus?.last_sync_duration_ms ?? lastSyncResult?.syncDurationMs ?? null;
  const activityCount = (effectiveSyncData?.total_joins ?? effectiveDashboardHealth?.stats.joins ?? 0) + (effectiveSyncData?.total_disconnects ?? effectiveDashboardHealth?.stats.disconnects ?? 0) + (effectiveSyncData?.total_deaths ?? effectiveDashboardHealth?.stats.deaths ?? 0);
  const noPvpKillsYet = statsSyncActive && (effectiveSyncData?.total_kills ?? effectiveDashboardHealth?.stats.kills ?? 0) === 0;
  const globalRankLabel = formatGlobalRank(server.global_rank ?? server.rank ?? null);
  const scoreLabel = server.score_label ?? (typeof server.score === "number" && server.score > 0 ? String(server.score) : "Pending");
  const scoreTitle = scoreBreakdownTitle(server.score_breakdown ?? null);
  const syncBanner = getSyncBanner({
    active: statsSyncActive,
    readPending: effectiveSyncStatus === "read_pending",
    noPvpKillsYet,
    hasActivity: activityCount > 0,
  });
  const recentEventsAreMock = effectiveRecentEvents.some((event) => event.is_mock || [event.player_name, event.killer_name, event.victim_name].some((name) => /^Mock(Survivor|Bandit|Runner)/.test(name ?? "")));
  const syncRuns = getPrioritizedSyncRuns(effectiveSyncData?.recent_sync_runs ?? []);
  const syncHealth = getSyncHealth(effectiveSyncData?.recent_sync_runs ?? [], effectiveSyncStatus, effectiveSyncData?.last_sync_message ?? effectiveDashboardHealth?.sync.last_error ?? null);
  const dashboardSyncBanner = getDashboardSyncStatusBanner(syncBanner, syncHealth, effectiveSyncStatus);
  const latestAdmReadable = getLatestAdmReadableLabel(effectiveSyncStatus);
  const recentFeedStatus = getRecentFeedStatus(effectiveSyncData, effectiveSyncStatus, effectiveRecentEvents.length);
  const recentFeedBadge = getRecentFeedBadge(recentEventsAreMock, effectiveSyncStatus);
  const overviewAdmSyncStatus = getOverviewAdmSyncStatus(effectiveSyncStatus, Boolean(syncStatusActiveAdmImportJob), statsSyncActive);
  const syncHealthPercent = syncHealth.status === "error" ? 72 : effectiveSyncStatus === "read_pending" ? 76 : 100;
  const processedPercent = getProcessedPercent(effectiveSyncData);
  const nextScheduledSync = getNextScheduledSync(effectiveSyncData?.last_scheduled_sync_at ?? null);
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
  const effectiveBillingStatus = billingStatus ?? lastGoodBilling;
  const effectivePlanLabel = effectiveBillingStatus ? planLabel(effectiveBillingStatus.plan_key) : effectiveDashboardHealth?.current_plan ? planLabel(effectiveDashboardHealth.current_plan) : "Loading";
  const effectiveAutomationHealth = automationHealth ?? lastGoodAutomationHealth;
  const effectivePublicCacheDebug = publicCacheDebug ?? lastGoodPublicCache;
  const showingCachedDashboardData = Boolean(
    liveRefreshStatus !== "ok" &&
    (lastGoodSyncStatus || lastGoodRecentEvents.length || lastGoodBilling || lastGoodAutomationHealth || lastGoodPublicCache || lastGoodAdmJob),
  );
  const admDiscoveryInterval = effectiveBillingStatus?.entitlements.adm_discovery_interval_minutes ?? null;
  const admProcessingInterval = effectiveBillingStatus?.entitlements.adm_pull_interval_minutes ?? null;
  const dashboardStatValues = {
    kills: effectiveSyncData?.total_kills ?? effectiveDashboardHealth?.stats.kills ?? null,
    deaths: effectiveSyncData?.total_deaths ?? effectiveDashboardHealth?.stats.deaths ?? null,
    joins: effectiveSyncData?.total_joins ?? effectiveDashboardHealth?.stats.joins ?? null,
    disconnects: effectiveSyncData?.total_disconnects ?? effectiveDashboardHealth?.stats.disconnects ?? null,
    uniquePlayers: effectiveSyncData?.unique_players ?? effectiveDashboardHealth?.stats.unique_players ?? null,
    score: server.score_label
      ?? (typeof server.score === "number" && server.score > 0 ? String(server.score) : effectiveDashboardHealth?.stats.score ? String(effectiveDashboardHealth.stats.score) : "Pending"),
  };
  const publicCacheFlags = effectivePublicCacheDebug?.problem_flags ?? [];
  const publicCacheStale = publicCacheFlags.some((flag) => [
    "public_cache_missing",
    "public_cache_stale",
    "metadata_newer_than_public_cache",
    "status_sync_newer_than_public_cache",
    "adm_newer_than_public_cache",
  ].includes(flag));
  const activeDashboardAction = isActiveDashboardActionStatus(dashboardAction?.status) ? dashboardAction : null;
  const isDashboardActionActive = Boolean(activeDashboardAction);
  const dashboardActionKey = activeDashboardAction?.actionKey ?? null;

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

    const refreshPromise = Promise.allSettled([
      getSyncStatus(server.id),
      getRecentSyncEvents(server.id),
      getNitradoLogSettings(server.id),
    ]).then(([statusResult, eventsResult, logSettingsResult]) => {
      const now = new Date().toISOString();
      const failed: string[] = [];

      if (statusResult.status === "fulfilled") {
        setSyncStatus(statusResult.value.status);
        setLastGoodSyncStatus(statusResult.value.status);
        if (statusResult.value.status.active_adm_import_job) setLastGoodAdmJob(statusResult.value.status.active_adm_import_job);
        setLastSyncStatusRefreshAt(now);
      } else {
        failed.push("sync-status");
      }

      if (eventsResult.status === "fulfilled") {
        setRecentEvents(eventsResult.value.events);
        setLastGoodRecentEvents(eventsResult.value.events);
        setLastRecentEventsRefreshAt(now);
      } else {
        failed.push("recent-events");
      }

      if (logSettingsResult.status === "fulfilled" && logSettingsResult.value?.saved_settings) {
        setNitradoLogSettings(logSettingsResult.value.saved_settings);
        setNitradoLogSettingsCheck(logSettingsResult.value);
      } else if (logSettingsResult.status === "rejected") {
        failed.push("nitrado-log-settings");
      }

      if (failed.length) {
        setFailedEndpoint(failed.join(", "));
        setLastRefreshError(firstRejectedMessage(statusResult, eventsResult, logSettingsResult));
        setFailedRefreshCount((count) => count + 1);
        setLiveRefreshStatus(statusResult.status === "fulfilled" || eventsResult.status === "fulfilled" ? "stale" : "retrying");
        if (options.warnOnError !== false) {
          setLiveRefreshWarning(`Live refresh failed. Showing last successful data from ${lastRefreshedAt ? formatClockTime(lastRefreshedAt) : "the previous refresh"}. Retrying...`);
        }
        return statusResult.status === "fulfilled" || eventsResult.status === "fulfilled";
      }

      setLastRefreshedAt(now);
      setLiveRefreshWarning("");
      setLiveRefreshStatus("ok");
      setLastRefreshError(null);
      setFailedEndpoint(null);
      return true;
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
  }, [lastRefreshedAt, server.id]);

  async function refreshDashboardDataAfterAction(scope: RunDashboardActionInput<unknown>["refreshAfterSuccess"] = "full") {
    if (scope === false || scope === "none") return true;
    const scopes = scope === true || scope === undefined
      ? new Set<DashboardActionRefreshScope>(["full"])
      : new Set(Array.isArray(scope) ? scope : [scope]);
    const includeFull = scopes.has("full");
    const tasks: Array<Promise<unknown>> = [];

    if (includeFull || scopes.has("dashboard-health")) tasks.push(refreshDashboardHealth());
    if (includeFull || scopes.has("sync")) tasks.push(refreshSyncData({ warnOnError: false, queueIfBusy: true }));
    if (includeFull) tasks.push(onRefreshRef.current());
    if (includeFull || scopes.has("billing")) tasks.push(refreshBilling());
    if (includeFull || scopes.has("discord")) tasks.push(refreshDiscordChannels());
    if (includeFull || scopes.has("public-cache")) {
      tasks.push(getPublicCacheDebug(server.id).then((cacheDebug) => {
        setPublicCacheDebug(cacheDebug);
        setLastGoodPublicCache(cacheDebug);
      }));
    }
    if (includeFull || scopes.has("sync")) {
      tasks.push(getAutomationHealth().then((health) => {
        setAutomationHealth(health);
        setLastGoodAutomationHealth(health);
      }));
    }

    const results = await Promise.allSettled(tasks);
    const ok = results.every((result) => result.status === "fulfilled");
    if (!ok) {
      setFailedEndpoint("action-refresh");
      setLastRefreshError(firstRejectedMessage(...results));
      setFailedRefreshCount((count) => count + 1);
      setLiveRefreshStatus("stale");
      setLiveRefreshWarning(`Action completed, but dashboard refresh failed. Showing last successful data from ${lastRefreshedAt ? formatClockTime(lastRefreshedAt) : "the previous refresh"}.`);
    }
    return ok;
  }

  async function runDashboardAction<T>({
    actionKey,
    title,
    steps,
    run,
    onSuccess,
    onError,
    refreshAfterSuccess = "full",
    successSummary,
    major = false,
    autoHardRefreshOnComplete: hardRefresh = autoHardRefreshOnComplete,
  }: RunDashboardActionInput<T>): Promise<T | null> {
    const existing = dashboardActionRef.current;
    const allowInterrupt = actionKey === "cancel-import";
    if (existing && isActiveDashboardActionStatus(existing.status) && !allowInterrupt) {
      setActionMessage(existing.actionKey === actionKey
        ? `${existing.title} is already running.`
        : `${existing.title} is running. Wait for it to finish before starting another dashboard action.`);
      return null;
    }

    const startedAt = new Date().toISOString();
    const initialAction: DashboardActionProgress = {
      actionKey,
      title,
      status: "queued",
      progress: steps.length ? 0 : null,
      currentStepIndex: steps.length ? 1 : 0,
      totalSteps: steps.length,
      currentStep: steps[0] ?? "Starting action",
      detail: "Queued",
      startedAt,
      lastUpdatedAt: startedAt,
      indeterminate: !steps.length,
      major,
    };
    dashboardActionRef.current = initialAction;
    setDashboardAction(initialAction);
    saveDashboardActionState(server.id, initialAction);
    setActionMessage(`${title} started.`);

    const helpers: DashboardActionHelpers = {
      setStep: (stepIndex, detail, progress) => {
        const clampedStep = Math.max(1, Math.min(Math.max(steps.length, 1), stepIndex));
        updateDashboardAction({
          status: "running",
          currentStepIndex: clampedStep,
          currentStep: steps[clampedStep - 1] ?? `Step ${clampedStep}`,
          detail: detail ?? null,
          progress: progress ?? (steps.length ? ((clampedStep - 1) / steps.length) * 100 : null),
          indeterminate: progress === null,
          errorMessage: null,
          warningMessage: null,
        });
      },
      setDetail: (detail, progress) => updateDashboardAction({
        status: "running",
        detail,
        progress: progress ?? undefined,
        indeterminate: progress === null ? true : undefined,
      }),
      setProgress: (progress, detail) => updateDashboardAction({
        status: "running",
        progress,
        detail: detail ?? undefined,
        indeterminate: progress === null,
      }),
      setStats: (stats) => updateDashboardAction({ stats }),
      setPolling: (detail, progress) => updateDashboardAction({
        status: "polling",
        detail: detail ?? "Polling for updated status",
        progress: progress ?? undefined,
        indeterminate: progress === null,
      }),
      setWarning: (message, detail) => updateDashboardAction({
        status: "warning",
        warningMessage: message,
        detail: detail ?? null,
      }),
    };

    try {
      helpers.setStep(1, "Running");
      const result = await run(helpers);
      if (refreshAfterSuccess !== false && refreshAfterSuccess !== "none") {
        helpers.setStep(steps.length || 1, "Action completed. Refreshing dashboard data...", 96);
        await refreshDashboardDataAfterAction(refreshAfterSuccess);
      }
      await onSuccess?.(result);
      const completedAt = new Date().toISOString();
      const finalAction: DashboardActionProgress = {
        ...(dashboardActionRef.current ?? initialAction),
        status: "completed",
        progress: 100,
        currentStepIndex: Math.max(steps.length, 1),
        currentStep: steps[steps.length - 1] ?? "Completed",
        detail: "Dashboard data refreshed",
        successSummary: successSummary?.(result) ?? "Action completed.",
        errorMessage: null,
        lastUpdatedAt: completedAt,
      };
      dashboardActionRef.current = finalAction;
      setDashboardAction(finalAction);
      saveDashboardActionState(server.id, null);
      setActionMessage(finalAction.successSummary ?? "Action completed.");
      if (hardRefresh) {
        window.setTimeout(() => window.location.reload(), 1500);
      }
      return result;
    } catch (error) {
      await onError?.(error);
      const message = error instanceof Error ? error.message : "Dashboard action failed.";
      updateDashboardAction({
        status: "failed",
        errorMessage: message,
        detail: "Last-known dashboard data is still visible.",
      });
      setActionMessage(message);
      return null;
    }
  }

  function updateAdmChunkDashboardActionProgress(
    filename: string,
    progress: AdmImportJobProgressResult,
    metrics?: { chunksPerMinute: number | null; estimatedRemainingSeconds: number | null },
  ) {
    const action = dashboardActionRef.current;
    if (!action || !ADM_PROGRESS_ACTION_KEYS.has(action.actionKey) || !isActiveDashboardActionStatus(action.status)) return;
    const display = normalizeChunkProgress(progress);
    const percent = display.totalChunks > 0 ? Math.round((display.chunksProcessed / display.totalChunks) * 100) : null;
    updateDashboardAction({
      status: isCompletedAdmImportJobStatus(progress.status) ? "polling" : "running",
      progress: percent,
      currentStep: "Processing ADM chunks",
      detail: `${filename} chunk ${display.displayCurrentChunk}/${display.totalChunks}`,
      stats: {
        "Parsed kills": progress.parsed_kills,
        "Written kills": progress.written_kills,
        Joins: progress.joins,
        Disconnects: progress.disconnects,
        PlayerList: progress.playerlist_snapshots,
        Duplicates: progress.duplicate_skips,
        "Chunks/min": metrics?.chunksPerMinute ? Math.round(metrics.chunksPerMinute) : null,
        "ETA": metrics?.estimatedRemainingSeconds ? formatDuration(metrics.estimatedRemainingSeconds * 1000) : null,
      },
    });
  }

  const activeBulkAdmImportJob = findActiveAdmImportJobFromResult(bulkAdmImportResult);
  const activeAdmImportJobForPolling = syncStatusActiveAdmImportJob ?? activeBulkAdmImportJob ?? null;
  const activeAdmImportJobPollId = activeAdmImportJobForPolling?.job_id ?? null;
  const activeAdmImportJobPollStatus = activeAdmImportJobForPolling?.status ?? null;

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

  useEffect(() => {
    const jobId = activeAdmImportJobPollId;
    if (!jobId || !isActiveAdmImportJobStatus(activeAdmImportJobPollStatus)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await getAdmImportJobStatus(server.id, jobId);
        if (cancelled) return;
        if (!response.ok) return;
        setLastGoodAdmJob(response.job);
        const fileResult = makeProcessingBulkAdmFileResultFromJob(response.job, response.job.source);
        setBulkAdmImportResult((current) => replaceBulkAdmFileResult(
          current,
          fileResult,
          response.job.source,
          Math.max(current?.files_uploaded ?? 0, 1),
        ));
        if (isCompletedAdmImportJobStatus(response.job.status)) {
          void refreshSyncData({ warnOnError: false, queueIfBusy: true });
          void onRefreshRef.current().catch(() => null);
        }
      } catch {
        if (!cancelled) {
          setLiveRefreshWarning("Dashboard refresh failed, but ADM import job is still processing.");
          setLiveRefreshStatus("stale");
          setFailedEndpoint("adm-import-job-status");
          setFailedRefreshCount((count) => count + 1);
        }
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), ADM_IMPORT_JOB_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeAdmImportJobPollId, activeAdmImportJobPollStatus, refreshSyncData, server.id]);

  async function refreshNow() {
    await runDashboardAction({
      actionKey: "refresh-status",
      title: "Refreshing Dashboard Status",
      steps: ["Checking server metadata", "Refreshing sync status", "Refreshing dashboard"],
      refreshAfterSuccess: "dashboard-health",
      run: async (action) => {
        setActionMessage("");
        if (shouldRefreshServerInfo(server.metadata_last_checked_at)) {
          action.setStep(1, "Requesting fresh Nitrado metadata.");
          await refreshServerMetadata(server.id).catch(() => null);
          await onRefresh();
        }
        action.setStep(2, "Refreshing sync status and recent events.", 45);
        const refreshed = await refreshSyncData({ manual: true, warnOnError: true });
        if (!refreshed) action.setWarning("Refresh partially failed. Last-known data remains visible.");
        return refreshed;
      },
      successSummary: () => "Dashboard sync status refreshed. Use Run Manual Sync to process ADM log lines now.",
    });
  }

  async function refreshServerInfo() {
    await runDashboardAction({
      actionKey: "refresh-server-info",
      title: "Refreshing Server Info",
      steps: ["Requesting Nitrado status", "Updating metadata", "Refreshing dashboard"],
      refreshAfterSuccess: ["dashboard-health", "public-cache"],
      run: async (action) => {
        setRefreshingServerInfo(true);
        setActionMessage("");
        try {
          const beforePlayers = formatDashboardPlayerSlots(server.current_players, server.max_players ?? server.player_slots, server.player_count_last_checked_at, server.player_count_status);
          action.setStep(1, `Current player count before refresh: ${beforePlayers}.`);
          const result = await refreshServerMetadata(server.id);
          const patch = metadataPatchFromRefreshResult(result);
          setServerInfoOverride((current) => ({
            serverId: server.id,
            patch: {
              ...(current?.serverId === server.id ? current.patch : {}),
              ...patch,
            },
          }));
          action.setStep(2, "Metadata updated from Nitrado.", 70);
          action.setStats({
            "Players before": beforePlayers,
            "Players after": formatDashboardPlayerSlots(patch.current_players, patch.max_players ?? server.max_players ?? server.player_slots, patch.player_count_last_checked_at, patch.player_count_status),
          });
          await onRefresh();
          const cacheDebug = await getPublicCacheDebug(server.id).catch(() => null);
          if (cacheDebug) {
            setPublicCacheDebug(cacheDebug);
            setLastGoodPublicCache(cacheDebug);
          }
          return result;
        } finally {
          setRefreshingServerInfo(false);
        }
      },
      successSummary: () => "Server info checked from Nitrado just now.",
    });
  }

  async function saveNitradoChecklist(next: NitradoLogSettingsConfirmation) {
    await runDashboardAction({
      actionKey: "save-nitrado-log-settings",
      title: "Saving Nitrado Log Settings",
      steps: ["Saving settings", "Refreshing sync state"],
      refreshAfterSuccess: "sync",
      run: async (action) => {
        setSavingNitradoLogSettings(true);
        setActionMessage("");
        try {
          action.setStep(1, "Saving owner-confirmed Nitrado log settings.");
          const result = await saveNitradoLogSettings(server.id, next);
          setNitradoLogSettings(result.settings);
          setNitradoLogSettingsCheck(null);
          action.setStep(2, "Refreshing sync state.", 80);
          await refreshSyncData({ warnOnError: false, queueIfBusy: true });
          return result;
        } finally {
          setSavingNitradoLogSettings(false);
        }
      },
      successSummary: (result) => result.settings.nitrado_reduce_log_output_confirmed && result.settings.nitrado_log_playerlist_confirmed
        ? "Nitrado log settings confirmed for ADM tracking."
        : "Nitrado log settings checklist updated.",
    });
  }

  async function checkNitradoLogSettingsNow() {
    await runDashboardAction({
      actionKey: "check-nitrado-log-settings",
      title: "Checking Nitrado Log Settings",
      steps: ["Reading Nitrado settings", "Saving verification state", "Refreshing sync state"],
      refreshAfterSuccess: "sync",
      run: async (action) => {
        setCheckingNitradoLogSettings(true);
        setActionMessage("");
        try {
          action.setStep(1, "Checking Nitrado log settings.");
          const result = await getNitradoLogSettings(server.id, { check: true });
          setNitradoLogSettingsCheck(result);
          setNitradoLogSettings(result.saved_settings);
          action.setStep(2, result.verified ? "Verification state saved." : "Automatic verification was inconclusive.", 66);
          if (!result.valid && result.warnings?.length) action.setStats({ Warnings: result.warnings.length });
          await refreshSyncData({ warnOnError: false, queueIfBusy: true });
          return result;
        } finally {
          setCheckingNitradoLogSettings(false);
        }
      },
      successSummary: (result) => result.verified && result.valid
        ? "Nitrado log settings verified automatically by DZN."
        : result.verified && result.warnings?.length
          ? result.warnings.join(" ")
          : result.reason ?? "DZN could not verify these Nitrado settings automatically.",
    });
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
    await runDashboardAction({
      actionKey: "run-manual-sync",
      title: "Running Manual Sync",
      steps: ["Checking ADM availability", "Continuing or creating import job", "Refreshing stats and events"],
      refreshAfterSuccess: ["sync", "dashboard-health", "public-cache"],
      run: async (action) => {
        setSyncing(true);
        setActionMessage("");
        try {
          action.setStep(1, "Checking ADM availability.");
          const result = await runManualSync(server.id);
          setLastSyncResult(result);
          action.setStep(2, result.job ? `Active ADM job: ${result.job.filename}` : result.latestAdmFile ? `Latest ADM: ${result.latestAdmFile}` : "No active ADM job returned.", 70);
          action.setStats({
            "Lines read": result.linesRead ?? 0,
            "Lines processed": result.linesProcessed ?? 0,
            "Events": result.eventsCreated ?? 0,
            "Kills": result.killsCreated ?? 0,
          });
          return result;
        } finally {
          setSyncing(false);
        }
      },
      successSummary: getManualSyncMessage,
    });
  }

  async function importPastedAdmNow() {
    const filename = manualAdmFilename.trim();
    const admText = manualAdmText.trim();
    if (!filename) {
      setActionMessage("Enter the ADM filename before importing.");
      return;
    }
    if (!admText) {
      setActionMessage("Paste ADM log text before importing.");
      return;
    }

    await runDashboardAction({
      actionKey: "import-adm-paste",
      title: "Importing Pasted ADM",
      steps: ["Reading pasted ADM", "Importing events", "Refreshing stats and events"],
      refreshAfterSuccess: ["sync", "dashboard-health", "public-cache"],
      major: true,
      run: async (action) => {
        setManualAdmImporting(true);
        setActionMessage("");
        setManualAdmImportError(null);
        setAdmImportTotalsDelta(null);
        const beforeTotals = makeDashboardTotalsSnapshot(server, syncStatus);
        try {
          action.setStep(1, `Reading ${filename}.`);
          const response = await importManualAdmText(server.id, {
            filename,
            admText: manualAdmText,
            source: "manual_paste",
          });
          if (!response.ok) {
            setManualAdmImportError(response);
            throw new Error(response.message);
          }

          setManualAdmImportResult(response);
          action.setStep(2, `${response.parsed_kills} kills parsed, ${response.written_kills} kills written.`, 82);
          action.setStats({
            "Parsed kills": response.parsed_kills,
            "Written kills": response.written_kills,
            Joins: response.joins,
            Disconnects: response.disconnects,
          });
          await refreshDashboardAfterManualAdmImport(beforeTotals);
          return response;
        } catch (error) {
          const failure: ManualAdmImportErrorResult = {
            ok: false,
            error_code: "client_exception",
            message: error instanceof Error ? error.message : "Manual ADM import failed before a response was received.",
            details: error instanceof Error ? error.stack ?? error.message : String(error),
          };
          setManualAdmImportError(failure);
          throw new Error(failure.message);
        } finally {
          setManualAdmImporting(false);
        }
      },
      successSummary: () => "ADM import completed. Stats and feeds updated.",
    });
  }

  function buildAdmBulkFiles() {
    const files = manualAdmFiles.map((file) => ({ filename: file.filename, admText: file.admText }));
    const pastedFilename = manualAdmFilename.trim();
    const pastedText = manualAdmText.trim();
    if (pastedFilename && pastedText && !files.some((file) => file.filename === pastedFilename && file.admText === manualAdmText)) {
      files.push({ filename: pastedFilename, admText: manualAdmText });
    }
    return files;
  }

  function beginAdmChunkRunner(jobId: string, filename: string) {
    const runId = admChunkRunnerControlRef.current.runId + 1;
    admChunkRunnerControlRef.current = { paused: false, cancelled: false, runId };
    setAdmChunkRunnerPaused(false);
    setAdmChunkRunnerJob({ jobId, filename });
    return runId;
  }

  function isAdmChunkRunnerStopped(runId: number) {
    const control = admChunkRunnerControlRef.current;
    return control.runId !== runId || control.paused || control.cancelled;
  }

  function pauseAdmChunkRunner() {
    admChunkRunnerControlRef.current.paused = true;
    setAdmChunkRunnerPaused(true);
    updateDashboardAction({
      status: "warning",
      currentStep: "ADM import paused",
      detail: "Resume Import will continue from the saved chunk. Cron may continue in the background.",
      warningMessage: "ADM import paused by the dashboard user.",
    });
    setActionMessage("ADM import paused. Already written events remain saved; Resume Import will continue from the next chunk.");
  }

  async function cancelActiveAdmImportJob(filename?: string, jobId?: string | null) {
    const active = jobId
      ? { jobId, filename: filename ?? admChunkRunnerJob?.filename ?? "ADM import" }
      : admChunkRunnerJob;
    if (!active?.jobId) {
      setActionMessage("No active ADM import job is available to cancel.");
      return;
    }
    const confirmed = window.confirm("Cancel this ADM import job? Already imported events and stats will remain saved.");
    if (!confirmed) return;
    await runDashboardAction({
      actionKey: "cancel-import",
      title: "Cancelling ADM Import",
      steps: ["Stopping browser runner", "Marking job cancelled", "Refreshing import status"],
      refreshAfterSuccess: "sync",
      run: async (action) => {
        admChunkRunnerControlRef.current.cancelled = true;
        setAdmChunkRunnerPaused(false);
        action.setStep(1, "Stopping the active browser chunk runner.");
        setManualAdmImporting(true);
        try {
          action.setStep(2, `Cancelling ${active.filename}.`, 55);
          const cancelled = await cancelAdmImportJob(server.id, active.jobId);
          if (!cancelled.ok) {
            setBulkAdmImportError(cancelled);
            throw new Error(cancelled.message);
          }
          setBulkAdmImportResult((current) => replaceBulkAdmFileResult(
            current,
            makeProcessingBulkAdmFileResultFromJob(cancelled, cancelled.source),
            cancelled.source,
            Math.max(current?.files_uploaded ?? 1, 1),
          ));
          return cancelled;
        } finally {
          setManualAdmImporting(false);
          setAdmChunkRunnerJob(null);
          setBulkAdmImportProgress(null);
        }
      },
      successSummary: () => `${active.filename} was cancelled. Already imported events remain saved.`,
    });
  }

  async function previewAdmFilesNow() {
    const files = buildAdmBulkFiles();
    if (!files.length) {
      setActionMessage("Upload ADM files or paste ADM text before previewing.");
      return;
    }

    await runDashboardAction({
      actionKey: "preview-adm-files",
      title: "Previewing ADM Files",
      steps: ["Reading selected files", "Parsing preview", "Showing results"],
      refreshAfterSuccess: false,
      run: async (action) => {
        setManualAdmPreviewing(true);
        setManualAdmImportError(null);
        setBulkAdmImportError(null);
        setAdmImportTotalsDelta(null);
        setActionMessage("");
        try {
          action.setStep(1, `Reading ${files.length} selected ADM file${files.length === 1 ? "" : "s"}.`);
          const response = await bulkImportAdmFiles(server.id, {
            files,
            source: "manual_file_upload",
            preview: true,
          });
          if (!response.ok) {
            setBulkAdmImportError(response);
            throw new Error(response.message);
          }
          setBulkAdmImportResult(response);
          action.setStep(2, `${response.parsed_kills} PvP kills found in preview.`, 82);
          action.setStats({
            Files: response.files_uploaded,
            "Parsed kills": response.parsed_kills,
          });
          return response;
        } catch (error) {
          const failure = makeClientAdmFailure(error, "bulk_preview_exception", "ADM file preview failed before a response was received.");
          setBulkAdmImportError(failure);
          throw new Error(failure.message);
        } finally {
          setManualAdmPreviewing(false);
        }
      },
      successSummary: (response) => `ADM file preview found ${response.parsed_kills} PvP kills across ${response.files_uploaded} file${response.files_uploaded === 1 ? "" : "s"}.`,
    });
  }

  async function importAdmFilesNow() {
    const files = buildAdmBulkFiles();
    if (!files.length) {
      setActionMessage("Upload ADM files or paste ADM text before importing.");
      return;
    }

    await runDashboardAction({
      actionKey: "import-adm-files",
      title: "Importing ADM Files",
      steps: ["Reading selected files", "Creating chunk jobs", "Processing chunks", "Finishing imports", "Refreshing stats and events"],
      refreshAfterSuccess: ["sync", "dashboard-health", "public-cache"],
      major: true,
      run: async (action) => {
        setManualAdmImporting(true);
        setBulkAdmImportProgress({ current: 0, total: files.length, filename: null });
        setActionMessage("");
        setManualAdmImportError(null);
        setBulkAdmImportError(null);
        setAdmImportTotalsDelta(null);
        setBulkAdmImportResult(summarizeClientBulkAdmResults([], manualAdmFiles.length ? "manual_file_upload" : "manual_paste", files.length));
        const source = manualAdmFiles.length ? "manual_file_upload" : "manual_paste";
        const fileResults: BulkAdmFileResult[] = [];
        const beforeTotals = makeDashboardTotalsSnapshot(server, syncStatus);
        try {
          action.setStep(1, `Preparing ${files.length} ADM file${files.length === 1 ? "" : "s"}.`);
          for (const [index, file] of files.entries()) {
            const filePercent = Math.round((index / Math.max(files.length, 1)) * 100);
            action.setStep(2, `Creating or attaching chunk job for ${file.filename}.`, filePercent);
            setBulkAdmImportProgress({ current: index + 1, total: files.length, filename: file.filename });
            const fileResult = await importSingleAdmFileInChunks(file, source, index + 1, files.length);
            fileResults.push(fileResult);
            setBulkAdmImportResult(summarizeClientBulkAdmResults([...fileResults], source, files.length));
            if (isProcessingBulkAdmFile(fileResult)) {
              action.setWarning(
                admChunkRunnerControlRef.current.paused ? "ADM import paused." : "ADM import is still processing.",
                admChunkRunnerControlRef.current.paused
                  ? "Resume Import will continue from the saved chunk."
                  : "Continue Import can keep the browser runner attached; cron remains the backup.",
              );
              return summarizeClientBulkAdmResults(fileResults, source, files.length);
            }
          }

          const response = summarizeClientBulkAdmResults(fileResults, source, files.length);
          setBulkAdmImportResult(response);
          action.setStep(4, "Finishing imports and rebuilding stats.", 92);
          await refreshDashboardAfterManualAdmImport(beforeTotals);
          return response;
        } catch (error) {
          const failure = makeClientAdmFailure(error, "bulk_import_exception", "Bulk ADM import failed before a response was received.");
          setBulkAdmImportError(failure);
          throw new Error(failure.message);
        } finally {
          setManualAdmImporting(false);
          if (!admChunkRunnerControlRef.current.paused) setAdmChunkRunnerJob(null);
          setBulkAdmImportProgress(null);
        }
      },
      successSummary: () => "ADM import completed. Stats and feeds updated.",
    });
  }

  async function retryBulkAdmFile(filename: string) {
    const file = buildAdmBulkFiles().find((candidate) => candidate.filename === filename);
    if (!file) {
      setBulkAdmImportError({
        ok: false,
        error_code: "adm_file_not_available_for_retry",
        message: "That ADM file is no longer selected. Re-upload it before retrying.",
        details: { filename },
      });
      return;
    }

    const source = manualAdmFiles.length ? "manual_file_upload" : "manual_paste";
    const selectedCount = Math.max(buildAdmBulkFiles().length, bulkAdmImportResult?.files_uploaded ?? 1);
    setManualAdmImporting(true);
    setBulkAdmImportProgress({ current: 1, total: 1, filename: file.filename });
    setActionMessage("");
    setBulkAdmImportError(null);
    setAdmImportTotalsDelta(null);
    const beforeTotals = makeDashboardTotalsSnapshot(server, syncStatus);
    try {
      const fileResult = await importSingleAdmFileInChunks(file, source, 1, 1);
      const merged = replaceBulkAdmFileResult(bulkAdmImportResult, fileResult, source, selectedCount);
      setBulkAdmImportResult(merged);
      const refreshed = await refreshDashboardAfterManualAdmImport(beforeTotals);
      setActionMessage(refreshed
        ? "ADM import completed. Stats and feeds updated."
        : `Retry complete for ${file.filename}, but dashboard refresh failed. Hard refresh or retry refresh.`);
    } catch (error) {
      const failure = makeClientAdmFailure(error, "bulk_retry_exception", "ADM file retry failed before a response was received.");
      setBulkAdmImportError(failure);
      setBulkAdmImportResult((current) => replaceBulkAdmFileResult(
        current,
        makeFailedBulkAdmFileResult(file, failure, source),
        source,
        selectedCount,
      ));
      setActionMessage(`ADM file retry failed: ${failure.message}`);
    } finally {
      setManualAdmImporting(false);
      if (!admChunkRunnerControlRef.current.paused) setAdmChunkRunnerJob(null);
      setBulkAdmImportProgress(null);
    }
  }

  async function continueBulkAdmFile(filename: string, jobId?: string | null) {
    const selectedFile = buildAdmBulkFiles().find((candidate) => candidate.filename === filename);
    const source = selectedFile ? (manualAdmFiles.length ? "manual_file_upload" : "manual_paste") : bulkAdmImportResult?.source ?? "manual_file_upload";
    const selectedCount = Math.max(buildAdmBulkFiles().length, bulkAdmImportResult?.files_uploaded ?? 1);
    await runDashboardAction({
      actionKey: admChunkRunnerPaused ? "resume-import" : "continue-import",
      title: admChunkRunnerPaused ? "Resuming ADM Import" : "Continuing ADM Import",
      steps: ["Attaching to chunk job", "Processing ADM chunks", "Finishing import", "Refreshing stats and events"],
      refreshAfterSuccess: ["sync", "dashboard-health", "public-cache"],
      major: true,
      run: async (action) => {
        setManualAdmImporting(true);
        setBulkAdmImportProgress({ current: 1, total: 1, filename });
        setActionMessage("");
        setBulkAdmImportError(null);
        const beforeTotals = makeDashboardTotalsSnapshot(server, syncStatus);
        try {
          action.setStep(1, `Attaching to ${filename}.`);
          if (selectedFile) {
            const fileResult = await importSingleAdmFileInChunks(selectedFile, source, 1, 1);
            setBulkAdmImportResult((current) => replaceBulkAdmFileResult(current, fileResult, source, selectedCount));
          } else if (jobId) {
            await runServerSideAdmImportJobToCompletion(filename, jobId, source, selectedCount);
          } else {
            const latest = await getLatestAdmImportJob(server.id, filename);
            if (latest.ok && (isActiveAdmImportJobStatus(latest.job.status) || latest.job.status === "failed_retryable")) {
              setBulkAdmImportResult((current) => replaceBulkAdmFileResult(
                current,
                makeProcessingBulkAdmFileResultFromJob(latest.job, latest.job.source),
                latest.job.source,
                selectedCount,
              ));
              await runServerSideAdmImportJobToCompletion(filename, latest.job.job_id, latest.job.source, selectedCount);
            } else {
              const failure = {
                ok: false,
                error_code: "adm_import_job_unavailable",
                message: "No selected file or active import job is available. Reselect the ADM file to continue.",
                details: { filename },
              } satisfies ManualAdmImportErrorResult;
              setBulkAdmImportError(failure);
              throw new Error(failure.message);
            }
          }
          if (admChunkRunnerControlRef.current.paused) {
            action.setWarning("ADM import paused.", "Resume Import will continue from the saved chunk.");
            return null;
          }
          action.setStep(3, "Finishing import and refreshing totals.", 94);
          await refreshDashboardAfterManualAdmImport(beforeTotals);
          return null;
        } catch (error) {
          const failure = makeClientAdmFailure(error, "adm_import_continue_exception", "ADM import continue failed before a response was received.");
          setBulkAdmImportError(failure);
          throw new Error(failure.message);
        } finally {
          setManualAdmImporting(false);
          if (!admChunkRunnerControlRef.current.paused) setAdmChunkRunnerJob(null);
          setBulkAdmImportProgress(null);
        }
      },
      successSummary: () => admChunkRunnerPaused
        ? "ADM import resumed. Stats and feeds updated from the latest available progress."
        : "ADM import job continued. Stats and feeds updated from the latest available progress.",
    });
  }

  async function runServerSideAdmImportJobToCompletion(
    filename: string,
    jobId: string,
    source: string,
    selectedCount: number,
  ) {
    const runId = beginAdmChunkRunner(jobId, filename);
    const runnerStartedAt = Date.now();
    let progress = await getAdmImportJobStatus(server.id, jobId)
      .then((status) => (status.ok ? status.job : null))
      .catch(() => null);
    const startingChunksProcessed = progress ? normalizeChunkProgress(progress).chunksProcessed : 0;
    let browserChunksProcessed = 0;

    while (browserChunksProcessed < ADM_CHUNK_RUNNER_MAX_BROWSER_CHUNKS) {
      if (isAdmChunkRunnerStopped(runId)) return;
      let continued = await continueAdmImportJob(server.id, jobId);
      if (!continued.ok && isAdmRateLimitedFailure(continued)) {
        setBulkAdmImportProgress((current) => current ? { ...current, status: "rate limited - backing off", runnerState: "running" } : current);
        await sleep(ADM_CHUNK_RUNNER_RATE_LIMIT_DELAY_MS);
        continued = await continueAdmImportJob(server.id, jobId);
      }
      if (!continued.ok) {
        setBulkAdmImportError(continued);
        setActionMessage(`${filename} could not continue from the server-side job. Reselect the file if this was a manual upload.`);
        return;
      }
      const nextProgress = continued;
      progress = nextProgress;
      browserChunksProcessed += 1;
      const display = normalizeChunkProgress(nextProgress);
      const metrics = makeAdmChunkRunnerMetrics(runnerStartedAt, startingChunksProcessed, display.chunksProcessed, display.totalChunks);
      setBulkAdmImportResult((current) => replaceBulkAdmFileResult(
        current,
        makeProcessingBulkAdmFileResultFromJob(nextProgress, nextProgress.source ?? source),
        nextProgress.source ?? source,
        selectedCount,
      ));
      setBulkAdmImportProgress({
        current: 1,
        total: 1,
        filename,
        chunkCurrent: display.displayCurrentChunk,
        chunkTotal: display.totalChunks,
        status: nextProgress.already_processed ? "chunk already processed - advancing" : nextProgress.status,
        writtenKills: nextProgress.written_kills,
        duplicateSkips: nextProgress.duplicate_skips,
        chunksPerMinute: metrics.chunksPerMinute,
        estimatedRemainingSeconds: metrics.estimatedRemainingSeconds,
        lastChunkAt: nextProgress.updated_at ?? new Date().toISOString(),
        activeInBrowser: true,
        runnerState: isCompletedAdmImportJobStatus(nextProgress.status) ? "finishing" : "running",
      });
      updateAdmChunkDashboardActionProgress(filename, nextProgress, metrics);
      if (isCompletedAdmImportJobStatus(nextProgress.status) || nextProgress.status === "failed" || nextProgress.status === "failed_retryable" || nextProgress.status === "cancelled") {
        return;
      }
      await sleep(ADM_CHUNK_RUNNER_DELAY_MS);
    }

    setActionMessage("ADM chunk runner reached the browser safety limit. Use Resume Import to continue.");
  }

  async function importSingleAdmFileInChunks(
    file: { filename: string; admText: string },
    source: string,
    fileIndex: number,
    fileTotal: number,
  ): Promise<BulkAdmFileResult> {
    const lines = splitAdmTextForUpload(file.admText);
    if (!lines.length) {
      return makeFailedBulkAdmFileResult(file, {
        ok: false,
        error_code: "empty_adm_file",
        message: "ADM file did not contain readable lines.",
        details: { filename: file.filename },
      }, source);
    }
    const chunks = chunkAdmLinesForUpload(lines, ADM_IMPORT_UPLOAD_CHUNK_SIZE);
    const created = await startAdmImportJob(server.id, {
      filename: file.filename,
      totalLines: lines.length,
      totalChunks: chunks.length,
      chunkSize: ADM_IMPORT_UPLOAD_CHUNK_SIZE,
      source,
      importHitLines: manualAdmImportHitLines,
    });
    if (!created.ok) {
      return makeFailedBulkAdmFileResult(file, {
        ...created,
        details: {
          ...(typeof created.details === "object" && created.details ? created.details : {}),
          endpoint: "/adm/import-job/start",
          client_file_read_ok: true,
          client_total_lines: lines.length,
          client_total_chunks: chunks.length,
        },
      }, source);
    }

    let progress: AdmImportJobProgressResult = created;
    const runId = beginAdmChunkRunner(progress.job_id, file.filename);
    const runnerStartedAt = Date.now();
    const startingChunksProcessed = normalizeChunkProgress(progress).chunksProcessed;
    setBulkAdmImportResult((current) => replaceBulkAdmFileResult(
      current,
      makeProcessingBulkAdmFileResultFromJob(progress, source),
      source,
      fileTotal,
    ));
    setBulkAdmImportProgress({
      current: fileIndex,
      total: fileTotal,
      filename: file.filename,
      chunkCurrent: normalizeChunkProgress(progress).displayCurrentChunk,
      chunkTotal: normalizeChunkProgress(progress).totalChunks,
      status: "browser runner active",
      writtenKills: progress.written_kills,
      duplicateSkips: progress.duplicate_skips,
      activeInBrowser: true,
      runnerState: "running",
    });
    updateAdmChunkDashboardActionProgress(file.filename, progress);

    let browserChunksProcessed = 0;
    while (progress.current_line < lines.length && !isCompletedAdmImportJobStatus(progress.status)) {
      if (isAdmChunkRunnerStopped(runId)) {
        return makeProcessingBulkAdmFileResultFromJob(progress, source);
      }
      if (browserChunksProcessed >= ADM_CHUNK_RUNNER_MAX_BROWSER_CHUNKS) {
        return makeFailedBulkAdmFileResult(file, {
          ok: false,
          error_code: "adm_chunk_runner_safety_limit",
          message: "ADM chunk runner stopped at the browser safety limit. Use Resume Import to continue.",
          details: { job_id: progress.job_id, chunks_processed: progress.chunks_processed, total_chunks: progress.total_chunks },
        }, source);
      }
      const chunkIndex = Math.max(0, Math.floor(progress.current_line / ADM_IMPORT_UPLOAD_CHUNK_SIZE));
      const chunk = {
        index: chunkIndex,
        startLine: progress.current_line,
        lines: lines.slice(progress.current_line, Math.min(lines.length, progress.current_line + ADM_IMPORT_UPLOAD_CHUNK_SIZE)),
      };
      const progressDisplay = normalizeChunkProgress(progress);
      const metrics = makeAdmChunkRunnerMetrics(runnerStartedAt, startingChunksProcessed, progressDisplay.chunksProcessed, progressDisplay.totalChunks);
      setBulkAdmImportProgress({
        current: fileIndex,
        total: fileTotal,
        filename: file.filename,
        chunkCurrent: progressDisplay.displayCurrentChunk,
        chunkTotal: progressDisplay.totalChunks,
        status: `processing chunk ${chunk.index + 1}/${chunks.length}`,
        writtenKills: progress.written_kills,
        duplicateSkips: progress.duplicate_skips,
        chunksPerMinute: metrics.chunksPerMinute,
        estimatedRemainingSeconds: metrics.estimatedRemainingSeconds,
        lastChunkAt: progress.updated_at ?? null,
        activeInBrowser: true,
        runnerState: "running",
      });
      updateAdmChunkDashboardActionProgress(file.filename, progress, metrics);
      let next = await sendAdmImportChunkWithFallback({
        file,
        source,
        jobId: progress.job_id,
        chunkIndex: chunk.index,
        startLine: chunk.startLine,
        lines: chunk.lines,
        allLines: lines,
        progress,
        totalChunks: chunks.length,
      });
      if (!next.ok && isAdmRateLimitedFailure(next)) {
        setBulkAdmImportProgress((current) => current ? { ...current, status: "rate limited - backing off", runnerState: "running" } : current);
        await sleep(ADM_CHUNK_RUNNER_RATE_LIMIT_DELAY_MS);
        next = await sendAdmImportChunkWithFallback({
          file,
          source,
          jobId: progress.job_id,
          chunkIndex: chunk.index,
          startLine: chunk.startLine,
          lines: chunk.lines,
          allLines: lines,
          progress,
          totalChunks: chunks.length,
        });
      }
      if (!next.ok) {
        return makeFailedBulkAdmFileResult(file, next, source);
      }
      progress = next;
      browserChunksProcessed += 1;
      setBulkAdmImportResult((current) => replaceBulkAdmFileResult(
        current,
        makeProcessingBulkAdmFileResultFromJob(progress, source),
        source,
        fileTotal,
      ));
      const nextDisplay = normalizeChunkProgress(progress);
      const nextMetrics = makeAdmChunkRunnerMetrics(runnerStartedAt, startingChunksProcessed, nextDisplay.chunksProcessed, nextDisplay.totalChunks);
      setBulkAdmImportProgress({
        current: fileIndex,
        total: fileTotal,
        filename: file.filename,
        chunkCurrent: nextDisplay.displayCurrentChunk,
        chunkTotal: nextDisplay.totalChunks,
        status: progress.already_processed ? "chunk already processed - advancing" : progress.status,
        writtenKills: progress.written_kills,
        duplicateSkips: progress.duplicate_skips,
        chunksPerMinute: nextMetrics.chunksPerMinute,
        estimatedRemainingSeconds: nextMetrics.estimatedRemainingSeconds,
        lastChunkAt: progress.updated_at ?? new Date().toISOString(),
        activeInBrowser: true,
        runnerState: isCompletedAdmImportJobStatus(progress.status) ? "finishing" : "running",
      });
      updateAdmChunkDashboardActionProgress(file.filename, progress, nextMetrics);
      if (progress.current_line < lines.length && !isCompletedAdmImportJobStatus(progress.status)) {
        await sleep(ADM_CHUNK_RUNNER_DELAY_MS);
      }
    }

    if (isCompletedAdmImportJobStatus(progress.status)) {
      return progress.file_result ?? makeProcessingBulkAdmFileResultFromJob(progress, source);
    }

    setBulkAdmImportProgress({
      current: fileIndex,
      total: fileTotal,
      filename: file.filename,
      chunkCurrent: normalizeChunkProgress(progress).displayCurrentChunk,
      chunkTotal: normalizeChunkProgress(progress).totalChunks,
      status: "finishing",
      writtenKills: progress.written_kills,
      duplicateSkips: progress.duplicate_skips,
      activeInBrowser: true,
      runnerState: "finishing",
    });
    updateAdmChunkDashboardActionProgress(file.filename, progress);
    const finished = await finishAdmImportJob(server.id, progress.job_id);
    if (!finished.ok) {
      if (progress.current_line >= lines.length) {
        return makeWarningBulkAdmFileResultFromProgress(file, progress, finished, source, lines.length, chunks.length);
      }
      return makeFailedBulkAdmFileResult(file, {
        ...finished,
        details: {
          ...(typeof finished.details === "object" && finished.details ? finished.details : {}),
          endpoint: "/adm/import-job/finish",
          job_id: progress.job_id,
          job_status: progress.status,
          chunks_processed: progress.chunks_processed,
          total_chunks: progress.total_chunks,
          written_kills: progress.written_kills,
          duplicate_skips: progress.duplicate_skips,
          client_file_read_ok: file.admText.length > 0,
          client_total_lines: lines.length,
          client_total_chunks: chunks.length,
        },
      }, source);
    }
    progress = finished;
    updateAdmChunkDashboardActionProgress(file.filename, progress);

    return progress.file_result ?? makeWarningBulkAdmFileResultFromProgress(file, progress, {
      ok: false,
      error_code: "missing_file_result",
      message: "ADM import job completed without a file result. DZN preserved the accumulated job counters.",
      details: progress,
      http_status: progress.http_status,
      response_body: progress.response_body,
    }, source, lines.length, chunks.length);
  }

  async function sendAdmImportChunkWithFallback(input: {
    file: { filename: string; admText: string };
    source: string;
    jobId: string;
    chunkIndex: number;
    startLine: number;
    lines: string[];
    allLines: string[];
    progress: AdmImportJobProgressResult;
    totalChunks: number;
  }): Promise<AdmImportJobProgressResult | ManualAdmImportErrorResult> {
    const firstAttempt = await sendAdmImportChunkAttempt(input, input.lines, input.startLine, input.chunkIndex, ADM_IMPORT_UPLOAD_CHUNK_SIZE);
    if (firstAttempt.ok) return firstAttempt;

    for (const retrySize of ADM_IMPORT_RETRY_CHUNK_SIZES) {
      const retryResult = await sendAdmImportChunkRangeInSmallerPieces(input, retrySize, firstAttempt);
      if (retryResult.ok) return retryResult;
      if (retrySize === 1) return retryResult;
    }
    return firstAttempt;
  }

  async function sendAdmImportChunkRangeInSmallerPieces(
    input: {
      file: { filename: string; admText: string };
      source: string;
      jobId: string;
      chunkIndex: number;
      startLine: number;
      lines: string[];
      allLines: string[];
      progress: AdmImportJobProgressResult;
      totalChunks: number;
    },
    retrySize: number,
    originalFailure: ManualAdmImportErrorResult,
  ): Promise<AdmImportJobProgressResult | ManualAdmImportErrorResult> {
    let latestProgress = input.progress;
    for (let offset = 0; offset < input.lines.length; offset += retrySize) {
      const subLines = input.lines.slice(offset, offset + retrySize);
      const subStartLine = input.startLine + offset;
      const subAttempt = await sendAdmImportChunkAttempt(input, subLines, subStartLine, input.chunkIndex, retrySize, originalFailure);
      if (!subAttempt.ok) return subAttempt;
      latestProgress = subAttempt;
    }
    return latestProgress;
  }

  async function sendAdmImportChunkAttempt(
    input: {
      file: { filename: string; admText: string };
      source: string;
      jobId: string;
      chunkIndex: number;
      startLine: number;
      lines: string[];
      allLines: string[];
      progress: AdmImportJobProgressResult;
      totalChunks: number;
    },
    linesToSend: string[],
    startLine: number,
    chunkIndex: number,
    attemptedChunkSize: number,
    previousFailure?: ManualAdmImportErrorResult,
  ): Promise<AdmImportJobProgressResult | ManualAdmImportErrorResult> {
    const response = await sendAdmImportJobChunk(server.id, {
      jobId: input.jobId,
      filename: input.file.filename,
      chunkIndex,
      startLine,
      lines: linesToSend,
      previousLines: input.allLines.slice(Math.max(0, startLine - ADM_IMPORT_PREVIOUS_LINE_CONTEXT), startLine),
    });
    if (response.ok) return response;
    return {
      ...response,
      details: {
        ...(typeof response.details === "object" && response.details ? response.details : {}),
        previous_error_code: previousFailure?.error_code,
        previous_message: previousFailure?.message,
        endpoint: "/adm/import-job/chunk",
        chunk_index: chunkIndex,
        attempted_chunk_size: attemptedChunkSize,
        start_line: startLine,
        end_line: startLine + linesToSend.length,
        first_failed_line_number: startLine + 1,
        first_failed_line_preview: linesToSend[0]?.slice(0, 180) ?? "",
        job_id: input.jobId,
        job_status: input.progress.status,
        chunks_processed: input.progress.chunks_processed,
        total_chunks: input.totalChunks,
        written_kills: input.progress.written_kills,
        duplicate_skips: input.progress.duplicate_skips,
        client_file_read_ok: input.file.admText.length > 0,
        client_total_lines: input.allLines.length,
        client_total_chunks: input.totalChunks,
      },
    };
  }

  async function forceProcessLatestAdmNow() {
    await runDashboardAction({
      actionKey: "force-process-latest-adm",
      title: "Force Processing Latest ADM",
      steps: ["Discovering latest ADM", "Creating or attaching import job", "Processing first chunks", "Continuing in background", "Refreshing dashboard"],
      refreshAfterSuccess: ["sync", "dashboard-health", "public-cache"],
      major: true,
      run: async (action) => {
        setForceLatestAdmRunning(true);
        setActionMessage("");
        try {
          action.setStep(1, "Discovering latest readable ADM.");
          const response = await forceProcessLatestAdm(server.id);
          if ("ok" in response && response.ok === false) {
            throw new Error(response.message);
          }
          setLastSyncResult(response);
          setForceLatestAdmResult(response);
          action.setStep(3, response.job ? `${response.job.filename} chunk ${normalizeChunkProgress(response.job).displayCurrentChunk}/${normalizeChunkProgress(response.job).totalChunks}` : "Latest ADM processed.", 72);
          if (response.job) updateAdmChunkDashboardActionProgress(response.job.filename, response.job);
          await refreshDashboardAfterManualAdmImport();
          return response;
        } finally {
          setForceLatestAdmRunning(false);
        }
      },
      successSummary: getManualSyncMessage,
    });
  }

  async function backfillMissingAdmNow() {
    await runDashboardAction({
      actionKey: "backfill-missing-adm",
      title: "Running ADM Backfill",
      steps: ["Discovering missing ADM files", "Queueing missing jobs", "Starting active job", "Refreshing dashboard"],
      refreshAfterSuccess: ["sync", "dashboard-health", "public-cache"],
      major: true,
      run: async (action) => {
        setAdmBackfillRunning(true);
        setActionMessage("");
        try {
          action.setStep(1, "Discovering missing ADM files from Nitrado.");
          const response = await backfillMissingAdm(server.id);
          if ("ok" in response && response.ok === false && "message" in response) {
            throw new Error(response.message);
          }
          setAdmBackfillResult(response);
          action.setStep(2, response.message, 70);
          action.setStats(makeBackfillActionStats(response));
          return response;
        } finally {
          setAdmBackfillRunning(false);
        }
      },
      successSummary: (response) => response.message,
    });
  }

  async function verifyAdmAutomationNow() {
    await runDashboardAction({
      actionKey: "verify-adm-automation",
      title: "Verifying ADM Automation",
      steps: ["Checking cron", "Checking active jobs", "Checking backfill", "Checking stats and events"],
      refreshAfterSuccess: "dashboard-health",
      run: async (action) => {
        setVerifyingAdmAutomation(true);
        setActionMessage("");
        try {
          action.setStep(1, "Checking cron and automation status.");
          const response = await getAdmAutomationStatus(server.id);
          if (!response.ok) {
            throw new Error(response.message);
          }
          setAdmAutomationStatus(response);
          action.setStep(2, response.active_job ? `Active job: ${response.active_job.filename}` : "No active job.", 54);
          action.setStats({
            "Cron healthy": response.cron?.cron_healthy ? "Yes" : "No",
            "Latest ADM": response.adm?.newest_available_adm_filename ?? "Waiting",
            "Active jobs": response.active_job ? 1 : 0,
            "Recent events": response.recent_events_count ?? 0,
            Warnings: response.problem_flags?.length ?? 0,
          });
          return response;
        } finally {
          setVerifyingAdmAutomation(false);
        }
      },
      successSummary: (response) => response.next_action,
    });
  }

  async function previewPastedAdmNow() {
    const filename = manualAdmFilename.trim();
    const admText = manualAdmText.trim();
    if (!filename) {
      setActionMessage("Enter the ADM filename before previewing.");
      return;
    }
    if (!admText) {
      setActionMessage("Paste ADM log text before previewing.");
      return;
    }

    await runDashboardAction({
      actionKey: "preview-adm-paste",
      title: "Previewing Pasted ADM",
      steps: ["Reading pasted ADM", "Parsing preview", "Showing results"],
      refreshAfterSuccess: false,
      run: async (action) => {
        setManualAdmPreviewing(true);
        setManualAdmImportError(null);
        setActionMessage("");
        try {
          action.setStep(1, `Reading ${filename}.`);
          const response = await previewManualAdmText(server.id, { filename, admText: manualAdmText });
          if (!response.ok) {
            setManualAdmImportError(response);
            throw new Error(response.message);
          }
          setManualAdmParsePreview(response);
          action.setStep(2, `${response.parsed_kills} PvP kills found.`, 82);
          action.setStats({
            "Parsed kills": response.parsed_kills,
            "Raw lines": response.raw_lines,
          });
          return response;
        } catch (error) {
          const failure: ManualAdmImportErrorResult = {
            ok: false,
            error_code: "client_exception",
            message: error instanceof Error ? error.message : "ADM parse preview failed before a response was received.",
            details: error instanceof Error ? error.stack ?? error.message : String(error),
          };
          setManualAdmImportError(failure);
          throw new Error(failure.message);
        } finally {
          setManualAdmPreviewing(false);
        }
      },
      successSummary: (response) => `ADM preview found ${response.parsed_kills} PvP kill${response.parsed_kills === 1 ? "" : "s"}.`,
    });
  }

  async function loadManualAdmFile(file: File | null) {
    if (!file) return;
    setManualAdmFilename(file.name);
    setManualAdmText(await file.text());
  }

  async function loadManualAdmFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    const loaded = await Promise.all(Array.from(files).map(async (file) => {
      const admText = await file.text();
      return {
        filename: file.name,
        admText,
        size: file.size,
        preview: buildAdmUploadPreview(file.name, admText),
      };
    }));
    setManualAdmFiles(loaded);
    if (loaded[0]) {
      setManualAdmFilename(loaded[0].filename);
      setManualAdmText(loaded[0].admText);
    }
    setBulkAdmImportResult(null);
    setBulkAdmImportError(null);
    setAdmImportTotalsDelta(null);
    setManualAdmImportResult(null);
    setManualAdmImportError(null);
    setManualAdmParsePreview(null);
  }

  async function refreshDashboardAfterManualAdmImport(beforeTotals?: DashboardTotalsSnapshot) {
    setManualAdmRefreshFailed(false);
    setRefreshingSyncData(true);
    const [authRefresh, statusResult, eventsResult, publicCacheResult, automationResult] = await Promise.allSettled([
      getMe(),
      getSyncStatus(server.id),
      getRecentSyncEvents(server.id),
      getPublicCacheDebug(server.id),
      getAutomationHealth(),
    ]);

    let refreshedServer: LinkedServer | null = null;
    if (authRefresh.status === "fulfilled" && authRefresh.value.authenticated) {
      refreshedServer = findLinkedServerInAuthResponse(authRefresh.value, server.id);
      if (refreshedServer) {
        setServerInfoOverride({ serverId: server.id, patch: refreshedServer });
      }
      void onRefreshRef.current().catch(() => null);
    }

    if (statusResult.status === "fulfilled") setSyncStatus(statusResult.value.status);
    if (eventsResult.status === "fulfilled") setRecentEvents(eventsResult.value.events);
    if (publicCacheResult.status === "fulfilled") setPublicCacheDebug(publicCacheResult.value);
    if (automationResult.status === "fulfilled") setAutomationHealth(automationResult.value);

    if (beforeTotals) {
      const afterStatus = statusResult.status === "fulfilled" ? statusResult.value.status : syncStatus;
      const afterServer = refreshedServer ? { ...server, ...refreshedServer } : server;
      if (afterStatus) {
        setAdmImportTotalsDelta(makeDashboardTotalsDelta(beforeTotals, makeDashboardTotalsSnapshot(afterServer, afterStatus)));
      }
    }

    const ok = [authRefresh, statusResult, eventsResult, publicCacheResult].every((result) => result.status === "fulfilled");
    if (ok) {
      setLastRefreshedAt(new Date().toISOString());
      setLiveRefreshWarning("");
    } else {
      setManualAdmRefreshFailed(true);
    }
    setRefreshingSyncData(false);
    return ok;
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

  async function checkAdmFileDiscoveryNow() {
    await runDashboardAction({
      actionKey: "check-adm-files",
      title: "Checking ADM Files",
      steps: ["Discovering Nitrado files", "Testing newest ADM readability", "Saving discovery state"],
      refreshAfterSuccess: "dashboard-health",
      run: async (action) => {
        setCheckingAdmFileDiscovery(true);
        setActionMessage("");
        try {
          action.setStep(1, "Discovering ADM files from Nitrado.");
          const result = await getAdmFileDiscoveryDebug(server.id, {
            knownLatestFile: "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM",
          });
          setAdmFileDiscoveryDebug(result);
          setAdmFileDiscoveryOpen(true);
          const selected = result.selected_newest_available?.name ?? "no ADM file";
          const readable = result.selected_newest_readable?.name ?? "no readable ADM file";
          action.setStep(2, `Newest candidate: ${selected}; newest readable: ${readable}.`, 72);
          action.setStats({
            "Newest file": selected,
            Readable: readable === "no readable ADM file" ? "No" : "Yes",
          });
          return result;
        } finally {
          setCheckingAdmFileDiscovery(false);
        }
      },
      successSummary: (result) => {
        const selected = result.selected_newest_available?.name ?? "no ADM file";
        const readable = result.selected_newest_readable?.name ?? "no readable ADM file";
        return `ADM discovery checked. Newest candidate: ${selected}; newest readable: ${readable}.`;
      },
    });
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

  async function openBillingPortal() {
    await runDashboardAction({
      actionKey: "manage-billing",
      title: "Opening Billing Portal",
      steps: ["Creating billing portal session", "Redirecting to Stripe"],
      refreshAfterSuccess: false,
      run: async (action) => {
        try {
          action.setStep(1, "Creating billing portal session.");
          const session = await createPortalSession();
          action.setStep(2, "Redirecting to Stripe billing.", 90);
          window.location.assign(session.url);
          return session;
        } catch (error) {
          setBillingMessage(error instanceof Error ? error.message : "Could not open billing portal.");
          setActiveTab("billing");
          throw error;
        }
      },
      successSummary: () => "Billing portal opened.",
    });
  }

  async function refreshBillingWithAction() {
    await runDashboardAction({
      actionKey: "refresh-plan",
      title: "Refreshing Plan",
      steps: ["Requesting billing status", "Refreshing plan limits", "Refreshing dashboard"],
      refreshAfterSuccess: false,
      run: async (action) => {
        action.setStep(1, "Requesting current plan and package limits.");
        await refreshBilling();
        action.setStep(2, "Plan and billing state refreshed.", 80);
        return null;
      },
      successSummary: () => "Current plan refreshed.",
    });
  }

  const tabItems: Array<{ key: DashboardTabKey; label: string; icon: React.ReactNode }> = [
    { key: "overview", label: "Overview", icon: <Server className="h-4 w-4" /> },
    { key: "sync-health", label: "Sync Health", icon: <RefreshCw className="h-4 w-4" /> },
    { key: "public-listing", label: "Public Listing", icon: <ExternalLink className="h-4 w-4" /> },
    { key: "billing", label: "Billing & Boosts", icon: <Gauge className="h-4 w-4" /> },
    { key: "discord-posts", label: "Discord Posts", icon: <Bell className="h-4 w-4" /> },
    { key: "settings-danger", label: "Settings & Danger", icon: <Settings className="h-4 w-4" /> },
  ];
  const selectedServerLabel = serverDisplayName || server.guild_name || "DZN Server";
  const currentPlanName = effectivePlanLabel;
  const nitradoLogSettingsComplete = isNitradoLogSettingsComplete(nitradoLogSettings);
  const logSettingsSourceLabel = getNitradoLogSettingsSourceLabel(nitradoLogSettings);
  const setupChecks = [
    ["ADM Discovered", admState.isDiscovered],
    ["Log Sync Active", statsSyncActive],
    ["Events Processing", (syncStatus?.last_events_created ?? 0) > 0 || (syncStatus?.total_joins ?? 0) > 0],
    ["Discord Connected", Boolean(server.guild_id)],
    ["DZN Bot Installed", discordBotInstalled],
    ["Channels Discovered", discordChannelsDiscovered],
    [`Nitrado Log Settings${logSettingsSourceLabel ? ` (${logSettingsSourceLabel})` : ""}`, nitradoLogSettingsComplete],
    ["Stats Sync Active", statsSyncActive],
  ] as const;
  const displayedBulkAdmImportResult = mergeActiveAdmImportJobIntoBulkResult(
    bulkAdmImportResult,
    syncStatus?.active_adm_import_job ?? null,
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#050913]/85 p-4 backdrop-blur-xl lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 lg:block">
          <DznLogo compact />
          <button type="button" aria-label="Notifications" className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 lg:hidden">
            <Bell className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 rounded-xl border border-violet-300/20 bg-violet-400/10 p-3">
          <p className="text-[10px] font-black uppercase text-violet-200/75">Selected Server</p>
          <p className="mt-1 truncate text-sm font-black text-white">{selectedServerLabel}</p>
          <div className="mt-2 flex items-center gap-2 text-[11px] font-bold text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
            {statsSyncActive ? "Synced" : formatServerStatus(server.status)}
          </div>
        </div>
        <nav className="mt-5 grid gap-2">
          {tabItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveTab(item.key)}
              className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-bold transition ${activeTab === item.key ? "border-violet-300/40 bg-violet-500/24 text-white shadow-[0_0_28px_rgba(139,92,246,0.18)]" : "border-transparent bg-transparent text-zinc-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-white"}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-6 rounded-xl border border-white/10 bg-black/24 p-3">
          <p className="text-xs font-black uppercase text-zinc-200">Need help?</p>
          <p className="mt-2 text-xs leading-5 text-zinc-500">Everything you need to manage your server.</p>
          <Link href="/setup#review-test" className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-[10px] font-black uppercase text-white">View Setup Guide</Link>
          <a href="https://discord.gg/T2cgcTYPFV" target="_blank" rel="noreferrer" className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-100">Support Discord</a>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#030711]/88 px-4 py-3 backdrop-blur-xl sm:px-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <label className="relative grid gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 md:min-w-[260px]">
              <span className="text-[9px] font-black uppercase text-zinc-500">Selected Server</span>
              <select
                value={selectedServerId ?? server.id}
                onChange={(event) => onSelectServer(event.target.value)}
                className="appearance-none bg-transparent pr-8 text-sm font-black text-white outline-none"
                aria-label="Select dashboard server"
              >
                {servers.map((item) => (
                  <option key={item.id} value={item.id} className="bg-[#080b16] text-white">
                    {item.display_name ?? item.hostname ?? item.server_name ?? item.nitrado_service_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 text-zinc-400" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/servers" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-200">View Network</Link>
              <Link href="/setup" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-200">Setup</Link>
              <button type="button" aria-label="Notifications" className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200">
                <Bell className="h-4 w-4" />
              </button>
              <button type="button" onClick={onLogout} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-200">
                <LogOut className="h-4 w-4" /> Logout
              </button>
            </div>
          </div>
        </header>
        <div className="space-y-5 px-4 py-5 sm:px-5 xl:px-6">
      <ActionProgressPanel action={dashboardAction} onDismiss={clearDashboardAction} />
      {activeTab === "overview" ? (
      <>
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
                <HeroMetric icon={<CircleCheck className="h-4 w-4" />} label="Status" value={overviewAdmSyncStatus} />
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
            <HealthCard icon={<ListChecks className="h-4 w-4" />} label="ADM" value={overviewAdmSyncStatus} tone="cyan" />
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
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <DashboardStatTile icon={<Users className="h-5 w-5" />} label="Players Online" value={playerSlotsLabel} detail={playerCountFreshnessDetail} tone="cyan" />
        <DashboardStatTile icon={<Crosshair className="h-5 w-5" />} label="Kills" value={formatNullableDashboardNumber(dashboardStatValues.kills)} detail={dashboardStatValues.kills === null ? "Loading" : "Total"} tone="red" />
        <DashboardStatTile icon={<AlertTriangle className="h-5 w-5" />} label="Deaths" value={formatNullableDashboardNumber(dashboardStatValues.deaths)} detail={dashboardStatValues.deaths === null ? "Loading" : "Total"} tone="orange" />
        <DashboardStatTile icon={<ArrowRight className="h-5 w-5" />} label="Joins" value={formatNullableDashboardNumber(dashboardStatValues.joins)} detail={dashboardStatValues.joins === null ? "Loading" : "Total"} tone="emerald" />
        <DashboardStatTile icon={<Users className="h-5 w-5" />} label="Disconnects" value={formatNullableDashboardNumber(dashboardStatValues.disconnects)} detail={dashboardStatValues.disconnects === null ? "Loading" : "Total"} tone="zinc" />
        <DashboardStatTile icon={<Users className="h-5 w-5" />} label="Unique Players" value={formatNullableDashboardNumber(dashboardStatValues.uniquePlayers)} detail={dashboardStatValues.uniquePlayers === null ? "Loading" : "Total"} tone="violet" />
        <DashboardStatTile icon={<Gauge className="h-5 w-5" />} label="Server Score" value={scoreLabel} detail="Score" tone="violet" />
        <DashboardStatTile icon={<BarChart3 className="h-5 w-5" />} label="Global Rank" value={globalRankLabel} detail="Rank" tone="orange" />
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)_minmax(320px,0.72fr)]">
        <DashboardPanel className="p-4">
          <div className="flex items-center justify-between gap-3">
            <PanelHeader icon={<Activity className="h-5 w-5" />} title="Recent Synced Events" />
            <button type="button" onClick={() => setActiveTab("sync-health")} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-200">View All</button>
          </div>
          <div className="mt-4 grid max-h-[340px] gap-2 overflow-auto pr-1">
            {effectiveRecentEvents.length ? effectiveRecentEvents.slice(0, 5).map((event, index) => <RecentSyncEventRow key={`${event.source}-${event.created_at ?? index}-${event.event_type}`} event={event} />) : (
              <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-3 text-sm font-bold text-zinc-300">No recent events yet. Activity will appear after synced ADM events.</div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] font-bold text-zinc-500">Feed last updated {lastRefreshedAt ? formatRelativeTime(lastRefreshedAt) : "when data syncs"}.</p>
            <button type="button" onClick={() => setActiveTab("sync-health")} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50">
              View Sync Details <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </DashboardPanel>
        <DashboardPanel className="p-4">
          <div className="flex items-center justify-between">
            <PanelHeader icon={<CircleCheck className="h-5 w-5" />} title="Setup Progress" />
            <span className="text-xs font-black uppercase text-emerald-100">{progress}% Complete</span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-sm bg-white/10">
            <div className="h-full bg-gradient-to-r from-violet-300 via-cyan-300 to-emerald-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-4 grid gap-2">
            {setupChecks.slice(0, 7).map(([label, done]) => <SetupCheck key={label} label={label} done={done} />)}
          </div>
          <Link href="/setup#review-test" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white">
            View Setup Guide <LifeBuoy className="h-4 w-4" />
          </Link>
        </DashboardPanel>
        <div className="grid gap-4">
          <DashboardPanel className="p-4">
            <div className="flex items-start justify-between gap-3">
              <PanelHeader icon={<Gauge className="h-5 w-5" />} title="Current Plan" />
              <button type="button" disabled={!effectiveBillingStatus?.stripe_customer_exists} onClick={openBillingPortal} className="rounded-lg border border-violet-300/25 bg-violet-400/10 px-3 py-2 text-[10px] font-black uppercase text-violet-50 disabled:opacity-55">Manage Billing</button>
            </div>
            <p className="mt-4 text-2xl font-black uppercase text-violet-100">{currentPlanName}</p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <MiniInfo label="Servers Used" value={effectiveBillingStatus ? `${effectiveBillingStatus.linked_server_count} / ${effectiveBillingStatus.entitlements.max_linked_servers}` : "Loading"} />
              <MiniInfo label="Bumps This Month" value={advertisingStatus ? `${advertisingStatus.bump_count_current_period} / ${advertisingStatus.included_bumps_per_month}` : String(effectiveBillingStatus?.entitlements.included_bumps_per_month ?? "Loading")} />
              <MiniInfo label="Renews" value={billingRenewalLabel(effectiveBillingStatus)} />
            </div>
          </DashboardPanel>
          <DashboardPanel className="p-4">
            <PanelHeader icon={<Wrench className="h-5 w-5" />} title="Quick Actions" />
            <div className="mt-3 grid gap-2">
              <ActionLink href="/leaderboards" icon={<Crosshair className="h-4 w-4" />} label="View Kill Feed" />
              <button type="button" onClick={() => setActiveTab("public-listing")} className="inline-flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm font-bold text-zinc-100">Edit Server <ArrowRight className="h-4 w-4" /></button>
              <button type="button" disabled={refreshingServerInfo || isDashboardActionActive} onClick={refreshServerInfo} className="inline-flex items-center justify-between rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-left text-sm font-bold text-emerald-50 disabled:opacity-55">{dashboardActionKey === "refresh-server-info" ? "Running..." : "Refresh Server Info"} <RefreshCw className={`h-4 w-4 ${refreshingServerInfo || dashboardActionKey === "refresh-server-info" ? "animate-spin" : ""}`} /></button>
              <button type="button" disabled={syncing || isDashboardActionActive} onClick={runSync} className="inline-flex items-center justify-between rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-left text-sm font-bold text-cyan-50 disabled:opacity-55">{dashboardActionKey === "run-manual-sync" ? "Running..." : "Run Manual Sync"} <RefreshCw className={`h-4 w-4 ${syncing || dashboardActionKey === "run-manual-sync" ? "animate-spin" : ""}`} /></button>
            </div>
          </DashboardPanel>
          <DashboardPanel className="p-4">
            <PanelHeader icon={<ShieldCheck className="h-5 w-5" />} title="Sync Health" />
            <p className={`mt-3 text-sm font-black ${syncHealth.status === "error" ? "text-amber-100" : "text-emerald-100"}`}>{syncHealth.status === "error" ? syncHealth.title : "All systems operational"}</p>
            <p className="mt-1 text-xs leading-5 text-zinc-400">{syncHealth.status === "error" ? syncHealth.nextAction : "Status, ADM, and Discord automation are tracked in Sync Health."}</p>
            <button type="button" onClick={() => setActiveTab("sync-health")} className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-100">View Details</button>
          </DashboardPanel>
        </div>
      </section>
      </>
      ) : null}

      {activeTab !== "overview" ? (
      <section className={`grid gap-5 ${activeTab === "sync-health" || activeTab === "public-listing" ? "xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_390px]" : ""}`}>
        <div className={activeTab === "billing" || activeTab === "settings-danger" ? "hidden" : "grid gap-5"}>
          {activeTab === "sync-health" ? (
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
                  disabled={refreshingServerInfo || isDashboardActionActive}
                  onClick={refreshServerInfo}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshingServerInfo ? "animate-spin" : ""}`} />
                  {dashboardActionKey === "refresh-server-info" || refreshingServerInfo ? "Running..." : "Refresh Server Info"}
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {tags.length ? tags.map((tag) => <TagPill key={tag}>{tag}</TagPill>) : <span className="text-sm text-zinc-400">No tags selected</span>}
              </div>
            </DashboardPanel>

            <NitradoLogSettingsChecklist
              settings={nitradoLogSettings}
              check={nitradoLogSettingsCheck}
              saving={savingNitradoLogSettings}
              checking={checkingNitradoLogSettings}
              onSave={saveNitradoChecklist}
              onCheck={checkNitradoLogSettingsNow}
            />

            <DashboardPanel className="p-4">
              <div className="flex items-start justify-between gap-3">
                <PanelHeader icon={<DatabaseZap className={`h-5 w-5 ${refreshingSyncData ? "animate-pulse" : ""}`} />} title="Sync Engine Status" />
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={checkingAdmFileDiscovery || isDashboardActionActive}
                    onClick={checkAdmFileDiscoveryNow}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-purple-300/20 bg-purple-400/10 px-3 py-2 text-xs font-black uppercase text-purple-50 transition hover:border-purple-300/45 hover:bg-purple-400/18 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <DatabaseZap className={`h-3.5 w-3.5 ${checkingAdmFileDiscovery ? "animate-pulse" : ""}`} />
                    {dashboardActionKey === "check-adm-files" || checkingAdmFileDiscovery ? "Running..." : "Check ADM Files"}
                  </button>
                  <button
                    type="button"
                    disabled={verifyingAdmAutomation || isDashboardActionActive}
                    onClick={verifyAdmAutomationNow}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 hover:bg-cyan-400/18 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <ShieldCheck className={`h-3.5 w-3.5 ${verifyingAdmAutomation ? "animate-pulse" : ""}`} />
                    {dashboardActionKey === "verify-adm-automation" || verifyingAdmAutomation ? "Running..." : "Verify ADM Automation"}
                  </button>
                  <button
                    type="button"
                    disabled={forceLatestAdmRunning || isDashboardActionActive}
                    onClick={forceProcessLatestAdmNow}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-black uppercase text-emerald-50 transition hover:border-emerald-300/45 hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${forceLatestAdmRunning ? "animate-spin" : ""}`} />
                    {dashboardActionKey === "force-process-latest-adm" || forceLatestAdmRunning ? "Running..." : "Force Process Latest ADM Now"}
                  </button>
                  <button
                    type="button"
                    disabled={admBackfillRunning || isDashboardActionActive}
                    onClick={backfillMissingAdmNow}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-black uppercase text-amber-50 transition hover:border-amber-300/45 hover:bg-amber-400/18 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <ListChecks className={`h-3.5 w-3.5 ${admBackfillRunning ? "animate-pulse" : ""}`} />
                    {dashboardActionKey === "backfill-missing-adm" || admBackfillRunning ? "Running..." : "Backfill Missing ADM Now"}
                  </button>
                  <button
                    type="button"
                    disabled={refreshingSyncData || isDashboardActionActive}
                    onClick={refreshNow}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 hover:bg-cyan-400/18 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? "animate-spin" : ""}`} />
                    {dashboardActionKey === "refresh-status" || manualRefreshing ? "Running..." : "Refresh Status"}
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <MiniInfo label="Auto-refresh" value="On (15s)" />
                <MiniInfo label="Last Refreshed" value={lastRefreshedAt ? formatClockTime(lastRefreshedAt) : "Starting..."} />
                <MiniInfo label="Status" value={syncHealth.status === "error" ? "Needs Action" : formatSyncStatus(effectiveSyncStatus)} />
                <MiniInfo label="ADM Discovery" value={admDiscoveryInterval ? `Checks for new ADM files every ${admDiscoveryInterval} minutes` : "Plan loading"} />
                <MiniInfo label="Last Discovery Check" value={syncStatus?.last_adm_discovery_check_at ? formatDashboardDate(syncStatus.last_adm_discovery_check_at) : "Not checked"} />
                <MiniInfo label="Next Discovery Check" value={syncStatus?.next_adm_discovery_due_at ? formatDashboardDate(syncStatus.next_adm_discovery_due_at) : "Not scheduled"} />
                <MiniInfo label="Discovery Status" value={formatSyncStatus(syncStatus?.adm_discovery_status ?? effectiveSyncStatus)} />
                <MiniInfo label="Observed ADM Cadence" value={formatAdmCadence(syncStatus?.observed_adm_cadence_minutes)} />
                <MiniInfo label="Last ADM Event" value={syncStatus?.last_useful_adm_event_at ? formatCompactDate(syncStatus.last_useful_adm_event_at) : "No useful event yet"} />
                <MiniInfo label="Last PlayerList" value={syncStatus?.last_playerlist_at ? formatCompactDate(syncStatus.last_playerlist_at) : "No PlayerList yet"} />
                <MiniInfo label="Next Expected ADM Update" value={syncStatus?.next_expected_adm_update_at ? `around ${formatCompactDate(syncStatus.next_expected_adm_update_at)}` : "Waiting for cadence"} />
                <MiniInfo label="First ADM After Restart" value={formatFirstAdmAfterRestart(syncStatus)} />
                <MiniInfo label="First Useful Line After Restart" value={syncStatus?.first_useful_adm_line_after_restart_at ? formatDashboardDate(syncStatus.first_useful_adm_line_after_restart_at) : "Waiting"} />
                <MiniInfo label="ADM Processing" value={admProcessingInterval ? `Processes readable ADM data every ${admProcessingInterval} minutes` : "Plan loading"} />
                <MiniInfo label="Next Processing Check" value={syncStatus?.next_adm_pull_due_at ? formatDashboardDate(syncStatus.next_adm_pull_due_at) : "Not scheduled"} />
                <MiniInfo label="Latest File Readable" value={latestAdmReadable} />
                <MiniInfo label="ADM Health" value={syncStatus?.adm_health_label ?? "Delayed"} />
                <MiniInfo label="Chunk Import Job" value={formatActiveAdmImportJob(syncStatus?.active_adm_import_job ?? null)} />
                <MiniInfo label="Last Checked" value={syncStatus?.last_sync_at ? formatDashboardDate(syncStatus.last_sync_at) : "Not checked"} />
                <MiniInfo label="Last Successful Feed Sync" value={syncStatus?.last_successful_sync_at ? formatDashboardDate(syncStatus.last_successful_sync_at) : "Not synced"} />
                <MiniInfo label="Last Scheduled Sync" value={syncStatus?.last_scheduled_sync_at ? formatDashboardDate(syncStatus.last_scheduled_sync_at) : "Not synced"} />
                <MiniInfo label="Last Manual Sync" value={syncStatus?.last_manual_sync_at ? formatDashboardDate(syncStatus.last_manual_sync_at) : "Not synced"} />
                <MiniInfo label="Last Sync Trigger" value={formatSyncTrigger(syncStatus?.last_sync_trigger)} />
                <MiniInfo label="Next Action" value={syncHealth.status === "error" ? syncHealth.nextAction : "Continue syncing after fresh ADM activity"} />
              </div>
              <AutomaticAdmImportJobPanel syncStatus={effectiveSyncData} dashboardHealth={effectiveDashboardHealth} />
              <AdmBackfillStatusPanel syncStatus={effectiveSyncData} dashboardHealth={effectiveDashboardHealth} result={admBackfillResult} running={admBackfillRunning} onBackfill={backfillMissingAdmNow} />
              <VerifyAdmAutomationPanel status={admAutomationStatus} verifying={verifyingAdmAutomation} onVerify={verifyAdmAutomationNow} />
              <DashboardDataHealthPanel
                liveRefreshStatus={liveRefreshStatus}
                lastSuccessfulFullRefresh={lastRefreshedAt}
                lastSuccessfulSyncStatusRefresh={lastSyncStatusRefreshAt}
                lastSuccessfulRecentEventsRefresh={lastRecentEventsRefreshAt}
                lastSuccessfulBillingRefresh={lastBillingRefreshAt}
                failedRefreshCount={failedRefreshCount}
                failedEndpoint={failedEndpoint}
                lastRefreshError={lastRefreshError}
                showingCachedData={showingCachedDashboardData}
                lastGoodAdmJob={lastGoodAdmJob}
                dashboardHealth={effectiveDashboardHealth}
              />
              <details className="mt-4 rounded-lg border border-white/10 bg-black/24 p-3">
                <summary className="cursor-pointer text-xs font-black uppercase text-zinc-200">Show ADM Technical Diagnostics</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <MiniInfo label="Newest Available ADM" value={syncStatus?.newest_available_adm_filename ?? latestAdmFile} />
                  <MiniInfo label="Newest ADM Age" value={formatMinutesAgo(syncStatus?.newest_adm_file_age_minutes, "Waiting for ADM")} />
                  <MiniInfo label="Newest Readable ADM" value={syncStatus?.newest_readable_adm_filename ?? "Waiting for readable ADM"} />
                  <MiniInfo label="Latest ADM Processed" value={syncStatus?.latest_adm_processed ?? "Not processed"} />
                  <MiniInfo label="Newest Unprocessed ADM" value={syncStatus?.newest_unprocessed_adm_file ?? "None queued"} />
                  <MiniInfo label="Unreadable Files Queued" value={String(syncStatus?.unreadable_files_queued ?? 0)} />
                  <MiniInfo label="Last Processed Line" value={String(syncStatus?.last_processed_line ?? 0)} />
                  <MiniInfo label="Last Sync Duration" value={formatDuration(lastSyncDuration)} />
                  <MiniInfo label="Lines Read This Check" value={String(syncStatus?.last_lines_read ?? lastSyncResult?.linesRead ?? 0)} />
                  <MiniInfo label="New Lines Processed" value={String(syncStatus?.last_lines_processed ?? lastSyncResult?.linesProcessed ?? 0)} />
                  <MiniInfo label="Events Created" value={String(syncStatus?.last_events_created ?? lastSyncResult?.eventsCreated ?? 0)} />
                  <MiniInfo label="Kills Created" value={String(syncStatus?.last_kills_created ?? lastSyncResult?.killsCreated ?? 0)} />
                  <MiniInfo label="Raw Kill Lines Found" value={String(syncStatus?.raw_kill_lines_found ?? 0)} />
                  <MiniInfo label="Kill Lines Parsed" value={String(syncStatus?.parsed_kill_lines_found ?? 0)} />
                  <MiniInfo label="Parser Skipped Lines" value={String(syncStatus?.parser_skipped_lines ?? 0)} />
                  <MiniInfo label="Recovery Action" value={syncStatus?.current_recovery_action ?? "ADM sync healthy"} />
                </div>
              </details>
              <p className="mt-4 rounded-lg border border-white/10 bg-black/24 px-3 py-3 text-xs font-bold leading-5 text-zinc-300">
                DZN can check whether a new ADM file exists more often than it processes the full file. Nitrado still controls when the ADM file is uploaded and readable.
              </p>
              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px]">
                <div className="space-y-3">
                  <ProgressLine label="Read Status" value={`${processedPercent.toFixed(1)}%`} percent={processedPercent} />
                  <ProgressLine label="Sync Health" value={`${syncHealthPercent}%`} percent={syncHealthPercent} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-1">
                  <MetricTile label="Kills" value={dashboardStatValues.kills} />
                  <MetricTile label="Deaths" value={dashboardStatValues.deaths} />
                  <MetricTile label="Joins" value={dashboardStatValues.joins} />
                  <MetricTile label="Disconnects" value={dashboardStatValues.disconnects} />
                  <MetricTile label="Unique Players" value={dashboardStatValues.uniquePlayers} />
                </div>
              </div>
              {liveRefreshWarning ? (
                <p className="mt-4 rounded-lg border border-orange-300/20 bg-orange-400/10 px-3 py-3 text-sm font-bold leading-6 text-orange-50">
                  {liveRefreshWarning}
                </p>
              ) : null}
              {forceLatestAdmResult ? (
                <div className="mt-4 rounded-lg border border-emerald-300/18 bg-emerald-400/8 p-3">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase text-emerald-100">Force Process Latest ADM Result</p>
                      <p className="mt-1 text-sm font-bold leading-6 text-emerald-50">{getManualSyncMessage(forceLatestAdmResult)}</p>
                    </div>
                    <SmallBadge tone={forceLatestAdmResult.status === "completed" ? "emerald" : "orange"}>{formatSyncStatus(forceLatestAdmResult.status)}</SmallBadge>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                    <MiniInfo label="Lines Read" value={String(forceLatestAdmResult.linesRead ?? 0)} />
                    <MiniInfo label="Lines Processed" value={String(forceLatestAdmResult.linesProcessed ?? 0)} />
                    <MiniInfo label="Events Created" value={String(forceLatestAdmResult.eventsCreated ?? 0)} />
                    <MiniInfo label="Kills Created" value={String(forceLatestAdmResult.killsCreated ?? 0)} />
                    <MiniInfo label="Duration" value={formatDuration(forceLatestAdmResult.syncDurationMs ?? null)} />
                  </div>
                </div>
              ) : null}
              {effectivePublicCacheDebug ? (
                <PublicCacheHealthPanel
                  debug={effectivePublicCacheDebug}
                  rebuildResult={publicCacheRebuildResult}
                  stale={publicCacheStale}
                  rebuilding={rebuildingPublicCache}
                  onRebuild={rebuildPublicProfileCache}
                />
              ) : null}
              <SyncLockRecoveryPanel
                result={syncLockRecoveryResult}
                recovering={recoveringSyncLocks}
                onRecover={recoverSyncLocks}
              />
              <ManualAdmImportPanel
                filename={manualAdmFilename}
                admText={manualAdmText}
                uploadedFiles={manualAdmFiles}
                importing={manualAdmImporting}
                previewing={manualAdmPreviewing}
                result={manualAdmImportResult}
                failure={manualAdmImportError}
                preview={manualAdmParsePreview}
                bulkResult={displayedBulkAdmImportResult}
                bulkFailure={bulkAdmImportError}
                bulkProgress={bulkAdmImportProgress}
                runnerPaused={admChunkRunnerPaused}
                activeRunnerJob={admChunkRunnerJob}
                totalsDelta={admImportTotalsDelta}
                importHitLines={manualAdmImportHitLines}
                refreshFailed={manualAdmRefreshFailed}
                history={effectiveSyncData?.manual_import_history ?? []}
                onFilenameChange={setManualAdmFilename}
                onTextChange={setManualAdmText}
                onImportHitLinesChange={setManualAdmImportHitLines}
                onFileSelected={loadManualAdmFile}
                onFilesSelected={loadManualAdmFiles}
                onImport={importPastedAdmNow}
                onPreview={previewPastedAdmNow}
                onBulkImport={importAdmFilesNow}
                onBulkPreview={previewAdmFilesNow}
                onRetryBulkFile={retryBulkAdmFile}
                onContinueBulkFile={continueBulkAdmFile}
                onPauseImport={pauseAdmChunkRunner}
                onCancelImport={cancelActiveAdmImportJob}
                onRetryRefresh={refreshDashboardAfterManualAdmImport}
              />
              {admFileDiscoveryDebug ? (
                <AdmFileDiscoveryDebugPanel
                  debug={admFileDiscoveryDebug}
                  open={admFileDiscoveryOpen}
                  onToggle={() => setAdmFileDiscoveryOpen((value) => !value)}
                />
              ) : null}
              <LastSyncDetails open={syncDetailsOpen} onToggle={() => setSyncDetailsOpen((value) => !value)} latestAdmFile={latestAdmFile} syncStatus={effectiveSyncData} lastSyncResult={lastSyncResult} />
            </DashboardPanel>
          </div>
          ) : null}

          {activeTab === "public-listing" ? (
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
          ) : null}

          {activeTab === "discord-posts" ? (
          <DiscordAutoPostsPanel
            serverId={server.id}
            setups={postingSetups}
            options={postingOptions}
            channels={effectiveDiscordPostingChannels}
            channelsResponse={discordChannelsResponse}
            channelCache={discordChannelCache}
            channelFetchFailure={discordChannelFetchFailure}
            channelsLoading={discordChannelsLoading}
            channelsWarning={discordChannelsWarning}
            connectedServerName={server.guild_name ?? serverDisplayName}
            planName={effectivePlanLabel}
            onChannelsRefresh={refreshDiscordChannels}
            runDashboardAction={runDashboardAction}
            onSaved={(result) => {
              setPostingSetups(result.setups ?? []);
              if (result.post_type_options) setPostingOptions(result.post_type_options);
            }}
          />
          ) : null}

          {activeTab === "sync-health" ? (
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
                {effectiveRecentEvents.length ? (
                  effectiveRecentEvents.map((event, index) => <RecentSyncEventRow key={`${event.source}-${event.created_at ?? index}-${event.event_type}`} event={event} />)
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
          ) : null}
        </div>

        <aside className={activeTab === "discord-posts" ? "hidden" : "grid content-start gap-5"}>
          {activeTab === "billing" ? (
          <BillingPlanPanel billing={effectiveBillingStatus} plans={billingPlans} message={billingMessage} onRefresh={refreshBillingWithAction} />
          ) : null}
          {activeTab === "billing" ? (
          <AdvertisingBoostPanel
            serverId={server.id}
            billing={effectiveBillingStatus}
            advertising={advertisingStatus}
            onBumped={(next) => {
              setAdvertisingStatus(next);
              setActionMessage("Server bumped. It will appear higher in public discovery.");
              void refreshBilling();
            }}
          />
          ) : null}
          {activeTab === "sync-health" && effectiveAutomationHealth ? <AutomationHealthPanel health={effectiveAutomationHealth} /> : null}
          {activeTab === "settings-danger" ? (
          <DashboardPanel className="p-4">
            <PanelHeader icon={<Wrench className="h-5 w-5" />} title="Quick Actions & Setup" />
            <div className="mt-4 grid gap-3">
              <ActionLink href="/leaderboards" icon={<Crosshair className="h-4 w-4" />} label="View Kill Feed" />
              <ActionLink href="/setup" icon={<Settings className="h-4 w-4" />} label="Edit Server" />
              <ActionLink href="/setup" icon={<Gauge className="h-4 w-4" />} label="Server Settings" />
              <ActionLink href="/setup#review-test" icon={<LifeBuoy className="h-4 w-4" />} label="Setup Guide" />
              <button type="button" disabled={syncing || isDashboardActionActive} onClick={runSync} className="inline-flex items-center justify-between rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-left text-sm font-bold text-cyan-50 transition hover:border-cyan-300/45 hover:bg-cyan-400/18 disabled:cursor-not-allowed disabled:opacity-55">
                <span>{dashboardActionKey === "run-manual-sync" || syncing ? "Running..." : "Run Manual Sync"}</span>
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              </button>
              <button type="button" disabled={refreshingServerInfo || isDashboardActionActive} onClick={refreshServerInfo} className="inline-flex items-center justify-between rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-left text-sm font-bold text-emerald-50 transition hover:border-emerald-300/45 hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-55">
                <span>{dashboardActionKey === "refresh-server-info" || refreshingServerInfo ? "Running..." : "Refresh Server Info"}</span>
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
          ) : null}
          {activeTab === "public-listing" && server.public_slug ? <DashboardPublicReviewsSummary slug={server.public_slug} /> : null}
          {activeTab === "settings-danger" ? (
          <DangerZonePanel
            isOriginalOwner={isOriginalOwner}
            onRemoveServer={() => setDangerAction("server")}
            onCloseAccount={() => setDangerAction("account")}
            onDownloadSummary={downloadDataSummary}
          />
          ) : null}
        </aside>
      </section>
      ) : null}
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
      <ActionProgressToast action={dashboardAction} />
        </div>
      </div>
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

function ActionProgressPanel({ action, onDismiss }: { action: DashboardActionProgress | null; onDismiss: () => void }) {
  if (!action) return null;
  const percent = clampActionProgress(action.progress);
  const active = isActiveDashboardActionStatus(action.status);
  const tone = action.status === "failed"
    ? "border-red-300/25 bg-red-400/10 text-red-50"
    : action.status === "completed"
      ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"
      : action.status === "warning"
        ? "border-amber-300/25 bg-amber-400/10 text-amber-50"
        : "border-cyan-300/25 bg-cyan-400/10 text-cyan-50";
  const bar = action.status === "failed"
    ? "from-red-400 via-red-300 to-orange-300"
    : action.status === "completed"
      ? "from-emerald-400 via-cyan-300 to-emerald-200"
      : action.status === "warning"
        ? "from-amber-400 via-orange-300 to-cyan-300"
        : "from-violet-400 via-cyan-300 to-emerald-300";
  return (
    <div className={`rounded-xl border p-4 shadow-[0_0_36px_rgba(34,211,238,0.10)] backdrop-blur-xl ${tone}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-black/24 ${active ? "animate-pulse" : ""}`}>
              {action.status === "completed" ? <CircleCheck className="h-4 w-4" /> : action.status === "failed" ? <AlertTriangle className="h-4 w-4" /> : <RefreshCw className={`h-4 w-4 ${active ? "animate-spin" : ""}`} />}
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] opacity-75">{formatStatusLabel(action.status)}</p>
              <h3 className="text-sm font-black uppercase text-white">{action.title}</h3>
            </div>
          </div>
          <p className="mt-3 text-sm font-bold leading-6 text-zinc-100">
            {action.currentStepIndex > 0 ? `Step ${action.currentStepIndex}/${Math.max(action.totalSteps, action.currentStepIndex)}: ` : ""}
            {action.currentStep}
          </p>
          {action.detail ? <p className="mt-1 text-xs font-bold leading-5 text-zinc-300">{action.detail}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase text-zinc-300">
          <span>Elapsed {formatElapsedActionTime(action.startedAt)}</span>
          <span className="text-zinc-600">/</span>
          <span>Updated {formatClockTime(action.lastUpdatedAt)}</span>
          {!active ? (
            <button type="button" onClick={onDismiss} className="ml-1 grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-black/24 text-zinc-200">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between text-[10px] font-black uppercase text-zinc-300">
          <span>{percent === null || action.indeterminate ? "Working" : `${percent}%`}</span>
          <span>{action.status === "polling" ? "Polling" : active ? "Running" : "Done"}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-sm bg-black/35">
          <div
            className={`h-full bg-gradient-to-r ${bar} ${percent === null || action.indeterminate ? "w-1/2 animate-pulse" : ""}`}
            style={percent === null || action.indeterminate ? undefined : { width: `${percent}%` }}
          />
        </div>
      </div>
      {action.stats && Object.values(action.stats).some((value) => value !== null && value !== undefined && value !== "") ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(action.stats).map(([label, value]) => (
            <MiniInfo key={label} label={label} value={value === null || value === undefined || value === "" ? "Waiting" : String(value)} />
          ))}
        </div>
      ) : null}
      {action.warningMessage ? <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-50">{action.warningMessage}</p> : null}
      {action.errorMessage ? <p className="mt-3 rounded-lg border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-50">{action.errorMessage}</p> : null}
      {action.successSummary ? <p className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-50">{action.successSummary}</p> : null}
    </div>
  );
}

function ActionProgressToast({ action }: { action: DashboardActionProgress | null }) {
  if (!action) return null;
  const percent = clampActionProgress(action.progress);
  const active = isActiveDashboardActionStatus(action.status);
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-cyan-300/20 bg-[#050913]/94 p-3 shadow-[0_0_42px_rgba(34,211,238,0.18)] backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-cyan-100">
          {active ? <RefreshCw className="h-4 w-4 animate-spin" /> : action.status === "completed" ? <CircleCheck className="h-4 w-4 text-emerald-200" /> : <AlertTriangle className="h-4 w-4 text-amber-200" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-black uppercase text-white">{action.title}</p>
          <p className="mt-1 truncate text-[11px] font-bold text-zinc-300">{action.detail ?? action.currentStep}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-white/10">
            <div className={`h-full bg-cyan-300 ${percent === null || action.indeterminate ? "w-1/2 animate-pulse" : ""}`} style={percent === null || action.indeterminate ? undefined : { width: `${percent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function NitradoLogSettingsChecklist({
  settings,
  check,
  saving,
  checking,
  onSave,
  onCheck,
}: {
  settings: NitradoLogSettingsConfirmation | null;
  check: NitradoLogSettingsCheckResponse | null;
  saving: boolean;
  checking: boolean;
  onSave: (settings: NitradoLogSettingsConfirmation) => void;
  onCheck: () => void;
}) {
  const reduceConfirmed = settings?.nitrado_reduce_log_output_confirmed ?? false;
  const playerlistConfirmed = settings?.nitrado_log_playerlist_confirmed ?? false;
  const fullyConfirmed = reduceConfirmed && playerlistConfirmed;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const verificationStatus = getNitradoVerificationStatus(settings, check);
  const hasWrongSettings = verificationStatus === "verified_wrong" && Boolean(check?.warnings?.length);
  const verifiedByDzn = verificationStatus === "verified";
  const manuallyConfirmed = verificationStatus === "manual_confirmed";
  const verificationUnavailable = verificationStatus === "manual_required";
  const showManualFallback = verificationUnavailable || manuallyConfirmed || settings?.nitrado_log_settings_verification_source === "manual";
  const sourceLabel = getNitradoLogSettingsSourceDisplay(settings, check, verificationStatus);
  const diagnostics = check?.diagnostics ?? {
    source: check?.source ?? settings?.nitrado_log_settings_verification_source ?? "not_checked",
    verificationStatus,
    last_checked_at: settings?.nitrado_log_settings_last_checked_at ?? null,
    last_error: settings?.nitrado_log_settings_last_error ?? null,
    discovered_setting_keys: check?.discovered_setting_keys ?? [],
    parsed_values: check?.settings ?? {
      admin_log_enabled: settings?.nitrado_admin_log_enabled ?? null,
      server_log_enabled: settings?.nitrado_server_log_enabled ?? null,
      reduce_log_output_disabled: verificationStatus === "verified" || verificationStatus === "verified_wrong" ? reduceConfirmed : null,
      log_playerlist_enabled: verificationStatus === "verified" || verificationStatus === "verified_wrong" ? playerlistConfirmed : null,
    },
  };
  const nextSettings = (patch: Partial<NitradoLogSettingsConfirmation>): NitradoLogSettingsConfirmation => ({
    nitrado_reduce_log_output_confirmed: reduceConfirmed,
    nitrado_log_playerlist_confirmed: playerlistConfirmed,
    nitrado_log_settings_confirmed_at: settings?.nitrado_log_settings_confirmed_at ?? null,
    nitrado_log_settings_verification_source: "manual",
    nitrado_admin_log_enabled: settings?.nitrado_admin_log_enabled ?? null,
    nitrado_server_log_enabled: settings?.nitrado_server_log_enabled ?? null,
    nitrado_log_settings_last_checked_at: settings?.nitrado_log_settings_last_checked_at ?? null,
    nitrado_log_settings_last_error: settings?.nitrado_log_settings_last_error ?? null,
    ...patch,
  });

  return (
    <DashboardPanel className={`p-4 ${fullyConfirmed ? "border-emerald-300/20" : "border-amber-300/20"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PanelHeader icon={<ListChecks className="h-5 w-5" />} title="Nitrado Log Settings" />
        <button
          type="button"
          disabled={checking}
          onClick={onCheck}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking..." : "Check Nitrado Log Settings"}
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-300">
        DZN will try to verify the required Nitrado log settings from the connected service. Manual confirmation is only needed when Nitrado does not expose the settings through the API.
      </p>

      {hasWrongSettings ? (
        <div className="mt-3 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-sm font-bold leading-6 text-amber-50">
          {check?.warnings?.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : verifiedByDzn ? (
        <p className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm font-bold leading-6 text-emerald-50">
          Nitrado log settings verified automatically{settings?.nitrado_log_settings_confirmed_at ? ` ${formatRelativeTime(settings.nitrado_log_settings_confirmed_at)}` : ""}.
        </p>
      ) : manuallyConfirmed ? (
        <p className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm font-bold leading-6 text-emerald-50">
          Nitrado log settings were manually confirmed{settings?.nitrado_log_settings_confirmed_at ? ` ${formatRelativeTime(settings.nitrado_log_settings_confirmed_at)}` : ""}.
        </p>
      ) : verificationStatus === "not_checked" ? (
        <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-bold leading-6 text-zinc-300">
          DZN has not checked these Nitrado log settings yet. Click Check Nitrado Log Settings to verify them from the connected service.
        </p>
      ) : !fullyConfirmed ? (
        <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-sm font-bold leading-6 text-amber-50">
          {verificationUnavailable
            ? check?.reason ?? "DZN could not verify these Nitrado settings automatically."
            : "ADM tracking may miss useful lines until these Nitrado settings are confirmed."}
        </p>
      ) : (
        <p className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm font-bold leading-6 text-emerald-50">
          Required Nitrado log settings were confirmed{settings?.nitrado_log_settings_confirmed_at ? ` ${formatRelativeTime(settings.nitrado_log_settings_confirmed_at)}` : ""}.
        </p>
      )}

      <div className="mt-4 grid gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
        <NitradoSettingStatus label="Admin Log" status={getNitradoSettingDisplay("admin_log_enabled", check?.settings.admin_log_enabled ?? settings?.nitrado_admin_log_enabled ?? null, verificationStatus, "Enabled", false)} />
        <NitradoSettingStatus label="Server Log" status={getNitradoSettingDisplay("server_log_enabled", check?.settings.server_log_enabled ?? settings?.nitrado_server_log_enabled ?? null, verificationStatus, "Enabled", false)} />
        <NitradoSettingStatus label="Reduce Log Output" status={getNitradoSettingDisplay("reduce_log_output_disabled", check?.settings.reduce_log_output_disabled ?? (verificationStatus === "verified" || verificationStatus === "verified_wrong" || manuallyConfirmed ? reduceConfirmed : null), verificationStatus, "Disabled", reduceConfirmed)} />
        <NitradoSettingStatus label="Log Playerlist" status={getNitradoSettingDisplay("log_playerlist_enabled", check?.settings.log_playerlist_enabled ?? (verificationStatus === "verified" || verificationStatus === "verified_wrong" || manuallyConfirmed ? playerlistConfirmed : null), verificationStatus, "Enabled", playerlistConfirmed)} />
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase text-zinc-500">
          <span>Source: {sourceLabel}</span>
          {settings?.nitrado_log_settings_last_checked_at ? <span>Last checked: {formatRelativeTime(settings.nitrado_log_settings_last_checked_at)}</span> : null}
        </div>
        {settings?.nitrado_log_settings_last_error && !verifiedByDzn ? (
          <p className="text-xs font-bold text-amber-100">{settings.nitrado_log_settings_last_error}</p>
        ) : null}
        <button
          type="button"
          onClick={() => setDiagnosticsOpen((open) => !open)}
          className="mt-2 text-left text-[11px] font-black uppercase text-cyan-100 transition hover:text-cyan-50"
        >
          {diagnosticsOpen ? "Hide Nitrado Settings Diagnostics" : "Show Nitrado Settings Diagnostics"}
        </button>
        {diagnosticsOpen ? (
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs leading-5 text-zinc-300">
            <p><span className="font-bold text-zinc-500">source:</span> {diagnostics.source}</p>
            <p><span className="font-bold text-zinc-500">verificationStatus:</span> {diagnostics.verificationStatus}</p>
            <p><span className="font-bold text-zinc-500">last checked:</span> {diagnostics.last_checked_at ? formatRelativeTime(diagnostics.last_checked_at) : "not checked yet"}</p>
            <p><span className="font-bold text-zinc-500">last error:</span> {diagnostics.last_error || "none"}</p>
            <p><span className="font-bold text-zinc-500">parsed admin_log_enabled:</span> {formatNullableBoolean(diagnostics.parsed_values.admin_log_enabled)}</p>
            <p><span className="font-bold text-zinc-500">parsed server_log_enabled:</span> {formatNullableBoolean(diagnostics.parsed_values.server_log_enabled)}</p>
            <p><span className="font-bold text-zinc-500">parsed reduce_log_output_disabled:</span> {formatNullableBoolean(diagnostics.parsed_values.reduce_log_output_disabled)}</p>
            <p><span className="font-bold text-zinc-500">parsed log_playerlist_enabled:</span> {formatNullableBoolean(diagnostics.parsed_values.log_playerlist_enabled)}</p>
            <p className="mt-2 font-bold text-zinc-500">discovered Nitrado setting keys</p>
            <p className="break-words text-zinc-400">{diagnostics.discovered_setting_keys.length ? diagnostics.discovered_setting_keys.join(", ") : "none recorded"}</p>
          </div>
        ) : null}
      </div>

      {showManualFallback && !verifiedByDzn && !hasWrongSettings ? (
        <>
          <p className="mt-4 text-xs font-bold uppercase text-zinc-500">Manual fallback</p>
          <div className="mt-2 grid gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => onSave(nextSettings({ nitrado_reduce_log_output_confirmed: !reduceConfirmed }))}
              className={`flex items-center justify-between rounded-lg border px-3 py-3 text-left text-sm font-black transition ${reduceConfirmed ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-50" : "border-white/10 bg-black/24 text-zinc-200"}`}
            >
              <span>I have disabled Reduce Log Output</span>
              {reduceConfirmed ? <CircleCheck className="h-4 w-4" /> : <span className="text-[10px] uppercase text-zinc-500">Required</span>}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onSave(nextSettings({ nitrado_log_playerlist_confirmed: !playerlistConfirmed }))}
              className={`flex items-center justify-between rounded-lg border px-3 py-3 text-left text-sm font-black transition ${playerlistConfirmed ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-50" : "border-white/10 bg-black/24 text-zinc-200"}`}
            >
              <span>I have enabled Log Playerlist</span>
              {playerlistConfirmed ? <CircleCheck className="h-4 w-4" /> : <span className="text-[10px] uppercase text-zinc-500">Required</span>}
            </button>
          </div>
        </>
      ) : null}
      {saving ? <p className="mt-3 text-xs font-bold uppercase text-cyan-100">Saving checklist...</p> : null}
    </DashboardPanel>
  );
}

function NitradoSettingStatus({ label, status }: { label: string; status: { label: string; tone: "good" | "warn" | "bad" | "muted" } }) {
  const toneClass = status.tone === "good"
    ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
    : status.tone === "bad"
      ? "border-red-300/25 bg-red-400/10 text-red-100"
      : status.tone === "warn"
        ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
        : "border-white/10 bg-white/[0.03] text-zinc-500";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-bold text-zinc-300">{label}</span>
      <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${toneClass}`}>
        {status.label}
      </span>
    </div>
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

function MetricTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-2">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-black text-white">{value === null ? "Loading" : value.toLocaleString()}</p>
    </div>
  );
}

function DashboardStatTile({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "cyan" | "red" | "orange" | "emerald" | "zinc" | "violet";
}) {
  const classes = {
    cyan: "text-cyan-200 border-cyan-300/20 bg-cyan-400/8",
    red: "text-red-200 border-red-300/20 bg-red-400/8",
    orange: "text-amber-200 border-amber-300/20 bg-amber-400/8",
    emerald: "text-emerald-200 border-emerald-300/20 bg-emerald-400/8",
    zinc: "text-zinc-200 border-zinc-300/15 bg-zinc-400/8",
    violet: "text-violet-200 border-violet-300/20 bg-violet-400/8",
  }[tone];

  return (
    <div className={`rounded-xl border p-3 ${classes}`}>
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-black/30 shadow-[0_0_18px_currentColor]">{icon}</span>
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase text-zinc-500">{label}</p>
          <p className="mt-1 truncate text-xl font-black text-white">{value}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] font-bold text-zinc-500">{detail}</p>
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
                  <p><span className="font-black uppercase text-zinc-400">ADM Discovery:</span> new ADM files checked every {plan.adm_discovery_interval_minutes ?? "?"} minutes.</p>
                  <p><span className="font-black uppercase text-zinc-400">ADM Processing:</span> kills, deaths, K/D, leaderboards, and events processed every {plan.adm_pull_interval_minutes ?? "?"} minutes.</p>
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
  channelCache,
  channelFetchFailure,
  channelsLoading,
  channelsWarning,
  connectedServerName,
  planName,
  onChannelsRefresh,
  runDashboardAction,
  onSaved,
}: {
  serverId: string;
  setups: PostingChannelSetup[];
  options: PostingOptionSummary[];
  channels: DiscordPostingChannel[];
  channelsResponse: DiscordChannelsResponse | null;
  channelCache: DiscordChannelCache | null;
  channelFetchFailure: DiscordChannelFetchFailure | null;
  channelsLoading: boolean;
  channelsWarning: string;
  connectedServerName: string;
  planName: string;
  onChannelsRefresh: () => Promise<DiscordChannelsResponse | null>;
  runDashboardAction: <T>(input: RunDashboardActionInput<T>) => Promise<T | null>;
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
  const [dispatchingNow, setDispatchingNow] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<AutoPostDispatchNowResult | null>(null);
  const [busyChannel, setBusyChannel] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [testTypeByChannel, setTestTypeByChannel] = useState<Record<string, string>>({});
  const [dispatchDiagnosticsOpenByChannel, setDispatchDiagnosticsOpenByChannel] = useState<Record<string, boolean>>({});

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
        permissionSource: "unknown",
        botUserId: null as string | null,
        botRoleIds: [] as string[],
        botRoleNames: [] as string[],
        botHasAdministrator: false,
        baseGuildPermissions: null as string | null,
        effectiveChannelPermissions: null as string | null,
      };
    }
    const diagnostics = selectedChannel.permission_diagnostics;
    const botHasAdministrator = diagnostics?.bot_has_administrator === true || selectedChannel.permission_source === "administrator";
    return {
      channelId: selectedChannel.channel_id,
      channelName: selectedChannel.channel_name,
      canPost: selectedChannel.can_post === true || botHasAdministrator,
      missingPermissions: botHasAdministrator
        ? []
        : Array.isArray(selectedChannel.missing_permissions)
          ? selectedChannel.missing_permissions
          : [],
      permissionSource: diagnostics?.permission_source ?? selectedChannel.permission_source ?? "unknown",
      botUserId: diagnostics?.bot_user_id ?? null,
      botRoleIds: diagnostics?.bot_role_ids ?? [],
      botRoleNames: diagnostics?.bot_role_names ?? [],
      botHasAdministrator,
      baseGuildPermissions: diagnostics?.base_guild_permissions ?? null,
      effectiveChannelPermissions: diagnostics?.effective_channel_permissions ?? null,
    };
  }, [selectedChannel, selectedChannelId]);
  const responseErrorCode = channelsResponse?.error_code ?? channelsResponse?.errorCode ?? null;
  const channelFetchFailed = Boolean(channelsResponse?.manual_fallback || responseErrorCode || channelFetchFailure || channelsWarning);
  const usingCachedChannelState = Boolean((channelFetchFailure || responseErrorCode) && channelCache?.channels.length);
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
    : usingCachedChannelState && channelCache?.last_bot_connected_state === true
      ? "Connected (last known)"
      : responseErrorCode === "missing_bot_token"
      ? "Bot token missing"
      : channelsResponse?.bot_connected === false
        ? "Not connected"
        : "Unknown";
  const channelCountLabel = channelsLoading
    ? "Loading"
    : usingCachedChannelState && channelCache
      ? `${channelCache.last_channel_count} (last known)`
      : String(channels.length);
  const channelWarningText = channelsWarning || (channelFetchFailure?.message ?? "");
  const retryableChannelFetch = Boolean(channelFetchFailure?.retryable || channelsResponse?.retryable);

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
    await runDashboardAction({
      actionKey: "check-discord-channel",
      title: "Checking Discord Channel",
      steps: ["Refreshing channel list", "Checking bot permissions", "Saving diagnostics"],
      refreshAfterSuccess: "discord",
      run: async (action) => {
        setRecheckingChannel(true);
        setMessage("");
        try {
          action.setStep(1, "Refreshing Discord channels.");
          const response = await onChannelsRefresh();
          const refreshedChannel = response?.channels.find((channel) => channel.channel_id === selectedChannelId);
          if (!refreshedChannel) {
            throw new Error("Selected channel was not returned by Discord during recheck. Choose another channel or check bot access.");
          }
          const summary = refreshedChannel.permission_diagnostics?.bot_has_administrator === true || refreshedChannel.permission_source === "administrator"
            ? "DZN Bot has Administrator and can post in this channel."
            : refreshedChannel.can_post
              ? "DZN Bot can post in this channel."
              : `Missing: ${refreshedChannel.missing_permissions.join(", ") || "channel permissions"}.`;
          action.setStep(2, summary, 82);
          setMessage(`Selected channel rechecked. ${summary}`);
          return refreshedChannel;
        } finally {
          setRecheckingChannel(false);
        }
      },
      successSummary: () => "Selected Discord channel rechecked.",
    });
  }

  async function saveSetup() {
    if (!canSave) return;
    await runDashboardAction({
      actionKey: "save-auto-post-setup",
      title: "Saving Auto Post Setup",
      steps: ["Rendering setup payload", "Saving Discord destination", "Refreshing diagnostics"],
      refreshAfterSuccess: "discord",
      run: async (action) => {
        setSaving(true);
        setMessage("");
        try {
          action.setStep(1, "Rendering Discord auto-post setup payload.");
          const result = await savePostingDestination(serverId, {
            action: "save",
            channel_id: channelForSave,
            post_types: selectedPostTypes,
            discord_webhook_url: webhookUrl || null,
            enabled: true,
          });
          onSaved(result);
          action.setStep(2, "Discord destination saved.", 76);
          setMessage("Discord auto-post setup saved.");
          setSelectedChannelId("");
          setManualChannelId("");
          setSelectedPostTypes([]);
          setWebhookUrl("");
          setAdvancedOpen(false);
          setDiagnosticsOpen(false);
          return result;
        } finally {
          setSaving(false);
        }
      },
      successSummary: () => "Discord auto-post setup saved.",
    });
  }

  async function runSetupAction(setup: PostingChannelSetup, action: "test" | "disable" | "delete") {
    await runDashboardAction({
      actionKey: action === "test" ? "test-discord-post" : `${action}-discord-post`,
      title: action === "test" ? "Testing Discord Post" : `${formatStatusLabel(action)} Discord Setup`,
      steps: ["Rendering payload", "Sending or saving Discord state", "Refreshing diagnostics"],
      refreshAfterSuccess: "discord",
      run: async (actionProgress) => {
        setBusyChannel(`${setup.channel_id}:${action}`);
        setMessage("");
        try {
          const selectedTestType = testTypeByChannel[setup.channel_id] ?? setup.post_types.find((postType) => postType.enabled)?.key ?? setup.post_types[0]?.key;
          actionProgress.setStep(1, `${formatPostType(selectedTestType)} payload ready.`);
          const result = await savePostingDestination(serverId, {
            action,
            channel_id: setup.channel_id,
            post_types: setup.post_types.map((postType) => postType.key),
            test_post_type: selectedTestType,
            enabled: action !== "disable",
          });
          onSaved(result);
          actionProgress.setStep(2, action === "test" ? "Discord test post response received." : "Discord setup state saved.", 78);
          if (action === "test") {
            const message = result.test_post?.ok
              ? `${formatPostType(selectedTestType)} test posted. Future updates will edit the saved message when possible.`
              : formatPostingError(result.test_post?.error ?? "Discord test post failed.", result.test_post?.missing_permissions);
            setMessage(message);
            if (!result.test_post?.ok) throw new Error(message);
          } else if (action === "delete") {
            setMessage("Discord auto-post setup deleted.");
          } else {
            setMessage("Discord auto-post setup disabled.");
          }
          return result;
        } finally {
          setBusyChannel(null);
        }
      },
      successSummary: () => action === "test" ? "Discord test post completed." : `Discord auto-post setup ${action === "delete" ? "deleted" : "updated"}.`,
    });
  }

  async function runDispatcherNow() {
    await runDashboardAction({
      actionKey: "run-auto-post-dispatcher",
      title: "Running Auto Post Dispatcher",
      steps: ["Rendering Discord payloads", "Sending or editing Discord messages", "Saving message state", "Refreshing diagnostics"],
      refreshAfterSuccess: "discord",
      run: async (action) => {
        setDispatchingNow(true);
        setMessage("");
        setDispatchResult(null);
        try {
          action.setStep(1, "Rendering queued Discord payloads.");
          const result = await runAutoPostDispatcherNow(serverId);
          setDispatchResult(result);
          action.setStep(2, `Processed ${result.processed}, edited ${result.edited}, sent ${result.sent}.`, 72);
          action.setStats({
            Processed: result.processed,
            Edited: result.edited,
            Sent: result.sent,
            Skipped: result.skipped,
            Failed: result.failed,
          });
          const refreshed = await getPostingDestinations(serverId).catch(() => null);
          if (refreshed) onSaved(refreshed);
          setMessage(`Auto post dispatcher run complete. Processed ${result.processed}, edited ${result.edited}, sent ${result.sent}, skipped ${result.skipped}, failed ${result.failed}.`);
          return result;
        } finally {
          setDispatchingNow(false);
        }
      },
      successSummary: (result) => `Auto post dispatcher run complete. Processed ${result.processed}, edited ${result.edited}, sent ${result.sent}, skipped ${result.skipped}, failed ${result.failed}.`,
    });
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
        <MiniInfo label="Channels Found" value={channelCountLabel} />
        <MiniInfo label="Plan" value={planName} />
      </div>

      {channelsLoading ? (
        <p className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-50">
          Loading Discord channels...
        </p>
      ) : null}
      {channelWarningText ? (
        <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-amber-100">{channelFetchFailure?.error_code ?? responseErrorCode ?? "Channel fetch warning"}</p>
              <p className="mt-1 text-xs font-bold leading-5 text-amber-50">{channelWarningText}</p>
              {usingCachedChannelState && channelCache ? (
                <p className="mt-2 text-[11px] font-bold leading-5 text-amber-100">
                  Last successful channel refresh: {formatDashboardDate(channelCache.last_channel_fetch_success_at)}.
                </p>
              ) : null}
              {setups.some((setup) => setup.status === "active") ? (
                <p className="mt-2 text-[11px] font-black uppercase text-emerald-100">
                  Saved auto-post setups continue running even if channel refresh temporarily fails.
                </p>
              ) : null}
            </div>
            {retryableChannelFetch ? (
              <button
                type="button"
                onClick={() => void onChannelsRefresh()}
                disabled={channelsLoading}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-200/30 bg-amber-300/15 px-3 py-2 text-[10px] font-black uppercase text-amber-50 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <RefreshCw className={`h-3 w-3 ${channelsLoading ? "animate-spin" : ""}`} />
                Recheck Channels
              </button>
            ) : null}
          </div>
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
                  {selectedChannelPermission.botHasAdministrator
                    ? "DZN Bot has Administrator and can post in this channel."
                    : selectedChannelPermission.canPost
                    ? "DZN Bot can post in this channel."
                    : `DZN can see this channel, but cannot post here yet. Missing: ${selectedChannelPermission.missingPermissions.join(", ") || "channel permissions"}. Make sure you select the DZN Bot role in Discord channel permissions, not @everyone, then allow Send Messages and Embed Links. Channel or category overrides may still block the bot; add the DZN Bot role directly to the channel permissions or choose another channel.`}
                </span>
                <div className="rounded-lg border border-white/10 bg-black/24 p-2 text-[10px] font-bold leading-5 text-zinc-400">
                  <p className="font-black uppercase text-zinc-500">Selected channel debug</p>
                  <p>ID: <span className="text-zinc-200">{selectedChannelPermission.channelId}</span></p>
                  <p>Name: <span className="text-zinc-200">#{selectedChannelPermission.channelName}</span></p>
                  <p>Bot user ID: <span className="text-zinc-200">{selectedChannelPermission.botUserId ?? "unknown"}</span></p>
                  <p>Bot role IDs: <span className="text-zinc-200">[{selectedChannelPermission.botRoleIds.join(", ")}]</span></p>
                  <p>Bot role names: <span className="text-zinc-200">[{selectedChannelPermission.botRoleNames.join(", ")}]</span></p>
                  <p>bot_has_administrator: <span className={selectedChannelPermission.botHasAdministrator ? "text-emerald-200" : "text-zinc-200"}>{String(selectedChannelPermission.botHasAdministrator)}</span></p>
                  <p>base guild permissions: <span className="text-zinc-200">{selectedChannelPermission.baseGuildPermissions ?? "unknown"}</span></p>
                  <p>effective channel permissions: <span className="text-zinc-200">{selectedChannelPermission.effectiveChannelPermissions ?? "unknown"}</span></p>
                  <p>permission source: <span className="text-zinc-200">{selectedChannelPermission.permissionSource}</span></p>
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="text-[10px] font-black uppercase text-zinc-500">{setups.length} channels configured</p>
          <button
            type="button"
            onClick={runDispatcherNow}
            disabled={dispatchingNow || setups.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-50 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <RefreshCw className={`h-3 w-3 ${dispatchingNow ? "animate-spin" : ""}`} />
            {dispatchingNow ? "Running..." : "Run Auto Post Dispatcher Now"}
          </button>
        </div>
      </div>
      {dispatchResult ? (
        <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3">
          <p className="text-[10px] font-black uppercase text-emerald-100">Run Now Result</p>
          <div className="mt-2 grid gap-2 text-xs font-bold text-emerald-50 sm:grid-cols-5">
            <MiniInfo label="Processed" value={String(dispatchResult.processed)} />
            <MiniInfo label="Edited" value={String(dispatchResult.edited)} />
            <MiniInfo label="Sent" value={String(dispatchResult.sent)} />
            <MiniInfo label="Skipped" value={String(dispatchResult.skipped)} />
            <MiniInfo label="Failed" value={String(dispatchResult.failed)} />
          </div>
          <div className="mt-3 grid gap-2">
            {dispatchResult.results.map((result, index) => {
              const channelLabel = resolveDispatchChannelLabel(result.channel_id, setups, channelById);
              return (
                <div key={`${result.post_type}-${result.channel_id ?? "none"}-${index}`} className="rounded-lg border border-white/10 bg-black/24 p-2 text-[11px] font-bold leading-5 text-zinc-300">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black uppercase text-white">{channelLabel} - {formatPostType(result.post_type)}</p>
                    <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase ${dispatchStatusClass(result.status)}`}>{result.status}</span>
                  </div>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    <p>message ID: <span className="text-zinc-100">{result.message_id ?? "none"}</span></p>
                    <p>old hash: <span className="text-zinc-100">{shortHash(result.old_payload_hash)}</span></p>
                    <p>new hash: <span className="text-zinc-100">{shortHash(result.new_payload_hash)}</span></p>
                    <p>last edited: <span className="text-zinc-100">{result.last_edited_at ? formatDashboardDate(result.last_edited_at) : "none"}</span></p>
                    <p>state found: <span className="text-zinc-100">{result.message_state_found === undefined ? "unknown" : String(result.message_state_found)}</span></p>
                    <p>reason: <span className="text-zinc-100">{result.reason ?? "none"}</span></p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
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
                  <div className="mt-3 rounded-lg border border-white/10 bg-black/24 p-2 text-[10px] font-bold leading-5 text-zinc-400">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <p>Last dispatch: <span className="text-zinc-200">{formatLatestDispatchAt(setup)}</span></p>
                      <p>Last dispatch status: <span className="text-zinc-200">{formatLatestDispatchStatus(setup)}</span></p>
                      <p>Last error: <span className="text-zinc-200">{formatLatestDispatchError(setup)}</span></p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDispatchDiagnosticsOpenByChannel((current) => ({ ...current, [setup.channel_id]: !current[setup.channel_id] }))}
                      className="mt-2 text-[10px] font-black uppercase text-cyan-200"
                    >
                      {dispatchDiagnosticsOpenByChannel[setup.channel_id] ? "Hide" : "Show"} dispatch diagnostics
                    </button>
                    {dispatchDiagnosticsOpenByChannel[setup.channel_id] ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {setup.post_types.map((postType) => (
                          <div key={`${postType.key}-debug`} className="min-w-0 rounded-md border border-white/10 bg-white/[0.03] p-2">
                            <p className="font-black uppercase text-zinc-300">{postType.label}</p>
                            <p>guild_id: <span className="text-zinc-200">{postType.guild_id ?? "unknown"}</span></p>
                            <p>post_type: <span className="text-zinc-200">{postType.key}</span></p>
                            <p>discord_channel_id: <span className="text-zinc-200">{postType.discord_channel_id ?? setup.channel_id}</span></p>
                            <p>discord_message_id: <span className="text-zinc-200">{postType.discord_message_id ?? "none"}</span></p>
                            <p>posting mode: <span className="text-zinc-200">{postType.posting_mode ?? setup.posting_mode}</span></p>
                            <p>enabled: <span className="text-zinc-200">{String(postType.enabled)}</span></p>
                            <p>plan allowed: <span className={postType.allowed_by_plan ? "text-emerald-200" : "text-amber-200"}>{String(postType.allowed_by_plan)}</span></p>
                            <p>last_payload_hash: <span className="text-zinc-200">{shortHash(postType.last_payload_hash)}</span></p>
                            <p>last_posted_at: <span className="text-zinc-200">{postType.last_posted_at ? formatDashboardDate(postType.last_posted_at) : "none"}</span></p>
                            <p>last_edited_at: <span className="text-zinc-200">{postType.last_edited_at ? formatDashboardDate(postType.last_edited_at) : "none"}</span></p>
                            <p>last_dispatch_attempt_at: <span className="text-zinc-200">{postType.last_dispatch_attempt_at ? formatDashboardDate(postType.last_dispatch_attempt_at) : "none"}</span></p>
                            <p>last_dispatch_status: <span className="text-zinc-200">{postType.last_dispatch_status ?? "none"}</span></p>
                            <p>last_dispatch_error: <span className="text-zinc-200">{postType.last_dispatch_error ?? "none"}</span></p>
                            <p>queued job count: <span className="text-zinc-200">{postType.queued_job_count ?? 0}</span></p>
                            <p>latest automation job id: <span className="text-zinc-200">{postType.latest_automation_job_id ?? "none"}</span></p>
                          </div>
                        ))}
                      </div>
                    ) : null}
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
          <MiniInfo label="Channels Fetched" value={String(usingCachedChannelState && channelCache ? channelCache.last_channel_count : diagnostics?.channels_fetched_count ?? channels.length)} />
          <MiniInfo label="Postable Channels" value={String(usingCachedChannelState && channelCache ? channelCache.last_postable_channel_count : diagnostics?.postable_channels_count ?? channels.filter((channel) => channel.can_post).length)} />
          <MiniInfo label="Last Fetch Error" value={channelFetchFailure?.error_code ?? diagnostics?.last_fetch_error_code ?? "None"} />
          <MiniInfo label="Last Fetch Status" value={String(channelFetchFailure?.status ?? diagnostics?.last_fetch_status ?? "None")} />
          <MiniInfo label="Last Fetch Attempt" value={channelFetchFailure?.attempted_at ? formatDashboardDate(channelFetchFailure.attempted_at) : diagnostics?.last_fetch_attempt_at ? formatDashboardDate(diagnostics.last_fetch_attempt_at) : diagnostics?.last_fetch_time ? formatDashboardDate(diagnostics.last_fetch_time) : "Waiting"} />
          <MiniInfo label="Last Fetch Success" value={channelCache?.last_channel_fetch_success_at ? formatDashboardDate(channelCache.last_channel_fetch_success_at) : diagnostics?.last_fetch_success_at ? formatDashboardDate(diagnostics.last_fetch_success_at) : "Waiting"} />
          <MiniInfo label="Using Cached State" value={usingCachedChannelState ? "Yes" : "No"} />
          <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-2 sm:col-span-2 lg:col-span-4">
            <p className="text-[10px] font-black uppercase text-zinc-500">Last Fetch Message</p>
            <p className="mt-1 text-xs font-bold text-zinc-200">{channelFetchFailure?.message ?? diagnostics?.last_fetch_error_message ?? "Channel fetch is healthy."}</p>
          </div>
        </div>
      ) : null}
      {message ? <p className="mt-3 text-xs font-bold text-cyan-100">{message}</p> : null}
    </DashboardPanel>
  );
}

function AutomationHealthPanel({ health }: { health: AutomationHealth }) {
  const summary = getAutomationHealthSummary(health);
  const cron = health.cron_health;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
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
        {cron ? (
          <>
            <MiniInfo label="Cron Status" value={formatStatusLabel(cron.status)} />
            <MiniInfo label="Cloudflare Check-in" value={formatCronRunSummary(cron.cloudflare)} />
            <MiniInfo label="GitHub Backup Check-in" value={formatCronRunSummary(cron.github_backup)} />
            <MiniInfo label="Discord Cron" value={formatCronRunSummary(cron.discord_posts)} />
          </>
        ) : null}
        <MiniInfo label="Last Metadata Run" value={health.last_metadata_sync_run ? formatDashboardDate(health.last_metadata_sync_run) : "Waiting"} />
        <MiniInfo label="Last ADM Discovery" value={health.last_adm_discovery_run ? formatDashboardDate(health.last_adm_discovery_run) : "Waiting"} />
        <MiniInfo label="Last ADM Run" value={health.last_adm_sync_run ? formatDashboardDate(health.last_adm_sync_run) : "Waiting"} />
        <MiniInfo label="Last Discord Dispatch" value={health.last_discord_dispatcher_run ? formatDashboardDate(health.last_discord_dispatcher_run) : "Waiting"} />
        <MiniInfo label="Last Cron Source" value={formatCronSource(health.last_cron_trigger_source)} />
        <MiniInfo label="Last Cron Trigger" value={health.last_cron_trigger_at ? formatDashboardDate(health.last_cron_trigger_at) : "Waiting"} />
        <MiniInfo label="Cloudflare Cron" value={health.latest_cloudflare_cron_run_at ? formatDashboardDate(health.latest_cloudflare_cron_run_at) : "Waiting"} />
        <MiniInfo label="GitHub Backup" value={health.latest_github_backup_cron_run_at ? formatDashboardDate(health.latest_github_backup_cron_run_at) : "Waiting"} />
        <MiniInfo label="Cron Table" value={health.automation_cron_runs_table_exists ? health.automation_cron_runs_migration_applied && health.automation_cron_metrics_migration_applied !== false ? "Migration applied" : "Runtime-created" : "Missing"} />
        <MiniInfo label="Due Metadata Jobs" value={String(health.due_metadata_jobs)} />
        <MiniInfo label="Due ADM Discovery" value={String(health.due_adm_discovery_jobs ?? 0)} />
        <MiniInfo label="Due ADM Jobs" value={String(health.due_adm_jobs)} />
        <MiniInfo label="Newest ADM Found" value={health.newest_adm_found ?? "Waiting"} />
        <MiniInfo label="Newest ADM Readable" value={health.newest_adm_readable ? "Yes" : health.newest_adm_found ? "No" : "Waiting"} />
        <MiniInfo label="Latest Scheduled Job" value={formatAutomationAdmJob(health.latest_scheduled_nitrado_job)} />
        <MiniInfo label="Active ADM Jobs" value={String(health.active_adm_import_jobs_count ?? 0)} />
        <MiniInfo label="Stuck ADM Jobs" value={String(health.stuck_adm_import_jobs_count ?? 0)} />
        <MiniInfo label="Completed ADM Today" value={String(health.completed_adm_import_jobs_today ?? 0)} />
        <MiniInfo label="Retryable ADM Jobs" value={String(health.failed_retryable_adm_import_jobs ?? 0)} />
        <MiniInfo label="Last ADM Chunk" value={health.last_adm_import_chunk_processed_at ? formatDashboardDate(health.last_adm_import_chunk_processed_at) : "Waiting"} />
        <MiniInfo label="Last Completed ADM" value={health.last_completed_adm_file ?? "None"} />
        <MiniInfo label="Next ADM Discovery" value={health.next_adm_discovery_due_at ? formatDashboardDate(health.next_adm_discovery_due_at) : "Waiting"} />
        <MiniInfo label="Next ADM Processing" value={health.next_adm_processing_due_at ? formatDashboardDate(health.next_adm_processing_due_at) : "Waiting"} />
        <MiniInfo label="Queued Discord Jobs" value={String(health.queued_discord_post_jobs)} />
        <MiniInfo label="Failed Jobs" value={String(health.failed_jobs)} />
        <MiniInfo label="Stuck Locks" value={`${health.stuck_currently_checking_status_locks + health.stuck_currently_syncing_adm_locks}`} />
      </div>
      <div className="mt-4 grid gap-2">
        <HealthCountLine label="Plans" counts={health.server_count_by_plan} />
        <HealthCountLine label="Subscriptions" counts={health.subscription_count_by_status} />
      </div>
      {health.due_server_diagnostics?.length ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setDiagnosticsOpen((value) => !value)}
            className="text-left text-[10px] font-black uppercase text-cyan-100 transition hover:text-cyan-50"
          >
            {diagnosticsOpen ? "Hide" : "Show"} Due Server Diagnostics
          </button>
          {diagnosticsOpen ? (
            <div className="mt-3 grid gap-2">
              {health.due_server_diagnostics.slice(0, 10).map((row) => (
                <div key={row.linked_server_id} className="rounded-lg border border-white/10 bg-black/24 p-3 text-xs leading-5 text-zinc-300">
                  <p className="font-black text-white">{row.server_name ?? row.public_slug ?? row.linked_server_id}</p>
                  <p>Plan: {planLabel(row.plan_key)} / {row.subscription_status ?? "unknown"}</p>
                  <p>Intervals: status {row.status_interval_minutes ?? "?"}m / discovery {row.adm_discovery_interval_minutes ?? "?"}m / processing {row.adm_processing_interval_minutes ?? "?"}m</p>
                  <p>Reason: {formatStatusLabel(row.skipped_reason)}</p>
                  {row.currently_checking_status ? <p>Status lock age: {row.status_lock_age_minutes !== null && row.status_lock_age_minutes !== undefined ? `${row.status_lock_age_minutes} min` : "Unknown"}</p> : null}
                  {row.currently_syncing_adm ? <p>ADM lock age: {row.adm_lock_age_minutes !== null && row.adm_lock_age_minutes !== undefined ? `${row.adm_lock_age_minutes} min` : "Unknown"}</p> : null}
                  <p>Status due: {row.next_status_check_due_at ? formatDashboardDate(row.next_status_check_due_at) : "Now"}</p>
                  <p>ADM discovery due: {row.next_adm_discovery_due_at ? formatDashboardDate(row.next_adm_discovery_due_at) : "Now"}</p>
                  <p>ADM processing due: {row.next_adm_pull_due_at ? formatDashboardDate(row.next_adm_pull_due_at) : "Now"}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </DashboardPanel>
  );
}

function AutomaticAdmImportJobPanel({ syncStatus, dashboardHealth }: { syncStatus: AdmSyncStatus | null; dashboardHealth: DashboardHealthResult | null }) {
  const job = syncStatus?.active_adm_import_job ?? (dashboardHealth?.sync.active_job ? dashboardHealthJobToAdmJob(dashboardHealth.sync.active_job) : null);
  const report = syncStatus?.last_adm_import_report ?? null;
  const readFailed = ["adm_file_unreadable", "latest_adm_unreadable"].includes(String(syncStatus?.last_sync_status ?? dashboardHealth?.sync.status ?? "").toLowerCase());
  const backfillActive = Boolean(syncStatus?.adm_backfill_status?.active_job || syncStatus?.adm_backfill_status?.queued_files?.length || dashboardHealth?.sync.backfill_status.active_file || dashboardHealth?.sync.backfill_status.queued_jobs_count);
  const jobProgress = job ? getSafeAdmChunkProgressPercent(job) : null;
  const nextAction = job
    ? job.status === "failed_retryable"
      ? "Cron will retry the stalled chunk job automatically, or an owner can use Continue Import to resume it now."
      : "Dashboard Continue Import can actively process chunks now. Cron remains the background backup."
    : readFailed && !backfillActive
      ? "Retry Nitrado ADM download on the next discovery or processing run."
      : "Wait for the next Nitrado ADM file after reset.";
  return (
    <div className="mt-4 rounded-lg border border-cyan-300/15 bg-cyan-400/8 p-3">
      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-black uppercase text-cyan-100">Automatic ADM Import Job</p>
          <p className="mt-1 text-sm font-bold leading-6 text-zinc-100">
            {job ? job.filename : report?.admFileName ? `Latest completed ADM: ${report.admFileName}` : "No active scheduled ADM job"}
          </p>
        </div>
        <SmallBadge tone={job ? "emerald" : readFailed && !backfillActive ? "orange" : "zinc"}>{job ? formatStatusLabel(job.status) : readFailed && !backfillActive ? "Nitrado Read Failed" : "Idle"}</SmallBadge>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <MiniInfo label="Source" value={job?.source ?? report?.importSource ?? "scheduled_nitrado"} />
        <MiniInfo label="Chunk" value={job ? `${job.display_current_chunk ?? Math.min(job.total_chunks, job.chunks_processed + 1)}/${job.total_chunks}` : "No active job"} />
        <MiniInfo label="Parsed Kills" value={String(job?.parsed_kills ?? report?.parsedPvpKills ?? 0)} />
        <MiniInfo label="Written Kills" value={String(job?.written_kills ?? report?.writtenKills ?? 0)} />
        <MiniInfo label="Joins" value={String(job?.joins ?? report?.parsedJoins ?? 0)} />
        <MiniInfo label="Disconnects" value={String(job?.disconnects ?? report?.parsedDisconnects ?? 0)} />
        <MiniInfo label="PlayerList" value={String(job?.playerlist_snapshots ?? report?.parsedPlayerlistSnapshots ?? 0)} />
        <MiniInfo label="Last Updated" value={job?.updated_at ? formatDashboardDate(job.updated_at) : report?.importedAt ? formatDashboardDate(report.importedAt) : "Waiting"} />
        <MiniInfo label="Duplicate Skips" value={String(job?.duplicate_skips ?? report?.duplicateSkips ?? 0)} />
        <MiniInfo label="Chunk Count" value={job?.chunk_count_mismatch ? "Corrected for display" : "OK"} />
      </div>
      {job ? (
        <div className="mt-3">
          <ProgressLine label="ADM Job Progress" value={`${job.display_current_chunk ?? Math.min(job.total_chunks, job.chunks_processed + 1)}/${job.total_chunks} chunks`} percent={jobProgress ?? 0} />
        </div>
      ) : null}
      <p className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold leading-5 text-zinc-300">
        {readFailed && !backfillActive ? syncStatus?.last_adm_discovery_error ?? syncStatus?.last_sync_message ?? nextAction : nextAction}
      </p>
      {!job ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <MiniInfo label="Next Discovery" value={syncStatus?.next_adm_discovery_due_at ? formatDashboardDate(syncStatus.next_adm_discovery_due_at) : "Waiting"} />
          <MiniInfo label="Next Processing" value={syncStatus?.next_adm_pull_due_at ? formatDashboardDate(syncStatus.next_adm_pull_due_at) : "Waiting"} />
        </div>
      ) : null}
    </div>
  );
}

function AdmBackfillStatusPanel({
  syncStatus,
  dashboardHealth,
  result,
  running,
  onBackfill,
}: {
  syncStatus: AdmSyncStatus | null;
  dashboardHealth: DashboardHealthResult | null;
  result: AdmBackfillPlanResult | null;
  running: boolean;
  onBackfill: () => void;
}) {
  const status = syncStatus?.adm_backfill_status ?? null;
  const healthBackfill = dashboardHealth?.sync.backfill_status ?? null;
  const activeJob = result?.active_job ?? status?.active_job ?? syncStatus?.active_adm_import_job ?? (dashboardHealth?.sync.active_job ? dashboardHealthJobToAdmJob(dashboardHealth.sync.active_job) : null);
  const queuedFiles = result?.queued_files ?? status?.queued_files ?? [];
  const missingCount = result?.missing_files.length ?? status?.missing_files_detected ?? healthBackfill?.missing_files_count ?? 0;
  const skippedCount = result?.skipped_already_imported.length ?? status?.skipped_already_imported ?? 0;
  const unreadableFiles = result?.unreadable_files.map((file) => file.filename) ?? status?.unreadable_files ?? [];
  const backfillTotal = Math.max(1, missingCount + queuedFiles.length + skippedCount + (result?.completed_files.length ?? status?.completed_files_today ?? 0));
  const backfillDone = Math.min(backfillTotal, skippedCount + (result?.completed_files.length ?? status?.completed_files_today ?? 0));
  const backfillProgress = activeJob ? getSafeAdmChunkProgressPercent(activeJob) : Math.round((backfillDone / backfillTotal) * 100);
  const summary = activeJob
    ? `Processing ${activeJob.filename} chunk ${Math.min(activeJob.total_chunks, activeJob.chunks_processed + 1)}/${activeJob.total_chunks}`
    : missingCount > 0
      ? `Backfilling ${missingCount} missing ADM file${missingCount === 1 ? "" : "s"}`
      : "No missing ADM files detected";
  return (
    <div className="mt-4 rounded-lg border border-amber-300/15 bg-amber-400/8 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase text-amber-100">ADM Backfill Status</p>
          <p className="mt-1 text-sm font-bold leading-6 text-zinc-100">{summary}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">{result?.message ?? status?.next_action ?? healthBackfill?.next_action ?? "DZN will queue old missing ADM files oldest-to-newest."}</p>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={onBackfill}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs font-black uppercase text-amber-50 transition hover:border-amber-300/45 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ListChecks className={`h-4 w-4 ${running ? "animate-pulse" : ""}`} />
          {running ? "Backfilling..." : "Backfill Missing ADM Now"}
        </button>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <MiniInfo label="Missing ADM Files" value={String(missingCount)} />
        <MiniInfo label="Queued ADM Files" value={queuedFiles.length ? queuedFiles.slice(0, 2).join(", ") : "None"} />
        <MiniInfo label="Active File" value={activeJob?.filename ?? status?.active_file ?? healthBackfill?.active_file ?? "None"} />
        <MiniInfo label="Completed Today" value={String(status?.completed_files_today ?? result?.completed_files.length ?? healthBackfill?.completed_today ?? 0)} />
        <MiniInfo label="Skipped Imported" value={String(skippedCount)} />
        <MiniInfo label="Oldest Missing" value={result?.oldest_missing_file ?? status?.oldest_missing_file ?? healthBackfill?.oldest_missing_file ?? "None"} />
        <MiniInfo label="Newest Missing" value={result?.newest_missing_file ?? status?.newest_missing_file ?? healthBackfill?.newest_missing_file ?? "None"} />
        <MiniInfo label="Unreadable Missing" value={unreadableFiles.length ? unreadableFiles.slice(0, 2).join(", ") : healthBackfill?.unreadable_files_count ? String(healthBackfill.unreadable_files_count) : "None"} />
      </div>
      <div className="mt-3">
        <ProgressLine
          label={activeJob ? "Active File Progress" : "Backfill Queue Progress"}
          value={activeJob ? `${activeJob.display_current_chunk ?? Math.min(activeJob.total_chunks, activeJob.chunks_processed + 1)}/${activeJob.total_chunks} chunks` : `${backfillDone}/${backfillTotal} handled`}
          percent={backfillProgress}
        />
      </div>
      {activeJob ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <MiniInfo label="Chunk" value={`${Math.min(activeJob.total_chunks, activeJob.chunks_processed + 1)}/${activeJob.total_chunks}`} />
          <MiniInfo label="Parsed Kills" value={String(activeJob.parsed_kills)} />
          <MiniInfo label="Joins" value={String(activeJob.joins)} />
          <MiniInfo label="PlayerList" value={String(activeJob.playerlist_snapshots)} />
        </div>
      ) : null}
    </div>
  );
}

function VerifyAdmAutomationPanel({
  status,
  verifying,
  onVerify,
}: {
  status: AdmAutomationStatusResult | null;
  verifying: boolean;
  onVerify: () => void;
}) {
  const activeJob = status?.active_job ?? null;
  const completed = status?.latest_completed_job ?? null;
  return (
    <div className="mt-4 rounded-lg border border-emerald-300/15 bg-emerald-400/8 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase text-emerald-100">Verify ADM Automation</p>
          <p className="mt-1 text-sm font-bold leading-6 text-zinc-100">
            {status ? status.next_action : "Run a direct DB-backed automation check for this server."}
          </p>
        </div>
        <button
          type="button"
          disabled={verifying}
          onClick={onVerify}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-black uppercase text-emerald-50 transition hover:border-emerald-300/45 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ShieldCheck className={`h-4 w-4 ${verifying ? "animate-pulse" : ""}`} />
          {verifying ? "Verifying..." : "Verify ADM Automation"}
        </button>
      </div>
      {status ? (
        <>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <MiniInfo label="Cron Healthy" value={status.cron.cron_healthy ? "Yes" : "Needs attention"} />
            <MiniInfo label="Plan" value={`${planLabel(status.plan.plan_key)} / ${status.plan.subscription_status ?? "unknown"}`} />
            <MiniInfo label="Latest ADM" value={status.adm.newest_available_adm_filename ?? "Waiting"} />
            <MiniInfo label="Readable ADM" value={status.adm.newest_readable_adm_filename ?? "Waiting"} />
            <MiniInfo label="Active Job" value={activeJob ? `${activeJob.filename} ${activeJob.current_chunk}/${activeJob.total_chunks}` : "None"} />
            <MiniInfo label="Latest Completed" value={completed ? `${completed.filename} (${formatStatusLabel(completed.status)})` : "None"} />
            <MiniInfo label="Recent Events" value={String(status.latest_events.recent_events_count)} />
            <MiniInfo label="Latest Event" value={status.latest_events.latest_event_at ? formatDashboardDate(status.latest_events.latest_event_at) : "None"} />
            <MiniInfo label="Kills" value={String(status.stats.kills)} />
            <MiniInfo label="Deaths" value={String(status.stats.deaths)} />
            <MiniInfo label="Joins" value={String(status.stats.joins)} />
            <MiniInfo label="Score" value={String(status.stats.score)} />
          </div>
          <p className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold leading-5 text-zinc-300">
            Warnings: {status.problem_flags.length ? status.problem_flags.map(formatStatusLabel).join(", ") : "None"}
          </p>
        </>
      ) : null}
    </div>
  );
}

function DashboardDataHealthPanel({
  liveRefreshStatus,
  lastSuccessfulFullRefresh,
  lastSuccessfulSyncStatusRefresh,
  lastSuccessfulRecentEventsRefresh,
  lastSuccessfulBillingRefresh,
  failedRefreshCount,
  failedEndpoint,
  lastRefreshError,
  showingCachedData,
  lastGoodAdmJob,
  dashboardHealth,
}: {
  liveRefreshStatus: "ok" | "retrying" | "failed" | "stale";
  lastSuccessfulFullRefresh: string | null;
  lastSuccessfulSyncStatusRefresh: string | null;
  lastSuccessfulRecentEventsRefresh: string | null;
  lastSuccessfulBillingRefresh: string | null;
  failedRefreshCount: number;
  failedEndpoint: string | null;
  lastRefreshError: string | null;
  showingCachedData: boolean;
  lastGoodAdmJob: AdmImportJobProgressResult | null;
  dashboardHealth: DashboardHealthResult | null;
}) {
  return (
    <details className="mt-4 rounded-lg border border-white/10 bg-black/24 p-3">
      <summary className="cursor-pointer text-xs font-black uppercase text-zinc-200">Dashboard Data Health</summary>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <MiniInfo label="Retry State" value={formatStatusLabel(liveRefreshStatus)} />
        <MiniInfo label="Cached Last-Good Data" value={showingCachedData ? "Yes" : "No"} />
        <MiniInfo label="Failed Refresh Count" value={String(failedRefreshCount)} />
        <MiniInfo label="Last Failed Endpoint" value={failedEndpoint ?? "None"} />
        <MiniInfo label="Full Refresh" value={lastSuccessfulFullRefresh ? formatDashboardDate(lastSuccessfulFullRefresh) : "Waiting"} />
        <MiniInfo label="Sync Status Refresh" value={lastSuccessfulSyncStatusRefresh ? formatDashboardDate(lastSuccessfulSyncStatusRefresh) : "Waiting"} />
        <MiniInfo label="Recent Events Refresh" value={lastSuccessfulRecentEventsRefresh ? formatDashboardDate(lastSuccessfulRecentEventsRefresh) : "Waiting"} />
        <MiniInfo label="Billing Refresh" value={lastSuccessfulBillingRefresh ? formatDashboardDate(lastSuccessfulBillingRefresh) : "Waiting"} />
        <MiniInfo label="Dashboard Health Refresh" value={dashboardHealth?.generated_at ? formatDashboardDate(dashboardHealth.generated_at) : "Waiting"} />
        <MiniInfo label="Last-Good Source" value={dashboardHealth?.source ? formatStatusLabel(dashboardHealth.source) : "None"} />
        <MiniInfo label="Snapshot Stale" value={dashboardHealth?.stale ? "Yes" : "No"} />
        <MiniInfo label="Last ADM Job" value={lastGoodAdmJob ? `${lastGoodAdmJob.filename} ${lastGoodAdmJob.display_current_chunk ?? lastGoodAdmJob.chunks_processed}/${lastGoodAdmJob.total_chunks}` : "None"} />
      </div>
      {lastRefreshError ? (
        <p className="mt-3 rounded-lg border border-orange-300/20 bg-orange-400/10 px-3 py-2 text-xs font-bold leading-5 text-orange-50">
          {lastRefreshError}
        </p>
      ) : null}
    </details>
  );
}

function PublicCacheHealthPanel({
  debug,
  rebuildResult,
  stale,
  rebuilding,
  onRebuild,
}: {
  debug: PublicCacheDebug;
  rebuildResult: PublicCacheRebuildResult | null;
  stale: boolean;
  rebuilding: boolean;
  onRebuild: () => void;
}) {
  const [open, setOpen] = useState(false);
  const flags = debug.problem_flags.length ? debug.problem_flags.map(formatStatusLabel).join(", ") : "None";
  return (
    <div className={`mt-4 rounded-lg border p-3 ${stale ? "border-amber-300/20 bg-amber-400/10" : "border-emerald-300/20 bg-emerald-400/10"}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className={`text-xs font-black uppercase ${stale ? "text-amber-100" : "text-emerald-100"}`}>Public Profile Cache</p>
          <p className="mt-1 text-sm font-bold leading-6 text-zinc-200">
            {stale ? "Public profile cache is stale. Rebuild recommended." : "Public profile cache is aligned with current sync data."}
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Profile last sync uses {formatStatusLabel(debug.timestamps.profile_last_sync_display_source)} at {debug.timestamps.profile_last_sync_display_at ? formatDashboardDate(debug.timestamps.profile_last_sync_display_at) : "no recorded sync"}.
          </p>
        </div>
        <button
          type="button"
          disabled={rebuilding}
          onClick={onRebuild}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${rebuilding ? "animate-spin" : ""}`} />
          {rebuilding ? "Rebuilding..." : "Rebuild Public Cache Now"}
        </button>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <MiniInfo label="Public Cache Updated" value={debug.timestamps.public_cache_updated_at ? formatDashboardDate(debug.timestamps.public_cache_updated_at) : "Missing"} />
        <MiniInfo label="Metadata Checked" value={debug.timestamps.metadata_last_checked_at ? formatDashboardDate(debug.timestamps.metadata_last_checked_at) : "Not checked"} />
        <MiniInfo label="ADM Processed" value={debug.timestamps.adm_last_processed_at ? formatDashboardDate(debug.timestamps.adm_last_processed_at) : "Not processed"} />
        <MiniInfo label="Flags" value={flags} />
      </div>
      {rebuildResult ? (
        <p className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-50">
          Rebuilt {formatRelativeTime(rebuildResult.rebuilt_at)}. Cache age is now {rebuildResult.after.staleness.public_cache_age_minutes ?? 0} minutes.
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-3 text-left text-[10px] font-black uppercase text-cyan-100 transition hover:text-cyan-50"
      >
        {open ? "Hide" : "Show"} Public Cache Diagnostics
      </button>
      {open ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-white/10 bg-black/24 p-3 text-xs leading-5 text-zinc-300 md:grid-cols-2">
          <MiniInfo label="Plan" value={`${planLabel(debug.plan_key)} / ${debug.subscription_status ?? "unknown"}`} />
          <MiniInfo label="Status Due" value={debug.plan_due_state.next_status_due_at ? formatDashboardDate(debug.plan_due_state.next_status_due_at) : "Now"} />
          <MiniInfo label="ADM Discovery Due" value={debug.plan_due_state.next_adm_discovery_due_at ? formatDashboardDate(debug.plan_due_state.next_adm_discovery_due_at) : "Now"} />
          <MiniInfo label="ADM Processing Due" value={debug.plan_due_state.next_adm_pull_due_at ? formatDashboardDate(debug.plan_due_state.next_adm_pull_due_at) : "Now"} />
          <MiniInfo label="Plan Skip Reason" value={debug.plan_due_state.skipped_reason ? formatStatusLabel(debug.plan_due_state.skipped_reason) : "Due or active"} />
          <MiniInfo label="Last Cloudflare Cron" value={debug.cron.last_cloudflare_cron_at ? formatDashboardDate(debug.cron.last_cloudflare_cron_at) : "No check-in"} />
          <MiniInfo label="Last Metadata Cron" value={debug.cron.last_metadata_cron_at ? formatDashboardDate(debug.cron.last_metadata_cron_at) : "No check-in"} />
          <MiniInfo label="Last ADM Cron" value={debug.cron.last_adm_cron_at ? formatDashboardDate(debug.cron.last_adm_cron_at) : "No check-in"} />
        </div>
      ) : null}
    </div>
  );
}

function SyncLockRecoveryPanel({
  result,
  recovering,
  onRecover,
}: {
  result: SyncLockRecoveryResult | null;
  recovering: boolean;
  onRecover: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-black/24 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase text-zinc-200">Sync Lock Recovery</p>
          <p className="mt-1 text-sm font-bold leading-6 text-zinc-300">
            Releases stale status locks older than 10 minutes and stale ADM locks older than 30 minutes. Fresh active locks are left alone.
          </p>
        </div>
        <button
          type="button"
          disabled={recovering}
          onClick={onRecover}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs font-black uppercase text-amber-50 transition hover:border-amber-300/45 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${recovering ? "animate-spin" : ""}`} />
          {recovering ? "Recovering..." : "Recover Stuck Sync Locks"}
        </button>
      </div>
      {result ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <MiniInfo label="Recovered" value={result.recovered ? "Yes" : "No stale locks"} />
          <MiniInfo label="Status Lock" value={`${result.before.currently_checking_status ? "Locked" : "Clear"} -> ${result.after.currently_checking_status ? "Locked" : "Clear"}`} />
          <MiniInfo label="ADM Lock" value={`${result.before.currently_syncing_adm ? "Locked" : "Clear"} -> ${result.after.currently_syncing_adm ? "Locked" : "Clear"}`} />
          <MiniInfo label="Status Lock Age" value={result.before.status_lock_age_minutes !== null && result.before.status_lock_age_minutes !== undefined ? `${result.before.status_lock_age_minutes} min` : "Unknown"} />
          <MiniInfo label="ADM Lock Age" value={result.before.adm_lock_age_minutes !== null && result.before.adm_lock_age_minutes !== undefined ? `${result.before.adm_lock_age_minutes} min` : "Unknown"} />
        </div>
      ) : null}
    </div>
  );
}

function ManualAdmImportPanel({
  filename,
  admText,
  uploadedFiles,
  importing,
  previewing,
  result,
  failure,
  preview,
  bulkResult,
  bulkFailure,
  bulkProgress,
  runnerPaused,
  activeRunnerJob,
  totalsDelta,
  importHitLines,
  refreshFailed,
  history,
  onFilenameChange,
  onTextChange,
  onImportHitLinesChange,
  onFileSelected,
  onFilesSelected,
  onImport,
  onPreview,
  onBulkImport,
  onBulkPreview,
  onRetryBulkFile,
  onContinueBulkFile,
  onPauseImport,
  onCancelImport,
  onRetryRefresh,
}: {
  filename: string;
  admText: string;
  uploadedFiles: AdmUploadFile[];
  importing: boolean;
  previewing: boolean;
  result: ManualAdmImportResult | null;
  failure: ManualAdmImportErrorResult | null;
  preview: ManualAdmParsePreviewResult | null;
  bulkResult: BulkAdmImportResult | null;
  bulkFailure: ManualAdmImportErrorResult | null;
  bulkProgress: AdmBulkProgress | null;
  runnerPaused: boolean;
  activeRunnerJob: { jobId: string; filename: string } | null;
  totalsDelta: DashboardTotalsDelta | null;
  importHitLines: boolean;
  refreshFailed: boolean;
  history: AdmSyncStatus["manual_import_history"];
  onFilenameChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onImportHitLinesChange: (value: boolean) => void;
  onFileSelected: (file: File | null) => void;
  onFilesSelected: (files: FileList | File[] | null) => void;
  onImport: () => void;
  onPreview: () => void;
  onBulkImport: () => void;
  onBulkPreview: () => void;
  onRetryBulkFile: (filename: string) => void;
  onContinueBulkFile: (filename: string, jobId?: string | null) => void;
  onPauseImport: () => void;
  onCancelImport: (filename?: string, jobId?: string | null) => void;
  onRetryRefresh: () => Promise<boolean>;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasBulkFiles = uploadedFiles.length > 0;
  const canRunBulk = hasBulkFiles || (filename.trim() && admText.trim());
  return (
    <div className="mt-4 rounded-lg border border-violet-300/18 bg-violet-400/8 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase text-violet-100">ADM File Import</p>
          <p className="mt-1 text-sm font-bold leading-6 text-zinc-300">
            Upload one or more ADM files, or paste text if Nitrado can show the ADM but DZN cannot download it automatically.
          </p>
        </div>
        <label className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-xs font-black uppercase text-zinc-100 transition hover:border-violet-300/35">
          <Upload className="h-4 w-4" />
          Upload ADM Files
          <input
            type="file"
            multiple
            accept=".ADM,.adm,.txt,text/plain"
            className="hidden"
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files && files.length > 1) {
                void onFilesSelected(files);
              } else {
                void onFileSelected(files?.[0] ?? null);
                void onFilesSelected(files);
              }
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {uploadedFiles.length ? (
        <div className="mt-4 rounded-lg border border-white/10 bg-black/24 p-3">
          <p className="text-[10px] font-black uppercase text-zinc-400">Selected files</p>
          <div className="mt-2 grid gap-2">
            {uploadedFiles.map((file) => (
              <div key={`${file.filename}-${file.size}`} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="break-all text-xs font-bold text-zinc-100">{file.filename}</span>
                  <span className="text-[10px] font-black uppercase text-zinc-500">{formatBytes(file.size)}</span>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                  <MiniInfo label="Lines Detected" value={String(file.preview.lineCount)} />
                  <MiniInfo label="Chunks" value={String(file.preview.chunkCount)} />
                  <MiniInfo label="Preview Kills" value={String(file.preview.parsedKills)} />
                  <MiniInfo label="Joins" value={String(file.preview.joins)} />
                  <MiniInfo label="Disconnects" value={String(file.preview.disconnects)} />
                  <MiniInfo label="PlayerList" value={String(file.preview.playerlistSnapshots)} />
                </div>
                {file.preview.firstLinePreview ? (
                  <p className="mt-2 break-words rounded border border-white/10 bg-black/24 px-2 py-1 font-mono text-[10px] text-zinc-400">
                    First line: {file.preview.firstLinePreview}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-xs font-black uppercase text-zinc-400">
          ADM filename
          <input
            type="text"
            value={filename}
            onChange={(event) => onFilenameChange(event.currentTarget.value)}
            placeholder="DayZServer_PS4_x64_2026-05-20_09-01-27.ADM"
            className="rounded-lg border border-white/10 bg-black/34 px-3 py-2 text-sm font-bold normal-case text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-300/45"
          />
        </label>
        <label className="grid gap-1 text-xs font-black uppercase text-zinc-400">
          Paste ADM log text
          <textarea
            value={admText}
            onChange={(event) => onTextChange(event.currentTarget.value)}
            rows={8}
            placeholder="AdminLog started on ..."
            className="min-h-40 resize-y rounded-lg border border-white/10 bg-black/34 px-3 py-2 font-mono text-xs leading-5 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-300/45"
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-2">
            <p className="text-xs font-bold text-zinc-400">
              Imports use browser-side 10-line chunks, rebuild stats once after each file, refresh public cache, and queue allowed Discord posts.
            </p>
            <label className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold normal-case text-zinc-300">
              <input
                type="checkbox"
                checked={importHitLines}
                onChange={(event) => onImportHitLinesChange(event.currentTarget.checked)}
                className="mt-0.5 h-4 w-4 accent-violet-400"
              />
              <span>
                Import hit feed lines
                <span className="block text-[10px] font-black uppercase text-zinc-500">Off by default to avoid hit-spam and Worker/D1 request limits.</span>
              </span>
            </label>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={previewing || importing || !canRunBulk}
              onClick={onBulkPreview}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-500/12 px-3 py-2 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <ListChecks className={`h-4 w-4 ${previewing ? "animate-pulse" : ""}`} />
              {previewing ? "Previewing..." : "Preview ADM Files"}
            </button>
            <button
              type="button"
              disabled={importing || !canRunBulk}
              onClick={onBulkImport}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-300/25 bg-violet-500/18 px-3 py-2 text-xs font-black uppercase text-violet-50 transition hover:border-violet-300/45 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <DatabaseZap className={`h-4 w-4 ${importing ? "animate-pulse" : ""}`} />
              {importing ? "Importing..." : "Import ADM Files Now"}
            </button>
          </div>
        </div>
        {bulkProgress ? (
          <div className="rounded-lg border border-violet-300/20 bg-violet-400/10 p-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-black uppercase text-violet-100">
                Importing {bulkProgress.current}/{bulkProgress.total}
              </p>
              <p className="break-all text-xs font-bold text-violet-50">
                {bulkProgress.filename ?? "Preparing ADM files"}
                {bulkProgress.chunkTotal ? ` - chunk ${bulkProgress.chunkCurrent ?? 0}/${bulkProgress.chunkTotal}` : ""}
              </p>
            </div>
            {bulkProgress.status ? (
              <p className="mt-1 text-[10px] font-black uppercase text-violet-200">{bulkProgress.status}</p>
            ) : null}
            {bulkProgress.chunkTotal ? (
              <p className="mt-1 text-[10px] font-black uppercase text-violet-200">
                Written kills: {bulkProgress.writtenKills ?? 0} | Duplicates: {bulkProgress.duplicateSkips ?? 0}
              </p>
            ) : null}
            {bulkProgress.activeInBrowser ? (
              <div className="mt-2 grid gap-2 text-[10px] font-black uppercase text-violet-100 sm:grid-cols-3">
                <span>{bulkProgress.chunksPerMinute ? `${bulkProgress.chunksPerMinute} chunks/min` : "Calculating speed"}</span>
                <span>{bulkProgress.estimatedRemainingSeconds !== null && bulkProgress.estimatedRemainingSeconds !== undefined ? `${formatDuration(bulkProgress.estimatedRemainingSeconds * 1000)} remaining` : "ETA pending"}</span>
                <span>{bulkProgress.lastChunkAt ? `Last chunk ${formatDashboardDate(bulkProgress.lastChunkAt)}` : "First chunk pending"}</span>
              </div>
            ) : null}
            {activeRunnerJob ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!importing}
                  onClick={onPauseImport}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  Pause Import
                </button>
                <button
                  type="button"
                  onClick={() => onCancelImport(activeRunnerJob.filename, activeRunnerJob.jobId)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-[10px] font-black uppercase text-rose-50 transition hover:border-rose-300/45"
                >
                  Cancel Import
                </button>
              </div>
            ) : null}
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/40">
              <div
                className="h-full rounded-full bg-violet-300 transition-all"
                style={{
                  width: `${bulkProgress.chunkTotal
                    ? Math.max(4, Math.min(100, Math.round(((Math.max(0, bulkProgress.current - 1) + (Math.min(bulkProgress.chunkCurrent ?? 0, bulkProgress.chunkTotal) / bulkProgress.chunkTotal)) / bulkProgress.total) * 100)))
                    : bulkProgress.total ? Math.max(4, Math.round((bulkProgress.current / bulkProgress.total) * 100)) : 4}%`,
                }}
              />
            </div>
          </div>
        ) : null}
        {filename.trim() && admText.trim() ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={previewing || importing}
              onClick={onPreview}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-100 transition hover:border-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-55"
            >
              Preview Pasted Text Only
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={onImport}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-100 transition hover:border-violet-300/35 disabled:cursor-not-allowed disabled:opacity-55"
            >
              Import Pasted Text Only
            </button>
          </div>
        ) : null}
      </div>
      {bulkFailure && !(bulkResult?.files.some(isProcessingBulkAdmFile) ?? false) ? (
        <ManualAdmFailurePanel failure={bulkFailure} title="Bulk ADM Import Failed" />
      ) : null}
      {bulkResult ? (
        <BulkAdmImportResultPanel
          result={bulkResult}
          totalsDelta={totalsDelta}
          importing={importing}
          runnerPaused={runnerPaused}
          activeRunnerJob={activeRunnerJob}
          onRetryFile={onRetryBulkFile}
          onContinueFile={onContinueBulkFile}
          onPauseImport={onPauseImport}
          onCancelImport={onCancelImport}
        />
      ) : null}
      {preview ? (
        <div className="mt-4 rounded-lg border border-cyan-300/18 bg-cyan-400/8 p-3">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black uppercase text-cyan-100">Parsed ADM Preview</p>
              <p className="mt-1 break-all text-sm font-bold text-cyan-50">{preview.filename}</p>
            </div>
            <SmallBadge tone={preview.parsed_kills > 0 ? "emerald" : "orange"}>{preview.parsed_kills} PvP Kill{preview.parsed_kills === 1 ? "" : "s"}</SmallBadge>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <MiniInfo label="HTTP Status" value={preview.http_status ? String(preview.http_status) : "Not recorded"} />
            <MiniInfo label="Raw Lines" value={String(preview.raw_lines)} />
            <MiniInfo label="Raw Kill Lines" value={String(preview.raw_kill_lines_found)} />
            <MiniInfo label="Parsed PvP Kills" value={String(preview.parsed_kills)} />
            <MiniInfo label="Joins" value={String(preview.joins)} />
            <MiniInfo label="Disconnects" value={String(preview.disconnects)} />
            <MiniInfo label="PlayerList" value={String(preview.playerlist_snapshots)} />
            <MiniInfo label="Dead Hits Skipped" value={String(preview.skipped_dead_hit_lines)} />
          </div>
          <div className="mt-3 grid gap-2">
            {preview.kill_previews.length ? preview.kill_previews.map((kill) => (
              <p key={`${kill.line_number}-${kill.killer_name}-${kill.victim_name}`} className="rounded-md border border-cyan-300/15 bg-black/20 px-3 py-2 text-xs font-bold text-cyan-50">
                Line {kill.line_number}: {kill.victim_name ?? "Unknown victim"} -&gt; {kill.killer_name ?? "Unknown killer"}{kill.weapon ? ` / ${kill.weapon}` : ""}{kill.distance !== null ? ` / ${kill.distance}m` : ""}
              </p>
            )) : (
              <p className="rounded-md border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100">
                No PvP kill lines parsed from this text.
              </p>
            )}
          </div>
        </div>
      ) : null}
      {failure ? (
        <div className="mt-4 rounded-lg border border-rose-300/20 bg-rose-400/10 p-3">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black uppercase text-rose-100">Manual ADM Import Failed</p>
              <p className="mt-1 text-sm font-bold text-rose-50">{failure.message}</p>
            </div>
            <SmallBadge tone="orange">{failure.error_code}</SmallBadge>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <MiniInfo label="HTTP Status" value={failure.http_status !== undefined ? String(failure.http_status) : "Not recorded"} />
            <MiniInfo label="Error Code" value={failure.error_code} />
            <MiniInfo label="Message" value={failure.message} />
            <MiniInfo label="Details" value={formatDebugValue(failure.details)} />
          </div>
          {failure.response_body ? (
            <details className="mt-3 rounded-md border border-white/10 bg-black/24 p-3">
              <summary className="cursor-pointer text-xs font-black uppercase text-rose-100">Response Body</summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-rose-50">{failure.response_body}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
      {refreshFailed ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-amber-300/20 bg-amber-400/10 p-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm font-bold leading-6 text-amber-50">
            Import succeeded but dashboard refresh failed. Hard refresh or retry refresh.
          </p>
          <button
            type="button"
            onClick={() => void onRetryRefresh()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-200/30 bg-amber-300/12 px-3 py-2 text-xs font-black uppercase text-amber-50 transition hover:border-amber-200/50"
          >
            <RefreshCw className="h-4 w-4" />
            Retry Dashboard Refresh
          </button>
        </div>
      ) : null}
      {result ? (
        <div className="mt-4 rounded-lg border border-emerald-300/18 bg-emerald-400/8 p-3">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black uppercase text-emerald-100">Manual ADM Import Result</p>
              <p className="mt-1 break-all text-sm font-bold text-emerald-50">{result.filename}</p>
            </div>
            <SmallBadge tone={result.failed_writes > 0 ? "orange" : "emerald"}>{result.failed_writes > 0 ? "Needs Review" : "Succeeded"}</SmallBadge>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <MiniInfo label="Source" value={formatSyncTrigger(result.source)} />
            <MiniInfo label="Imported At" value={formatDashboardDate(result.imported_at)} />
            <MiniInfo label="HTTP Status" value={result.http_status ? String(result.http_status) : "Not recorded"} />
            <MiniInfo label="Import Report ID" value={result.import_report_id.slice(0, 8)} />
            <MiniInfo label="Raw Lines" value={String(result.raw_lines)} />
            <MiniInfo label="Parsed PvP Kills" value={String(result.parsed_kills)} />
            <MiniInfo label="Written Kills" value={String(result.written_kills)} />
            <MiniInfo label="Deaths" value={String(result.import_report.parsedSuicides + result.import_report.parsedUncreditedDeaths + result.written_kills)} />
            <MiniInfo label="Joins" value={String(result.joins)} />
            <MiniInfo label="Disconnects" value={String(result.disconnects)} />
            <MiniInfo label="PlayerList Snapshots" value={String(result.playerlist_snapshots)} />
            <MiniInfo label="Duplicate Skips" value={String(result.duplicate_skips)} />
            <MiniInfo label="Failed Writes" value={String(result.failed_writes)} />
            <MiniInfo label="Public Cache" value={result.public_cache_updated ? "Updated" : "Skipped"} />
            <MiniInfo label="Discord Jobs" value={String(result.discord_jobs_queued)} />
            <MiniInfo label="Total Kills" value={String(result.total_kills)} />
            <MiniInfo label="Total Deaths" value={String(result.total_deaths)} />
          </div>
          {result.parser_warnings.length ? (
            <div className="mt-3 grid gap-2">
              {result.parser_warnings.map((warning) => (
                <p key={warning} className="rounded-md border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100">{warning}</p>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-md border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100">
              No parser warnings were reported for this manual import.
            </p>
          )}
          {result.response_body ? (
            <details className="mt-3 rounded-md border border-white/10 bg-black/24 p-3">
              <summary className="cursor-pointer text-xs font-black uppercase text-emerald-100">Response Body</summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-emerald-50">{result.response_body}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 rounded-lg border border-white/10 bg-black/24">
        <button
          type="button"
          onClick={() => setHistoryOpen((value) => !value)}
          className="flex w-full items-center justify-between px-3 py-3 text-left text-xs font-black uppercase text-zinc-200"
        >
          <span>Manual ADM Imports</span>
          <span className="text-cyan-200">{historyOpen ? "Hide" : "Show"}</span>
        </button>
        {historyOpen ? (
          <div className="grid gap-2 border-t border-white/10 p-3">
            {history.length ? history.slice(0, 5).map((item) => (
              <div key={item.id} className="rounded-lg border border-white/10 bg-black/24 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="break-all text-sm font-black text-white">{item.filename ?? "Manual ADM import"}</p>
                    <p className="mt-1 text-xs font-bold text-zinc-500">{item.imported_at ? formatDashboardDate(item.imported_at) : "Time unknown"} | {formatSyncTrigger(item.source)}</p>
                  </div>
                  <SmallBadge tone={item.status === "completed" ? "emerald" : "orange"}>{formatStatusLabel(item.status)}</SmallBadge>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                  <MiniInfo label="Parsed Kills" value={String(item.parsed_kills)} />
                  <MiniInfo label="Written Kills" value={String(item.written_kills)} />
                  <MiniInfo label="Joins" value={String(item.joins)} />
                  <MiniInfo label="Disconnects" value={String(item.disconnects)} />
                  <MiniInfo label="Duplicates" value={String(item.duplicate_skips)} />
                  <MiniInfo label="Failed Writes" value={String(item.failed_writes)} />
                </div>
              </div>
            )) : (
              <p className="rounded-lg border border-white/10 bg-black/24 px-3 py-3 text-sm font-bold text-zinc-300">
                No manual ADM imports recorded yet.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BulkAdmImportResultPanel({
  result,
  totalsDelta,
  importing,
  runnerPaused,
  activeRunnerJob,
  onRetryFile,
  onContinueFile,
  onPauseImport,
  onCancelImport,
}: {
  result: BulkAdmImportResult;
  totalsDelta: DashboardTotalsDelta | null;
  importing: boolean;
  runnerPaused: boolean;
  activeRunnerJob: { jobId: string; filename: string } | null;
  onRetryFile: (filename: string) => void;
  onContinueFile: (filename: string, jobId?: string | null) => void;
  onPauseImport: () => void;
  onCancelImport: (filename?: string, jobId?: string | null) => void;
}) {
  const failedFiles = result.files.filter(isFailedBulkAdmFile);
  const processingFiles = result.files.filter(isProcessingBulkAdmFile);
  const completedFiles = result.files.filter((file) => isCompletedBulkAdmFile(file) && !isProcessingBulkAdmFile(file));
  const statusTone = failedFiles.length > 0 || result.errors.length ? "orange" : processingFiles.length > 0 || result.mode === "preview" ? "cyan" : "emerald";
  const statusMessage = result.mode === "preview"
    ? `Previewed ${result.files_uploaded} ADM file${result.files_uploaded === 1 ? "" : "s"}.`
    : processingFiles.length > 0
      ? `Processing ${processingFiles.length} ADM file${processingFiles.length === 1 ? "" : "s"}.`
      : failedFiles.length > 0
      ? `Imported ${completedFiles.length} of ${result.files_uploaded} ADM file${result.files_uploaded === 1 ? "" : "s"}.`
      : "ADM import completed. Stats and feeds updated.";
  return (
    <div className={`mt-4 rounded-lg border p-3 ${statusTone === "emerald" ? "border-emerald-300/18 bg-emerald-400/8" : statusTone === "cyan" ? "border-cyan-300/18 bg-cyan-400/8" : "border-amber-300/20 bg-amber-400/10"}`}>
      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
        <div>
          <p className={`text-xs font-black uppercase ${statusTone === "emerald" ? "text-emerald-100" : statusTone === "cyan" ? "text-cyan-100" : "text-amber-100"}`}>Bulk ADM Import Summary</p>
          <p className={`mt-1 text-sm font-bold ${statusTone === "emerald" ? "text-emerald-50" : statusTone === "cyan" ? "text-cyan-50" : "text-amber-50"}`}>
            {statusMessage}
          </p>
        </div>
        <SmallBadge tone={statusTone}>{failedFiles.length > 0 ? `${failedFiles.length} Need Retry` : processingFiles.length > 0 ? "Processing" : result.mode === "preview" ? "Preview Ready" : "Succeeded"}</SmallBadge>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <MiniInfo label="Files Selected" value={String(result.files_uploaded)} />
        <MiniInfo label="Files Completed" value={String(completedFiles.length)} />
        <MiniInfo label="Files Processing" value={String(processingFiles.length)} />
        <MiniInfo label="Files Failed" value={String(failedFiles.length)} />
        <MiniInfo label="Parsed PvP Kills" value={String(result.parsed_kills)} />
        <MiniInfo label="Written PvP Kills" value={String(result.written_kills)} />
        <MiniInfo label="Duplicate Skips" value={String(result.duplicate_kills_skipped)} />
        <MiniInfo label="Deaths" value={String(result.deaths)} />
        <MiniInfo label="Joins" value={String(result.joins)} />
        <MiniInfo label="Disconnects" value={String(result.disconnects)} />
        <MiniInfo label="PlayerList Snapshots" value={String(result.playerlist_snapshots)} />
        <MiniInfo label="Public Cache" value={result.public_cache_updated ? "Updated" : result.mode === "preview" ? "Preview only" : "Not updated"} />
        <MiniInfo label="Discord Jobs Queued" value={String(result.discord_jobs_queued)} />
      </div>
      {totalsDelta?.changed ? <DashboardTotalsDeltaPanel delta={totalsDelta} /> : null}
      {processingFiles.length ? (
        <div className="mt-4 grid gap-2">
          {processingFiles.map((file) => (
            <div key={`${file.filename}-${file.job_id ?? file.status}-processing`} className="rounded-lg border border-cyan-300/18 bg-cyan-400/8 px-3 py-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="break-all text-sm font-black text-cyan-50">{file.filename}</p>
                  <p className="mt-1 text-xs font-bold text-cyan-100">
                    Import in progress{file.chunks_processed !== undefined && file.total_chunks ? ` - chunk ${file.chunks_processed}/${file.total_chunks}` : ""}
                  </p>
                </div>
                {result.mode === "import" ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {importing && activeRunnerJob?.jobId === file.job_id ? (
                      <button
                        type="button"
                        onClick={onPauseImport}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50 transition hover:border-cyan-300/45"
                      >
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Pause Import
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={importing}
                        onClick={() => onContinueFile(file.filename, file.job_id)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${importing ? "animate-spin" : ""}`} />
                        {runnerPaused && activeRunnerJob?.jobId === file.job_id ? "Resume Import" : "Continue Import"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onCancelImport(file.filename, file.job_id)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-[10px] font-black uppercase text-rose-50 transition hover:border-rose-300/45"
                    >
                      Cancel Import
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                <MiniInfo label="Parsed Kills So Far" value={String(file.parsed_kills)} />
                <MiniInfo label="Written Kills So Far" value={String(file.written_kills)} />
                <MiniInfo label="Duplicates" value={String(file.duplicate_skips)} />
                <MiniInfo label="Joins" value={String(file.joins)} />
                <MiniInfo label="Disconnects" value={String(file.disconnects)} />
                <MiniInfo label="PlayerList" value={String(file.playerlist_snapshots)} />
                <MiniInfo label="Job Status" value={formatStatusLabel(file.job_status ?? file.status)} />
                <MiniInfo label="Last Error" value={String(file.message ?? "None")} />
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/40">
                <div className="h-full rounded-full bg-cyan-300" style={{ width: `${getSafeAdmChunkProgressPercent(file)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {completedFiles.length ? (
        <div className="mt-4 grid gap-2">
          {completedFiles.map((file) => (
            <div key={`${file.filename}-${file.status}-complete`} className="rounded-lg border border-white/10 bg-black/24 px-3 py-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="break-all text-sm font-black text-white">{file.filename}</p>
                  <p className="mt-1 text-xs font-bold text-zinc-400">{getBulkAdmFileOutcomeLabel(file, result.mode)}</p>
                </div>
                <SmallBadge tone={getBulkAdmFileOutcomeTone(file, result.mode)}>{getBulkAdmFileOutcomeLabel(file, result.mode)}</SmallBadge>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                <MiniInfo label="Parsed Kills" value={String(file.parsed_kills)} />
                <MiniInfo label="Written Kills" value={String(file.written_kills)} />
                <MiniInfo label="Duplicates" value={String(file.duplicate_skips)} />
                <MiniInfo label="Joins" value={String(file.joins)} />
                <MiniInfo label="Disconnects" value={String(file.disconnects)} />
                <MiniInfo label="PlayerList" value={String(file.playerlist_snapshots)} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {failedFiles.length || result.errors.length || result.warnings.length ? (
        <details className="mt-4 rounded-lg border border-amber-300/20 bg-black/24 p-3">
          <summary className="cursor-pointer text-xs font-black uppercase text-amber-100">Previous Import Attempts</summary>
          <div className="mt-3 grid gap-2">
            {[...result.errors, ...result.warnings].map((message) => (
              <p key={message} className="rounded-md border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100">{message}</p>
            ))}
            {failedFiles.map((file) => (
              <div key={`${file.filename}-${file.status}-failed`} className="rounded-lg border border-rose-300/20 bg-rose-400/10 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="break-all text-sm font-black text-rose-50">{file.filename}</p>
                    <p className="mt-1 text-xs font-bold text-rose-100">{file.message ?? file.error_code ?? "Import failed."}</p>
                  </div>
                  {result.mode === "import" ? (
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => onRetryFile(file.filename)}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-[10px] font-black uppercase text-amber-50 transition hover:border-amber-300/45 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${importing ? "animate-spin" : ""}`} />
                      Retry this file
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <MiniInfo label="Failed Endpoint" value={file.failed_endpoint ?? "Not recorded"} />
                  <MiniInfo label="Failed Chunk" value={file.failed_chunk_index !== null && file.failed_chunk_index !== undefined ? String(file.failed_chunk_index) : "Not recorded"} />
                  <MiniInfo label="HTTP Status" value={file.http_status !== undefined ? String(file.http_status) : "Not recorded"} />
                  <MiniInfo label="Error Code" value={file.error_code ?? "Not recorded"} />
                  <MiniInfo label="Client File Read" value={file.client_file_read_ok === false ? "Failed" : "OK"} />
                  <MiniInfo label="Client Lines" value={file.client_total_lines !== undefined ? String(file.client_total_lines) : "Not recorded"} />
                  <MiniInfo label="Client Chunks" value={file.client_total_chunks !== undefined ? String(file.client_total_chunks) : "Not recorded"} />
                  <MiniInfo label="Job ID" value={file.job_id ? file.job_id.slice(0, 8) : "Not recorded"} />
                  <MiniInfo label="Job Status" value={file.job_status ?? "Not recorded"} />
                  <MiniInfo label="First Failed Line" value={file.first_failed_line_number !== null && file.first_failed_line_number !== undefined ? String(file.first_failed_line_number) : "Not recorded"} />
                </div>
                {file.first_failed_line_preview ? (
                  <p className="mt-3 break-words rounded-md border border-rose-300/20 bg-black/24 px-3 py-2 font-mono text-xs text-rose-50">
                    {file.first_failed_line_preview}
                  </p>
                ) : null}
                {file.response_body ? (
                  <details className="mt-3 rounded-md border border-white/10 bg-black/24 p-3">
                    <summary className="cursor-pointer text-xs font-black uppercase text-rose-100">Response Body</summary>
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-rose-50">{file.response_body}</pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <details className="mt-4 rounded-lg border border-white/10 bg-black/24 p-3">
        <summary className="cursor-pointer text-xs font-black uppercase text-zinc-200">Import Diagnostics</summary>
        <div className="mt-3 grid gap-3">
          {result.files.map((file) => (
            <div key={`${file.filename}-${file.status}-diagnostics`} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="break-all text-xs font-black uppercase text-zinc-200">{file.filename}</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                <MiniInfo label="HTTP Status" value={result.http_status ? String(result.http_status) : "Not recorded"} />
                <MiniInfo label="Job ID" value={file.job_id ? file.job_id.slice(0, 8) : "None"} />
                <MiniInfo label="Job Status" value={file.job_status ?? file.status ?? "Not recorded"} />
                <MiniInfo label="Finish Status" value={file.status ?? "Not recorded"} />
                <MiniInfo label="Raw Lines" value={String(file.raw_lines)} />
                <MiniInfo label="Raw Kill Lines" value={String(file.raw_kill_lines_found)} />
                <MiniInfo label="Failed Writes" value={String(file.failed_writes)} />
                <MiniInfo label="Hit Lines" value={String(file.hit_lines)} />
                <MiniInfo label="Raw Events" value={String(file.raw_events_stored)} />
                <MiniInfo label="Player Events" value={String(file.player_events_stored)} />
                <MiniInfo label="Chunks" value={file.total_chunks ? `${file.chunks_processed ?? 0}/${file.total_chunks}` : "Chunked"} />
                <MiniInfo label="Discord Jobs" value={String(file.discord_jobs_queued)} />
                <MiniInfo label="Import Report" value={file.import_report_id ? file.import_report_id.slice(0, 8) : "None"} />
                <MiniInfo label="Last Error" value={file.message ?? file.error_code ?? "None"} />
              </div>
              {file.parser_warnings.length ? (
                <div className="mt-3 grid gap-2">
                  {file.parser_warnings.map((warning) => (
                    <p key={`${file.filename}-${warning}`} className="rounded-md border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100">{warning}</p>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 grid gap-2">
                {file.kill_previews.length ? file.kill_previews.slice(0, 5).map((kill) => (
                  <p key={`${file.filename}-${kill.line_number}-${kill.killer_name}-${kill.victim_name}`} className="rounded-md border border-cyan-300/15 bg-black/20 px-3 py-2 text-xs font-bold text-cyan-50">
                    Line {kill.line_number}: {kill.victim_name ?? "Unknown victim"} -&gt; {kill.killer_name ?? "Unknown killer"}{kill.weapon ? ` / ${kill.weapon}` : ""}{kill.distance !== null ? ` / ${kill.distance}m` : ""}
                  </p>
                )) : (
                  <p className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-zinc-400">No PvP kill previews for this file.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function DashboardTotalsDeltaPanel({ delta }: { delta: DashboardTotalsDelta }) {
  return (
    <div className="mt-4 rounded-lg border border-emerald-300/18 bg-emerald-400/8 p-3">
      <p className="text-xs font-black uppercase text-emerald-100">Dashboard totals updated</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
        <MiniInfo label="Kills" value={`${delta.before.kills} -> ${delta.after.kills}`} />
        <MiniInfo label="Deaths" value={`${delta.before.deaths} -> ${delta.after.deaths}`} />
        <MiniInfo label="Joins" value={`${delta.before.joins} -> ${delta.after.joins}`} />
        <MiniInfo label="Disconnects" value={`${delta.before.disconnects} -> ${delta.after.disconnects}`} />
        <MiniInfo label="Unique Players" value={`${delta.before.uniquePlayers} -> ${delta.after.uniquePlayers}`} />
        <MiniInfo label="Server Score" value={`${delta.before.serverScore} -> ${delta.after.serverScore}`} />
      </div>
    </div>
  );
}

function ManualAdmFailurePanel({ failure, title }: { failure: ManualAdmImportErrorResult; title: string }) {
  return (
    <div className="mt-4 rounded-lg border border-rose-300/20 bg-rose-400/10 p-3">
      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-black uppercase text-rose-100">{title}</p>
          <p className="mt-1 text-sm font-bold text-rose-50">{failure.message}</p>
        </div>
        <SmallBadge tone="orange">{failure.error_code}</SmallBadge>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <MiniInfo label="HTTP Status" value={failure.http_status !== undefined ? String(failure.http_status) : "Not recorded"} />
        <MiniInfo label="Error Code" value={failure.error_code} />
        <MiniInfo label="Message" value={failure.message} />
        <MiniInfo label="Details" value={formatDebugValue(failure.details)} />
      </div>
      {failure.response_body ? (
        <details className="mt-3 rounded-md border border-white/10 bg-black/24 p-3">
          <summary className="cursor-pointer text-xs font-black uppercase text-rose-100">Response Body</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-rose-50">{failure.response_body}</pre>
        </details>
      ) : null}
    </div>
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

function discordChannelCacheKey(serverId: string) {
  return `dzn_discord_channel_cache_${serverId}`;
}

function loadDiscordChannelCache(serverId: string): DiscordChannelCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(discordChannelCacheKey(serverId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiscordChannelCache;
    if (parsed?.server_id !== serverId || !Array.isArray(parsed.channels)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDiscordChannelCache(serverId: string, cache: DiscordChannelCache) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(discordChannelCacheKey(serverId), JSON.stringify(cache));
  } catch {
    // Local storage can be unavailable in hardened/private browser contexts.
  }
}

function buildDiscordChannelCache(serverId: string, response: DiscordChannelsResponse): DiscordChannelCache {
  return {
    server_id: serverId,
    channels: response.channels,
    last_channel_fetch_success_at: response.fetched_at,
    last_channel_count: response.channels.length,
    last_postable_channel_count: response.channels.filter((channel) => channel.can_post).length,
    last_bot_connected_state: response.bot_connected ?? null,
    guild_name: response.guild_name ?? null,
  };
}

function buildChannelFetchFailure(response: DiscordChannelsResponse): DiscordChannelFetchFailure {
  return {
    error_code: response.error_code ?? response.errorCode ?? "channel_fetch_unavailable",
    message: friendlyChannelFetchWarning(response, false),
    status: response.status ?? null,
    retryable: Boolean(response.retryable),
    attempted_at: response.fetched_at || new Date().toISOString(),
  };
}

function friendlyChannelFetchWarning(response: DiscordChannelsResponse, hasSavedSetups: boolean) {
  const code = response.error_code ?? response.errorCode;
  const base = response.retryable || code === "channel_fetch_unavailable" || response.status === 503
    ? "Channel refresh temporarily failed. Existing saved auto-post setups are still active."
    : response.message ?? response.warning ?? "DZN could not load Discord channel diagnostics for this server.";
  return hasSavedSetups && !base.includes("Saved auto-post setups continue")
    ? `${base} Saved auto-post setups continue running even if channel refresh temporarily fails.`
    : base;
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

function dispatchStatusClass(status: string | null | undefined) {
  if (status === "edited" || status === "sent" || status === "success") return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  if (status?.startsWith("skipped")) return "border-amber-300/30 bg-amber-400/10 text-amber-100";
  if (status === "failed" || status === "no_message_id") return "border-red-300/30 bg-red-400/10 text-red-100";
  return "border-zinc-300/20 bg-zinc-400/10 text-zinc-200";
}

function resolveDispatchChannelLabel(
  channelId: string | null,
  setups: PostingChannelSetup[],
  channelById: Map<string, DiscordPostingChannel>,
) {
  if (!channelId) return "No channel";
  const setup = setups.find((item) => item.channel_id === channelId);
  if (setup) return resolveSetupChannelLabel(setup, channelById);
  const channel = channelById.get(channelId);
  if (channel) return formatChannelLabel(channel);
  return `Unknown channel (${channelId})`;
}

function shortHash(value: string | null | undefined) {
  return value ? `${value.slice(0, 10)}...` : "none";
}

function formatLatestDispatchAt(setup: PostingChannelSetup) {
  const latest = getLatestPostTypeValue(setup, "last_dispatch_attempt_at") ?? getLatestPostTypeValue(setup, "last_edited_at");
  return latest ? formatDashboardDate(latest) : "none";
}

function formatLatestDispatchStatus(setup: PostingChannelSetup) {
  return getLatestPostTypeValue(setup, "last_dispatch_status") ?? "none";
}

function formatLatestDispatchError(setup: PostingChannelSetup) {
  return getLatestPostTypeValue(setup, "last_dispatch_error") ?? "none";
}

function getLatestPostTypeValue(
  setup: PostingChannelSetup,
  key: "last_dispatch_attempt_at" | "last_edited_at" | "last_dispatch_status" | "last_dispatch_error",
) {
  const values = setup.post_types
    .map((postType) => postType[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!values.length) return null;
  if (key === "last_dispatch_status" || key === "last_dispatch_error") return values[0];
  return values.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? values[0];
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

function formatCronRunSummary(run: AutomationCronRunSummary | null | undefined) {
  if (!run) return "No check-in";
  const createdAt = run.created_at;
  const status = run.status ?? "unknown";
  const age = typeof run.age_minutes === "number" ? `${run.age_minutes}m ago` : createdAt ? formatDashboardDate(createdAt) : "unknown";
  const failed = typeof run.failed_count === "number" && run.failed_count > 0 ? `, ${run.failed_count} failed` : "";
  return `${formatStatusLabel(status)} (${age}${failed})`;
}

function getAutomationHealthSummary(health: AutomationHealth) {
  if (health.cron_health?.message) {
    return {
      message: health.cron_health.message,
      className: health.cron_health.status === "healthy"
        ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-50"
        : health.cron_health.status === "cron_secret_mismatch" || health.cron_health.status === "no_recent_automation"
          ? "border-orange-300/20 bg-orange-400/10 text-orange-50"
          : "border-amber-300/20 bg-amber-400/10 text-amber-50",
    };
  }
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
          {syncStatus?.last_adm_import_report ? (
            <div className="rounded-lg border border-cyan-300/15 bg-cyan-400/8 p-3">
              <p className="text-[10px] font-black uppercase text-cyan-100">Last ADM Import Report</p>
              <p className="mt-1 text-xs text-cyan-100/75">
                {getAdmCursorValidationMessage(syncStatus.last_adm_import_report.cursorValidationStatus)}
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <MiniInfo label="Source" value={syncStatus.last_adm_import_report.importSource ? formatSyncTrigger(syncStatus.last_adm_import_report.importSource) : "Unknown"} />
                <MiniInfo label="Imported At" value={syncStatus.last_adm_import_report.importedAt ? formatDashboardDate(syncStatus.last_adm_import_report.importedAt) : "Unknown"} />
                <MiniInfo label="Import Report ID" value={syncStatus.last_adm_import_report.importReportId ? syncStatus.last_adm_import_report.importReportId.slice(0, 8) : "None"} />
                <MiniInfo label="ADM Filename" value={syncStatus.last_adm_import_report.admFileName ?? "Unknown"} />
                <MiniInfo label="Parsed Kills" value={String(syncStatus.last_adm_import_report.parsedPvpKills)} />
                <MiniInfo label="Written Kills" value={String(syncStatus.last_adm_import_report.writtenKills)} />
                <MiniInfo label="Parsed Joins" value={String(syncStatus.last_adm_import_report.parsedJoins ?? 0)} />
                <MiniInfo label="Parsed Disconnects" value={String(syncStatus.last_adm_import_report.parsedDisconnects ?? 0)} />
                <MiniInfo label="PlayerList Snapshots" value={String(syncStatus.last_adm_import_report.parsedPlayerlistSnapshots ?? 0)} />
                <MiniInfo label="Duplicate Skips" value={String(syncStatus.last_adm_import_report.duplicateSkips)} />
                <MiniInfo label="Failed Writes" value={String(syncStatus.last_adm_import_report.failedWrites)} />
                <MiniInfo label="Cursor Advanced" value={syncStatus.last_adm_import_report.cursorAdvanced ? "Yes" : "No"} />
                <MiniInfo label="Cursor Before / After" value={`${syncStatus.last_adm_import_report.cursorBefore} -> ${syncStatus.last_adm_import_report.cursorAfter}`} />
                <MiniInfo label="Cursor Validation" value={formatStatusLabel(syncStatus.last_adm_import_report.cursorValidationStatus)} />
                <MiniInfo label="Cursor Hash Matched" value={syncStatus.last_adm_import_report.cursorHashMatched === null ? "Not checked" : syncStatus.last_adm_import_report.cursorHashMatched ? "Yes" : "No"} />
                <MiniInfo label="Cursor Line Checked" value={syncStatus.last_adm_import_report.cursorLineChecked === null ? "Not checked" : String(syncStatus.last_adm_import_report.cursorLineChecked)} />
                <MiniInfo label="Recovery Strategy" value={syncStatus.last_adm_import_report.cursorRecoveryStrategy ? formatStatusLabel(syncStatus.last_adm_import_report.cursorRecoveryStrategy) : "None"} />
                <MiniInfo label="Public Cache Updated" value={syncStatus.last_adm_import_report.publicCacheUpdated ? "Yes" : syncStatus.last_adm_import_report.cacheRefreshStatus} />
                <MiniInfo label="Discord Queues Created" value={String(syncStatus.last_adm_import_report.discordQueuesCreated)} />
                <MiniInfo label="Previous Line Hash" value={syncStatus.last_adm_import_report.previousLineHash ? `${syncStatus.last_adm_import_report.previousLineHash.slice(0, 12)}...` : "None"} />
                <MiniInfo label="Current Line Hash" value={syncStatus.last_adm_import_report.currentLineHash ? `${syncStatus.last_adm_import_report.currentLineHash.slice(0, 12)}...` : "None"} />
              </div>
              {syncStatus.last_adm_import_report.cursorValidationError ? (
                <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                  {syncStatus.last_adm_import_report.cursorValidationError}
                </p>
              ) : null}
              {syncStatus.last_adm_import_report.parserWarnings?.length ? (
                <div className="mt-3 grid gap-2">
                  {syncStatus.last_adm_import_report.parserWarnings.map((warning) => (
                    <p key={warning} className="rounded-md border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{warning}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AdmFileDiscoveryDebugPanel({
  debug,
  open,
  onToggle,
}: {
  debug: AdmFileDiscoveryDebug;
  open: boolean;
  onToggle: () => void;
}) {
  const topCandidates = debug.adm_candidates.slice(0, 12);
  return (
    <div className="mt-4 rounded-lg border border-purple-300/15 bg-purple-400/8">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-xs font-black uppercase text-zinc-200"
      >
        <span>ADM File Discovery Diagnostics</span>
        <span className={debug.problem_flags.length ? "text-amber-200" : "text-emerald-200"}>
          {debug.problem_flags.length ? "Warnings" : "Checked"}
        </span>
      </button>
      {open ? (
        <div className="border-t border-white/10 p-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <MiniInfo label="Nitrado Service ID" value={debug.service_id} />
            <MiniInfo label="Nitrado Username" value={debug.username ?? "Not found"} />
            <MiniInfo label="Raw log_files Count" value={String(debug.log_files_raw_count)} />
            <MiniInfo label="game_specific ADM Candidates" value={String(debug.game_specific_adm_count)} />
            <MiniInfo label="File Browser ADM Candidates" value={String(debug.file_browser_adm_count ?? debug.listed_adm_count)} />
            <MiniInfo label="Merged ADM Candidates" value={String(debug.merged_adm_count ?? debug.total_adm_candidates)} />
            <MiniInfo label="Readable Candidates" value={String(debug.readable_adm_count ?? debug.adm_candidates.filter((candidate) => candidate.sample_read_success).length)} />
            <MiniInfo label="Unreadable Candidates" value={String(debug.unreadable_adm_count ?? debug.adm_candidates.filter((candidate) => candidate.sample_read_attempted && !candidate.sample_read_success).length)} />
            <MiniInfo label="Newest Selected" value={debug.selected_newest_available?.name ?? "None"} />
            <MiniInfo label="Expected By Filename" value={debug.newest_by_filename?.name ?? "None"} />
            <MiniInfo label="Newest Readable" value={debug.selected_newest_readable?.name ?? "None"} />
            <MiniInfo label="Known 2026-05-20 File" value={debug.known_latest_file_present === null ? "Not checked" : debug.known_latest_file_present ? "Present" : "Missing"} />
            <MiniInfo label="Saved Newest Available" value={debug.current_saved_state?.newest_available_adm_filename ?? "None"} />
            <MiniInfo label="Saved Newest Readable" value={debug.current_saved_state?.newest_readable_adm_filename ?? "None"} />
            <MiniInfo label="Last Discovery Check" value={debug.current_saved_state?.last_adm_discovery_check_at ? formatDashboardDate(debug.current_saved_state.last_adm_discovery_check_at) : "Not checked"} />
          </div>
          {debug.problem_flags.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {debug.problem_flags.map((flag) => <SmallBadge key={flag} tone="orange">{formatStatusLabel(flag)}</SmallBadge>)}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-emerald-300/15 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100">
              DZN selected the newest ADM candidate it could see from Nitrado.
            </p>
          )}
          <div className="mt-3 rounded-lg border border-white/10 bg-black/24 p-3">
            <p className="text-[10px] font-black uppercase text-zinc-400">Directories searched</p>
            <p className="mt-1 break-words text-xs font-bold leading-5 text-zinc-300">{debug.base_paths_used.join(", ") || "None"}</p>
          </div>
          <div className="mt-3 max-h-[440px] overflow-auto rounded-lg border border-white/10">
            {topCandidates.length ? topCandidates.map((candidate) => (
              <div key={`${candidate.path}-${candidate.name}`} className="border-b border-white/10 bg-black/20 px-3 py-3 text-xs last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-all font-black text-white">{candidate.name}</p>
                    <p className="mt-1 break-all text-[11px] font-bold text-zinc-500">{candidate.path}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {candidate.selected_as_newest_available ? <SmallBadge tone="cyan">Newest</SmallBadge> : null}
                    {candidate.sample_read_success ? <SmallBadge tone="emerald">Readable</SmallBadge> : candidate.sample_read_attempted ? <SmallBadge tone="orange">Unreadable</SmallBadge> : <SmallBadge tone="zinc">Not sampled</SmallBadge>}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-4">
                  <MiniInfo label="Parsed Timestamp" value={candidate.parsed_timestamp ? formatDashboardDate(candidate.parsed_timestamp) : "Not parsed"} />
                  <MiniInfo label="Modified" value={candidate.modified_at ? String(candidate.modified_at) : "Not provided"} />
                  <MiniInfo label="Sort Score" value={candidate.sort_key === null ? "None" : String(candidate.sort_key)} />
                  <MiniInfo label="Sources" value={candidate.sources.join(", ") || "Unknown"} />
                  <MiniInfo label="Seek Sample" value={candidate.seek_sample_attempted ? candidate.seek_sample_status : "Not attempted"} />
                  <MiniInfo label="Download Fallback" value={candidate.download_fallback_attempted ? candidate.download_fallback_status : "Not attempted"} />
                  <MiniInfo label="Read Method" value={candidate.selected_read_method === "download_fallback" ? "Download fallback" : candidate.selected_read_method === "seek" ? "Seek" : "None"} />
                  <MiniInfo label="Selected Path" value={candidate.selected_successful_path ?? "None"} />
                </div>
                {candidate.seek_sample_error ? (
                  <p className="mt-2 rounded-md border border-amber-300/20 bg-amber-400/10 px-2 py-2 font-bold text-amber-100">
                    Seek sample error: {candidate.seek_sample_error}
                  </p>
                ) : null}
                {candidate.download_fallback_attempted ? (
                  candidate.download_fallback_error ? (
                    <p className="mt-2 rounded-md border border-amber-300/20 bg-amber-400/10 px-2 py-2 font-bold text-amber-100">
                      Download fallback error: {candidate.download_fallback_error}
                    </p>
                  ) : candidate.sample_read_success ? (
                    <p className="mt-2 rounded-md border border-emerald-300/20 bg-emerald-400/10 px-2 py-2 font-bold text-emerald-100">
                      Nitrado seek failed or was unavailable; download fallback succeeded.
                    </p>
                  ) : (
                    <p className="mt-2 rounded-md border border-amber-300/20 bg-amber-400/10 px-2 py-2 font-bold text-amber-100">
                      Download fallback returned data, but DZN did not find ADM log markers in the sample.
                    </p>
                  )
                ) : null}
                {candidate.sample_read_error ? (
                  <p className="mt-2 rounded-md border border-amber-300/20 bg-amber-400/10 px-2 py-2 font-bold text-amber-100">
                    Sample error: {candidate.sample_read_error}
                  </p>
                ) : null}
                {candidate.attempted_paths?.length ? (
                  <details className="mt-2 rounded-md border border-white/10 bg-black/25 px-2 py-2">
                    <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">
                      Download path attempts
                    </summary>
                    <div className="mt-2 space-y-1">
                      {candidate.attempted_paths.map((attempt) => (
                        <p key={attempt.path} className="break-all text-[11px] font-bold text-zinc-400">
                          {attempt.fileFetchOk ? "OK" : "FAIL"} · token {attempt.tokenRequestOk ? "ok" : "failed"} · {attempt.path}{attempt.error ? ` · ${attempt.error}` : ""}
                        </p>
                      ))}
                    </div>
                  </details>
                ) : null}
                {candidate.first_lines_preview.length ? (
                  <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/35 px-2 py-2 text-[11px] leading-5 text-zinc-300">
                    {candidate.first_lines_preview.join("\n")}
                  </pre>
                ) : null}
              </div>
            )) : (
              <div className="px-3 py-3 text-sm font-bold text-zinc-400">No ADM candidates were returned by Nitrado.</div>
            )}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <MiniInfo label="List Attempts" value={String(debug.list_attempts.length)} />
            <MiniInfo label="Service Details Status" value={debug.service_details_status} />
          </div>
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

function formatNullableDashboardNumber(value: number | null) {
  return value === null ? "Loading" : value.toLocaleString();
}

function loadDashboardHealthCache(serverId: string): DashboardHealthResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`dzn:lastGoodDashboard:${serverId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardHealthResult;
    return parsed?.ok && parsed.server_id === serverId ? { ...parsed, stale: true, source: "local_fallback" } : null;
  } catch {
    return null;
  }
}

function saveDashboardHealthCache(serverId: string, value: DashboardHealthResult) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`dzn:lastGoodDashboard:${serverId}`, JSON.stringify(value));
    window.localStorage.setItem(`dzn:lastGoodSyncHealth:${serverId}`, JSON.stringify({
      generated_at: value.generated_at,
      sync: value.sync,
      stats: value.stats,
      latest_events: value.latest_events,
    }));
  } catch {
    // Storage can be blocked in hardened browser contexts.
  }
}

function dashboardHealthJobToAdmJob(job: DashboardHealthResult["sync"]["active_job"]): AdmImportJobProgressResult | null {
  if (!job) return null;
  const totalChunks = Math.max(1, job.total_chunks);
  const chunksProcessed = Math.max(0, Math.min(totalChunks, job.chunks_processed));
  return {
    ok: true,
    job_id: job.job_id ?? job.id,
    filename: job.filename,
    source: job.source,
    status: job.status as AdmImportJobProgressResult["status"],
    total_lines: job.total_lines,
    current_line: job.current_line,
    chunk_size: Math.max(1, Math.ceil(Math.max(1, job.total_lines) / totalChunks)),
    total_chunks: totalChunks,
    chunks_processed: chunksProcessed,
    display_current_chunk: Math.max(1, Math.min(totalChunks, chunksProcessed + 1)),
    progress: Math.max(0, Math.min(100, Math.round((chunksProcessed / totalChunks) * 100))),
    parsed_kills: job.parsed_kills,
    written_kills: job.written_kills,
    duplicate_skips: job.duplicate_skips,
    joins: job.joins,
    disconnects: job.disconnects,
    playerlist_snapshots: job.playerlist_snapshots,
    hit_lines: 0,
    raw_events_stored: 0,
    player_events_stored: 0,
    public_cache_updated: false,
    discord_jobs_queued: 0,
    warnings: [],
    file_result: null,
    error_message: job.error_message,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
  };
}

function formatDebugValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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

function getNitradoLogSettingsSourceLabel(settings: NitradoLogSettingsConfirmation | null) {
  if (!settings?.nitrado_log_settings_verification_source) return "";
  if (settings.nitrado_log_settings_verification_source === "nitrado_api") return "Verified by DZN";
  if (settings.nitrado_log_settings_verification_source === "manual") return "Manually confirmed";
  if (settings.nitrado_log_settings_verification_source === "manual_required") return "Manual required";
  return settings.nitrado_log_settings_verification_source;
}

function getNitradoVerificationStatus(
  settings: NitradoLogSettingsConfirmation | null,
  check: NitradoLogSettingsCheckResponse | null,
) {
  if (check?.verificationStatus) return check.verificationStatus;
  if (!settings?.nitrado_log_settings_verification_source) return "not_checked";
  if (settings.nitrado_log_settings_verification_source === "nitrado_api") {
    return settings.nitrado_reduce_log_output_confirmed && settings.nitrado_log_playerlist_confirmed && settings.nitrado_admin_log_enabled !== false && settings.nitrado_server_log_enabled !== false
      ? "verified"
      : "verified_wrong";
  }
  if (settings.nitrado_log_settings_verification_source === "manual") {
    return settings.nitrado_reduce_log_output_confirmed && settings.nitrado_log_playerlist_confirmed ? "manual_confirmed" : "manual_required";
  }
  if (settings.nitrado_log_settings_verification_source === "manual_required") return "manual_required";
  return "not_checked";
}

function getNitradoLogSettingsSourceDisplay(
  settings: NitradoLogSettingsConfirmation | null,
  check: NitradoLogSettingsCheckResponse | null,
  verificationStatus: string,
) {
  if (verificationStatus === "not_checked") return "Not checked";
  if (verificationStatus === "verified" || verificationStatus === "verified_wrong") return "Verified by DZN";
  if (verificationStatus === "manual_confirmed") return "Manually confirmed";
  if (verificationStatus === "manual_required") return "Manual required";
  return getNitradoLogSettingsSourceLabel(settings) || check?.source || "Not checked";
}

function getNitradoSettingDisplay(
  key: "admin_log_enabled" | "server_log_enabled" | "reduce_log_output_disabled" | "log_playerlist_enabled",
  value: boolean | null,
  verificationStatus: string,
  expectedLabel: string,
  manuallyConfirmed: boolean,
): { label: string; tone: "good" | "warn" | "bad" | "muted" } {
  const isRequiredManualSetting = key === "reduce_log_output_disabled" || key === "log_playerlist_enabled";
  if (verificationStatus === "not_checked") return { label: "Not checked yet", tone: "muted" };
  if (verificationStatus === "manual_confirmed" && isRequiredManualSetting && manuallyConfirmed) {
    return { label: "Manually confirmed", tone: "good" };
  }
  if (verificationStatus === "manual_required") {
    if (isRequiredManualSetting) {
      return manuallyConfirmed
        ? { label: "Manually confirmed", tone: "good" }
        : { label: "Manual confirmation required", tone: "warn" };
    }
    return { label: "Manual check recommended", tone: "warn" };
  }
  if (verificationStatus === "manual_confirmed") return { label: "Manual check recommended", tone: "warn" };
  if (value === true) return { label: expectedLabel, tone: "good" };
  if (value === false) return { label: "Needs Change", tone: "bad" };
  if (isRequiredManualSetting) return { label: "Manual confirmation required", tone: "warn" };
  return { label: "Manual check recommended", tone: "warn" };
}

function formatNullableBoolean(value: boolean | null) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "unknown";
}

function isNitradoLogSettingsComplete(settings: NitradoLogSettingsConfirmation | null) {
  if (!settings?.nitrado_reduce_log_output_confirmed || !settings.nitrado_log_playerlist_confirmed) return false;
  if (settings.nitrado_log_settings_verification_source === "nitrado_api") {
    return settings.nitrado_admin_log_enabled !== false && settings.nitrado_server_log_enabled !== false;
  }
  return true;
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
  if (["processing_in_chunks", "adm_import_job_queued"].includes(result.status)) {
    return result.message || "Processing ADM in chunks. Continue Import can accelerate it now; cron remains the backup.";
  }
  if (result.status === "no_new_lines") {
    return "Latest ADM checked just now. No new ADM lines since last sync.";
  }
  if (result.status === "no_supported_events") {
    return "Latest ADM checked just now. No supported ADM events found.";
  }
  if (["adm_not_generated_yet", "no_adm_file", "waiting_after_restart"].includes(result.status)) {
    return "Server restart detected. Waiting for Nitrado to publish the next ADM log.";
  }
  if (["adm_file_unreadable", "latest_adm_unreadable"].includes(result.status)) {
    return "Latest ADM file found but not readable yet. DZN will retry on the next scheduled check.";
  }
  if (result.status === "delayed_after_restart") {
    return "Nitrado has not published a readable ADM log yet. This can take 5-45 minutes after restart.";
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

function makeClientAdmFailure(error: unknown, errorCode: string, fallbackMessage: string): ManualAdmImportErrorResult {
  return {
    ok: false,
    error_code: errorCode,
    message: error instanceof Error ? error.message : fallbackMessage,
    details: error instanceof Error ? error.stack ?? error.message : String(error),
  };
}

function makeFailedBulkAdmFileResult(
  file: { filename: string; admText: string },
  failure: ManualAdmImportErrorResult,
  source: string,
): BulkAdmFileResult {
  const detailRecord = failure.details && typeof failure.details === "object" ? failure.details as Record<string, unknown> : {};
  const rawLines = file.admText.split(/\r?\n/).filter((line) => line.trim()).length;
  const totalChunks = Math.ceil(rawLines / ADM_IMPORT_UPLOAD_CHUNK_SIZE);
  return {
    ok: false,
    filename: file.filename,
    source,
    status: "failed",
    failed_endpoint: stringFromUnknown(detailRecord.endpoint ?? detailRecord.failed_endpoint),
    failed_chunk_index: numberFromUnknown(detailRecord.chunk_index ?? detailRecord.failed_chunk_index),
    first_failed_line_number: numberFromUnknown(detailRecord.first_failed_line_number ?? detailRecord.start_line),
    first_failed_line_preview: stringFromUnknown(detailRecord.first_failed_line_preview),
    client_file_read_ok: Boolean(detailRecord.client_file_read_ok ?? file.admText.length > 0),
    client_total_lines: numberFromUnknown(detailRecord.client_total_lines) ?? rawLines,
    client_total_chunks: numberFromUnknown(detailRecord.client_total_chunks) ?? totalChunks,
    job_status: stringFromUnknown(detailRecord.job_status),
    job_id: stringFromUnknown(detailRecord.job_id),
    raw_lines: rawLines,
    raw_kill_lines_found: 0,
    parsed_kills: 0,
    written_kills: 0,
    deaths: 0,
    joins: 0,
    disconnects: 0,
    playerlist_snapshots: 0,
    suicides: 0,
    uncredited_deaths: 0,
    hit_lines: 0,
    raw_events_stored: 0,
    player_events_stored: 0,
    duplicate_skips: 0,
    failed_writes: 0,
    public_cache_updated: false,
    discord_jobs_queued: 0,
    parser_warnings: [],
    kill_previews: [],
    import_report_id: null,
    imported_at: null,
    chunks_processed: numberFromUnknown(detailRecord.chunks_processed ?? detailRecord.chunk_index ?? 0),
    total_chunks: numberFromUnknown(detailRecord.total_chunks ?? 0),
    error_code: failure.error_code,
    message: failure.message,
    details: failure.details,
    http_status: failure.http_status,
    response_body: failure.response_body,
  };
}

function makeWarningBulkAdmFileResultFromProgress(
  file: { filename: string; admText: string },
  progress: AdmImportJobProgressResult,
  failure: ManualAdmImportErrorResult,
  source: string,
  clientTotalLines: number,
  clientTotalChunks: number,
): BulkAdmFileResult {
  const warning = `${failure.error_code}: ${failure.message}`;
  const chunkProgress = normalizeChunkProgress(progress);
  return {
    ok: true,
    filename: file.filename,
    source,
    status: "completed_with_warnings",
    failed_endpoint: "/adm/import-job/finish",
    failed_chunk_index: progress.failed_chunk_index ?? null,
    first_failed_line_number: null,
    first_failed_line_preview: null,
    client_file_read_ok: file.admText.length > 0,
    client_total_lines: clientTotalLines,
    client_total_chunks: clientTotalChunks,
    job_status: progress.status,
    job_id: progress.job_id,
    raw_lines: progress.total_lines || clientTotalLines,
    raw_kill_lines_found: progress.parsed_kills,
    parsed_kills: progress.parsed_kills,
    written_kills: progress.written_kills,
    deaths: progress.written_kills,
    joins: progress.joins,
    disconnects: progress.disconnects,
    playerlist_snapshots: progress.playerlist_snapshots,
    suicides: 0,
    uncredited_deaths: 0,
    hit_lines: progress.hit_lines,
    raw_events_stored: progress.raw_events_stored,
    player_events_stored: progress.player_events_stored,
    duplicate_skips: progress.duplicate_skips,
    failed_writes: 0,
    public_cache_updated: progress.public_cache_updated,
    discord_jobs_queued: progress.discord_jobs_queued,
    parser_warnings: [...progress.warnings, `Finish completed with warning: ${warning}`],
    kill_previews: [],
    import_report_id: null,
    imported_at: null,
    error_code: failure.error_code,
    message: `Core ADM chunks completed, but finish reported a warning: ${failure.message}`,
    details: failure.details,
    http_status: failure.http_status,
    response_body: failure.response_body,
    chunks_processed: chunkProgress.chunksProcessed,
    total_chunks: chunkProgress.totalChunks,
  };
}

function makeProcessingBulkAdmFileResultFromJob(
  job: AdmImportJobProgressResult,
  source: string,
): BulkAdmFileResult {
  const completed = isCompletedAdmImportJobStatus(job.status);
  const fileResult = job.file_result;
  const chunkProgress = normalizeChunkProgress(job);
  if (completed && fileResult) {
    return {
      ...fileResult,
      job_id: job.job_id,
      job_status: job.status,
      chunks_processed: chunkProgress.chunksProcessed,
      total_chunks: chunkProgress.totalChunks,
    };
  }
  return {
    ok: true,
    filename: job.filename,
    source,
    status: job.status === "cancelled" ? "cancelled" : completed ? "completed_with_warnings" : job.status === "failed_retryable" ? "failed_retryable" : "processing",
    failed_endpoint: null,
    failed_chunk_index: job.failed_chunk_index ?? null,
    first_failed_line_number: null,
    first_failed_line_preview: null,
    client_file_read_ok: undefined,
    client_total_lines: job.total_lines,
    client_total_chunks: job.total_chunks,
    job_status: job.status,
    job_id: job.job_id,
    chunks_processed: chunkProgress.chunksProcessed,
    total_chunks: chunkProgress.totalChunks,
    raw_lines: job.total_lines,
    raw_kill_lines_found: job.parsed_kills,
    parsed_kills: job.parsed_kills,
    written_kills: job.written_kills,
    deaths: job.written_kills,
    joins: job.joins,
    disconnects: job.disconnects,
    playerlist_snapshots: job.playerlist_snapshots,
    suicides: 0,
    uncredited_deaths: 0,
    hit_lines: job.hit_lines,
    raw_events_stored: job.raw_events_stored,
    player_events_stored: job.player_events_stored,
    duplicate_skips: job.duplicate_skips,
    failed_writes: job.status === "failed_retryable" || job.status === "failed" ? 1 : 0,
    public_cache_updated: job.public_cache_updated,
    discord_jobs_queued: job.discord_jobs_queued,
    parser_warnings: job.warnings,
    kill_previews: [],
    import_report_id: null,
    imported_at: job.completed_at ?? null,
    error_code: job.status === "failed_retryable" ? "failed_retryable" : undefined,
    message: job.error_message ?? (completed ? "ADM import job completed." : "ADM import job is processing."),
    details: {
      job_id: job.job_id,
      status: job.status,
      current_line: job.current_line,
      total_lines: job.total_lines,
      updated_at: job.updated_at,
    },
  };
}

function splitAdmTextForUpload(text: string) {
  return text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
}

function chunkAdmLinesForUpload(lines: string[], chunkSize: number) {
  const safeChunkSize = Math.max(1, Math.min(25, Math.trunc(chunkSize)));
  const chunks: Array<{ index: number; startLine: number; lines: string[] }> = [];
  for (let startLine = 0; startLine < lines.length; startLine += safeChunkSize) {
    chunks.push({
      index: chunks.length,
      startLine,
      lines: lines.slice(startLine, startLine + safeChunkSize),
    });
  }
  return chunks;
}

function numberFromUnknown(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : undefined;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function buildAdmUploadPreview(filename: string, text: string): AdmUploadFilePreview {
  const lines = splitAdmTextForUpload(text);
  return {
    lineCount: lines.length,
    chunkCount: chunkAdmLinesForUpload(lines, ADM_IMPORT_UPLOAD_CHUNK_SIZE).length,
    parsedKills: lines.filter((line) => /\bkilled by Player\b/i.test(line)).length,
    joins: lines.filter((line) => /\bis connected\b/i.test(line)).length,
    disconnects: lines.filter((line) => /\b(has been disconnected|disconnected)\b/i.test(line)).length,
    playerlistSnapshots: lines.filter((line) => /PlayerList log:/i.test(line)).length,
    firstLinePreview: lines[0]?.slice(0, 160) ?? "",
  };
}

function findLinkedServerInAuthResponse(auth: AuthResponse, serverId: string): LinkedServer | null {
  if (!auth.authenticated) return null;
  return auth.linkedServers?.find((server) => server.id === serverId)
    ?? (auth.linkedServer?.id === serverId ? auth.linkedServer : null)
    ?? null;
}

function makeDashboardTotalsSnapshot(server: LinkedServer, status: AdmSyncStatus | null): DashboardTotalsSnapshot {
  return {
    kills: status?.total_kills ?? 0,
    deaths: status?.total_deaths ?? 0,
    joins: status?.total_joins ?? 0,
    disconnects: status?.total_disconnects ?? 0,
    uniquePlayers: status?.unique_players ?? 0,
    serverScore: server.score_label ?? (typeof server.score === "number" && server.score > 0 ? String(server.score) : "Pending"),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatElapsedActionTime(startedAt: string) {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return "0s";
  const seconds = Math.max(0, Math.round((Date.now() - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function firstRejectedMessage(...results: Array<PromiseSettledResult<unknown>>) {
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (!rejected) return null;
  return rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason);
}

function makeBackfillActionStats(result: AdmBackfillPlanResult): DashboardActionProgress["stats"] {
  return {
    "Missing files": result.missing_files.length,
    "Queued files": result.queued_files.length,
    "Created jobs": result.created_jobs.length,
    "Completed files": result.completed_files.length,
    "Skipped imported": result.skipped_already_imported.length,
    "Unreadable files": result.unreadable_files.length,
  };
}

function isAdmRateLimitedFailure(result: ManualAdmImportErrorResult) {
  return result.http_status === 429 || /rate.?limit|too many requests/i.test(`${result.error_code} ${result.message}`);
}

function normalizeChunkProgress(job: Pick<AdmImportJobProgressResult, "total_lines" | "current_line" | "chunk_size" | "total_chunks" | "chunks_processed" | "display_current_chunk">) {
  const totalLines = Math.max(0, numberFromUnknown(job.total_lines) ?? 0);
  const chunkSize = Math.max(1, numberFromUnknown(job.chunk_size || ADM_IMPORT_UPLOAD_CHUNK_SIZE) ?? ADM_IMPORT_UPLOAD_CHUNK_SIZE);
  const calculatedTotalChunks = Math.max(1, Math.ceil(Math.max(totalLines, 1) / chunkSize));
  const rawTotalChunks = Math.max(1, numberFromUnknown(job.total_chunks) ?? 1);
  const currentLine = Math.max(0, Math.min(totalLines, numberFromUnknown(job.current_line) ?? 0));
  const rawChunksProcessed = Math.max(0, numberFromUnknown(job.chunks_processed) ?? 0);
  const chunksFromLine = currentLine >= totalLines && totalLines > 0 ? calculatedTotalChunks : Math.ceil(currentLine / chunkSize);
  const totalChunks = Math.max(rawTotalChunks, calculatedTotalChunks, rawChunksProcessed, chunksFromLine);
  const chunksProcessed = Math.max(0, Math.min(totalChunks, Math.max(rawChunksProcessed, chunksFromLine)));
  const displayCurrentChunk = Math.max(1, Math.min(totalChunks, numberFromUnknown(job.display_current_chunk ?? (currentLine >= totalLines && totalLines > 0 ? totalChunks : chunksProcessed + 1)) ?? 1));
  return { totalChunks, chunksProcessed, displayCurrentChunk };
}

function makeAdmChunkRunnerMetrics(startedAtMs: number, startingChunksProcessed: number, chunksProcessed: number, totalChunks: number) {
  const elapsedMinutes = Math.max((Date.now() - startedAtMs) / 60000, 1 / 60);
  const chunksDoneThisRun = Math.max(0, chunksProcessed - startingChunksProcessed);
  const chunksPerMinute = chunksDoneThisRun > 0 ? Math.round(chunksDoneThisRun / elapsedMinutes) : null;
  const remainingChunks = Math.max(0, totalChunks - chunksProcessed);
  const estimatedRemainingSeconds = chunksPerMinute && chunksPerMinute > 0 ? Math.round((remainingChunks / chunksPerMinute) * 60) : null;
  return { chunksPerMinute, estimatedRemainingSeconds };
}

function makeDashboardTotalsDelta(before: DashboardTotalsSnapshot, after: DashboardTotalsSnapshot): DashboardTotalsDelta {
  return {
    before,
    after,
    changed: before.kills !== after.kills
      || before.deaths !== after.deaths
      || before.joins !== after.joins
      || before.disconnects !== after.disconnects
      || before.uniquePlayers !== after.uniquePlayers
      || before.serverScore !== after.serverScore,
  };
}

function isFailedBulkAdmFile(file: BulkAdmFileResult) {
  return !file.ok || file.status === "failed" || file.status === "cancelled" || (file.status === "failed_retryable" && !hasActiveAdmImportProgress(file));
}

function isCompletedBulkAdmFile(file: BulkAdmFileResult) {
  return file.ok && !isFailedBulkAdmFile(file) && !isProcessingBulkAdmFile(file);
}

function isProcessingBulkAdmFile(file: BulkAdmFileResult) {
  return file.ok && (["processing", "queued", "parsing", "writing", "rebuilding"].includes(String(file.status)) || (file.status === "failed_retryable" && hasActiveAdmImportProgress(file)));
}

function isActiveAdmImportJobStatus(status: string | null | undefined) {
  return status === "queued" || status === "processing" || status === "parsing" || status === "writing" || status === "rebuilding";
}

function isCompletedAdmImportJobStatus(status: string | null | undefined) {
  return status === "completed" || status === "completed_with_warnings";
}

function hasActiveAdmImportProgress(file: BulkAdmFileResult) {
  return (file.chunks_processed ?? 0) > 0 && (file.total_chunks ?? 0) > (file.chunks_processed ?? 0);
}

function getSafeAdmChunkProgressPercent(file: Pick<BulkAdmFileResult, "chunks_processed" | "total_chunks"> & { raw_lines?: number | null }) {
  const totalChunks = Math.max(1, numberFromUnknown(file.total_chunks) ?? 1);
  const chunksProcessed = Math.max(0, Math.min(totalChunks, numberFromUnknown(file.chunks_processed) ?? 0));
  if (totalChunks <= 0 || (file.raw_lines !== undefined && (numberFromUnknown(file.raw_lines) ?? 0) <= 0)) return 2;
  return Math.max(2, Math.min(100, Math.round((chunksProcessed / totalChunks) * 100)));
}

function findActiveAdmImportJobFromResult(result: BulkAdmImportResult | null) {
  const file = result?.files.find((candidate) => candidate.job_id && (isProcessingBulkAdmFile(candidate) || (candidate.status === "failed_retryable" && hasActiveAdmImportProgress(candidate))));
  if (!file?.job_id) return null;
  return {
    job_id: file.job_id,
    filename: file.filename,
    source: file.source,
    status: file.job_status ?? file.status,
  };
}

function isDedupeOnlyBulkAdmFile(file: BulkAdmFileResult) {
  return file.ok
    && (file.status === "duplicate_only" || file.status === "completed_duplicate_only" || file.status === "imported" || file.status === "completed_with_warnings")
    && file.parsed_kills > 0
    && file.written_kills === 0
    && file.duplicate_skips > 0
    && file.failed_writes === 0;
}

function getBulkAdmFileOutcomeLabel(file: BulkAdmFileResult, mode: BulkAdmImportResult["mode"]) {
  if (mode === "preview") return "Previewed";
  if (isProcessingBulkAdmFile(file)) return "Import in progress";
  if (file.status === "cancelled") return "Cancelled";
  if (isFailedBulkAdmFile(file)) return "Needs retry";
  if (isDedupeOnlyBulkAdmFile(file)) return "Already imported - skipped by dedupe";
  if (file.status === "completed_with_warnings") return "Completed with warnings";
  return "Imported";
}

function getBulkAdmFileOutcomeTone(file: BulkAdmFileResult, mode: BulkAdmImportResult["mode"]): "emerald" | "orange" | "cyan" | "zinc" {
  if (mode === "preview") return "cyan";
  if (isProcessingBulkAdmFile(file)) return "cyan";
  if (isFailedBulkAdmFile(file)) return "orange";
  if (isDedupeOnlyBulkAdmFile(file)) return "zinc";
  if (file.status === "completed_with_warnings") return "orange";
  return "emerald";
}

function summarizeClientBulkAdmResults(
  files: BulkAdmFileResult[],
  source: string,
  selectedFileCount = files.length,
): BulkAdmImportResult {
  const errors = files
    .filter(isFailedBulkAdmFile)
    .map((file) => `${file.filename}: ${file.message ?? file.error_code ?? "failed"}`);
  const warnings = files.flatMap((file) => file.parser_warnings.map((warning) => `${file.filename}: ${warning}`));
  return {
    ok: true,
    mode: "import",
    source,
    files_uploaded: selectedFileCount,
    files_imported: files.filter(isCompletedBulkAdmFile).length,
    processing_files: files.filter(isProcessingBulkAdmFile).length,
    failed_files: files.filter(isFailedBulkAdmFile).length,
    total_raw_lines: files.reduce((total, file) => total + file.raw_lines, 0),
    raw_kill_lines_found: files.reduce((total, file) => total + file.raw_kill_lines_found, 0),
    parsed_kills: files.reduce((total, file) => total + file.parsed_kills, 0),
    written_kills: files.reduce((total, file) => total + file.written_kills, 0),
    duplicate_kills_skipped: files.reduce((total, file) => total + file.duplicate_skips, 0),
    joins: files.reduce((total, file) => total + file.joins, 0),
    disconnects: files.reduce((total, file) => total + file.disconnects, 0),
    playerlist_snapshots: files.reduce((total, file) => total + file.playerlist_snapshots, 0),
    deaths: files.reduce((total, file) => total + file.deaths, 0),
    suicides: files.reduce((total, file) => total + file.suicides, 0),
    hit_lines: files.reduce((total, file) => total + file.hit_lines, 0),
    raw_events_stored: files.reduce((total, file) => total + file.raw_events_stored, 0),
    player_events_stored: files.reduce((total, file) => total + file.player_events_stored, 0),
    public_cache_updated: files.some((file) => file.public_cache_updated),
    discord_jobs_queued: files.reduce((total, file) => total + file.discord_jobs_queued, 0),
    warnings,
    errors,
    files,
  };
}

function replaceBulkAdmFileResult(
  current: BulkAdmImportResult | null,
  nextFile: BulkAdmFileResult,
  source: string,
  selectedFileCount: number,
): BulkAdmImportResult {
  const existing = current?.files ?? [];
  const replaced = existing.some((file) => file.filename === nextFile.filename);
  const files = replaced
    ? existing.map((file) => (file.filename === nextFile.filename ? nextFile : file))
    : [...existing, nextFile];
  return summarizeClientBulkAdmResults(files, source, Math.max(selectedFileCount, current?.files_uploaded ?? 0, files.length));
}

function mergeActiveAdmImportJobIntoBulkResult(
  current: BulkAdmImportResult | null,
  job: AdmImportJobProgressResult | null,
) {
  if (!job || (!isActiveAdmImportJobStatus(job.status) && job.status !== "failed_retryable")) return current;
  const activeFile = makeProcessingBulkAdmFileResultFromJob(job, job.source);
  return replaceBulkAdmFileResult(current, activeFile, job.source, Math.max(current?.files_uploaded ?? 0, 1));
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
  if (["processing_in_chunks", "adm_import_job_queued"].includes(normalizedStatus)) return "Processing latest ADM in chunks";
  if (["adm_file_unreadable", "latest_adm_unreadable", "nitrado_file_unavailable"].includes(normalizedStatus)) return "Latest ADM file found but not readable yet";
  if (["adm_not_generated_yet", "no_adm_file", "waiting_after_restart"].includes(normalizedStatus)) return "Waiting for Nitrado log";
  if (normalizedStatus === "delayed_after_restart") return "Delayed after restart";
  if (["completed", "new_data_found", "no_new_lines", "no_new_log_available", "no_supported_events"].includes(normalizedStatus)) return "Yes";
  if (normalizedStatus === "read_pending") return "Waiting for readable content";
  return "Unknown";
}

function getOverviewAdmSyncStatus(currentStatus: string, hasActiveJob: boolean, statsSyncActive: boolean) {
  const normalizedStatus = currentStatus.toLowerCase();
  if (hasActiveJob || ["processing_in_chunks", "adm_import_job_queued"].includes(normalizedStatus)) return "Importing ADM";
  if (["adm_file_unreadable", "latest_adm_unreadable", "adm_not_generated_yet", "waiting_after_restart", "delayed_after_restart", "no_adm_file", "read_pending"].includes(normalizedStatus)) return "Waiting for Nitrado";
  if (statsSyncActive || ["completed", "new_data_found", "no_new_lines", "no_new_log_available", "no_supported_events", "active"].includes(normalizedStatus)) return "ADM Sync Active";
  return "Waiting for Nitrado";
}

function getRecentFeedBadge(recentEventsAreMock: boolean, currentStatus: string): { label: string; tone: "emerald" | "orange" | "zinc" } {
  if (recentEventsAreMock) return { label: "Mock Sync Data", tone: "orange" };
  const normalizedStatus = currentStatus.toLowerCase();
  if (["processing_in_chunks", "adm_import_job_queued"].includes(normalizedStatus)) {
    return { label: "Chunk Import Active", tone: "emerald" };
  }
  if (["adm_file_unreadable", "latest_adm_unreadable", "nitrado_file_unavailable", "adm_not_generated_yet", "waiting_after_restart", "delayed_after_restart", "no_adm_file"].includes(normalizedStatus)) {
    return { label: "Waiting For Nitrado Log", tone: "orange" };
  }
  if (["nitrado_down", "nitrado_auth_invalid", "nitrado_rate_limited", "dzn_parser_error", "dzn_write_error", "dzn_scope_blocked", "nitrado_error", "parser_error", "write_error"].includes(normalizedStatus)) {
    return { label: "Feed Check Issue", tone: "orange" };
  }
  if (["no_new_lines", "no_new_log_available", "no_supported_events"].includes(normalizedStatus)) return { label: "Feed Checked", tone: "zinc" };
  return { label: "Live Feed Active", tone: "emerald" };
}

function getRecentFeedStatus(syncStatus: AdmSyncStatus | null, currentStatus: string, recentEventCount: number) {
  const normalizedStatus = currentStatus.toLowerCase();
  const lastChecked = syncStatus?.last_sync_at ? formatRelativeTime(syncStatus.last_sync_at) : "not checked yet";
  const lastSuccessful = syncStatus?.last_successful_sync_at ? formatRelativeTime(syncStatus.last_successful_sync_at) : null;

  if (["processing_in_chunks", "adm_import_job_queued"].includes(normalizedStatus)) {
    const job = syncStatus?.active_adm_import_job;
    return {
      message: job
        ? `Processing ${job.filename} in chunks (${job.display_current_chunk ?? job.chunks_processed}/${job.total_chunks}). Continue Import can keep it moving now.`
        : "Processing latest ADM in chunks. Continue Import can keep it moving now.",
      className: "border-emerald-300/15 bg-emerald-400/8 text-emerald-50",
    };
  }

  if (normalizedStatus === "no_new_lines" || normalizedStatus === "no_new_log_available") {
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

  if (["adm_file_unreadable", "latest_adm_unreadable", "nitrado_file_unavailable"].includes(normalizedStatus)) {
    return {
      message: `Feed last updated ${lastSuccessful ?? "previously"}. Latest ADM file found but not readable yet. DZN will retry on the next scheduled check.`,
      className: "border-orange-300/20 bg-orange-400/10 text-orange-50",
    };
  }

  if (["adm_not_generated_yet", "waiting_after_restart", "no_adm_file"].includes(normalizedStatus)) {
    return {
      message: "Server restart detected. Waiting for Nitrado to publish the next ADM log. Existing feed data remains preserved.",
      className: "border-orange-300/20 bg-orange-400/10 text-orange-50",
    };
  }

  if (normalizedStatus === "delayed_after_restart") {
    return {
      message: "Nitrado has not published a readable ADM log yet. This can take 5-45 minutes after restart.",
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

  if (["adm_file_unreadable", "latest_adm_unreadable"].includes(normalizedStatus)) {
    return {
      status: "pending" as const,
      title: "Latest ADM Not Readable Yet",
      message: "Latest ADM file found but not readable yet. DZN will retry on the next scheduled check.",
      detail: latestSuccessTime
        ? `The last successful feed sync remains active from ${formatDashboardDate(latestSuccessTime)}.`
        : "The last successful feed sync remains active when available.",
      nextAction: "Wait for the next ADM sync run",
      latestSuccessTime,
    };
  }

  if (["adm_not_generated_yet", "waiting_after_restart", "no_adm_file"].includes(normalizedStatus)) {
    return {
      status: "pending" as const,
      title: "Waiting For Nitrado Log",
      message: "Server restart detected. Waiting for Nitrado to publish the next ADM log.",
      detail: "DZN will process activity when Nitrado exposes the next readable ADM log file.",
      nextAction: "Waiting for next ADM file",
      latestSuccessTime,
    };
  }

  if (normalizedStatus === "delayed_after_restart") {
    return {
      status: "pending" as const,
      title: "ADM Delayed After Restart",
      message: "Nitrado has not published a readable ADM log yet. This can take 5-45 minutes after restart.",
      detail: latestSuccessTime
        ? `The last successful feed sync remains active from ${formatDashboardDate(latestSuccessTime)}.`
        : "Existing stats remain preserved while DZN waits for Nitrado.",
      nextAction: "DZN will retry on the next scheduled check",
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

  if (normalizedStatus === "no_new_lines" || normalizedStatus === "no_new_log_available") {
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
  if (syncStatus?.last_sync_status === "no_new_lines" || syncStatus?.last_sync_status === "no_new_log_available") return 100;
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
  return ["completed", "new_data_found", "idle", "no_new_lines", "no_new_log_available", "no_supported_events"].includes(run.status.toLowerCase());
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

function formatAdmCadence(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return "Learning from ADM";
  return `around ${Math.round(value)} minutes`;
}

function formatActiveAdmImportJob(job: AdmSyncStatus["active_adm_import_job"]) {
  if (!job) return "No active chunk job";
  if (job.status === "completed") return "Completed";
  const totalChunks = Math.max(1, job.total_chunks);
  const nextChunk = Math.min(totalChunks, Math.max(1, job.display_current_chunk ?? job.chunks_processed + 1));
  return `${formatStatusLabel(job.status)} - ${job.filename} - chunk ${nextChunk}/${totalChunks}, ${job.parsed_kills} parsed kills, ${job.written_kills} written`;
}

function formatAutomationAdmJob(job: AutomationHealth["latest_scheduled_nitrado_job"] | null | undefined) {
  if (!job) return "None";
  const totalChunks = Math.max(1, job.total_chunks);
  const currentChunk = Math.min(totalChunks, Math.max(1, job.chunks_processed || 1));
  return `${formatStatusLabel(job.status)} - ${job.filename} - ${currentChunk}/${totalChunks}`;
}

function formatMinutesAgo(value: number | null | undefined, fallback: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  if (value <= 0) return "just now";
  return `${Math.round(value)} minutes old`;
}

function formatFirstAdmAfterRestart(syncStatus: AdmSyncStatus | null | undefined) {
  if (!syncStatus?.first_adm_after_restart_at) return "Waiting";
  const delay = syncStatus.first_adm_after_restart_delay_minutes;
  const suffix = delay ? ` (${delay} min after restart)` : "";
  return `${formatCompactDate(syncStatus.first_adm_after_restart_at)}${suffix}`;
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

function formatStatusLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getAdmCursorValidationMessage(status: string | null | undefined) {
  if (status === "valid") return "ADM cursor verified.";
  if (status === "legacy_no_hash") return "ADM cursor will be upgraded with hash validation after the next successful import.";
  if (status === "line_out_of_range") return "DZN detected the ADM file was shorter than the saved cursor. This can happen after restart or file rollover. DZN recovered safely.";
  if (status === "hash_mismatch" || status === "hash_found_repositioned" || status === "safe_tail_reprocess") {
    return "DZN detected ADM cursor mismatch and safely reprocessed a recent tail window. Existing stats were preserved.";
  }
  if (status === "new_file") return "New ADM file detected. DZN will store a cursor hash after this import.";
  return "ADM cursor validation status is being tracked.";
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
  if (value === "processing_in_chunks") return "Processing In Chunks";
  if (value === "adm_import_job_queued") return "Chunk Import Queued";
  if (value === "new_data_found") return "New ADM Data Processed";
  if (value === "idle") return "Idle";
  if (value === "no_new_lines") return "No New Lines";
  if (value === "no_new_log_available") return "No New ADM Data";
  if (value === "no_supported_events") return "No Supported Events";
  if (value === "adm_not_generated_yet" || value === "waiting_after_restart" || value === "no_adm_file") return "Waiting For Nitrado Log";
  if (value === "adm_file_unreadable" || value === "latest_adm_unreadable") return "Latest ADM Not Readable Yet";
  if (value === "delayed_after_restart") return "ADM Delayed After Restart";
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
