"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Brackets,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Flag,
  Gamepad2,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Settings,
  ShieldCheck,
  Swords,
  Trophy,
} from "lucide-react";
import Link from "next/link";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { clearClientAuthState, getMe, logoutAndRedirect } from "./api";
import { SaveProgressButton, useSaveProgress, type SaveProgressState } from "./save-progress";
import type { LinkedServer } from "./types";

type EventHubPayload = {
  ok: true;
  generated_at: string;
  server: {
    id: string;
    name: string;
    category: string | null;
    categoryLabel: string;
    planKey: string;
    subscriptionStatus: string;
    admSync: {
      ready: boolean;
      latestAdmFile: string | null;
      lastProcessedFile: string | null;
      lastSuccessfulImportAt: string | null;
      status: string;
    };
    discordConnected: boolean;
    botConfigured: boolean;
    selectedDiscordEventChannel: EventChannelSummary | null;
    publicListingStatus: "public" | "hidden";
    setupComplete: boolean;
    playerCount: number;
    maxPlayers: number;
  };
  discordChannels: {
    selected: Record<string, EventChannelSummary | null>;
    status: {
      ready: boolean;
      label: string;
      selectedChannel: EventChannelSummary | null;
      advancedRoutingEnabled?: boolean;
    };
    settingsUrl: string;
  };
  cooldown: { cooldown_until?: string | null; reason?: string | null } | null;
  availableEvents: EventCard[];
  lockedEvents: EventCard[];
  enteredEvents: EventEntry[];
  liveMatchups: Matchup[];
  brackets: Matchup[];
  results: Matchup[];
};

type EventChannelSummary = {
  channelId: string;
  channelName: string | null;
  channelType: string;
  valid: boolean;
  missingPermissions: string[];
};

type EventEligibility = {
  canEnter: boolean;
  code: string | null;
  message: string;
  action: string;
  alreadyEntered?: boolean;
};

type EventCard = {
  id: string;
  slug: string;
  title: string;
  description: string;
  eventType: string;
  eventTypeLabel: string;
  category: string;
  categoryLabel: string;
  requiredPlan: string;
  startTime: string | null;
  endTime: string | null;
  entryDeadline: string | null;
  matchupDurationHours: number;
  phaseDurationHours: number;
  challengePhaseDuration: string;
  enteredServersCount: number;
  maxEntries: number | null;
  scoringSource: string;
  requiresDiscordPosting: boolean;
  selectedDiscordEventChannel: EventChannelSummary | null;
  discordRoutingAdvanced?: boolean;
  rewards: string | null;
  rulesSummary: string | null;
  eligibility: EventEligibility;
  cta: string;
  status: string;
};

type EventEntry = {
  id?: string;
  event_id?: string;
  status?: string;
  entered_at?: string;
  name?: string;
  slug?: string;
  event_type?: string;
  category?: string;
};

type Matchup = {
  id: string;
  eventName: string | null;
  eventType: string | null;
  roundNumber: number;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  serverA: { id: string; name: string; score: number };
  serverB: { id: string; name: string; score: number };
};

type TabKey = "available" | "entered" | "live" | "brackets" | "results" | "locked";

const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: "available", label: "Available", icon: <Flag className="h-4 w-4" /> },
  { key: "entered", label: "Entered", icon: <CheckCircle2 className="h-4 w-4" /> },
  { key: "live", label: "Live", icon: <Swords className="h-4 w-4" /> },
  { key: "brackets", label: "Brackets", icon: <Brackets className="h-4 w-4" /> },
  { key: "results", label: "Results", icon: <Trophy className="h-4 w-4" /> },
  { key: "locked", label: "Locked", icon: <LockKeyhole className="h-4 w-4" /> },
];

