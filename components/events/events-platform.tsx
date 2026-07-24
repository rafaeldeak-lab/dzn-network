"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Crown,
  Filter,
  Flag,
  Home,
  LayoutDashboard,
  LockKeyhole,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Swords,
  Trophy,
} from "lucide-react";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { fetchJsonWithRetry } from "@/lib/client-fetch";
import {
  fallbackActivity,
  fallbackEventDetail,
  fallbackEventsPayload,
  fallbackMatches,
  fallbackServerEvents,
  fallbackServers,
  type CompetitiveEvent,
  type EventDetailPayload,
  type EventMatch,
  type EventsPayload,
  type ServerEventsPayload,
} from "./event-data";
import { cn, formatNumber } from "./event-format";
import { BracketView } from "./BracketView";
import { ChallengeBattleCard } from "./ChallengeBattleCard";
import { ClientTimeUntil } from "./ClientTimeUntil";
import { EventFilterPanel } from "./EventFilterPanel";
import { EventHero } from "./EventHero";
import { EventTabs } from "./EventTabs";
import { LeaderboardTeaser } from "./LeaderboardTeaser";
import { LiveActivityFeed } from "./LiveActivityFeed";
import { LiveBattleCard } from "./LiveBattleCard";
import { PremiumLockedCard } from "./PremiumLockedCard";
import { SeasonBanner } from "./SeasonBanner";
import { ServerCategoryBadge } from "./ServerCategoryBadge";
import { ServerEventProfile } from "./ServerEventProfile";
import { TournamentCard } from "./TournamentCard";
import { TournamentTable } from "./TournamentTable";
import { ServerWarsTeaser } from "@/components/server-wars/server-wars-platform";
import {
  DznPulseBell,
  DznPulseProvider,
  usePulseContextOptional,
} from "@/components/dzn-pulse/dzn-pulse-provider";

type LoadState = "loading" | "loaded" | "stale";
type TournamentStatusFilter = "all" | "upcoming" | "active" | "completed" | string;

type AuthServer = {
  id: string;
  server_name?: string | null;
  display_name?: string | null;
  hostname?: string | null;
  nitrado_service_name?: string | null;
  server_category?: string | null;
  status?: string | null;
};

type AuthPayload = {
  authenticated: boolean;
  linkedServer?: AuthServer | null;
  linkedServers?: AuthServer[];
};

const CATEGORY_LABELS: Record<string, string> = {
  deathmatch: "Deathmatch",
  pvp: "PvP",
  pve: "PvE",
  pvp_pve: "PvP / PvE",
  hardcore: "Hardcore",
  roleplay: "Roleplay",
  faction_wars: "Faction Wars",
  vanilla: "Vanilla",
  modded: "Modded",
};

const EVENT_TYPE_OPTIONS = [
  ["capture_the_flag", "Capture The Flag"],
  ["community_cup", "Community Cup"],
  ["bot_tournament", "Bot Tournament"],
  ["faction_wars", "Faction Wars"],
  ["seasonal_wars", "Seasonal Wars"],
  ["kill_race", "Kill Race"],
  ["survival_challenge", "Survival Challenge"],
] as const;

function eventMatchesStatusFilter(eventStatus: string, status: TournamentStatusFilter) {
  const normalized = String(status || "all").toLowerCase();
  const event = String(eventStatus || "").toLowerCase();
  if (normalized === "all") return true;
  if (normalized === "upcoming") return ["upcoming", "registration_open", "standby"].includes(event);
  if (normalized === "active") return ["live", "active"].includes(event);
  if (normalized === "completed") return ["ended", "completed"].includes(event);
  return event === normalized;
}

function filterEventsForView(events: EventsPayload["events"], filters: { status?: string; type?: string; category?: string }) {
  return events.filter((event) => {
    const statusOk = eventMatchesStatusFilter(event.status, filters.status ?? "all");
    const typeOk = !filters.type || filters.type === "all" || event.event_type === filters.type;
    const categoryOk = !filters.category || filters.category === "all" || event.category === filters.category;
    return statusOk && typeOk && categoryOk;
  });
}

