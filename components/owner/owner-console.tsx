"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type LifecycleStatus =
  | "active_live"
  | "active_degraded"
  | "token_needs_resave"
  | "nitrado_upstream_down"
  | "stale_monitoring"
  | "expired_detected"
  | "deletion_imminent"
  | "final_sync_pending"
  | "final_sync_complete"
  | "legacy_offline"
  | "archived_hidden";

type OwnerServer = {
  id: string;
  serverName: string;
  slug: string | null;
  owner: { username: string | null; discordId: string | null };
  guild: { guildId: string | null; discordGuildId: string | null; name: string | null };
  nitradoServiceId: string | null;
  nitradoServiceName: string | null;
  status: string | null;
  listingVisibility: string | null;
  lifecycleStatus: LifecycleStatus;
  lifecycleLabel: string;
  lifecycleMessage: string;
  lifecycleReason: string | null;
  ownerActionRequired: boolean;
  ownerActionReason: string | null;
  syncResourceStatus: "active" | "reduced" | "stopped";
  playerCount: {
    current: number | null;
    max: number | null;
    status: string | null;
    source: string | null;
    freshness: string | null;
  };
  adm: {
    latestFile: string | null;
    latestProcessedFile: string | null;
    lastProcessedOffset: number | null;
    latestImportedEventAt: string | null;
    lastSuccessfulImportAt: string | null;
    lastAttemptedReadAt: string | null;
    status: string | null;
  };
  tokenStatus: "readable" | "decrypt_failed" | "needs_resave" | "unknown";
  publicProfileUrl: string | null;
  dashboardUrl: string;
  plan: { key: string | null; status: string | null };
  stats: {
    totalKills: number;
    totalDeaths: number;
    totalJoins: number;
    totalDisconnects: number;
    uniquePlayers: number;
    buildScore: number;
    lastEventAt: string | null;
    lastBuildAt: string | null;
  };
  resource: {
    admSyncEnabled: boolean;
    metadataRefreshEnabled: boolean;
    playerCountPollingEnabled: boolean;
    discordPostingEnabled: boolean;
    serverWarsEligible: boolean;
    consumingScheduledResources: boolean;
    excludedFromActiveSync: boolean;
    skippedReason: string | null;
  };
  nextRetryAfter: string | null;
  lastSkipReason: string | null;
  badges: string[];
  knownRole: "nuketown" | "pandora" | "warlords" | null;
};

type OwnerOverview = {
  counts: Record<LifecycleStatus, number> & {
    totalLinkedServers: number;
    serversConsumingSyncResources: number;
    serversSkippedFromSync: number;
  };
  featureFlags: {
    dznPulseEnabled: boolean;
    discordNotificationsEnabled: boolean;
    freeProAdvertisingStatus: "live";
  };
  ownerAccess: { allowlistConfigured: boolean };
  knownServers: {
    nuketown: KnownServerSummary | null;
    pandora: KnownServerSummary | null;
    warlords: KnownServerSummary | null;
  };
  health: {
    publicRoutes: StoredJobHealth | null;
    admCycleWatch: StoredJobHealth | null;
    autoUpdateScheduler: StoredJobHealth | null;
  };
  generatedAt: string;
};

type KnownServerSummary = {
  name: string;
  lifecycleStatus: LifecycleStatus;
  lifecycleLabel: string;
  status: string | null;
  publicVisibility: string | null;
  latestAdmFile: string | null;
  latestImportedEventAt: string | null;
  playerCount: string;
};

type StoredJobHealth = {
  source: string | null;
  jobType: string | null;
  status: string | null;
  createdAt: string | null;
  error: string | null;
};

type AuditLog = {
  message: string;
  phase: "phase_1_read_only" | "phase_2a_discord";
  items: AuditLogItem[];
};

type AuditLogItem = {
  id: string;
  actorDiscordId: string | null;
  action: string;
  targetType: string | null;
  targetSlot: string | null;
  guildId: string | null;
  channelId: string | null;
  result: string;
  reason: string | null;
  requestId: string | null;
  createdAt: string | null;
};

type DiscordPostingMode = "disabled" | "preview_only" | "production_disabled" | "ready_but_off";

