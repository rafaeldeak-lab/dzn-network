"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Crown,
  Filter,
  Flag,
  Home,
  LayoutDashboard,
  Search,
  Server,
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
  type EventDetailPayload,
  type EventsPayload,
  type ServerEventsPayload,
} from "./event-data";
import { cn, formatNumber } from "./event-format";
import { BracketView } from "./BracketView";
import { ChallengeBattleCard } from "./ChallengeBattleCard";
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

type LoadState = "loading" | "loaded" | "stale";
type TournamentStatusFilter = "all" | "upcoming" | "active" | "completed" | string;

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
      <HeaderLine title="EVENTS" subtitle="Search and filter DZN tournaments by status, category, type, and date." action={<EventActionLink href="/events">Events Hub</EventActionLink>} />
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
      <HeaderLine title="CHALLENGES" subtitle="Connected-node battles, kill races, survival ladders, and premium top-10 teasers." action={<EventActionLink href="/events">All Events</EventActionLink>} />
      <StaleNotice state={loadState} source={data.source} />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <main className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            {fallbackMatches.slice(0, 4).map((match) => <ChallengeBattleCard key={match.id} match={match} locked={data.teaserMode} />)}
          </div>
          <LeaderboardTeaser rows={fallbackServers} locked={data.teaserMode} />
        </main>
        <aside className="space-y-5">
          <PremiumLockedCard title="CROSS-SERVER MATCHING" message="Cross-server matching is an exclusive Pro/Partner platform feature." />
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

function EventsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const nav = [
    { href: "/", label: "Overview", icon: Home },
    { href: "/servers", label: "Servers", icon: Server },
    { href: "/leaderboards", label: "Leaderboards", icon: BarChart3 },
    { href: "/events", label: "Events", icon: Flag },
    { href: "/events/tournaments", label: "CTF Tournaments", icon: Trophy },
    { href: "/events/challenges", label: "Challenges", icon: Swords },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  ];
  return (
    <main className="min-h-screen bg-[#02030a] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_24%_0%,rgba(124,58,237,0.18),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,165,233,0.12),transparent_30%),linear-gradient(180deg,#02030a,#050816_48%,#02030a)]" />
      <div className="relative grid min-h-screen lg:grid-cols-[220px_1fr]">
        <aside className="hidden border-r border-white/8 bg-black/28 p-4 backdrop-blur-xl lg:block">
          <Link href="/" className="block">
            <DznLogo />
          </Link>
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
          </nav>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-white/8 bg-[#02030a]/86 px-4 py-3 backdrop-blur-xl lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <DznLogo />
              <Link href="/events" className="rounded-lg border border-violet-300/30 bg-violet-500/16 px-3 py-2 text-xs font-black uppercase text-white">Events</Link>
            </div>
          </header>
          <div className="flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">{children}</div>
        </div>
      </div>
    </main>
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