export function EventHubPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [servers, setServers] = useState<LinkedServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [payload, setPayload] = useState<EventHubPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("available");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeEventActionId, setActiveEventActionId] = useState<string | null>(null);
  const [activeLeaveEntryId, setActiveLeaveEntryId] = useState<string | null>(null);
  const enterEventProgress = useSaveProgress();
  const leaveEventProgress = useSaveProgress();

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const requestedServerId = params.get("serverId") ?? "";
    getMe()
      .then((auth) => {
        if (!active) return;
        const linkedServers = auth.linkedServers ?? (auth.linkedServer ? [auth.linkedServer] : []);
        setServers(linkedServers);
        setSelectedServerId(requestedServerId || linkedServers[0]?.id || "");
        setAuthChecked(true);
        if (linkedServers.length === 0) setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setAuthError(true);
        setAuthChecked(true);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedServerId) return;
    let active = true;
    fetch(`/api/servers/${encodeURIComponent(selectedServerId)}/events`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then((response) => readApiResponse<EventHubPayload>(response, "Unable to load Event Hub."))
      .then((data) => {
        if (!active) return;
        setPayload(data);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load Event Hub.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedServerId]);

  const selectedServer = useMemo(() => servers.find((server) => server.id === selectedServerId) ?? null, [servers, selectedServerId]);
  const tabCounts = {
    available: payload?.availableEvents.length ?? 0,
    entered: payload?.enteredEvents.length ?? 0,
    live: payload?.liveMatchups.length ?? 0,
    brackets: payload?.brackets.length ?? 0,
    results: payload?.results.length ?? 0,
    locked: payload?.lockedEvents.length ?? 0,
  };

  async function enterEvent(eventId: string) {
    if (!selectedServerId) return;
    setActiveEventActionId(eventId);
    enterEventProgress.start("Validating eligibility", 15);
    setMessage(null);
    setError(null);
    try {
      enterEventProgress.setStage("saving", "Entering event", 35);
      const response = await fetch(`/api/servers/${encodeURIComponent(selectedServerId)}/events/${encodeURIComponent(eventId)}/enter`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await readApiResponse<{ message?: string }>(response, "Unable to enter event.");
      enterEventProgress.setStage("refreshing", "Refreshing entry", 70);
      await reloadHub(selectedServerId);
      enterEventProgress.complete("Entered");
      setMessage(data.message ?? "Server entered. DZN will score this event automatically from ADM sync.");
      setActiveTab("entered");
    } catch (enterError) {
      const message = safeErrorMessage(enterError, "Unable to enter event.");
      setError(message);
      enterEventProgress.fail(message);
    }
  }

  async function reloadHub(serverId: string) {
    const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/events`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    });
    const data = await readApiResponse<EventHubPayload>(response, "Unable to refresh Event Hub.");
    setPayload(data as EventHubPayload);
  }

  async function leaveEvent(entry: EventEntry) {
    if (!selectedServerId) return;
    const eventId = entry.event_id ?? entry.id ?? "";
    if (!eventId) {
      const message = "Unable to leave event because the event id is missing.";
      setError(message);
      leaveEventProgress.fail(message);
      return;
    }
    const entryId = String(entry.id ?? eventId);
    setActiveLeaveEntryId(entryId);
    leaveEventProgress.start("Validating event entry", 15);
    setMessage(null);
    setError(null);
    try {
      leaveEventProgress.setStage("saving", "Leaving event", 35);
      const response = await fetch(`/api/servers/${encodeURIComponent(selectedServerId)}/events/${encodeURIComponent(eventId)}/leave`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await readApiResponse<{ message?: string }>(response, "Unable to leave event.");
      leaveEventProgress.setStage("refreshing", "Refreshing event entries", 70);
      await reloadHub(selectedServerId);
      leaveEventProgress.complete("Left");
      setMessage(data.message ?? "Event entry removed.");
      setActiveTab("available");
    } catch (leaveError) {
      const message = safeErrorMessage(leaveError, "Unable to leave event.");
      setError(message);
      leaveEventProgress.fail(message);
    }
  }

  if (!authChecked || loading) return <LoadingScreen />;
  if (authError) return <LoginRequired />;
  if (!selectedServerId || !selectedServer) {
    return (
      <EventHubShell onLogout={signOut}>
        <EmptyState title="No connected server found" detail="Connect Discord and Nitrado from setup before entering events." actionHref="/setup" actionLabel="Open Setup" />
      </EventHubShell>
    );
  }

  return (
    <EventHubShell onLogout={signOut}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-100">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <label className="relative grid min-w-[260px] gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
          <span className="text-[9px] font-black uppercase text-zinc-500">Selected Server</span>
          <select
            value={selectedServerId}
            onChange={(event) => {
              setLoading(true);
              setPayload(null);
              setError(null);
              setMessage(null);
              setActiveEventActionId(null);
              setActiveLeaveEntryId(null);
              enterEventProgress.reset();
              leaveEventProgress.reset();
              setSelectedServerId(event.target.value);
            }}
            className="appearance-none bg-transparent pr-8 text-sm font-black text-white outline-none"
          >
            {servers.map((server) => (
              <option key={server.id} value={server.id} className="bg-[#080b16] text-white">
                {server.display_name ?? server.hostname ?? server.server_name ?? server.nitrado_service_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="glass-surface animated-border rounded-lg p-5">
        <div className="relative z-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className="text-xs font-black uppercase text-violet-200/75">Owner Competition Control</p>
            <h1 className="mt-2 text-4xl font-black tracking-normal text-white">Event Hub</h1>
            <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-zinc-300">
              Enter your server into DZN challenges, tournaments, and server-vs-server competitions. Scoring is handled automatically from ADM sync.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusChip tone="cyan" icon={<ShieldCheck className="h-3.5 w-3.5" />}>{formatPlan(payload?.server.planKey)}</StatusChip>
              <StatusChip tone={payload?.server.category ? "violet" : "amber"} icon={<Gamepad2 className="h-3.5 w-3.5" />}>{payload?.server.categoryLabel ?? "Category Missing"}</StatusChip>
              <StatusChip tone="emerald" icon={<Flag className="h-3.5 w-3.5" />}>{tabCounts.available} Eligible Events</StatusChip>
              <StatusChip tone={payload?.cooldown?.cooldown_until ? "amber" : "emerald"} icon={<Clock3 className="h-3.5 w-3.5" />}>{payload?.cooldown?.cooldown_until ? "Event Cooldown" : "No Event Cooldown"}</StatusChip>
              <StatusChip tone={payload?.discordChannels.status.ready ? "emerald" : "amber"} icon={<Bell className="h-3.5 w-3.5" />}>{payload?.discordChannels.status.label ?? "Discord Channel Missing"}</StatusChip>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[360px]">
            <SummaryTile label="Server" value={payload?.server.name ?? selectedServer.display_name ?? "DZN Server"} />
            <SummaryTile label="ADM Sync" value={payload?.server.admSync.ready ? "Ready" : "Needs evidence"} />
            <SummaryTile label="Discord" value={payload?.server.discordConnected ? "Connected" : "Missing"} />
            <SummaryTile label="Public Listing" value={payload?.server.publicListingStatus === "public" ? "Public" : "Hidden"} />
          </div>
        </div>
      </section>

      {message || error ? (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm font-bold ${error ? "border-red-300/25 bg-red-400/10 text-red-50" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"}`}>
          {error ?? message}
        </div>
      ) : null}

      {payload ? <ReadinessBanners payload={payload} /> : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="grid content-start gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center justify-between rounded-lg border px-3 py-3 text-left text-sm font-black transition ${activeTab === tab.key ? "border-violet-300/40 bg-violet-500/22 text-white" : "border-white/10 bg-white/[0.035] text-zinc-400 hover:bg-white/[0.06] hover:text-white"}`}
            >
              <span className="inline-flex items-center gap-2">{tab.icon}{tab.label}</span>
              <span className="rounded-md border border-white/10 bg-black/24 px-2 py-1 text-[10px] text-zinc-300">{tabCounts[tab.key]}</span>
            </button>
          ))}
          <div className="mt-3 rounded-lg border border-white/10 bg-black/24 p-3">
            <p className="text-xs font-black uppercase text-zinc-300">{payload?.discordChannels.status.advancedRoutingEnabled ? "Discord Event Channels" : "Discord Event Channel"}</p>
            <p className="mt-2 text-sm font-bold text-zinc-100">{eventChannelStatusText(payload)}</p>
            <Link href={payload?.discordChannels.settingsUrl ?? "/dashboard/server-settings#discord-event-channels"} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50">
              Choose Channel
            </Link>
          </div>
        </aside>

        <section className="grid gap-4">
          {!payload ? <EmptyState title="Event Hub unavailable" detail={error ?? "DZN could not load owner event data."} /> : null}
          {payload && activeTab === "available" ? (
            payload.availableEvents.length ? payload.availableEvents.map((event) => <EventCardView key={event.id} event={event} actionProgress={activeEventActionId === event.id ? enterEventProgress.state : null} onEnter={() => enterEvent(event.id)} />) : (
              <EmptyState title="No eligible events right now" detail="When real DZN events are open for this server category and plan, they will appear here." />
            )
          ) : null}
          {payload && activeTab === "locked" ? (
            payload.lockedEvents.length ? payload.lockedEvents.map((event) => <EventCardView key={event.id} event={event} locked />) : (
              <EmptyState title="No locked events" detail="Plan, category, cooldown, Discord, and ADM requirements are currently clear for visible events." />
            )
          ) : null}
          {payload && activeTab === "entered" ? (
            payload.enteredEvents.length ? payload.enteredEvents.map((entry) => {
              const entryId = String(entry.id ?? entry.event_id ?? "");
              return <EntryRow key={entryId} entry={entry} actionProgress={activeLeaveEntryId === entryId ? leaveEventProgress.state : null} onLeave={() => leaveEvent(entry)} />;
            }) : (
              <EmptyState title="No entered events" detail="Enter an eligible event to create a server entry and start automatic ADM scoring when the event goes live." />
            )
          ) : null}
          {payload && activeTab === "live" ? (
            payload.liveMatchups.length ? payload.liveMatchups.map((matchup) => <MatchupRowView key={matchup.id} matchup={matchup} />) : (
              <EmptyState title="No live matchups" detail="Live server-vs-server matchups will appear here after brackets are seeded and phases begin." />
            )
          ) : null}
          {payload && activeTab === "brackets" ? (
            payload.brackets.length ? payload.brackets.map((matchup) => <MatchupRowView key={matchup.id} matchup={matchup} />) : (
              <EmptyState title="No bracket matchups yet" detail="DZN creates matchup phases after enough servers enter a bracketed event." />
            )
          ) : null}
          {payload && activeTab === "results" ? (
            payload.results.length ? payload.results.map((matchup) => <MatchupRowView key={matchup.id} matchup={matchup} />) : (
              <EmptyState title="No completed results yet" detail="Final reports and completed matchup results will appear here after event phases finish." />
            )
          ) : null}
        </section>
      </div>
    </EventHubShell>
  );
}