type DiscordAnnouncementSummary = {
  id: string;
  serverId: string | null;
  eventType: string;
  channelConfigured: boolean;
  status: string;
  failureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type DiscordAnnouncementHealth = {
  featureEnabled: boolean;
  advertChannelConfigured: boolean;
  showcaseChannelConfigured: boolean;
  botTokenConfigured: boolean;
  lastServerAnnouncement: DiscordAnnouncementSummary | null;
  lastBumpPost: DiscordAnnouncementSummary | null;
  lastWeeklySpotlight: DiscordAnnouncementSummary | null;
  recentFailures: DiscordAnnouncementSummary[];
  generatedAt: string;
};

type DiscordOverview = {
  integrationStatus: string;
  botConfigured: boolean;
  botTokenPresent: boolean;
  discordPulseDeliveryEnabled: boolean;
  discordNotificationsEnabled: boolean;
  connectedGuildCount: number | null;
  configuredChannelCount: number | null;
  lastPostAttempt: {
    postType: string | null;
    guildId: string | null;
    channelId: string | null;
    status: string | null;
    attemptedAt: string | null;
    error: string | null;
  } | null;
  serverAnnouncements: DiscordAnnouncementHealth | null;
  postingMode: DiscordPostingMode;
  generatedAt: string;
};

type DiscordPostType = {
  key: string;
  label: string;
  enabled: boolean;
  productionSendingDisabled: boolean;
  previewAvailable: boolean;
  channelTarget: string | null;
  channelConfigured: boolean;
  lastGeneratedPreview: string | null;
  requiredDataSource: string;
};

type DiscordChannelSlot = {
  slot: string;
  label: string;
  status: "not_configured" | "configured" | "missing_permission" | "disabled" | "preview_only";
  channelId: string | null;
  channelName: string | null;
  guildId: string | null;
  guildName: string | null;
  mappedPostTypes: string[];
  webhookConfigured: boolean;
  lastPermissionCheckedAt: string | null;
  lastPermissionStatus: string | null;
  lastPermissionError: string | null;
  permissionCheck?: DiscordPermissionCheck | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type DiscordPermissionCheck = {
  ok: boolean;
  status: "ok" | "missing_permissions" | "not_configured" | "discord_error";
  checkedAt: string;
  mode: string;
  canViewChannel: boolean;
  canSendMessages: boolean;
  canEmbedLinks: boolean;
  canReadMessageHistory: boolean;
  canAttachFiles: boolean | null;
  missingPermissions: string[];
  warning: string | null;
  channelName: string | null;
  permissionSource: string | null;
};

type DiscordDestinationModal =
  | { kind: "configure"; slot: string }
  | { kind: "permissions"; slot: string }
  | { kind: "test"; slot: string }
  | null;

type DestinationMappingForm = {
  guildId: string;
  guildName: string;
  channelId: string;
  channelName: string;
  confirmation: string;
};

type DiscordPreviewType =
  | "new_server"
  | "top_server"
  | "legacy_server"
  | "archived_server"
  | "server_wars_event"
  | "weekly_recap"
  | "daily_recap"
  | "longest_kill"
  | "milestone"
  | "dzn_announcement"
  | "package_promotion";

type DiscordPreviewEmbed = {
  type: DiscordPreviewType;
  title: string;
  description: string;
  colorHex: string;
  thumbnailUrl: string | null;
  bannerUrl: string | null;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  footer: string;
  timestamp: string;
  cta: { label: string; url: string } | null;
  previewOnly: true;
  sent: false;
};

type DiscordTemplate = {
  type: DiscordPreviewType;
  label: string;
  description: string;
  preview: DiscordPreviewEmbed;
};

type DiscordPreviewOption = {
  type: DiscordPreviewType;
  label: string;
  description: string;
  networkWide: boolean;
  suggestedSlot: string;
};

type DiscordLinkedServerOption = {
  value: string;
  label: string;
  slug: string | null;
  lifecycleStatus: string | null;
  lifecycleLabel: string;
  status: string | null;
  role: "network" | "nuketown" | "pandora" | "warlords" | "server";
};

type DiscordOptions = {
  postTypes: DiscordPreviewOption[];
  linkedServers: DiscordLinkedServerOption[];
  destinationSlots: DiscordChannelSlot[];
};

type DiscordControlData = {
  overview: DiscordOverview;
  postTypes: DiscordPostType[];
  channels: DiscordChannelSlot[];
  templates: DiscordTemplate[];
  options: DiscordOptions;
  auditLog: AuditLogItem[];
};

const LIFECYCLE_COPY: { status: LifecycleStatus; label: string; description: string }[] = [
  { status: "active_live", label: "Live sync active", description: "Full ADM, metadata, player-count, posting and live eligibility remain enabled." },
  { status: "active_degraded", label: "Live but degraded", description: "Sync runs with backoff while preserving last known good values." },
  { status: "token_needs_resave", label: "Token needs re-save", description: "Expensive token-dependent work is paused until the owner re-saves the Nitrado token." },
  { status: "nitrado_upstream_down", label: "Nitrado temporarily unavailable", description: "Retries are backed off so DZN does not hammer Nitrado while preserving stored data." },
  { status: "stale_monitoring", label: "Stale monitoring", description: "Reduced monitoring frequency for servers without recent readable activity." },
  { status: "expired_detected", label: "Server appears expired", description: "DZN can attempt a bounded final sync if access and logs still work." },
  { status: "deletion_imminent", label: "Deletion may be imminent", description: "One controlled final sync path is prepared before live sync stops." },
  { status: "final_sync_pending", label: "Final sync pending", description: "Only the bounded final sync should run, with dedupe and checkpoints." },
  { status: "final_sync_complete", label: "Final sync complete - live sync stopped", description: "Historical stats are preserved. Recurring live sync is disabled." },
  { status: "legacy_offline", label: "Legacy offline - historical stats preserved", description: "Historical profile/stat data can remain visible without active resource usage." },
  { status: "archived_hidden", label: "Archived / hidden - active sync disabled", description: "Hidden from active public surfaces and excluded from active workers and hard-fail health." },
];

const NAV_ITEMS = [
  "Overview",
  "Servers",
  "Lifecycle",
  "Resource Control",
  "Discord Control",
  "Audit Log",
  "Settings / Access",
] as const;

type NavItem = typeof NAV_ITEMS[number];

export function OwnerConsole() {
  const [activeView, setActiveView] = useState<NavItem>("Overview");
  const [overview, setOverview] = useState<OwnerOverview | null>(null);
  const [servers, setServers] = useState<OwnerServer[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLog | null>(null);
  const [discordControl, setDiscordControl] = useState<DiscordControlData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unauthorized" | "forbidden" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadOwnerConsole() {
      try {
        const [
          overviewResponse,
          serversResponse,
          auditResponse,
          discordOverviewResponse,
          discordPostTypesResponse,
          discordChannelsResponse,
          discordMappingsResponse,
          discordTemplatesResponse,
          discordOptionsResponse,
          discordAuditResponse,
        ] = await Promise.all([
          fetch("/api/owner/overview", { cache: "no-store" }),
          fetch("/api/owner/servers", { cache: "no-store" }),
          fetch("/api/owner/audit-log", { cache: "no-store" }),
          fetch("/api/owner/discord/overview", { cache: "no-store" }),
          fetch("/api/owner/discord/post-types", { cache: "no-store" }),
          fetch("/api/owner/discord/channels", { cache: "no-store" }),
          fetch("/api/owner/discord/channel-mappings", { cache: "no-store" }),
          fetch("/api/owner/discord/templates", { cache: "no-store" }),
          fetch("/api/owner/discord/options", { cache: "no-store" }),
          fetch("/api/owner/discord/audit-log", { cache: "no-store" }),
        ]);

        if (!active) return;

        const responses = [
          overviewResponse,
          serversResponse,
          auditResponse,
          discordOverviewResponse,
          discordPostTypesResponse,
          discordChannelsResponse,
          discordMappingsResponse,
          discordTemplatesResponse,
          discordOptionsResponse,
          discordAuditResponse,
        ];
        const firstBlocked = responses.find((response) => response.status === 401 || response.status === 403);
        if (firstBlocked) {
          setStatus(firstBlocked.status === 401 ? "unauthorized" : "forbidden");
          return;
        }
        if (responses.some((response) => !response.ok)) {
          setStatus("error");
          setError("Owner console data could not be loaded.");
          return;
        }

        const [
          overviewJson,
          serversJson,
          auditJson,
          discordOverviewJson,
          discordPostTypesJson,
          discordChannelsJson,
          discordMappingsJson,
          discordTemplatesJson,
          discordOptionsJson,
          discordAuditJson,
        ] = await Promise.all([
          overviewResponse.json(),
          serversResponse.json(),
          auditResponse.json(),
          discordOverviewResponse.json(),
          discordPostTypesResponse.json(),
          discordChannelsResponse.json(),
          discordMappingsResponse.json(),
          discordTemplatesResponse.json(),
          discordOptionsResponse.json(),
          discordAuditResponse.json(),
        ]);

        if (!active) return;

        setOverview(overviewJson.overview);
        setServers(serversJson.servers ?? []);
        setAuditLog({
          message: (discordAuditJson.auditLog ?? []).length > 0 ? "Discord owner actions recorded." : auditJson.auditLog?.message ?? "No owner actions recorded yet.",
          phase: (discordAuditJson.auditLog ?? []).length > 0 ? "phase_2a_discord" : auditJson.auditLog?.phase ?? "phase_1_read_only",
          items: discordAuditJson.auditLog ?? auditJson.auditLog?.items ?? [],
        });
        setDiscordControl({
          overview: discordOverviewJson.overview,
          postTypes: discordPostTypesJson.postTypes ?? [],
          channels: discordMappingsJson.mappings ?? discordChannelsJson.channels ?? [],
          templates: discordTemplatesJson.templates ?? [],
          options: discordOptionsJson.options ?? {
            postTypes: discordTemplatesJson.templates ?? [],
            linkedServers: [{ value: "network", label: "All Network / Network-wide", slug: null, lifecycleStatus: null, lifecycleLabel: "Network-wide", status: null, role: "network" }],
            destinationSlots: discordMappingsJson.mappings ?? discordChannelsJson.channels ?? [],
          },
          auditLog: discordAuditJson.auditLog ?? [],
        });
        setStatus("ready");
      } catch {
        if (!active) return;
        setStatus("error");
        setError("Owner console data could not be loaded.");
      }
    }

    void loadOwnerConsole();
    return () => {
      active = false;
    };
  }, []);

  const lifecycleCounts = useMemo(() => {
    if (!overview) return [];
    return LIFECYCLE_COPY.map((entry) => ({
      ...entry,
      count: overview.counts[entry.status] ?? 0,
    }));
  }, [overview]);

  if (status === "loading") {
    return <OwnerShell activeView={activeView} setActiveView={setActiveView}><LoadingPanel /></OwnerShell>;
  }

  if (status === "unauthorized" || status === "forbidden") {
    return (
      <OwnerShell activeView={activeView} setActiveView={setActiveView}>
        <section className="rounded-lg border border-red-400/20 bg-red-950/20 p-8 shadow-[0_0_40px_rgba(239,68,68,0.12)]">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-red-200">Owner access required</p>
          <h1 className="mt-3 text-3xl font-black text-white">{status === "unauthorized" ? "Sign in required" : "403 - platform owner only"}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">
            The DZN owner console is restricted to Discord user IDs in the secure platform-owner allowlist.
          </p>
          {status === "unauthorized" ? (
            <Link href="/login?returnTo=%2Fowner" className="mt-6 inline-flex rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-black text-cyan-100 hover:bg-cyan-300/20">
              Sign in with Discord
            </Link>
          ) : null}
        </section>
      </OwnerShell>
    );
  }

  if (status === "error") {
    return <OwnerShell activeView={activeView} setActiveView={setActiveView}><ErrorPanel message={error ?? "Unknown owner console error."} /></OwnerShell>;
  }

  return (
    <OwnerShell activeView={activeView} setActiveView={setActiveView}>
      {activeView === "Overview" && overview ? <OverviewPanel overview={overview} lifecycleCounts={lifecycleCounts} /> : null}
      {activeView === "Servers" ? <ServersPanel servers={servers} /> : null}
      {activeView === "Lifecycle" ? <LifecyclePanel lifecycleCounts={lifecycleCounts} /> : null}
      {activeView === "Resource Control" ? <ResourceControlPanel servers={servers} /> : null}
      {activeView === "Discord Control" && discordControl ? <DiscordControlPanel data={discordControl} /> : null}
      {activeView === "Audit Log" ? <AuditLogPanel auditLog={auditLog} /> : null}
      {activeView === "Settings / Access" && overview ? <SettingsPanel overview={overview} /> : null}
    </OwnerShell>
  );
}

