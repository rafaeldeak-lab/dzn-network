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
  phase: "phase_1_read_only";
  items: never[];
};

type DiscordPostingMode = "disabled" | "preview_only" | "production_disabled" | "ready_but_off";

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
  guildId: string | null;
  mappedPostTypes: string[];
  webhookConfigured: boolean;
};

type DiscordPreviewType = "new_server" | "top_server" | "legacy_server" | "archived_server" | "server_wars_event" | "weekly_recap";

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

type DiscordControlData = {
  overview: DiscordOverview;
  postTypes: DiscordPostType[];
  channels: DiscordChannelSlot[];
  templates: DiscordTemplate[];
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
        const [overviewResponse, serversResponse, auditResponse, discordOverviewResponse, discordPostTypesResponse, discordChannelsResponse, discordTemplatesResponse] = await Promise.all([
          fetch("/api/owner/overview", { cache: "no-store" }),
          fetch("/api/owner/servers", { cache: "no-store" }),
          fetch("/api/owner/audit-log", { cache: "no-store" }),
          fetch("/api/owner/discord/overview", { cache: "no-store" }),
          fetch("/api/owner/discord/post-types", { cache: "no-store" }),
          fetch("/api/owner/discord/channels", { cache: "no-store" }),
          fetch("/api/owner/discord/templates", { cache: "no-store" }),
        ]);

        if (!active) return;

        const responses = [overviewResponse, serversResponse, auditResponse, discordOverviewResponse, discordPostTypesResponse, discordChannelsResponse, discordTemplatesResponse];
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

        const [overviewJson, serversJson, auditJson, discordOverviewJson, discordPostTypesJson, discordChannelsJson, discordTemplatesJson] = await Promise.all([
          overviewResponse.json(),
          serversResponse.json(),
          auditResponse.json(),
          discordOverviewResponse.json(),
          discordPostTypesResponse.json(),
          discordChannelsResponse.json(),
          discordTemplatesResponse.json(),
        ]);

        if (!active) return;

        setOverview(overviewJson.overview);
        setServers(serversJson.servers ?? []);
        setAuditLog(auditJson.auditLog);
        setDiscordControl({
          overview: discordOverviewJson.overview,
          postTypes: discordPostTypesJson.postTypes ?? [],
          channels: discordChannelsJson.channels ?? [],
          templates: discordTemplatesJson.templates ?? [],
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
                <th className="px-4 py-3">Owner / Guild</th>
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
                    <div className="mt-2 text-xs text-zinc-500">{server.guild.name ?? "Unknown guild"}</div>
                    <div className="text-xs text-zinc-600">{server.guild.guildId ?? server.guild.discordGuildId ?? "No guild id"}</div>
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
  const [selectedType, setSelectedType] = useState<DiscordPreviewType>(data.templates[0]?.type ?? "weekly_recap");
  const [preview, setPreview] = useState<DiscordPreviewEmbed | null>(data.templates[0]?.preview ?? null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "error">("idle");

  const selectedTemplate = data.templates.find((template) => template.type === selectedType) ?? data.templates[0] ?? null;

  async function generatePreview(type: DiscordPreviewType) {
    setSelectedType(type);
    setPreviewStatus("loading");
    try {
      const response = await fetch("/api/owner/discord/preview-embed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!response.ok) throw new Error("preview_failed");
      const json = await response.json();
      setPreview(json.preview ?? selectedTemplate?.preview ?? null);
      setPreviewStatus("idle");
    } catch {
      setPreview(selectedTemplate?.preview ?? preview);
      setPreviewStatus("error");
    }
  }

  const futureActions = [
    "Send test embed",
    "Enable post type",
    "Disable post type",
    "Set channel",
    "Run Discord permission check",
    "Send weekly recap now",
    "Post announcement",
    "Connect guild",
    "Recheck bot permissions",
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <PanelHeader eyebrow="Discord Control" title="DZN Discord command centre" description="Owner-only Discord status, post templates and embed previews. Phase 1 is read-only and never sends real Discord messages." />
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
              <div className="flex justify-between gap-3 rounded border border-white/10 bg-black/25 px-3 py-2"><dt>Connected guilds</dt><dd>{data.overview.connectedGuildCount ?? "unknown"}</dd></div>
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
              <BooleanTile label="Preview mode only" enabled />
              <BooleanTile label="Secrets displayed" enabled={false} />
              <BooleanTile label="Owner-only access" enabled />
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-400">
              This console never returns bot tokens, client secrets, webhook URLs, Nitrado tokens, Cloudflare secrets or runtime encryption keys.
            </p>
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

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-white/[0.035]">
          <div className="shrink-0 border-b border-white/10 p-3">
            <h2 className="text-lg font-black text-white">Auto Post Types</h2>
            <p className="mt-1 text-xs text-zinc-400">Production sending stays disabled. Each row shows stored channel state and preview availability.</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="grid gap-2 lg:grid-cols-2">
              {data.postTypes.map((postType) => (
                <article key={postType.key} className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black text-white">{postType.label}</h3>
                      <p className="mt-1 text-[11px] leading-4 text-zinc-500">{postType.requiredDataSource}</p>
                    </div>
                    <span className="rounded border border-cyan-300/20 bg-cyan-300/[0.06] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100">
                      Preview
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-[11px] text-zinc-400 sm:grid-cols-2">
                    <div>Enabled: {postType.enabled ? "yes" : "no"}</div>
                    <div>Production: disabled</div>
                    <div>Channel: {postType.channelTarget ?? "not configured"}</div>
                    <div>Preview: {postType.previewAvailable ? "available" : "unavailable"}</div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <div className="grid min-h-0 gap-3 overflow-auto pr-1">
          <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-white">Embed Preview Builder</h2>
                <p className="mt-1 text-xs text-zinc-400">Local preview JSON only. Nothing is sent to Discord.</p>
              </div>
              <span className="rounded border border-amber-300/20 bg-amber-300/[0.06] px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-100">
                Preview only - not sent
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {data.templates.map((template) => (
                <button
                  key={template.type}
                  type="button"
                  onClick={() => void generatePreview(template.type)}
                  className={`rounded-lg border px-3 py-2 text-left text-xs font-bold transition ${
                    selectedType === template.type
                      ? "border-cyan-300/40 bg-cyan-300/[0.10] text-white"
                      : "border-white/10 bg-black/25 text-zinc-400 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {template.label}
                  <span className="mt-1 block text-[11px] font-normal leading-4 text-zinc-500">{template.description}</span>
                </button>
              ))}
            </div>
            {previewStatus === "loading" ? <p className="mt-3 text-xs font-bold text-cyan-100">Generating preview...</p> : null}
            {previewStatus === "error" ? <p className="mt-3 text-xs font-bold text-amber-200">Preview API failed. Showing stored template preview.</p> : null}
            <DiscordEmbedPreview preview={preview ?? selectedTemplate?.preview ?? null} />
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <h2 className="text-lg font-black text-white">Channel Mapping</h2>
            <p className="mt-1 text-xs text-zinc-400">Read-only stored mappings. Live Discord permission checks are reserved for Phase 2.</p>
            <div className="mt-3 grid gap-2">
              {data.channels.map((channel) => (
                <div key={channel.slot} className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black text-white">{channel.label}</h3>
                      <p className="mt-1 text-[11px] text-zinc-500">{channel.mappedPostTypes.join(", ")}</p>
                    </div>
                    <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-300">
                      {channelStatusLabel(channel.status)}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-zinc-500">
                    <div>Guild: {channel.guildId ?? "not configured"}</div>
                    <div>Channel: {channel.channelId ?? "not configured"}</div>
                    <div>Webhook fallback: {channel.webhookConfigured ? "configured" : "not configured"}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
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
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto lg:overflow-hidden">
      <PanelHeader eyebrow="Audit Log" title="Owner action history" description="Phase 1 is read-only. This space is prepared for future audited owner actions." />
      <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
        <p className="text-lg font-black text-white">{auditLog?.message ?? "No owner actions recorded yet."}</p>
        <p className="mt-2 text-sm text-zinc-400">Future lifecycle/resource changes will be recorded here with actor, target, timestamp and safe reason.</p>
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
          The allowlist values are never returned to this page. Display names, usernames, emails and guild nicknames are not used for platform-owner access.
        </p>
      </section>
    </div>
  );
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

function formatDate(value?: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