export function EventCreatePage() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthPayload | null>(null);
  const [authState, setAuthState] = useState<LoadState>("loading");
  const [selectedServerId, setSelectedServerId] = useState("");
  const [form, setForm] = useState({
    name: "",
    description: "",
    event_type: "capture_the_flag",
    starts_at: "",
    ends_at: "",
    server_limit: "16",
    team_limit: "16",
    status: "registration_open",
    tournament_channel_id: "",
    rules: "",
    rewards: "",
    visibility: "public",
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetchJsonWithRetry<AuthPayload>("/api/auth/me", {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
      timeoutMs: 10_000,
      retries: 1,
    })
      .then((payload) => {
        if (!active) return;
        setAuth(payload);
        const servers = payload.linkedServers?.length ? payload.linkedServers : payload.linkedServer ? [payload.linkedServer] : [];
        setSelectedServerId((current) => current || servers[0]?.id || "");
        setAuthState("loaded");
      })
      .catch(() => {
        if (!active) return;
        setAuth({ authenticated: false, linkedServers: [] });
        setAuthState("stale");
      });
    return () => {
      active = false;
    };
  }, []);

  const servers = useMemo(() => auth?.linkedServers?.length ? auth.linkedServers : auth?.linkedServer ? [auth.linkedServer] : [], [auth]);
  const selectedServer = servers.find((server) => server.id === selectedServerId) ?? servers[0] ?? null;
  const selectedCategory = normalizeClientCategory(selectedServer?.server_category);
  const canSubmit = Boolean(auth?.authenticated && selectedServer && selectedCategory && form.name.trim().length >= 3 && !submitting);

  const updateField = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth?.authenticated) {
      setMessage({ tone: "error", text: "Log in with Discord before creating an event." });
      return;
    }
    if (!selectedServer) {
      setMessage({ tone: "error", text: "Connect a server before creating an event." });
      return;
    }
    if (!selectedCategory) {
      setMessage({ tone: "error", text: "Set your server category before creating an event." });
      return;
    }
    setSubmitting(true);
    setMessage({ tone: "info", text: "Creating category-locked event..." });
    try {
      const payload = await fetchJsonWithRetry<{ ok: boolean; event_slug?: string; message?: string; error?: string }>(
        "/api/events/create",
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", accept: "application/json" },
          timeoutMs: 12_000,
          body: JSON.stringify({
            ...form,
            hosting_server_id: selectedServer.id,
            server_limit: Number(form.server_limit),
            team_limit: Number(form.team_limit),
          }),
        },
      );
      if (!payload.ok || !payload.event_slug) throw new Error(payload.message ?? payload.error ?? "Event could not be created.");
      setMessage({ tone: "success", text: payload.message ?? "Event created." });
      router.push(`/events/${payload.event_slug}`);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Event could not be created." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <EventsShell>
      <HeaderLine
        title="OFFICIAL EVENTS"
        subtitle="Official DZN events are creator-managed. Use Event Control for creator-only official creation."
        action={<EventActionLink href="/events">Events Hub</EventActionLink>}
      />
      <EventTabs active="CTF Tournaments" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={submit} className="space-y-5 rounded-xl border border-white/10 bg-white/[0.035] p-5 shadow-[0_30px_110px_rgba(0,0,0,0.32)]">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Event Name">
              <input value={form.name} onChange={(event) => updateField("name", event.target.value)} className={eventInputClass()} maxLength={90} placeholder="NukeTown Friday Kill Race" />
            </Field>
            <Field label="Event Type">
              <select value={form.event_type} onChange={(event) => updateField("event_type", event.target.value)} className={eventInputClass()}>
                {EVENT_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Hosting Server">
            <select value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)} className={eventInputClass()} disabled={authState === "loading"}>
              {servers.length ? servers.map((server) => (
                <option key={server.id} value={server.id}>{serverDisplayLabel(server)}</option>
              )) : <option value="">No connected servers found</option>}
            </select>
          </Field>
          <div className="rounded-lg border border-cyan-300/18 bg-cyan-400/8 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-cyan-100" />
              <span className="text-xs font-black uppercase text-cyan-50">Same Category Lock</span>
              {selectedCategory ? <ServerCategoryBadge category={selectedCategory} label={CATEGORY_LABELS[selectedCategory]} /> : <span className="rounded-md border border-amber-300/35 bg-amber-400/12 px-2.5 py-1 text-[10px] font-black uppercase text-amber-100">Set category first</span>}
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              The event category is locked to the selected hosting server. Only servers in the same category can register for this event.
            </p>
          </div>
          <Field label="Description">
            <textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} className={`${eventInputClass()} min-h-24 resize-y`} maxLength={500} placeholder="Short public event description." />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Start Date">
              <input type="datetime-local" value={form.starts_at} onChange={(event) => updateField("starts_at", event.target.value)} className={eventInputClass()} />
            </Field>
            <Field label="End Date">
              <input type="datetime-local" value={form.ends_at} onChange={(event) => updateField("ends_at", event.target.value)} className={eventInputClass()} />
            </Field>
            <Field label="Max Servers / Teams">
              <input type="number" min={2} max={128} value={form.server_limit} onChange={(event) => {
                updateField("server_limit", event.target.value);
                updateField("team_limit", event.target.value);
              }} className={eventInputClass()} />
            </Field>
            <Field label="Registration Status">
              <select value={form.status} onChange={(event) => updateField("status", event.target.value)} className={eventInputClass()}>
                <option value="registration_open">Registration Open</option>
                <option value="upcoming">Upcoming</option>
                <option value="standby">Standby</option>
              </select>
            </Field>
            <Field label="Tournament Channel ID">
              <input value={form.tournament_channel_id} onChange={(event) => updateField("tournament_channel_id", event.target.value)} className={eventInputClass()} placeholder="Optional Discord channel ID" />
            </Field>
            <Field label="Visibility">
              <select value={form.visibility} onChange={(event) => updateField("visibility", event.target.value)} className={eventInputClass()}>
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Rules">
              <textarea value={form.rules} onChange={(event) => updateField("rules", event.target.value)} className={`${eventInputClass()} min-h-32 resize-y`} maxLength={4000} placeholder="Roster rules, scoring, anti-alt notes, and dispute policy." />
            </Field>
            <Field label="Rewards">
              <textarea value={form.rewards} onChange={(event) => updateField("rewards", event.target.value)} className={`${eventInputClass()} min-h-32 resize-y`} maxLength={2000} placeholder="Champion badges, featured placement, credits, or community rewards." />
            </Field>
          </div>
          {message ? (
            <div className={cn(
              "rounded-lg border px-4 py-3 text-sm font-bold",
              message.tone === "error" && "border-rose-300/25 bg-rose-500/10 text-rose-100",
              message.tone === "success" && "border-emerald-300/25 bg-emerald-500/10 text-emerald-100",
              message.tone === "info" && "border-cyan-300/25 bg-cyan-500/10 text-cyan-100",
            )}>{message.text}</div>
          ) : null}
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300/35 bg-violet-500/24 px-5 py-3 text-xs font-black uppercase text-white shadow-[0_0_28px_rgba(124,58,237,0.24)] transition hover:bg-violet-500/34 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting ? <CheckCircle2 className="h-4 w-4 animate-pulse" /> : <Plus className="h-4 w-4" />}
            {submitting ? "Creating Event..." : "Create Event"}
          </button>
        </form>
        <aside className="space-y-5">
          <PremiumLockedCard title="PRO / PREMIUM EVENT TOOL" message="Event creation and cross-server matching use your existing Pro/Premium entitlement. Free users keep teaser access." />
          <InfoPanel title="Creation Safeties" rows={[
            ["Category", selectedCategory ? `${CATEGORY_LABELS[selectedCategory]} only` : "Set category first"],
            ["Telemetry", "Reads existing ADM aggregates only"],
            ["Registration", "Same-category guard enforced by API"],
            ["Stats", "No historical player data is changed"],
          ]} />
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase text-white"><CalendarDays className="h-4 w-4 text-violet-200" />Owner checklist</h2>
            {[
              "Select the hosting server.",
              "Confirm its server category.",
              "Set the event window.",
              "Publish rules and rewards.",
            ].map((item) => (
              <div key={item} className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
                <LockKeyhole className="h-3.5 w-3.5 text-cyan-200" />
                {item}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </EventsShell>
  );
}

export function EventsHubPage() {
  const fallback = useMemo(() => fallbackEventsPayload(), []);
  const { data, loadState } = useEventsPayload("/api/events?limit=24", fallback);
  const active = data.events.filter((event) => event.status === "live");
  const upcoming = data.events.filter((event) => ["upcoming", "registration_open", "standby"].includes(event.status));
  const top = fallbackServers[0];
  return (
    <EventsShell>
      <EventHero />
      <EventTabs active="CTF Tournaments" />
      <StaleNotice state={loadState} source={data.source} />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <main className="space-y-5">
          <PulseEventSpotlight event={(active[0] ?? upcoming[0] ?? data.events[0]) ?? null} />
          <ServerWarsTeaser />
          <CommunitySuggestionsPanel />
          <SectionHeader title="Active Tournaments" href="/events/tournaments?status=active" />
          <div className="grid gap-4 lg:grid-cols-3">
            {(active.length ? active : data.events.slice(0, 3)).slice(0, 3).map((event) => <TournamentCard key={event.id} event={event} />)}
          </div>
          <SectionHeader title="Upcoming Tournaments" href="/events/tournaments?status=upcoming" />
          <div className="grid gap-4 md:grid-cols-3">
            {(upcoming.length ? upcoming : data.events.slice(3, 6)).slice(0, 3).map((event) => <TournamentCard key={event.id} event={event} compact />)}
          </div>
          <SeasonBanner />
          <SectionHeader title="Category-Safe Battle Cards" href="/events/challenges" />
          <div className="grid gap-4 lg:grid-cols-2">
            {fallbackMatches.slice(0, 2).map((match) => <LiveBattleCard key={match.id} match={match} />)}
          </div>
          <LeaderboardTeaser rows={fallbackServers} locked={data.teaserMode} />
        </main>
        <aside className="space-y-5">
          <OverviewCard summary={data.summary} />
          <TopServerCard server={top} />
          <LiveActivityFeed activity={fallbackActivity} />
          <PremiumLockedCard title="SAME CATEGORY ONLY" message="Deathmatch can only fight Deathmatch, PvP can only fight PvP, and every join/match API enforces the same rule." />
        </aside>
      </div>
    </EventsShell>
  );
}

function CommunitySuggestionsPanel() {
  const lanes = ["Trending", "New", "Shortlisted", "Accepted", "Converted into Events"];
  return (
    <section className="rounded-lg border border-cyan-300/18 bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Community Suggestions</p>
          <h2 className="mt-1 text-xl font-black text-white">Vote on future DZN competition ideas</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Public suggestions can be submitted and voted on after Discord login. Accepted ideas remain community suggestions until the platform creator converts them into private official drafts.
          </p>
        </div>
        <EventActionLink href="/events/suggest">Open suggestion board</EventActionLink>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {lanes.map((lane) => (
          <div key={lane} className="rounded-lg border border-white/10 bg-black/25 p-3">
            <div className="flex items-center gap-2 text-xs font-black uppercase text-zinc-200">
              <Swords className="h-3.5 w-3.5 text-cyan-200" />
              {lane}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function EventsTournamentsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const status = searchParams.get("status") ?? "all";
  const [type, setType] = useState("all");
  const [category, setCategory] = useState("all");
  const handleStatus = (nextStatus: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextStatus === "all") params.delete("status");
    else params.set("status", nextStatus);
    const queryString = params.toString();
    router.push(queryString ? `/events/tournaments?${queryString}` : "/events/tournaments");
  };
  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "100", full: "true" });
    if (status !== "all") params.set("status", status);
    if (type !== "all") params.set("type", type);
    if (category !== "all") params.set("category", category);
    return `/api/events?${params.toString()}`;
  }, [category, status, type]);
  const fallback = useMemo(() => fallbackEventsPayload(), []);
  const { data, loadState } = useEventsPayload(query, fallback);
  const visibleEvents = useMemo(() => filterEventsForView(data.events, { status, type, category }), [category, data.events, status, type]);
  return (
    <EventsShell>
      <HeaderLine title="EVENTS" subtitle="Search and filter DZN tournaments by status, category, type, and date." action={<div className="flex flex-wrap gap-2"><EventActionLink href="/events">Events Hub</EventActionLink><EventActionLink href="/events/suggest">Suggest Competition</EventActionLink></div>} />
      <EventTabs active={status === "active" || status === "live" ? "Active" : status === "completed" || status === "ended" ? "Completed" : status === "upcoming" ? "Upcoming" : "CTF Tournaments"} />
      <StaleNotice state={loadState} source={data.source} />
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <main className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <Search className="h-4 w-4 text-zinc-500" />
            <span className="text-xs font-black uppercase text-zinc-400">Showing {visibleEvents.length} category-safe events</span>
          </div>
          <TournamentTable events={visibleEvents} />
        </main>
        <EventFilterPanel
          status={status}
          type={type}
          category={category}
          onStatus={handleStatus}
          onType={setType}
          onCategory={setCategory}
          onReset={() => {
            handleStatus("all");
            setType("all");
            setCategory("all");
          }}
        />
      </div>
    </EventsShell>
  );
}