function OwnerShell({ activeView, setActiveView, children }: {
  activeView: NavItem;
  setActiveView: (view: NavItem) => void;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.classList.add("dzn-owner-console-active");
    document.body.classList.add("dzn-owner-console-active");
    return () => {
      document.documentElement.classList.remove("dzn-owner-console-active");
      document.body.classList.remove("dzn-owner-console-active");
    };
  }, []);

  return (
    <main className="h-dvh overflow-hidden bg-[#02030a] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(168,85,247,0.14),transparent_30%)]" />
      <div className="relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="z-10 flex min-h-0 flex-col border-b border-white/10 bg-black/45 p-3 backdrop-blur-xl lg:h-dvh lg:border-b-0 lg:border-r">
          <Link href="/" className="block rounded-lg border border-cyan-300/20 bg-cyan-300/5 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">DZN Owner</p>
            <h1 className="mt-1 text-xl font-black text-white">Command Centre</h1>
          </Link>

          <nav className="mt-4 grid gap-1.5 overflow-auto pr-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setActiveView(item)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-bold transition ${
                  activeView === item
                    ? "border-cyan-300/40 bg-cyan-300/[0.12] text-white shadow-[0_0_24px_rgba(34,211,238,0.12)]"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-white"
                }`}
              >
                {item}
              </button>
            ))}
          </nav>

          <div className="mt-auto grid gap-1.5 pt-3">
            <Link href="/" className="block rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-bold text-zinc-300 hover:border-cyan-300/30 hover:text-white">
              View Public Site
            </Link>
            <Link href="/dashboard" className="block rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-bold text-zinc-300 hover:border-cyan-300/30 hover:text-white">
              View Server Owner Dashboard
            </Link>
          </div>
        </aside>

        <section className="min-h-0 overflow-hidden px-3 py-3 sm:px-4 lg:px-5">
          <div className="mx-auto h-full min-h-0 max-w-[1600px]">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}

function OverviewPanel({ overview, lifecycleCounts }: { overview: OwnerOverview; lifecycleCounts: Array<typeof LIFECYCLE_COPY[number] & { count: number }> }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto lg:overflow-hidden">
      <PanelHeader eyebrow="Platform Overview" title="DZN Network control state" description="Stored production state only. No live Nitrado or Discord calls are made from this console." />
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total linked servers" value={overview.counts.totalLinkedServers} accent="cyan" />
        <MetricCard label="Active live" value={overview.counts.active_live} accent="emerald" />
        <MetricCard label="Consuming sync resources" value={overview.counts.serversConsumingSyncResources} accent="violet" />
        <MetricCard label="Skipped from active sync" value={overview.counts.serversSkippedFromSync} accent="amber" />
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        <StatusCard title="DZN Pulse" value={overview.featureFlags.dznPulseEnabled ? "Enabled" : "Disabled"} tone={overview.featureFlags.dznPulseEnabled ? "good" : "warn"} />
        <StatusCard title="Discord Pulse delivery" value={overview.featureFlags.discordNotificationsEnabled ? "Enabled" : "Disabled"} tone={overview.featureFlags.discordNotificationsEnabled ? "warn" : "good"} />
        <StatusCard title="Free / Pro advertising" value={overview.featureFlags.freeProAdvertisingStatus === "live" ? "Live" : "Unknown"} tone="good" />
      </div>

      <div className="grid gap-2 xl:grid-cols-3">
        <KnownServerCard title="NukeTown" server={overview.knownServers.nuketown} />
        <KnownServerCard title="PANDORA" server={overview.knownServers.pandora} />
        <KnownServerCard title="Warlords" server={overview.knownServers.warlords} />
      </div>

      <section className="min-h-0 rounded-lg border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-black text-white">Lifecycle totals</h2>
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Stored state</span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
          {lifecycleCounts.map((entry) => (
            <div key={entry.status} className="min-h-[54px] rounded-lg border border-white/10 bg-black/25 p-2">
              <div className="text-xl font-black leading-none text-white">{entry.count}</div>
              <div className="mt-1 line-clamp-2 text-[11px] font-bold leading-4 text-zinc-300">{entry.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-2 lg:grid-cols-3">
        <HealthCard title="Public route health" health={overview.health.publicRoutes} />
        <HealthCard title="ADM Cycle Watch" health={overview.health.admCycleWatch} />
        <HealthCard title="Auto Update Scheduler" health={overview.health.autoUpdateScheduler} />
      </section>
    </div>
  );
}

function ServersPanel({ servers }: { servers: OwnerServer[] }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <PanelHeader eyebrow="Server Management" title="All linked servers" description="Read-only operational inventory with lifecycle, token, ADM, player-count and public visibility state." />
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/30">
        <div className="h-full overflow-auto">
          <table className="min-w-[1500px] w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-950/95 text-xs uppercase tracking-[0.16em] text-zinc-400 backdrop-blur">
              <tr>
                <th className="px-4 py-3">Server</th>
                <th className="px-4 py-3">Owner / Discord Server</th>
                <th className="px-4 py-3">Nitrado</th>
                <th className="px-4 py-3">Lifecycle</th>
                <th className="px-4 py-3">Visibility</th>
                <th className="px-4 py-3">Player Count</th>
                <th className="px-4 py-3">ADM</th>
                <th className="px-4 py-3">Token</th>
                <th className="px-4 py-3">Links</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {servers.map((server) => (
                <tr key={server.id} className="align-top hover:bg-white/[0.025]">
                  <td className="px-4 py-4">
                    <div className="font-black text-white">{server.serverName}</div>
                    <div className="mt-1 text-xs text-zinc-500">{server.slug ?? server.id}</div>
                    <BadgeList badges={server.badges} />
                  </td>
                  <td className="px-4 py-4 text-zinc-300">
                    <div>{server.owner.username ?? "Unknown owner"}</div>
                    <div className="mt-1 text-xs text-zinc-500">{server.owner.discordId ?? "No Discord ID"}</div>
                    <div className="mt-2 text-xs text-zinc-500">{server.guild.name ?? "Unknown Discord server"}</div>
                    <div className="text-xs text-zinc-600">{server.guild.guildId ?? server.guild.discordGuildId ?? "No Discord server id"}</div>
                  </td>
                  <td className="px-4 py-4 text-zinc-300">
                    <div>{server.nitradoServiceId ?? "No service"}</div>
                    <div className="mt-1 text-xs text-zinc-500">{server.nitradoServiceName ?? "No service name"}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-bold text-cyan-100">{server.lifecycleLabel}</div>
                    <div className="mt-1 text-xs leading-5 text-zinc-500">{server.lifecycleReason ?? server.lifecycleMessage}</div>
                    {server.ownerActionRequired ? <div className="mt-2 text-xs font-bold text-amber-200">{server.ownerActionReason ?? "Owner action required"}</div> : null}
                  </td>
                  <td className="px-4 py-4 text-zinc-300">
                    <div>Status: {server.status ?? "unknown"}</div>
                    <div className="mt-1 text-xs text-zinc-500">Listing: {server.listingVisibility ?? "default"}</div>
                    <div className="mt-1 text-xs text-zinc-500">Plan: {server.plan.key ?? "none"} / {server.plan.status ?? "unknown"}</div>
                  </td>
                  <td className="px-4 py-4 text-zinc-300">
                    <div className="font-bold text-white">{server.playerCount.current ?? "unknown"} / {server.playerCount.max ?? "unknown"}</div>
                    <div className="mt-1 text-xs text-zinc-500">Status: {server.playerCount.status ?? "unknown"}</div>
                    <div className="text-xs text-zinc-500">Source: {server.playerCount.source ?? "unknown"}</div>
                  </td>
                  <td className="px-4 py-4 text-zinc-300">
                    <div className="max-w-[260px] truncate">Latest: {server.adm.latestFile ?? "none"}</div>
                    <div className="max-w-[260px] truncate text-xs text-zinc-500">Processed: {server.adm.latestProcessedFile ?? "none"}</div>
                    <div className="text-xs text-zinc-500">Event: {formatDate(server.adm.latestImportedEventAt)}</div>
                  </td>
                  <td className="px-4 py-4">
                    <StatusPill value={server.tokenStatus} />
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-2">
                      {server.publicProfileUrl ? <Link href={server.publicProfileUrl} className="text-xs font-bold text-cyan-200 hover:text-cyan-100">Public profile</Link> : null}
                      <Link href={server.dashboardUrl} className="text-xs font-bold text-violet-200 hover:text-violet-100">Dashboard</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LifecyclePanel({ lifecycleCounts }: { lifecycleCounts: Array<typeof LIFECYCLE_COPY[number] & { count: number }> }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto lg:overflow-hidden">
      <PanelHeader eyebrow="Lifecycle / Resource State" title="Read-only lifecycle policy map" description="Phase 1 displays the state model and current counts. Lifecycle changes are disabled until Phase 2." />
      <div className="grid min-h-0 gap-2 md:grid-cols-2 xl:grid-cols-4">
        {lifecycleCounts.map((entry) => (
          <section key={entry.status} className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-black leading-5 text-white">{entry.label}</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{entry.description}</p>
              </div>
              <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1.5 text-base font-black text-cyan-100">{entry.count}</div>
            </div>
            <p className="mt-2 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{entry.status}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

function ResourceControlPanel({ servers }: { servers: OwnerServer[] }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <PanelHeader eyebrow="Resource Control" title="Scheduled work eligibility" description="This read-only view shows which servers should consume worker/API/D1 resources and why others are skipped." />
      <div className="grid min-h-0 flex-1 gap-2 overflow-auto pr-1">
        {servers.map((server) => (
          <section key={server.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-start">
              <div>
                <h2 className="text-lg font-black text-white">{server.serverName}</h2>
                <p className="mt-1 text-sm text-zinc-400">{server.lifecycleLabel}</p>
                <p className="mt-1 text-xs text-zinc-500">Skip reason: {server.resource.skippedReason ?? server.lastSkipReason ?? "none"}</p>
              </div>
              <StatusCard
                title="Scheduled resources"
                value={server.resource.consumingScheduledResources ? "Consuming" : "Excluded"}
                tone={server.resource.consumingScheduledResources ? "warn" : "good"}
              />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              <BooleanTile label="ADM sync" enabled={server.resource.admSyncEnabled} />
              <BooleanTile label="Metadata refresh" enabled={server.resource.metadataRefreshEnabled} />
              <BooleanTile label="Player-count polling" enabled={server.resource.playerCountPollingEnabled} />
              <BooleanTile label="Discord posting" enabled={server.resource.discordPostingEnabled} />
              <BooleanTile label="Server Wars eligibility" enabled={server.resource.serverWarsEligible} />
            </div>
            <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-2 xl:grid-cols-4">
              <div>Next retry: {formatDate(server.nextRetryAfter)}</div>
              <div>Public listing: {server.listingVisibility ?? "default"}</div>
              <div>Token status: {server.tokenStatus}</div>
              <div>Sync status: {server.syncResourceStatus}</div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function DiscordControlPanel({ data }: { data: DiscordControlData }) {
  const [channels, setChannels] = useState<DiscordChannelSlot[]>(data.channels);
  const [auditLog, setAuditLog] = useState<AuditLogItem[]>(data.auditLog);
  const [selectedType, setSelectedType] = useState<DiscordPreviewType>(data.options.postTypes[0]?.type ?? data.templates[0]?.type ?? "weekly_recap");
  const [selectedServer, setSelectedServer] = useState(data.options.linkedServers[0]?.value ?? "network");
  const [selectedSlot, setSelectedSlot] = useState(data.options.postTypes[0]?.suggestedSlot ?? data.channels[0]?.slot ?? "announcements");
  const [preview, setPreview] = useState<DiscordPreviewEmbed | null>(data.templates[0]?.preview ?? null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "error">("idle");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [inFlightAction, setInFlightAction] = useState<string | null>(null);
  const [destinationModal, setDestinationModal] = useState<DiscordDestinationModal>(null);
  const [mappingForms, setMappingForms] = useState<Record<string, DestinationMappingForm>>(() => Object.fromEntries(data.channels.map((channel) => [
    channel.slot,
    {
      guildId: channel.guildId ?? "",
      guildName: channel.guildName ?? "",
      channelId: channel.channelId ?? "",
      channelName: channel.channelName ?? "",
      confirmation: "",
    },
  ])));

  const postTypeOptions = data.options.postTypes.length > 0
    ? data.options.postTypes
    : data.templates.map((template) => ({ type: template.type, label: template.label, description: template.description, networkWide: false, suggestedSlot: "announcements" }));
  const linkedServerOptions = data.options.linkedServers.length > 0
    ? data.options.linkedServers
    : [{ value: "network", label: "All Network / Network-wide", slug: null, lifecycleStatus: null, lifecycleLabel: "Network-wide", status: null, role: "network" as const }];
  const selectedTemplate = data.templates.find((template) => template.type === selectedType) ?? data.templates[0] ?? null;
  const selectedPostType = postTypeOptions.find((option) => option.type === selectedType) ?? postTypeOptions[0] ?? null;
  const selectedServerOption = linkedServerOptions.find((server) => server.value === selectedServer) ?? linkedServerOptions[0] ?? null;
  const selectedDestination = channels.find((channel) => channel.slot === selectedSlot) ?? channels[0] ?? null;
  const selectedDestinationConfigured = selectedDestination ? isDiscordDestinationConfigured(selectedDestination) : false;
  const selectedDestinationPermissionOk = selectedDestination?.lastPermissionStatus === "ok";
  const modalChannel = destinationModal ? channels.find((channel) => channel.slot === destinationModal.slot) ?? null : null;
  const modalForm = modalChannel
    ? mappingForms[modalChannel.slot] ?? { guildId: "", guildName: "", channelId: "", channelName: "", confirmation: "" }
    : null;

  useEffect(() => {
    if (!destinationModal) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDestinationModal(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [destinationModal]);

  async function refreshDiscordState() {
    const [mappingsResponse, auditResponse] = await Promise.all([
      fetch("/api/owner/discord/channel-mappings", { cache: "no-store" }),
      fetch("/api/owner/discord/audit-log", { cache: "no-store" }),
    ]);
    if (mappingsResponse.ok) {
      const json = await mappingsResponse.json();
      const nextChannels = json.mappings ?? [];
      setChannels(nextChannels);
      setMappingForms((current) => ({
        ...current,
        ...Object.fromEntries(nextChannels.map((channel: DiscordChannelSlot) => [
          channel.slot,
          {
            guildId: channel.guildId ?? "",
            guildName: channel.guildName ?? "",
            channelId: channel.channelId ?? "",
            channelName: channel.channelName ?? "",
            confirmation: current[channel.slot]?.confirmation ?? "",
          },
        ])),
      }));
    }
    if (auditResponse.ok) {
      const json = await auditResponse.json();
      setAuditLog(json.auditLog ?? []);
    }
  }

  function updateMappingForm(slot: string, key: keyof DestinationMappingForm, value: string) {
    setMappingForms((current) => ({
      ...current,
      [slot]: {
        guildId: current[slot]?.guildId ?? "",
        guildName: current[slot]?.guildName ?? "",
        channelId: current[slot]?.channelId ?? "",
        channelName: current[slot]?.channelName ?? "",
        confirmation: current[slot]?.confirmation ?? "",
        [key]: value,
      },
    }));
  }

  async function runDiscordAction(actionKey: string, action: () => Promise<string>) {
    setInFlightAction(actionKey);
    setActionStatus(null);
    try {
      const message = await action();
      setActionStatus(message);
      await refreshDiscordState();
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "Discord owner action failed.");
    } finally {
      setInFlightAction(null);
    }
  }

  async function postJson(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.error ?? `Request failed with HTTP ${response.status}.`);
    return json;
  }

  async function generatePreview(type: DiscordPreviewType) {
    setSelectedType(type);
    setPreviewStatus("loading");
    const fallbackTemplate = data.templates.find((template) => template.type === type) ?? selectedTemplate;
    try {
      const response = await fetch("/api/owner/discord/preview-embed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, serverId: selectedServer, destinationSlot: selectedSlot }),
      });
      if (!response.ok) throw new Error("preview_failed");
      const json = await response.json();
      setPreview(json.preview ?? fallbackTemplate?.preview ?? null);
      setPreviewStatus("idle");
    } catch {
      setPreview(fallbackTemplate?.preview ?? preview);
      setPreviewStatus("error");
    }
  }

  const futureActions = [
    "Enable post type",
    "Disable post type",
    "Send weekly recap now",
    "Post announcement",
    "Connect Discord server",
    "Recheck bot permissions",
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <PanelHeader eyebrow="Discord Control" title="DZN Discord command centre" description="Owner-only Discord setup actions. Auto-posting remains disabled; only a confirmed manual test embed can send." />
      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-[360px_minmax(0,1fr)_420px]">
        <div className="grid min-h-0 gap-3 overflow-auto pr-1">
          <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <h2 className="text-lg font-black text-white">Discord Overview</h2>
            <div className="mt-3 grid gap-2">
              <StatusCard title="Integration status" value={ownerDiscordStatusLabel(data.overview.integrationStatus)} tone={data.overview.botConfigured ? "good" : "warn"} />
              <StatusCard title="Bot token present" value={data.overview.botTokenPresent ? "Yes" : "No"} tone={data.overview.botTokenPresent ? "good" : "warn"} />
              <StatusCard title="DZN_DISCORD_NOTIFICATIONS_ENABLED" value={data.overview.discordNotificationsEnabled ? "true" : "false"} tone={data.overview.discordNotificationsEnabled ? "warn" : "good"} />
              <StatusCard title="Posting mode" value={postingModeLabel(data.overview.postingMode)} tone="good" />
            </div>
            <dl className="mt-3 grid gap-2 text-xs text-zinc-400">
              <div className="flex justify-between gap-3 rounded border border-white/10 bg-black/25 px-3 py-2"><dt>Connected Discord servers</dt><dd>{data.overview.connectedGuildCount ?? "unknown"}</dd></div>
              <div className="flex justify-between gap-3 rounded border border-white/10 bg-black/25 px-3 py-2"><dt>Configured channels</dt><dd>{data.overview.configuredChannelCount ?? "unknown"}</dd></div>
              <div className="rounded border border-white/10 bg-black/25 px-3 py-2">
                <dt className="font-bold text-zinc-300">Last stored post attempt</dt>
                <dd className="mt-1 text-zinc-500">
                  {data.overview.lastPostAttempt
                    ? `${data.overview.lastPostAttempt.postType ?? "unknown"} / ${data.overview.lastPostAttempt.status ?? "stored"} / ${formatDate(data.overview.lastPostAttempt.attemptedAt)}`
                    : "No stored attempt found"}
                </dd>
                {data.overview.lastPostAttempt?.error ? <dd className="mt-1 text-amber-200">{data.overview.lastPostAttempt.error}</dd> : null}
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.04] p-3">
            <h2 className="text-lg font-black text-white">Discord Safety / Guards</h2>
            <div className="mt-3 grid gap-2">
              <BooleanTile label="Production Discord posting" enabled={false} />
              <BooleanTile label="Manual test send only" enabled />
              <BooleanTile label="Secrets displayed" enabled={false} />
              <BooleanTile label="Owner-only access" enabled />
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-400">
              Auto posting stays off. DZN_DISCORD_NOTIFICATIONS_ENABLED=false. Preview does not send unless Send Test Embed is confirmed. This console never returns bot tokens, client secrets, webhook URLs, Nitrado tokens, Cloudflare secrets or runtime encryption keys.
            </p>
            {actionStatus ? <p className="mt-3 rounded border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-100">{actionStatus}</p> : null}
          </section>

          <DiscordAnnouncementSystemPanel health={data.overview.serverAnnouncements} />

          <section className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.04] p-3">
            <h2 className="text-lg font-black text-white">What is a Discord Server ID?</h2>
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              Discord Server ID is the unique ID for your Discord server. DZN keeps raw IDs in advanced details and uses readable Discord Server labels everywhere else.
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">Channel ID is the unique ID for a Discord channel like #announcements.</p>
          </section>

          <section className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-3">
            <h2 className="text-lg font-black text-white">Future Phase 2 Actions</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {futureActions.map((action) => (
                <button key={action} type="button" disabled className="cursor-not-allowed rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs font-bold text-zinc-500">
                  <span className="block text-[10px] uppercase tracking-[0.16em] text-amber-200">Phase 2</span>
                  {action}
                  <span className="mt-1 block text-[11px] text-zinc-600">Coming soon - read-only for now</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="grid min-h-0 gap-3 overflow-hidden">
          <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-white">Post Preview Builder</h2>
                <p className="mt-1 text-xs text-zinc-400">Choose what to post, which DZN server it is about and where it should post.</p>
              </div>
              <span className="rounded border border-amber-300/20 bg-amber-300/[0.06] px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-100">
                Preview only - not sent
              </span>
            </div>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                What do you want to post?
                <select
                  value={selectedType}
                  onChange={(event) => {
                    const nextType = event.target.value as DiscordPreviewType;
                    const nextOption = postTypeOptions.find((option) => option.type === nextType);
                    setSelectedType(nextType);
                    if (nextOption?.suggestedSlot) setSelectedSlot(nextOption.suggestedSlot);
                  }}
                  className="rounded border border-white/10 bg-black/40 px-2 py-2 text-xs font-semibold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40"
                >
                  {postTypeOptions.map((option) => <option key={option.type} value={option.type}>{option.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                Which DZN server is this about?
                <select
                  value={selectedServer}
                  onChange={(event) => setSelectedServer(event.target.value)}
                  className="rounded border border-white/10 bg-black/40 px-2 py-2 text-xs font-semibold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40"
                >
                  {linkedServerOptions.map((server) => <option key={server.value} value={server.value}>{server.label} - {server.lifecycleLabel}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                Where should this post?
                <select
                  value={selectedSlot}
                  onChange={(event) => setSelectedSlot(event.target.value)}
                  className="rounded border border-white/10 bg-black/40 px-2 py-2 text-xs font-semibold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40"
                >
                  {channels.map((channel) => (
                    <option key={channel.slot} value={channel.slot}>
                      {discordDestinationOptionLabel(channel)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 grid gap-2 rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-400 md:grid-cols-3">
              <div>
                <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Post type group</span>
                <span className="mt-1 block text-white">{selectedPostType?.label ?? "Unknown post type"}</span>
              </div>
              <div>
                <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">DZN server</span>
                <span className="mt-1 block text-white">{selectedServerOption?.label ?? "All Network / Network-wide"}</span>
                <span className="text-zinc-500">{selectedServerOption?.lifecycleLabel ?? "Network-wide"}</span>
              </div>
              <div>
                <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Destination</span>
                <span className="mt-1 block text-white">{selectedDestination ? discordChannelLabel(selectedDestination) : "Not configured yet"}</span>
                <span className={selectedDestinationConfigured ? "block text-emerald-200" : "block text-amber-200"}>
                  {selectedDestinationConfigured ? "Destination configured" : "Destination not configured"}
                </span>
                <span className={selectedDestinationPermissionOk ? "text-emerald-200" : "text-amber-200"}>
                  {selectedDestinationPermissionOk ? "Permission check passed" : "Permission check required"}
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={previewStatus === "loading"}
                onClick={() => void generatePreview(selectedType)}
                className="rounded border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {previewStatus === "loading" ? "Previewing..." : "Preview Embed"}
              </button>
              <button
                type="button"
                disabled={!selectedDestination}
                onClick={() => selectedDestination ? setDestinationModal({ kind: "test", slot: selectedDestination.slot }) : null}
                className="rounded border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send Test Embed
              </button>
            </div>
            {previewStatus === "loading" ? <p className="mt-3 text-xs font-bold text-cyan-100">Generating preview...</p> : null}
            {previewStatus === "error" ? <p className="mt-3 text-xs font-bold text-amber-200">Preview API failed. Showing stored template preview.</p> : null}
          </section>

          <section className="min-h-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <h2 className="text-lg font-black text-white">Auto post types</h2>
            <p className="mt-1 text-xs text-zinc-400">Every type remains disabled for automatic production sending. Use the dropdown above to preview one at a time.</p>
            <div className="mt-3 flex flex-wrap gap-1.5 overflow-auto">
              {data.postTypes.map((postType) => (
                <span key={postType.key} className="rounded border border-white/10 bg-black/25 px-2 py-1 text-[11px] font-bold text-zinc-300">
                  {postType.label}
                </span>
              ))}
            </div>
          </section>
        </div>

        <div className="grid min-h-0 gap-3 overflow-auto pr-1">
          <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-white">Live embed preview</h2>
                <p className="mt-1 text-xs text-zinc-400">Discord-style preview for the selected post. Nothing is sent to Discord.</p>
              </div>
              <span className="rounded border border-amber-300/20 bg-amber-300/[0.06] px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-100">
                Preview only - not sent
              </span>
            </div>
            <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-400">
              <div className="font-black text-white">{selectedPostType?.label ?? "Selected post"}</div>
              <div className="mt-1">{selectedPostType?.description ?? "Owner-selected Discord preview."}</div>
              <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                <div>Discord Server: {selectedDestination?.guildName || "Not configured yet"}</div>
                <div>Discord Channel: {selectedDestination ? discordChannelLabel(selectedDestination) : "Not configured yet"}</div>
                <div>DZN server: {selectedServerOption?.label ?? "All Network / Network-wide"}</div>
              </div>
            </div>
            <DiscordEmbedPreview preview={preview ?? selectedTemplate?.preview ?? null} />
          </section>

          <section className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <h2 className="text-lg font-black text-white">Post destinations</h2>
            <p className="mt-1 text-xs text-zinc-400">Post destination setup. Actions open as focused popouts so the console stays in place.</p>
            <div className="mt-3 hidden grid-cols-[minmax(8rem,1.1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(6rem,0.7fr)_minmax(6rem,0.7fr)_minmax(8rem,0.8fr)] gap-3 rounded border border-white/10 bg-black/30 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500 2xl:grid">
              <span>Destination</span>
              <span>Discord Server</span>
              <span>Discord Channel</span>
              <span>Status</span>
              <span>Permission</span>
              <span>Actions</span>
            </div>
            <div className="mt-3 grid max-h-[44vh] gap-2 overflow-y-auto overflow-x-hidden pr-1">
              {channels.map((channel) => {
                const permissionPassed = channel.lastPermissionStatus === "ok";
                const configured = isDiscordDestinationConfigured(channel);
                const permissionLabel = permissionPassed ? "Passed" : channel.lastPermissionStatus ?? "Not checked";
                return (
                <article key={channel.slot} className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="grid gap-3 2xl:grid-cols-[minmax(8rem,1.1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(6rem,0.7fr)_minmax(6rem,0.7fr)_minmax(8rem,0.8fr)] 2xl:items-start">
                    <div className="min-w-0">
                      <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 2xl:hidden">Destination</span>
                      <h3 className="mt-1 truncate text-sm font-black text-white" title={channel.label}>{channel.label}</h3>
                      <p className="mt-1 text-[11px] leading-4 text-zinc-500">Post type group: {summarizePostTypes(channel.mappedPostTypes)}</p>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 2xl:hidden">Discord Server</span>
                      <p className="mt-1 truncate text-xs font-bold text-zinc-200" title={channel.guildName || undefined}>{channel.guildName || (configured ? "Configured" : "Not configured yet")}</p>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 2xl:hidden">Discord Channel</span>
                      <p className="mt-1 truncate text-xs font-bold text-zinc-200" title={discordChannelLabel(channel)}>{discordChannelLabel(channel)}</p>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 2xl:hidden">Status</span>
                      <span className="mt-1 inline-flex max-w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-300">
                        <span className="truncate">{channelStatusLabel(channel.status)}</span>
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 2xl:hidden">Permission</span>
                      <p className={`mt-1 truncate text-xs font-black ${permissionPassed ? "text-emerald-200" : "text-amber-200"}`} title={permissionLabel}>{permissionLabel}</p>
                    </div>
                    <div className="grid min-w-0 gap-1.5 sm:grid-cols-2 2xl:grid-cols-1">
                      <button type="button" onClick={() => setDestinationModal({ kind: "configure", slot: channel.slot })} className="w-full whitespace-nowrap rounded border border-cyan-300/30 bg-cyan-300/10 px-2 py-1.5 text-center text-[11px] font-black text-cyan-100">Configure</button>
                      <button
                        type="button"
                        disabled={inFlightAction !== null || !configured}
                        onClick={() => void runDiscordAction(`check-${channel.slot}`, async () => {
                          setDestinationModal({ kind: "permissions", slot: channel.slot });
                          await postJson(`/api/owner/discord/channel-mappings/${channel.slot}/permission-check`, { reason: "Owner console permission check" });
                          return `${channel.label} permission check completed.`;
                        })}
                        className="w-full whitespace-nowrap rounded border border-emerald-300/30 bg-emerald-300/10 px-2 py-1.5 text-center text-[11px] font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {inFlightAction === `check-${channel.slot}` ? "Checking..." : "Check permissions"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDestinationModal({ kind: "test", slot: channel.slot })}
                        className="w-full whitespace-nowrap rounded border border-amber-300/30 bg-amber-300/10 px-2 py-1.5 text-center text-[11px] font-black text-amber-100"
                      >
                        Send test embed
                      </button>
                      <button
                        type="button"
                        disabled={inFlightAction !== null || !configured}
                        onClick={() => void runDiscordAction(`disable-${channel.slot}`, async () => {
                          await postJson(`/api/owner/discord/channel-mappings/${channel.slot}/disable`, { reason: "Owner console mapping disable" });
                          return `${channel.label} mapping disabled.`;
                        })}
                        className="w-full whitespace-nowrap rounded border border-red-300/30 bg-red-300/10 px-2 py-1.5 text-center text-[11px] font-black text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Disable
                      </button>
                    </div>
                  </div>
                  {configured ? (
                    <p className="mt-2 text-[10px] leading-4 text-zinc-600">
                      Advanced details: Discord Server ID <span className="break-all">{channel.guildId}</span> / Discord Channel ID <span className="break-all">{channel.channelId}</span>
                    </p>
                  ) : null}
                </article>
              );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <h2 className="text-lg font-black text-white">Discord Audit Log</h2>
            <p className="mt-1 text-xs text-zinc-400">Owner Discord setup actions are stored with safe metadata only.</p>
            <div className="mt-3 grid max-h-72 gap-2 overflow-auto pr-1">
              {auditLog.length === 0 ? <p className="text-xs text-zinc-500">No Discord owner actions recorded yet.</p> : null}
              {auditLog.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-400">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-black text-white">{entry.action}</div>
                    <span className={entry.result === "success" ? "text-emerald-200" : "text-amber-200"}>{entry.result}</span>
                  </div>
                  <div className="mt-1 text-zinc-500">{entry.targetSlot ?? "general"} / {entry.channelId ? `Channel ID ${entry.channelId}` : "no channel"} / {formatDate(entry.createdAt)}</div>
                  {entry.reason ? <div className="mt-1 text-zinc-500">{entry.reason}</div> : null}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      {destinationModal && modalChannel && modalForm ? (
        <DiscordDestinationModalPanel
          modal={destinationModal}
          channel={modalChannel}
          form={modalForm}
          selectedType={selectedType}
          preview={preview ?? selectedTemplate?.preview ?? null}
          inFlightAction={inFlightAction}
          actionStatus={actionStatus}
          updateMappingForm={updateMappingForm}
          runDiscordAction={runDiscordAction}
          postJson={postJson}
          onClose={() => setDestinationModal(null)}
        />
      ) : null}
    </div>
  );
}

function DiscordDestinationModalPanel({
  modal,
  channel,
  form,
  selectedType,
  preview,
  inFlightAction,
  actionStatus,
  updateMappingForm,
  runDiscordAction,
  postJson,
  onClose,
}: {
  modal: NonNullable<DiscordDestinationModal>;
  channel: DiscordChannelSlot;
  form: DestinationMappingForm;
  selectedType: DiscordPreviewType;
  preview: DiscordPreviewEmbed | null;
  inFlightAction: string | null;
  actionStatus: string | null;
  updateMappingForm: (slot: string, key: keyof DestinationMappingForm, value: string) => void;
  runDiscordAction: (actionKey: string, action: () => Promise<string>) => Promise<void>;
  postJson: (path: string, body: unknown) => Promise<unknown>;
  onClose: () => void;
}) {
  const configured = isDiscordDestinationConfigured(channel);
  const permissionPassed = channel.lastPermissionStatus === "ok";
  const permissionCheck = channel.permissionCheck ?? null;
  const checkingPermissions = inFlightAction === `check-${channel.slot}`;
  const savingDestination = inFlightAction === `save-${channel.slot}`;
  const sendingTest = inFlightAction === `test-${channel.slot}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-x-hidden bg-black/75 p-3 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="discord-destination-modal-title">
      <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#050814] shadow-[0_24px_100px_rgba(0,0,0,0.65)]">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Post destination</p>
            <h2 id="discord-destination-modal-title" className="mt-1 truncate text-lg font-black text-white">
              {destinationModalTitle(modal.kind, channel.label)}
            </h2>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              {modal.kind === "configure"
                ? "Discord calls a server a guild internally. Paste your Discord Server ID and the channel ID you want DZN to post to."
                : modal.kind === "permissions"
                  ? "Permission checks show whether the bot can safely post to this Discord Channel."
                  : "This sends one manual owner-triggered test embed only. Auto posting stays disabled."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200 hover:border-white/20 hover:bg-white/[0.08]" aria-label="Close Discord destination modal">
            X
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4">
          <div className="grid gap-3 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-zinc-400 sm:grid-cols-3">
            <div className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Destination</span>
              <span className="mt-1 block truncate font-black text-white">{channel.label}</span>
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Discord Server</span>
              <span className="mt-1 block truncate font-bold text-zinc-200">{channel.guildName || (configured ? "Configured" : "Not configured")}</span>
            </div>
            <div className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Discord Channel</span>
              <span className="mt-1 block truncate font-bold text-zinc-200">{discordChannelLabel(channel)}</span>
            </div>
          </div>

          {modal.kind === "configure" ? (
            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid min-w-0 gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                  Discord Server ID
                  <input value={form.guildId} onChange={(event) => updateMappingForm(channel.slot, "guildId", event.target.value)} placeholder="123456789012345678" className="min-w-0 rounded border border-white/10 bg-black/40 px-2 py-2 text-xs font-semibold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                </label>
                <label className="grid min-w-0 gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                  Discord Channel ID
                  <input value={form.channelId} onChange={(event) => updateMappingForm(channel.slot, "channelId", event.target.value)} placeholder="123456789012345678" className="min-w-0 rounded border border-white/10 bg-black/40 px-2 py-2 text-xs font-semibold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                </label>
                <label className="grid min-w-0 gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                  Discord Server Name
                  <input value={form.guildName} onChange={(event) => updateMappingForm(channel.slot, "guildName", event.target.value)} placeholder="DZN Network" className="min-w-0 rounded border border-white/10 bg-black/40 px-2 py-2 text-xs font-semibold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                </label>
                <label className="grid min-w-0 gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                  Friendly channel name
                  <input value={form.channelName} onChange={(event) => updateMappingForm(channel.slot, "channelName", event.target.value)} placeholder="announcements" className="min-w-0 rounded border border-white/10 bg-black/40 px-2 py-2 text-xs font-semibold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                </label>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-zinc-300">
                <input type="checkbox" checked readOnly className="accent-cyan-300" />
                Enable destination when saved
              </label>
              {configured ? (
                <p className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] leading-5 text-zinc-500">
                  Advanced details: Discord Server ID <span className="break-all text-zinc-400">{channel.guildId}</span> / Discord Channel ID <span className="break-all text-zinc-400">{channel.channelId}</span>
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={onClose} className="rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200">Cancel</button>
                <button
                  type="button"
                  disabled={inFlightAction !== null}
                  onClick={() => void runDiscordAction(`save-${channel.slot}`, async () => {
                    await postJson("/api/owner/discord/channel-mappings", {
                      slot: channel.slot,
                      guildId: form.guildId,
                      guildName: form.guildName,
                      channelId: form.channelId,
                      channelName: form.channelName,
                      reason: "Owner console post destination save",
                    });
                    return `${channel.label} destination saved.`;
                  })}
                  className="rounded border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDestination ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : null}

          {modal.kind === "permissions" ? (
            <div className="mt-4 grid gap-3">
              {checkingPermissions ? <p className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100">Checking Discord permissions...</p> : null}
              <div className="grid gap-2">
                <PermissionCheckRow label="View channel" value={permissionCheck?.canViewChannel} />
                <PermissionCheckRow label="Send messages" value={permissionCheck?.canSendMessages} />
                <PermissionCheckRow label="Embed links" value={permissionCheck?.canEmbedLinks} />
                <PermissionCheckRow label="Attach files" value={permissionCheck?.canAttachFiles} />
                <PermissionCheckRow label="Read message history" value={permissionCheck?.canReadMessageHistory} />
              </div>
              <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs leading-5 text-zinc-400">
                <div>Status: <span className={permissionPassed ? "font-black text-emerald-200" : "font-black text-amber-200"}>{permissionCheck?.status ?? channel.lastPermissionStatus ?? "Not checked"}</span></div>
                <div>Last checked: {permissionCheck?.checkedAt ? formatDate(permissionCheck.checkedAt) : channel.lastPermissionCheckedAt ? formatDate(channel.lastPermissionCheckedAt) : "not checked"}</div>
                {permissionCheck?.warning || channel.lastPermissionError ? <div className="text-amber-200">{permissionCheck?.warning ?? channel.lastPermissionError}</div> : null}
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={onClose} className="rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200">Close</button>
              </div>
            </div>
          ) : null}

          {modal.kind === "test" ? (
            <div className="mt-4 grid gap-3">
              <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-xs leading-5 text-amber-100">
                This sends one manual owner-triggered test embed only. Auto posting stays disabled and DZN_DISCORD_NOTIFICATIONS_ENABLED remains false.
              </div>
              {preview ? <DiscordEmbedPreview preview={preview} /> : <p className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs text-zinc-400">No embed preview is currently selected.</p>}
              <label className="grid gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-100">
                Type SEND_TEST_EMBED
                <input value={form.confirmation} onChange={(event) => updateMappingForm(channel.slot, "confirmation", event.target.value)} placeholder="SEND_TEST_EMBED" className="rounded border border-white/10 bg-black/40 px-2 py-2 text-xs font-semibold normal-case tracking-normal text-white outline-none focus:border-amber-300/40" />
              </label>
              <div className="grid gap-2 text-[11px] leading-4 text-zinc-500 sm:grid-cols-3">
                <div className={configured ? "text-emerald-200" : "text-amber-200"}>{configured ? "Destination configured" : "Configure destination first"}</div>
                <div className={permissionPassed ? "text-emerald-200" : "text-amber-200"}>{permissionPassed ? "Permission check passed" : "Run permission check first"}</div>
                <div className={form.confirmation === "SEND_TEST_EMBED" ? "text-emerald-200" : "text-amber-200"}>{form.confirmation === "SEND_TEST_EMBED" ? "Confirmation accepted" : "Confirmation required"}</div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={onClose} className="rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200">Cancel</button>
                <button
                  type="button"
                  disabled={inFlightAction !== null || !configured || !permissionPassed || form.confirmation !== "SEND_TEST_EMBED"}
                  onClick={() => void runDiscordAction(`test-${channel.slot}`, async () => {
                    const result = await postJson("/api/owner/discord/test-embed", {
                      slot: channel.slot,
                      type: selectedType,
                      confirmation: form.confirmation,
                      reason: "Owner-triggered Discord Phase 2A test embed",
                    }) as { sent?: boolean };
                    return result.sent ? `${channel.label} test embed sent manually.` : `${channel.label} test embed preview generated.`;
                  })}
                  className="rounded border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingTest ? "Sending..." : "Send test embed"}
                </button>
              </div>
            </div>
          ) : null}

          {actionStatus ? <p className="mt-4 rounded border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-100">{actionStatus}</p> : null}
        </div>
      </div>
    </div>
  );
}

function PermissionCheckRow({ label, value }: { label: string; value: boolean | null | undefined }) {
  const state = value === true ? "pass" : value === false ? "fail" : "not_checked";
  const labelClass = state === "pass" ? "text-emerald-200" : state === "fail" ? "text-red-200" : "text-zinc-400";
  const display = state === "pass" ? "Pass" : state === "fail" ? "Fail" : "Not checked";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs">
      <span className="font-bold text-zinc-300">{label}</span>
      <span className={`font-black uppercase tracking-[0.12em] ${labelClass}`}>{display}</span>
    </div>
  );
}

function destinationModalTitle(kind: NonNullable<DiscordDestinationModal>["kind"], label: string) {
  if (kind === "configure") return `Configure ${label} destination`;
  if (kind === "permissions") return `Check ${label} permissions`;
  return `Send ${label} test embed`;
}

function DiscordEmbedPreview({ preview }: { preview: DiscordPreviewEmbed | null }) {
  if (!preview) return null;
  return (
    <div className="mt-4 rounded-xl border border-[#2b2d31] bg-[#313338] p-3 text-[#dbdee1] shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
      <div className="rounded-lg border-l-4 bg-[#2b2d31] p-3" style={{ borderLeftColor: preview.colorHex }}>
        {preview.bannerUrl ? <div className="mb-3 aspect-video rounded bg-black/30" /> : null}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black text-white">{preview.title}</h3>
            <p className="mt-2 text-xs leading-5 text-[#b5bac1]">{preview.description}</p>
          </div>
          <div className="h-10 w-10 shrink-0 rounded-full border border-white/10 bg-cyan-300/10" aria-hidden />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {preview.fields.map((field) => (
            <div key={`${field.name}-${field.value}`} className={field.inline ? "" : "sm:col-span-2"}>
              <div className="text-xs font-black text-white">{field.name}</div>
              <div className="mt-1 text-xs leading-5 text-[#b5bac1]">{field.value}</div>
            </div>
          ))}
        </div>
        {preview.cta ? (
          <div className="mt-3 inline-flex rounded bg-[#5865f2] px-3 py-2 text-xs font-black text-white">
            {preview.cta.label}
          </div>
        ) : null}
        <div className="mt-3 text-[11px] text-[#949ba4]">{preview.footer} - {formatDate(preview.timestamp)}</div>
      </div>
    </div>
  );
}

function AuditLogPanel({ auditLog }: { auditLog: AuditLog | null }) {
  const actions = ["mark legacy_offline", "archive_hidden", "run final sync", "pause sync", "reactivate sync", "hide from public listing", "show as legacy profile"];
  const items = auditLog?.items ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto lg:overflow-hidden">
      <PanelHeader eyebrow="Audit Log" title="Owner action history" description="Discord Phase 2A setup actions are audited. Lifecycle/resource controls remain read-only." />
      <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] p-4">
        <p className="text-lg font-black text-white">{auditLog?.message ?? "No owner actions recorded yet."}</p>
        <p className="mt-2 text-sm text-zinc-400">Audit rows use safe metadata only. Tokens, secrets, webhook URLs and encrypted blobs are never shown.</p>
        <div className="mt-4 grid max-h-[45vh] gap-2 overflow-auto pr-1">
          {items.length === 0 ? <p className="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">No owner actions recorded yet.</p> : null}
          {items.map((item) => (
            <article key={item.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-black text-white">{item.action}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{item.targetSlot ?? item.targetType ?? "general"} / {item.channelId ?? "no channel"}</p>
                </div>
                <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                  item.result === "success" ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100" : "border-amber-300/20 bg-amber-300/[0.06] text-amber-100"
                }`}>
                  {item.result}
                </span>
              </div>
              <div className="mt-2 grid gap-1 text-xs text-zinc-500 sm:grid-cols-2">
                <div>Actor: {item.actorDiscordId ?? "unknown"}</div>
                <div>Created: {formatDate(item.createdAt)}</div>
                <div>Discord Server ID: {item.guildId ?? "none"}</div>
                <div>Request: {item.requestId ?? "none"}</div>
              </div>
              {item.reason ? <p className="mt-2 text-xs text-zinc-400">{item.reason}</p> : null}
            </article>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-4">
        <h2 className="text-lg font-black text-white">Phase 2 actions</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {actions.map((action) => (
            <button key={action} type="button" disabled className="cursor-not-allowed rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm font-bold text-zinc-500">
              <span className="block text-xs uppercase tracking-[0.16em] text-amber-200">Phase 2</span>
              {action}
              <span className="mt-1 block text-xs text-zinc-600">Coming soon - read-only for now</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsPanel({ overview }: { overview: OwnerOverview }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto lg:overflow-hidden">
      <PanelHeader eyebrow="Settings / Access" title="Owner access guard" description="Access is based only on Discord user IDs in a secure runtime allowlist." />
      <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <StatusCard title="DZN_PLATFORM_OWNER_DISCORD_IDS" value={overview.ownerAccess.allowlistConfigured ? "Configured" : "Not configured"} tone={overview.ownerAccess.allowlistConfigured ? "good" : "warn"} />
          <StatusCard title="Authentication basis" value="Discord ID allowlist" tone="good" />
        </div>
        <p className="mt-5 text-sm leading-6 text-zinc-400">
          The allowlist values are never returned to this page. Display names, usernames, emails and Discord server nicknames are not used for platform-owner access.
        </p>
      </section>
    </div>
  );
}

function DiscordAnnouncementSystemPanel({ health }: { health: DiscordAnnouncementHealth | null }) {
  return (
    <section className="rounded-lg border border-violet-300/20 bg-violet-300/[0.04] p-3">
      <h2 className="text-lg font-black text-white">Discord Announcement System</h2>
      <p className="mt-1 text-xs leading-5 text-zinc-400">Read-only health for server listing announcements. Live posting stays disabled until the dedicated feature flag is turned on.</p>
      <div className="mt-3 grid gap-2">
        <BooleanTile label="Feature enabled" enabled={Boolean(health?.featureEnabled)} />
        <BooleanTile label="Advert channel configured" enabled={Boolean(health?.advertChannelConfigured)} />
        <BooleanTile label="Showcase channel configured" enabled={Boolean(health?.showcaseChannelConfigured)} />
        <BooleanTile label="Bot token configured" enabled={Boolean(health?.botTokenConfigured)} />
      </div>
      <dl className="mt-3 grid gap-2 text-xs text-zinc-400">
        <DiscordAnnouncementSummaryRow label="Last server announcement" summary={health?.lastServerAnnouncement ?? null} />
        <DiscordAnnouncementSummaryRow label="Last bump post" summary={health?.lastBumpPost ?? null} />
        <DiscordAnnouncementSummaryRow label="Last weekly spotlight" summary={health?.lastWeeklySpotlight ?? null} />
      </dl>
      <div className="mt-3 rounded border border-white/10 bg-black/25 px-3 py-2">
        <div className="text-xs font-bold text-zinc-300">Recent failures</div>
        {health?.recentFailures?.length ? (
          <ul className="mt-2 grid gap-1 text-[11px] text-amber-100">
            {health.recentFailures.slice(0, 3).map((failure) => (
              <li key={failure.id} className="min-w-0 truncate">
                {discordAnnouncementEventLabel(failure.eventType)} - {failure.failureReason ?? failure.status} - {formatDate(failure.updatedAt)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-zinc-500">No recent failures.</p>
        )}
      </div>
    </section>
  );
}

function DiscordAnnouncementSummaryRow({ label, summary }: { label: string; summary: DiscordAnnouncementSummary | null }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 px-3 py-2">
      <dt className="font-bold text-zinc-300">{label}</dt>
      <dd className="mt-1 text-zinc-500">
        {summary
          ? `${discordAnnouncementEventLabel(summary.eventType)} / ${summary.status} / ${formatDate(summary.updatedAt ?? summary.createdAt)}`
          : "No stored post found"}
      </dd>
      {summary?.failureReason ? <dd className="mt-1 text-amber-200">{summary.failureReason}</dd> : null}
    </div>
  );
}

function discordAnnouncementEventLabel(value: string) {
  if (value === "new_server") return "New server listed";
  if (value === "server_bump") return "Server bump";
  if (value === "pro_showcase_thread") return "Pro showcase thread";
  if (value === "weekly_spotlight") return "Weekly spotlight";
  return value.replace(/_/g, " ");
}

function LoadingPanel() {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
      <div className="h-3 w-40 animate-pulse rounded bg-cyan-300/20" />
      <div className="mt-4 h-8 w-96 max-w-full animate-pulse rounded bg-white/10" />
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-white/[0.04]" />)}
      </div>
    </section>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-red-400/20 bg-red-950/20 p-5">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-red-200">Owner console error</p>
      <h1 className="mt-2 text-2xl font-black text-white">{message}</h1>
    </section>
  );
}

function PanelHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="shrink-0 rounded-lg border border-white/10 bg-black/35 p-4 shadow-[0_0_40px_rgba(34,211,238,0.07)]">
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">{eyebrow}</p>
      <h1 className="mt-1 text-2xl font-black leading-tight text-white md:text-3xl">{title}</h1>
      <p className="mt-1 max-w-4xl text-xs leading-5 text-zinc-400">{description}</p>
    </header>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: number; accent: "cyan" | "emerald" | "violet" | "amber" }) {
  const accentClasses = {
    cyan: "border-cyan-300/20 text-cyan-100 shadow-[0_0_28px_rgba(34,211,238,0.08)]",
    emerald: "border-emerald-300/20 text-emerald-100 shadow-[0_0_28px_rgba(16,185,129,0.08)]",
    violet: "border-violet-300/20 text-violet-100 shadow-[0_0_28px_rgba(168,85,247,0.08)]",
    amber: "border-amber-300/20 text-amber-100 shadow-[0_0_28px_rgba(245,158,11,0.08)]",
  }[accent];
  return (
    <section className={`rounded-lg border bg-white/[0.035] p-3 ${accentClasses}`}>
      <div className="text-3xl font-black leading-none">{value}</div>
      <div className="mt-1 text-xs font-bold text-zinc-300">{label}</div>
    </section>
  );
}

function StatusCard({ title, value, tone }: { title: string; value: string; tone: "good" | "warn" }) {
  return (
    <section className={`rounded-lg border p-3 ${tone === "good" ? "border-emerald-300/20 bg-emerald-300/[0.04]" : "border-amber-300/20 bg-amber-300/[0.04]"}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{title}</div>
      <div className="mt-1 text-base font-black text-white">{value}</div>
    </section>
  );
}

function KnownServerCard({ title, server }: { title: string; server: KnownServerSummary | null }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{title}</div>
      {server ? (
        <>
          <h2 className="mt-1 truncate text-lg font-black text-white">{server.name}</h2>
          <p className="mt-1 truncate text-xs font-bold text-cyan-100">{server.lifecycleLabel}</p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-zinc-400 sm:grid-cols-2">
            <div className="flex justify-between gap-4"><dt>Status</dt><dd>{server.status ?? "unknown"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Visibility</dt><dd>{server.publicVisibility ?? "default"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Players</dt><dd>{server.playerCount}</dd></div>
            <div className="flex justify-between gap-4"><dt>Latest ADM</dt><dd className="max-w-[150px] truncate">{server.latestAdmFile ?? "none"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Latest event</dt><dd>{formatDate(server.latestImportedEventAt)}</dd></div>
          </dl>
        </>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">No stored server record found.</p>
      )}
    </section>
  );
}

function HealthCard({ title, health }: { title: string; health: StoredJobHealth | null }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{title}</div>
      <h2 className="mt-1 text-lg font-black text-white">{health?.status ?? "No stored run"}</h2>
      <p className="mt-1 truncate text-xs text-zinc-400">{health?.jobType ?? health?.source ?? "Stored automation summary unavailable"}</p>
      <p className="mt-1 text-xs text-zinc-500">{formatDate(health?.createdAt)}</p>
      {health?.error ? <p className="mt-3 text-xs text-amber-200">{health.error}</p> : null}
    </section>
  );
}

function BadgeList({ badges }: { badges: string[] }) {
  if (badges.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span key={badge} className="rounded border border-cyan-300/20 bg-cyan-300/[0.06] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100">{badge}</span>
      ))}
    </div>
  );
}

function StatusPill({ value }: { value: OwnerServer["tokenStatus"] }) {
  const label = {
    readable: "readable",
    decrypt_failed: "decrypt failed",
    needs_resave: "needs re-save",
    unknown: "unknown",
  }[value];
  const color = value === "readable" ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100" : value === "unknown" ? "border-white/10 bg-white/[0.04] text-zinc-400" : "border-amber-300/20 bg-amber-300/[0.06] text-amber-100";
  return <span className={`rounded px-2 py-1 text-xs font-black uppercase tracking-[0.12em] ${color}`}>{label}</span>;
}

function BooleanTile({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${enabled ? "border-cyan-300/20 bg-cyan-300/[0.05]" : "border-white/10 bg-black/25"}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">{label}</div>
      <div className={`mt-1 text-sm font-black ${enabled ? "text-cyan-100" : "text-zinc-500"}`}>{enabled ? "Enabled" : "Disabled"}</div>
    </div>
  );
}

function ownerDiscordStatusLabel(value: string) {
  if (value === "configured_preview_only") return "Configured - preview only";
  if (value === "not_configured") return "Not configured";
  return value.replace(/_/g, " ");
}

function postingModeLabel(value: DiscordPostingMode) {
  const labels: Record<DiscordPostingMode, string> = {
    disabled: "Disabled",
    preview_only: "Preview only",
    production_disabled: "Production disabled",
    ready_but_off: "Ready but off",
  };
  return labels[value];
}

function channelStatusLabel(value: DiscordChannelSlot["status"]) {
  const labels: Record<DiscordChannelSlot["status"], string> = {
    not_configured: "Not configured",
    configured: "Configured",
    missing_permission: "Missing permission",
    disabled: "Disabled",
    preview_only: "Preview only",
  };
  return labels[value];
}

function isDiscordDestinationConfigured(channel: DiscordChannelSlot) {
  return Boolean(channel.guildId && channel.channelId && channel.status !== "disabled" && channel.status !== "not_configured");
}

function discordChannelLabel(channel: DiscordChannelSlot) {
  if (!channel.channelId || channel.status === "not_configured") return "Not configured yet";
  return channel.channelName ? `#${channel.channelName}` : "Channel configured";
}

function discordDestinationOptionLabel(channel: DiscordChannelSlot) {
  return `${channel.label} — ${isDiscordDestinationConfigured(channel) ? discordChannelLabel(channel) : "Not configured"}`;
}

function summarizePostTypes(postTypes: string[]) {
  if (postTypes.length === 0) return "No post types mapped";
  if (postTypes.length <= 2) return postTypes.join(", ");
  return `${postTypes.slice(0, 2).join(", ")} +${postTypes.length - 2}`;
}

function formatDate(value?: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