function ReadinessBanners({ payload }: { payload: EventHubPayload }) {
  const notices: Array<{ key: string; text: string; href: string; action: string }> = [];
  if (!payload.server.category) notices.push({ key: "category", text: "Set your server category before entering category-matched events.", href: "/dashboard/server-settings#category", action: "Set Category" });
  if (!payload.server.setupComplete) notices.push({ key: "setup", text: "Complete setup before entering ADM-scored events.", href: "/setup", action: "Complete Setup" });
  if (!payload.discordChannels.status.ready) notices.push({ key: "discord", text: "Choose a Discord event channel before entering events that require live updates.", href: payload.discordChannels.settingsUrl, action: "Choose Channel" });
  if (!notices.length) return null;
  return (
    <div className="mt-4 grid gap-3">
      {notices.map((notice) => (
        <div key={notice.key} className="flex flex-col gap-3 rounded-lg border border-amber-300/20 bg-amber-400/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-bold leading-6 text-amber-50">{notice.text}</p>
          <Link href={notice.href} className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-200/25 bg-amber-300/12 px-3 py-2 text-[10px] font-black uppercase text-amber-50">
            {notice.action} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ))}
    </div>
  );
}

function EventCardView({ event, actionProgress, locked = false, onEnter }: { event: EventCard; actionProgress?: SaveProgressState | null; locked?: boolean; onEnter?: () => void }) {
  const busy = actionProgress?.status === "validating" || actionProgress?.status === "saving" || actionProgress?.status === "refreshing";
  const disabled = locked || !event.eligibility.canEnter || busy;
  const href = ctaHref(event.eligibility.code);
  return (
    <article className="glass-surface animated-border rounded-lg p-5">
      <div className="relative z-10 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone="violet" icon={<Flag className="h-3.5 w-3.5" />}>{event.eventTypeLabel}</StatusChip>
            <StatusChip tone={event.category === "open" ? "cyan" : "emerald"} icon={<Gamepad2 className="h-3.5 w-3.5" />}>{event.categoryLabel}</StatusChip>
            <StatusChip tone={event.requiresDiscordPosting ? "amber" : "zinc"} icon={<Bell className="h-3.5 w-3.5" />}>{event.requiresDiscordPosting ? "Discord Posting Required" : "Discord Optional"}</StatusChip>
          </div>
          <h2 className="mt-3 text-2xl font-black text-white">{event.title}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">{event.description || "DZN-scored event using imported ADM data."}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Mini label="Starts" value={formatDate(event.startTime)} />
            <Mini label="Entry deadline" value={formatDate(event.entryDeadline)} />
            <Mini label="Matchup duration" value={`${event.matchupDurationHours}h`} />
            <Mini label="Phase duration" value={event.challengePhaseDuration} />
            <Mini label="Entries" value={`${event.enteredServersCount}${event.maxEntries ? ` / ${event.maxEntries}` : ""}`} />
            <Mini label="Required plan" value={formatPlan(event.requiredPlan)} />
            <Mini label="Scoring" value={event.scoringSource} />
            <Mini label="Rewards" value={event.rewards || "Listed in event rules"} />
          </div>
          <p className={`mt-4 rounded-lg border px-3 py-2 text-xs font-bold leading-5 ${event.eligibility.canEnter ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-50" : "border-amber-300/20 bg-amber-400/10 text-amber-50"}`}>
            {event.eligibility.message}
          </p>
        </div>
        <div className="grid content-start gap-2">
          {event.eligibility.canEnter && onEnter ? (
            <SaveProgressButton
              idleLabel="Enter Event"
              savingLabel="Entering Event..."
              refreshingLabel="Refreshing..."
              successLabel="Entered"
              errorLabel="Retry Enter"
              state={actionProgress ?? { status: "idle", progress: 0, label: "Waiting", error: null }}
              disabled={disabled}
              onClick={onEnter}
              icon={<Trophy className="h-4 w-4" />}
              fullWidth
              buttonClassName="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-55"
            />
          ) : (
            <Link href={href} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black uppercase text-zinc-100">
              {event.eligibility.action}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          <Link href={`/events/${encodeURIComponent(event.slug)}`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-xs font-black uppercase text-cyan-50">
            View Public Event
          </Link>
          <div className="rounded-lg border border-white/10 bg-black/24 p-3">
            <p className="text-[10px] font-black uppercase text-zinc-500">{event.discordRoutingAdvanced ? "Discord Event Channels" : "Discord Event Channel"}</p>
            <p className="mt-1 text-sm font-bold text-zinc-100">{event.discordRoutingAdvanced ? "Advanced routing enabled" : event.selectedDiscordEventChannel?.channelName ? `#${event.selectedDiscordEventChannel.channelName}` : "Choose a Discord event channel before entering events that require live updates."}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function EntryRow({ entry, actionProgress, onLeave }: { entry: EventEntry; actionProgress?: SaveProgressState | null; onLeave?: () => void }) {
  const busy = actionProgress?.status === "validating" || actionProgress?.status === "saving" || actionProgress?.status === "refreshing";
  return (
    <div className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-4 md:grid-cols-[minmax(0,1fr)_180px] md:items-start">
      <div>
        <p className="text-xs font-black uppercase text-violet-200/75">{entry.status ?? "entered"}</p>
        <h3 className="mt-1 text-xl font-black text-white">{entry.name ?? "Entered event"}</h3>
        <p className="mt-2 text-sm text-zinc-400">Entered {formatDate(entry.entered_at ?? null)}. ADM scoring starts when the event phase is live.</p>
      </div>
      {onLeave ? (
        <SaveProgressButton
          idleLabel="Leave Event"
          savingLabel="Leaving Event..."
          refreshingLabel="Refreshing..."
          successLabel="Left"
          errorLabel="Retry Leave"
          state={actionProgress ?? { status: "idle", progress: 0, label: "Waiting", error: null }}
          disabled={busy}
          onClick={onLeave}
          icon={<ArrowRight className="h-4 w-4 rotate-180" />}
          fullWidth
          buttonClassName="inline-flex items-center justify-center gap-2 rounded-lg border border-red-300/25 bg-red-400/10 px-4 py-3 text-xs font-black uppercase text-red-50 transition hover:border-red-300/45 disabled:cursor-not-allowed disabled:opacity-55"
        />
      ) : null}
    </div>
  );
}

function MatchupRowView({ matchup }: { matchup: Matchup }) {
  const total = Math.max(1, matchup.serverA.score + matchup.serverB.score);
  const left = Math.round((matchup.serverA.score / total) * 100);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-cyan-200/75">Round {matchup.roundNumber} / {matchup.status}</p>
          <h3 className="mt-1 text-xl font-black text-white">{matchup.eventName ?? "DZN Matchup"}</h3>
        </div>
        <StatusChip tone="violet" icon={<CalendarClock className="h-3.5 w-3.5" />}>{formatDate(matchup.startsAt)}</StatusChip>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <ScoreBlock name={matchup.serverA.name} score={matchup.serverA.score} align="left" />
        <div className="text-center text-xs font-black uppercase text-zinc-500">vs</div>
        <ScoreBlock name={matchup.serverB.name} score={matchup.serverB.score} align="right" />
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-sm bg-white/10">
        <div className="h-full bg-gradient-to-r from-violet-300 to-cyan-300" style={{ width: `${left}%` }} />
      </div>
    </div>
  );
}

function ScoreBlock({ name, score, align }: { name: string; score: number; align: "left" | "right" }) {
  return (
    <div className={`rounded-lg border border-white/10 bg-black/24 p-3 ${align === "right" ? "text-right" : ""}`}>
      <p className="text-sm font-black text-white">{name}</p>
      <p className="mt-1 text-2xl font-black text-cyan-100">{score}</p>
    </div>
  );
}

function EventHubShell({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(34,211,238,0.1),transparent_26%),radial-gradient(circle_at_84%_16%,rgba(139,92,246,0.12),transparent_28%)]" />
      <div className="relative z-10 mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <DznLogo compact />
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-200"><LayoutDashboard className="h-4 w-4" />Dashboard</Link>
            <Link href="/dashboard/server-settings" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-200"><Settings className="h-4 w-4" />Server Settings</Link>
            <Link href="/setup" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-200">Setup</Link>
            <button type="button" onClick={onLogout} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-200">
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

function LoadingScreen() {
  return (
    <EventHubShell onLogout={signOut}>
      <section className="glass-surface animated-border rounded-lg p-6">
        <div className="relative z-10 flex items-center gap-3">
          <RefreshCw className="h-5 w-5 animate-spin text-violet-100" />
          <p className="text-sm font-black uppercase text-zinc-200">Loading Event Hub</p>
        </div>
      </section>
    </EventHubShell>
  );
}

function LoginRequired() {
  return (
    <main className="relative grid min-h-screen place-items-center bg-[#02030a] px-4 text-white">
      <section className="glass-surface animated-border w-full max-w-xl rounded-lg p-6">
        <div className="relative z-10">
          <p className="text-xs font-black uppercase text-violet-200/75">Protected Event Hub</p>
          <h1 className="mt-2 text-3xl font-black text-white">Login required</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">Event Hub is available to connected server owners and DZN admins only.</p>
          <Link href={`/login?returnTo=${encodeURIComponent("/dashboard/events")}`} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white">
            Login with Discord <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}

function EmptyState({ title, detail, actionHref, actionLabel }: { title: string; detail: string; actionHref?: string; actionLabel?: string }) {
  return (
    <section className="glass-surface animated-border rounded-lg p-6">
      <div className="relative z-10">
        <CircleSlash className="h-8 w-8 text-zinc-400" />
        <h2 className="mt-4 text-2xl font-black text-white">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-zinc-300">{detail}</p>
        {actionHref && actionLabel ? (
          <Link href={actionHref} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white">
            {actionLabel} <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function StatusChip({ icon, tone, children }: { icon: React.ReactNode; tone: "emerald" | "violet" | "cyan" | "amber" | "zinc"; children: React.ReactNode }) {
  const classes = {
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    violet: "border-violet-300/25 bg-violet-400/10 text-violet-100",
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
    amber: "border-amber-300/25 bg-amber-400/10 text-amber-100",
    zinc: "border-white/10 bg-white/[0.04] text-zinc-200",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-black uppercase ${classes}`}>{icon}{children}</span>;
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-3">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-2">
      <p className="text-[9px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-xs font-bold text-zinc-100">{value}</p>
    </div>
  );
}

function eventChannelStatusText(payload: EventHubPayload | null) {
  if (!payload) return "Choose a Discord event channel before entering events that require live updates.";
  if (payload.discordChannels.status.advancedRoutingEnabled) return "Advanced routing enabled";
  const channelName = payload.discordChannels.status.selectedChannel?.channelName;
  if (channelName) return `#${channelName}`;
  return "Choose a Discord event channel before entering events that require live updates.";
}

function ctaHref(code: string | null) {
  if (code === "CATEGORY_REQUIRED" || code === "CATEGORY_MISMATCH") return "/dashboard/server-settings#category";
  if (code === "SETUP_INCOMPLETE") return "/setup";
  if (code === "DISCORD_EVENT_CHANNEL_REQUIRED") return "/dashboard/server-settings#discord-event-channels";
  if (code === "ADM_SYNC_REQUIRED") return "/dashboard";
  if (code === "PLAN_REQUIRED") return "/dashboard";
  return "/events";
}

function formatPlan(value: unknown) {
  const text = String(value ?? "free").replace(/_/g, " ");
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Not scheduled";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

class ApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function readApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
    throw new ApiRequestError(stringOrNull(body.message) ?? stringOrNull(body.error) ?? fallbackMessage);
  }
  return data as T;
}

function safeErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error && !/^Request failed:/i.test(error.message)) return error.message;
  return fallbackMessage;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function signOut() {
  clearClientAuthState();
  void logoutAndRedirect();
}