export function EventDetailPage({ slug: slugProp }: { slug?: string } = {}) {
  const routeSlug = useSlugParam();
  const slug = slugProp ?? routeSlug;
  const { data, loadState } = useEventDetail(slug);
  const event = data.event;
  return (
    <EventsShell>
      <EventHero event={event} detail />
      <EventDetailTabs slug={event.slug} active="Overview" />
      <StaleNotice state={loadState} source={data.source} />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <main className="space-y-5">
          <LeaderboardTeaser rows={data.leaderboard} locked={data.premiumLocked} title="Event Leaderboard" />
          <div className="grid gap-4 md:grid-cols-2">
            <InfoPanel title="Event Info" rows={[
              ["Start Date", event.starts_at ? new Date(event.starts_at).toUTCString() : "TBD"],
              ["End Date", event.ends_at ? new Date(event.ends_at).toUTCString() : "TBD"],
              ["Type", event.event_type_label],
              ["Format", `${event.registered_servers} servers · ${event.match_count} rounds`],
              ["Point System", event.event_type === "capture_the_flag" ? "Flag captures and roster-verified actions" : "Metric tally based on event type"],
            ]} />
            <InfoPanel title="Rules & Rewards" rows={[
              ["Rules", event.rules ?? "Same-category only. DZN dedupe applies."],
              ["Rewards", event.rewards ?? "Champion badge and leaderboard spotlight."],
            ]} />
          </div>
          <SectionHeader title="Participating Servers" href={`/events/${event.slug}/bracket`} />
          <div className="grid gap-3 md:grid-cols-2">
            {data.registered_servers.slice(0, 6).map((server) => (
              <div key={server.registration_id} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-black uppercase text-white">{server.server_name}</div>
                  <ServerCategoryBadge category={server.category} label={server.category_label} compact />
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full rounded-full bg-[linear-gradient(90deg,#7c3aed,#22d3ee)]" style={{ width: `${Math.min(100, server.score / 25)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </main>
        <aside className="space-y-5">
          <LiveActivityFeed activity={data.activity_feed} />
          <PremiumLockedCard message="Full bracket insights, advanced score history, and full event telemetry unlock with DZN Pro." />
        </aside>
      </div>
    </EventsShell>
  );
}

export function EventBracketPage({ slug: slugProp }: { slug?: string } = {}) {
  const routeSlug = useSlugParam();
  const slug = slugProp ?? routeSlug;
  const { data, loadState } = useEventDetail(slug);
  return (
    <EventsShell>
      <HeaderLine title="BRACKET" subtitle={`${data.event.name} · ${data.event.category_label}`} action={<EventActionLink href={`/events/${data.event.slug}`}>Overview</EventActionLink>} />
      <EventDetailTabs slug={data.event.slug} active="Bracket" />
      <StaleNotice state={loadState} source={data.source} />
      <div className="grid gap-5 xl:grid-cols-[1fr_260px]">
        <BracketView matches={data.matches} category={data.event.category} categoryLabel={data.event.category_label} />
        <aside className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <h2 className="text-sm font-black uppercase text-white">Champions</h2>
            {["Season 1", "Season 0", "Season -1"].map((season, index) => (
              <div key={season} className="mt-3 flex items-center justify-between rounded-md border border-white/8 bg-black/24 p-3 text-xs">
                <span className="text-zinc-400">{season}</span>
                <span className="font-black text-white">{fallbackServers[index]?.server_name ?? "TBD"}</span>
              </div>
            ))}
          </div>
          <PremiumLockedCard title="Share Bracket" message="Full bracket exports and share cards are premium event tools." />
        </aside>
      </div>
    </EventsShell>
  );
}

export function EventsChallengesPage() {
  const fallback = useMemo(() => fallbackEventsPayload(), []);
  const { data, loadState } = useEventsPayload("/api/events?type=kill_race&limit=24", fallback);
  return (
    <EventsShell>
      <HeaderLine title="CHALLENGES" subtitle="Connected-node battles, kill races, survival ladders, and premium top-10 teasers." action={<div className="flex flex-wrap gap-2"><EventActionLink href="/events">All Events</EventActionLink><EventActionLink href="/events/suggest">Suggest Competition</EventActionLink></div>} />
      <StaleNotice state={loadState} source={data.source} />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <main className="space-y-5">
          <PulseFeaturedMatchup match={fallbackMatches[0] ?? null} />
          <div className="grid gap-4 lg:grid-cols-2">
            {fallbackMatches.slice(0, 4).map((match) => <ChallengeBattleCard key={match.id} match={match} locked={data.teaserMode} />)}
          </div>
          <LeaderboardTeaser rows={fallbackServers} locked={data.teaserMode} />
        </main>
        <aside className="space-y-5">
          <PremiumLockedCard title="CROSS-SERVER MATCHING" message="Cross-server matching is an exclusive Pro/Premium platform feature." />
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase text-white"><Filter className="h-4 w-4 text-cyan-200" />Challenge Filters</h2>
            {["deathmatch", "pvp", "pve", "pvp_pve", "hardcore", "roleplay"].map((category) => (
              <div key={category} className="mt-3">
                <ServerCategoryBadge category={category} compact />
              </div>
            ))}
          </div>
          <LiveActivityFeed activity={fallbackActivity} />
        </aside>
      </div>
    </EventsShell>
  );
}

export function ServerEventsPage({ slug: slugProp }: { slug?: string } = {}) {
  const routeSlug = useSlugParam();
  const slug = slugProp ?? routeSlug;
  const { data, loadState } = useServerEvents(slug);
  return (
    <EventsShell>
      <HeaderLine title="SERVER EVENTS" subtitle="Server-specific event identity, compatible tournaments, trophies, and match history." action={<EventActionLink href="/events">Events Hub</EventActionLink>} />
      <StaleNotice state={loadState} source={data.source} />
      <ServerEventProfile profile={data} />
    </EventsShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-normal text-zinc-500">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function eventInputClass() {
  return "w-full rounded-lg border border-white/10 bg-black/36 px-3 py-3 text-sm font-bold text-white outline-none transition placeholder:text-zinc-600 focus:border-violet-300/50 focus:bg-black/48";
}

function serverDisplayLabel(server: AuthServer) {
  return server.display_name || server.hostname || server.server_name || server.nitrado_service_name || `Server ${server.id}`;
}

function normalizeClientCategory(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s/-]+/g, "_");
  if (!raw) return null;
  if (["deathmatch", "dm", "death_match"].includes(raw)) return "deathmatch";
  if (["pvp", "pvp_only"].includes(raw)) return "pvp";
  if (["pve", "pve_only"].includes(raw)) return "pve";
  if (["pvp_pve", "pvpve", "mixed"].includes(raw)) return "pvp_pve";
  if (["hardcore", "hc"].includes(raw)) return "hardcore";
  if (["roleplay", "rp"].includes(raw)) return "roleplay";
  if (["faction_wars", "factions"].includes(raw)) return "faction_wars";
  if (["vanilla", "modded"].includes(raw)) return raw;
  return null;
}

function EventsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const nav = [
    { href: "/", label: "Overview", icon: Home },
    { href: "/servers", label: "Servers", icon: Server },
    { href: "/leaderboards", label: "Leaderboards", icon: BarChart3 },
    { href: "/seasons", label: "Seasons", icon: CalendarDays },
    { href: "/events", label: "Events", icon: Flag },
    { href: "/events/tournaments", label: "CTF Tournaments", icon: Trophy },
    { href: "/events/challenges", label: "Challenges", icon: Swords },
  ];
  return (
    <DznPulseProvider enablePopups>
      <main className="min-h-screen bg-[#02030a] text-zinc-100">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_24%_0%,rgba(124,58,237,0.18),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,165,233,0.12),transparent_30%),linear-gradient(180deg,#02030a,#050816_48%,#02030a)]" />
        <div className="relative grid min-h-screen lg:grid-cols-[220px_1fr]">
          <aside className="hidden border-r border-white/8 bg-black/28 p-4 backdrop-blur-xl lg:block">
            <DznLogo />
            <nav className="mt-6 space-y-1">
              {nav.map((item) => {
                const active = isSidebarItemActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-black uppercase transition", active ? "bg-violet-500/24 text-white shadow-[0_0_18px_rgba(124,58,237,0.2)]" : "text-zinc-500 hover:bg-white/[0.04] hover:text-white")}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
              <PulseEventsSidebarItem pathname={pathname} />
              <Link href="/dashboard" className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-black uppercase transition", isSidebarItemActive(pathname, "/dashboard") ? "bg-violet-500/24 text-white shadow-[0_0_18px_rgba(124,58,237,0.2)]" : "text-zinc-500 hover:bg-white/[0.04] hover:text-white")}>
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>
            </nav>
          </aside>
          <div className="min-w-0">
            <header className="sticky top-0 z-20 border-b border-white/8 bg-[#02030a]/86 px-4 py-3 backdrop-blur-xl lg:hidden">
              <div className="flex items-center justify-between gap-3">
                <DznLogo />
                <div className="flex items-center gap-2">
                  <DznPulseBell />
                  <Link href="/events" className="rounded-lg border border-violet-300/30 bg-violet-500/16 px-3 py-2 text-xs font-black uppercase text-white">Events</Link>
                </div>
              </div>
            </header>
            <PulseEventsDesktopBell />
            <div className="flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">{children}</div>
          </div>
        </div>
      </main>
    </DznPulseProvider>
  );
}

function PulseEventsSidebarItem({ pathname }: { pathname: string }) {
  const pulse = usePulseContextOptional();
  if (!pulse?.enabled) return null;
  const active = isSidebarItemActive(pathname, "/dzn-pulse");
  return (
    <Link href="/dzn-pulse" className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-black uppercase transition", active ? "bg-violet-500/24 text-white shadow-[0_0_18px_rgba(124,58,237,0.2)]" : "text-zinc-500 hover:bg-white/[0.04] hover:text-white")}>
      <Activity className="h-4 w-4" />
      <span className="min-w-0 flex-1">DZN Pulse</span>
      <span className="rounded bg-blue-500/22 px-1.5 py-0.5 text-[9px] text-blue-100">NEW</span>
    </Link>
  );
}

function PulseEventsDesktopBell() {
  const pulse = usePulseContextOptional();
  if (!pulse?.enabled) return null;
  return (
    <div className="hidden justify-end px-4 pt-4 sm:px-6 lg:flex lg:px-8">
      <DznPulseBell />
    </div>
  );
}

function isSidebarItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/events/challenges") return pathname.startsWith("/events/challenges");
  if (href === "/events/tournaments") return pathname.startsWith("/events/tournaments");
  if (href === "/events") {
    return pathname === "/events" || (pathname.startsWith("/events/") && !pathname.startsWith("/events/tournaments") && !pathname.startsWith("/events/challenges"));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function useEventsPayload(endpoint: string, fallback: EventsPayload) {
  const [data, setData] = useState<EventsPayload>(fallback);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const latest = useRef(0);
  useEffect(() => {
    const requestId = latest.current + 1;
    latest.current = requestId;
    fetchJsonWithRetry<EventsPayload>(endpoint, { credentials: "include", headers: { accept: "application/json" }, timeoutMs: 12_000 })
      .then((payload) => {
        if (latest.current !== requestId) return;
        if (payload.ok && Array.isArray(payload.events)) {
          setData(payload.events.length ? payload : fallback);
          setLoadState("loaded");
        }
      })
      .catch(() => {
        if (latest.current !== requestId) return;
        setLoadState("stale");
      });
  }, [endpoint, fallback]);
  return { data, loadState };
}

function useEventDetail(slug: string) {
  const fallback = useMemo(() => fallbackEventDetail(slug), [slug]);
  const [data, setData] = useState<EventDetailPayload>(fallback);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  useEffect(() => {
    fetchJsonWithRetry<EventDetailPayload>(`/api/events/${encodeURIComponent(slug)}?full=true`, { credentials: "include", headers: { accept: "application/json" }, timeoutMs: 12_000 })
      .then((payload) => {
        if (payload.ok && payload.event) {
          setData(payload);
          setLoadState("loaded");
        }
      })
      .catch(() => setLoadState("stale"));
  }, [slug]);
  return { data, loadState };
}

function useServerEvents(slug: string) {
  const fallback = useMemo(() => fallbackServerEvents(slug), [slug]);
  const [data, setData] = useState<ServerEventsPayload>(fallback);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  useEffect(() => {
    fetchJsonWithRetry<ServerEventsPayload>(`/api/servers/${encodeURIComponent(slug)}/events`, { credentials: "include", headers: { accept: "application/json" }, timeoutMs: 12_000 })
      .then((payload) => {
        if (payload.ok && payload.server) {
          setData(payload);
          setLoadState("loaded");
        }
      })
      .catch(() => setLoadState("stale"));
  }, [slug]);
  return { data, loadState };
}

function useSlugParam() {
  const params = useParams<{ slug?: string }>();
  const slug = params?.slug;
  return Array.isArray(slug) ? slug[0] ?? "dzn-season-1" : slug ?? "dzn-season-1";
}

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-black uppercase text-white">{title}</h2>
      <Link href={href} className="text-[10px] font-black uppercase text-violet-200 transition hover:text-white">View all</Link>
    </div>
  );
}

function HeaderLine({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[radial-gradient(circle_at_24%_0%,rgba(124,58,237,0.18),transparent_32%),rgba(3,7,18,0.86)] p-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-4xl font-black uppercase text-white sm:text-5xl">{title}</h1>
        <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>
      </div>
      {action}
    </section>
  );
}

function PulseEventSpotlight({ event }: { event: CompetitiveEvent | null }) {
  const pulse = usePulseContextOptional();
  if (!pulse?.enabled || !event) return null;
  const artwork = event.banner_url;
  return (
    <article className="relative overflow-hidden rounded-xl border border-violet-300/24 bg-[#050812] shadow-[0_28px_110px_rgba(0,0,0,0.34)]">
      {artwork ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artwork} alt="" loading="lazy" decoding="async" width={1280} height={720} className="absolute inset-0 h-full w-full object-cover opacity-38" />
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.24),transparent_34%),radial-gradient(circle_at_88%_20%,rgba(249,115,22,0.22),transparent_34%),linear-gradient(90deg,rgba(5,8,18,0.96),rgba(5,8,18,0.72),rgba(5,8,18,0.96))]" />
      <div className="relative z-10 grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-md border border-amber-300/32 bg-amber-400/12 px-2.5 py-1 text-[10px] font-black uppercase text-amber-100">Featured Event</span>
            <span className="rounded-md border border-violet-300/30 bg-violet-500/12 px-2.5 py-1 text-[10px] font-black uppercase text-violet-100">{event.category_label}</span>
          </div>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.26em] text-cyan-100">Server VS Server</p>
          <h2 className="mt-2 max-w-xl text-4xl font-black uppercase leading-none text-white sm:text-5xl">{event.name}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">{event.description}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[390px]">
          <PulseSpotlightStat label="Servers" value={formatNumber(event.registered_servers)} />
          <PulseSpotlightStat label="Players" value={formatNumber(event.total_participants)} />
          <PulseSpotlightStat label="Starts In" value={<ClientTimeUntil value={event.starts_at} />} />
        </div>
        <div className="lg:col-span-2 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="h-2 overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
            <span className="block h-full rounded-full bg-[linear-gradient(90deg,#22d3ee,#8b5cf6,#f97316)]" style={{ width: `${Math.max(0, Math.min(100, event.progress_percent))}%` }} />
          </div>
          <Link href={`/events/${event.slug}`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-violet-300/32 bg-violet-500/18 px-5 text-xs font-black uppercase text-white transition hover:bg-violet-500/28">
            View Details
          </Link>
        </div>
      </div>
    </article>
  );
}

function PulseFeaturedMatchup({ match }: { match: EventMatch | null }) {
  const pulse = usePulseContextOptional();
  if (!pulse?.enabled || !match) return null;
  return (
    <article className="overflow-hidden rounded-xl border border-violet-300/24 bg-[#050812] shadow-[0_28px_110px_rgba(0,0,0,0.34)]">
      <div className="relative grid min-h-[260px] lg:grid-cols-[1fr_auto_1fr]">
        <PulseMatchSide tone="blue" label="Blue Side" name={match.left_server.server_name} score={match.left_score} />
        <div className="relative z-10 flex flex-col items-center justify-center border-y border-white/10 bg-black/34 px-5 py-4 lg:border-x lg:border-y-0">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-black uppercase text-white">VS</span>
          <p className="mt-4 text-[10px] font-black uppercase text-zinc-500">Ends In</p>
          <p className="mt-1 font-mono text-lg font-black text-white"><ClientTimeUntil value={match.ends_at} /></p>
        </div>
        <PulseMatchSide tone="orange" label="Orange Side" name={match.right_server.server_name} score={match.right_score} alignRight />
      </div>
      <div className="grid gap-3 border-t border-white/10 p-4 text-xs sm:grid-cols-4">
        <PulseSpotlightStat label="Roster" value="Verified" />
        <PulseSpotlightStat label="Metric" value="Tally Live" />
        <PulseSpotlightStat label="Mode" value={match.category_label} />
        <Link href="/events/dzn-season-1/bracket" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-violet-300/32 bg-violet-500/18 px-4 text-[10px] font-black uppercase text-white">
          View Match Details
        </Link>
      </div>
    </article>
  );
}

function PulseMatchSide({ tone, label, name, score, alignRight = false }: { tone: "blue" | "orange"; label: string; name: string; score: number; alignRight?: boolean }) {
  const blue = tone === "blue";
  return (
    <div className={`relative min-h-[180px] overflow-hidden ${blue ? "bg-cyan-500/10" : "bg-orange-500/10"}`}>
      <div className={`absolute inset-0 ${blue ? "bg-[radial-gradient(circle_at_20%_28%,rgba(34,211,238,0.32),transparent_42%),linear-gradient(90deg,rgba(5,8,18,0.24),rgba(5,8,18,0.84))]" : "bg-[radial-gradient(circle_at_80%_28%,rgba(249,115,22,0.32),transparent_42%),linear-gradient(270deg,rgba(5,8,18,0.24),rgba(5,8,18,0.84))]"}`} />
      <div className={`relative z-10 flex h-full min-h-[180px] flex-col justify-center p-5 ${alignRight ? "items-end text-right" : ""}`}>
        <p className={`text-[10px] font-black uppercase ${blue ? "text-cyan-200" : "text-orange-200"}`}>{label}</p>
        <h3 className="mt-2 text-2xl font-black uppercase text-white">{name}</h3>
        <p className={`mt-3 font-mono text-5xl font-black ${blue ? "text-cyan-100" : "text-orange-100"}`}>{formatNumber(score)}</p>
      </div>
    </div>
  );
}

function PulseSpotlightStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-black uppercase text-white">{value}</p>
    </div>
  );
}

function EventActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center justify-center rounded-lg border border-violet-300/35 bg-violet-500/18 px-4 py-3 text-xs font-black uppercase text-violet-50 transition hover:bg-violet-500/28">
      {children}
    </Link>
  );
}

function OverviewCard({ summary }: { summary: EventsPayload["summary"] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <h2 className="text-sm font-black uppercase text-white">Event Overview</h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <OverviewStat label="Active Events" value={summary.active_events} />
        <OverviewStat label="Upcoming" value={summary.upcoming_events} />
        <OverviewStat label="Registered" value={summary.registered_servers} />
        <OverviewStat label="Participants" value={summary.total_participants} />
      </div>
    </section>
  );
}

function OverviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/8 bg-black/24 p-3">
      <div className="font-mono text-xl font-black text-white">{formatNumber(value)}</div>
      <div className="mt-1 text-[10px] font-black uppercase text-zinc-500">{label}</div>
    </div>
  );
}

function TopServerCard({ server }: { server: typeof fallbackServers[number] }) {
  return (
    <section className="rounded-lg border border-amber-300/22 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(124,58,237,0.08)),rgba(3,7,18,0.86)] p-4">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase text-white"><Crown className="h-4 w-4 text-amber-200" />Top Performing Server</h2>
      <div className="mt-4 rounded-lg border border-white/10 bg-black/24 p-4">
        <div className="text-lg font-black uppercase text-white">{server.server_name}</div>
        <div className="mt-2"><ServerCategoryBadge category={server.category} label={server.category_label} compact /></div>
        <div className="mt-4 font-mono text-2xl font-black text-amber-100">{formatNumber(server.score)} pts</div>
      </div>
    </section>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <h2 className="text-sm font-black uppercase text-white">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md border border-white/8 bg-black/24 p-3">
            <div className="text-[10px] font-black uppercase text-zinc-500">{label}</div>
            <div className="mt-1 text-sm text-zinc-200">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EventDetailTabs({ slug, active }: { slug: string; active: "Overview" | "Bracket" }) {
  const tabs = [
    { label: "Overview", href: `/events/${slug}` },
    { label: "Bracket", href: `/events/${slug}/bracket` },
    { label: "Teams", href: `/events/${slug}` },
    { label: "Scores", href: `/events/${slug}` },
    { label: "Matches", href: `/events/${slug}/bracket` },
    { label: "Rewards", href: `/events/${slug}` },
  ];
  return (
    <nav className="flex flex-wrap gap-2 rounded-lg border border-white/8 bg-black/24 p-1">
      {tabs.map((tab) => (
        <Link key={tab.label} href={tab.href} className={cn("rounded-md px-3 py-2 text-[10px] font-black uppercase text-zinc-400 transition hover:text-white", active === tab.label && "bg-violet-500/22 text-violet-50")}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

function StaleNotice({ state, source }: { state: LoadState; source: string }) {
  if (state === "loaded" && source !== "display_fallback") return null;
  const label = state === "loading"
    ? "Syncing live data"
    : source === "display_fallback"
      ? "Demo data shown until live events are created"
      : "Showing last-known event data";
  return (
    <div className="flex">
      <span className="inline-flex items-center rounded-full border border-amber-300/22 bg-amber-500/8 px-3 py-1.5 text-[10px] font-black uppercase tracking-normal text-amber-100">
        {label}
      </span>
    </div>
  );
}
