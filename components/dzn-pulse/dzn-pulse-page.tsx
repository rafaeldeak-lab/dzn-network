"use client";

import Link from "next/link";
import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  Crown,
  Flag,
  Home,
  LayoutDashboard,
  Radio,
  Server,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { DznPulseBell, DznPulseProvider } from "@/components/dzn-pulse/dzn-pulse-provider";
import { fetchJsonWithRetry } from "@/lib/client-fetch";

type PulseSummary = {
  ok: boolean;
  generated_at: string;
  metrics: {
    live_events: number;
    active_servers: number;
    players_online: number;
    matches_today: number;
    event_registrations: number;
    participating_servers: number;
    connected_communities: number;
  };
  live_event: PulseEventSummary | null;
  top_server: PulseServerSummary | null;
  announcements: PulseAnnouncement[];
  monthly_rankings: PulseRankRow[];
  upcoming_events: PulseEventSummary[];
  achievements: PulseAchievement[];
  recent_activity: PulseActivity[];
  top10: PulseRankRow[];
};

type PulseEventSummary = {
  id: string;
  slug: string;
  name: string;
  event_type_label: string;
  category_label: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  registered_servers: number;
  participants: number;
  match_count: number;
  progress: number;
  artwork_url: string | null;
};

type PulseServerSummary = {
  id: string;
  slug: string | null;
  name: string;
  category: string | null;
  category_label: string | null;
  score: number;
  score_label: string;
  rank: number | null;
  players_online: number | null;
  max_players: number | null;
  win_loss: string | null;
  kd_ratio: number | null;
};

type PulseAnnouncement = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  action_url: string | null;
};

type PulseRankRow = {
  rank: number | null;
  server_name: string;
  server_slug: string | null;
  category_label: string | null;
  points: number;
  win_loss: string | null;
};

type PulseAchievement = {
  id: string;
  name: string;
  requirement: string;
  progress: number | null;
  target: number | null;
  current: number | null;
  earned_at: string | null;
};

type PulseActivity = {
  id: string;
  title: string;
  subtitle: string;
  created_at: string;
  action_url: string | null;
};

const CATEGORY_STEPS = ["Select Category", "Find Match", "Compete Live", "Earn Rewards"];
const CATEGORY_CHIPS = ["Deathmatch", "PvP", "PvE", "PvP/PvE", "Hardcore", "Roleplay"];

export function DznPulsePage() {
  return (
    <DznPulseProvider enablePopups>
      <DznPulsePageContent />
    </DznPulseProvider>
  );
}

function DznPulsePageContent() {
  const [summary, setSummary] = useState<PulseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchJsonWithRetry<PulseSummary>("/api/dzn-pulse/summary", {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
        retries: 1,
        timeoutMs: 12_000,
      });
      setSummary(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "DZN Pulse could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const metrics = summary?.metrics ?? {
    live_events: 0,
    active_servers: 0,
    players_online: 0,
    matches_today: 0,
    event_registrations: 0,
    participating_servers: 0,
    connected_communities: 0,
  };

  return (
    <main className="min-h-screen bg-[#02030a] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_22%_0%,rgba(124,58,237,0.22),transparent_30%),radial-gradient(circle_at_82%_16%,rgba(34,211,238,0.12),transparent_32%),linear-gradient(180deg,#02030a,#050812_48%,#02030a)]" />
      <div className="relative grid min-h-screen lg:grid-cols-[220px_1fr]">
        <PulseSidebar />
        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/8 bg-[#02030a]/86 px-4 py-3 backdrop-blur-xl lg:hidden">
            <DznLogo />
            <DznPulseBell />
          </header>
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
            <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-5xl font-black uppercase leading-none text-white sm:text-6xl">DZN Pulse</h1>
                  {metrics.live_events > 0 ? <span className="rounded-full border border-rose-300/35 bg-rose-500/18 px-3 py-1 text-[10px] font-black uppercase text-rose-100">Live Network</span> : null}
                  <span className="rounded-full border border-emerald-300/24 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase text-emerald-100">All systems operational</span>
                </div>
                <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-zinc-400">
                  The heartbeat of the DZN Network. Live events. Real competition. One connected community.
                </p>
              </div>
              <div className="hidden lg:block">
                <DznPulseBell />
              </div>
            </section>

            {error ? <PulseError message={error} onRetry={() => void load()} /> : null}

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard icon={Radio} label="Live Events" value={metrics.live_events} />
              <MetricCard icon={Server} label="Active Servers" value={metrics.active_servers} />
              <MetricCard icon={Users} label="Players Online" value={metrics.players_online} />
              <MetricCard icon={Swords} label="Matches Today" value={metrics.matches_today} />
              <MetricCard icon={ShieldCheck} label="Connected Communities" value={metrics.connected_communities} />
            </section>

            {loading && !summary ? <PulseSkeleton /> : null}

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
              <LiveEventHero event={summary?.live_event ?? null} />
              <div className="grid gap-5">
                <TopServerCard server={summary?.top_server ?? null} />
                <AnnouncementsPanel announcements={summary?.announcements ?? []} />
              </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(360px,0.75fr)]">
              <RankingsPanel rows={summary?.monthly_rankings ?? []} title="Monthly Rankings" />
              <UpcomingEventsPanel events={summary?.upcoming_events ?? []} />
              <AchievementsPanel achievements={summary?.achievements ?? []} />
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(360px,0.75fr)]">
              <SameCategoryPanel />
              <RankingsPanel rows={summary?.top10 ?? []} title="Top 10 Master Teaser" compact />
              <RecentActivityPanel activity={summary?.recent_activity ?? []} />
            </section>

            {summary?.live_event ? (
              <div className="sticky bottom-0 z-20 rounded-t-xl border border-violet-300/22 bg-[#050812]/92 px-4 py-3 text-center text-[10px] font-black uppercase text-violet-50 backdrop-blur-xl">
                Live now - {summary.live_event.name} - {formatNumber(summary.live_event.participants)} players - {formatNumber(summary.live_event.registered_servers)} servers
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function PulseSidebar() {
  const nav = [
    { href: "/", label: "Overview", icon: Home },
    { href: "/servers", label: "Servers", icon: Server },
    { href: "/leaderboards", label: "Leaderboards", icon: BarChart3 },
    { href: "/seasons", label: "Seasons", icon: CalendarDays },
    { href: "/events", label: "Events", icon: Flag },
    { href: "/events/tournaments", label: "CTF Tournaments", icon: Trophy },
    { href: "/events/challenges", label: "Challenges", icon: Swords },
    { href: "/dzn-pulse", label: "DZN Pulse", icon: Activity, badge: "NEW" },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  ];
  return (
    <aside className="hidden border-r border-white/8 bg-black/28 p-4 backdrop-blur-xl lg:block">
      <Link href="/" className="block">
        <DznLogo />
      </Link>
      <nav className="mt-6 space-y-1" aria-label="DZN Pulse navigation">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/dzn-pulse";
          return (
            <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-black uppercase transition ${active ? "bg-violet-500/24 text-white shadow-[0_0_18px_rgba(124,58,237,0.2)]" : "text-zinc-500 hover:bg-white/[0.04] hover:text-white"}`}>
              <Icon className="h-4 w-4" />
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.badge ? <span className="rounded bg-blue-500/22 px-1.5 py-0.5 text-[9px] text-blue-100">{item.badge}</span> : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-violet-300/24 bg-violet-500/14 text-violet-100">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-2xl font-black text-white">{formatNumber(value)}</p>
          <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
        </div>
      </div>
    </article>
  );
}

function LiveEventHero({ event }: { event: PulseEventSummary | null }) {
  if (!event) {
    return (
      <Panel className="min-h-[280px]">
        <EmptyPanel icon={CalendarDays} title="No live events right now." body="Browse upcoming events." href="/events/tournaments?status=upcoming" action="View Upcoming Events" />
      </Panel>
    );
  }
  return (
    <Panel className="relative min-h-[320px] overflow-hidden p-0">
      {event.artwork_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.artwork_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-42" loading="lazy" />
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(168,85,247,0.28),transparent_36%),linear-gradient(90deg,rgba(5,8,18,0.96),rgba(5,8,18,0.66),rgba(5,8,18,0.94))]" />
      <div className="relative z-10 flex h-full min-h-[320px] flex-col justify-end p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-rose-300/30 bg-rose-500/16 px-2 py-1 text-[10px] font-black uppercase text-rose-100">{event.status === "live" ? "Live Now" : "Upcoming"}</span>
          <span className="rounded-md border border-violet-300/30 bg-violet-500/12 px-2 py-1 text-[10px] font-black uppercase text-violet-100">{event.category_label}</span>
        </div>
        <h2 className="mt-4 text-3xl font-black uppercase text-white sm:text-4xl">{event.name}</h2>
        <p className="mt-1 text-sm font-bold text-zinc-300">{event.event_type_label}</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <MiniStat icon={Server} label="Servers" value={event.registered_servers} />
          <MiniStat icon={Users} label="Players" value={event.participants} />
          <MiniStat icon={Swords} label="Rounds" value={event.match_count} />
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
          <span className="block h-full rounded-full bg-[linear-gradient(90deg,#7c3aed,#22d3ee)]" style={{ width: `${Math.max(0, Math.min(100, event.progress))}%` }} />
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Link href={`/events/${event.slug}`} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-violet-300/36 bg-violet-500/24 px-4 text-xs font-black uppercase text-white">Join the Fight</Link>
          <Link href={`/events/${event.slug}`} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-4 text-xs font-black uppercase text-zinc-100">View Event</Link>
        </div>
      </div>
    </Panel>
  );
}

function TopServerCard({ server }: { server: PulseServerSummary | null }) {
  if (!server) return <Panel><EmptyPanel icon={Crown} title="Top server pending." body="Ranked server data will appear when the leaderboard has eligible rows." /></Panel>;
  return (
    <Panel>
      <PanelTitle icon={Crown} title="Top Performing Server" />
      <div className="mt-4 rounded-xl border border-violet-300/18 bg-[radial-gradient(circle_at_70%_0%,rgba(124,58,237,0.28),transparent_42%),rgba(255,255,255,0.035)] p-4">
        <h2 className="text-2xl font-black uppercase text-white">{server.name}</h2>
        {server.category_label ? <p className="mt-1 text-[10px] font-black uppercase text-violet-200">{server.category_label}</p> : null}
        <p className="mt-4 text-3xl font-black text-amber-100">{server.score_label || formatNumber(server.score)} pts</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <SmallValue label="W/L" value={server.win_loss ?? "Pending"} />
          <SmallValue label="K/D" value={server.kd_ratio == null ? "N/A" : server.kd_ratio.toFixed(2)} />
          <SmallValue label="Players" value={server.players_online == null ? "N/A" : String(server.players_online)} />
        </div>
        <Link href={server.slug ? `/servers/profile?slug=${encodeURIComponent(server.slug)}` : "/servers"} className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-violet-300/32 bg-violet-500/18 px-4 text-xs font-black uppercase text-white">View Server</Link>
      </div>
    </Panel>
  );
}

function AnnouncementsPanel({ announcements }: { announcements: PulseAnnouncement[] }) {
  return (
    <Panel>
      <PanelTitle icon={Bell} title="Network Announcements" href="/dzn-pulse" />
      <ListOrEmpty items={announcements} emptyTitle="No announcements." emptyBody="DZN announcements will appear here.">
        {announcements.slice(0, 3).map((item) => (
          <Link key={item.id} href={item.action_url ?? "/dzn-pulse"} className="flex items-center gap-3 rounded-lg border border-white/8 bg-black/22 p-3 transition hover:border-violet-300/28">
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-rose-300/20 bg-rose-500/12 text-rose-100"><Sparkles className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-white">{item.title}</span>
              <span className="block truncate text-xs text-zinc-500">{item.body}</span>
            </span>
            <span className="text-[10px] font-bold uppercase text-zinc-600">{timeAgo(item.created_at)}</span>
          </Link>
        ))}
      </ListOrEmpty>
    </Panel>
  );
}

function RankingsPanel({ rows, title, compact = false }: { rows: PulseRankRow[]; title: string; compact?: boolean }) {
  return (
    <Panel>
      <PanelTitle icon={Crown} title={title} href="/leaderboards" />
      <ListOrEmpty items={rows} emptyTitle="Rankings pending." emptyBody="Eligible ranked servers will appear when leaderboard data is available.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="text-[10px] uppercase text-zinc-500">
              <tr>
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Server</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3 text-right">Points</th>
                <th className="py-2 text-right">W/L</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, compact ? 3 : 5).map((row, index) => (
                <tr key={`${row.server_name}-${index}`} className="border-t border-white/8">
                  <td className="py-3 pr-3 font-black text-amber-100">{row.rank ?? index + 1}</td>
                  <td className="py-3 pr-3 font-black text-white">{row.server_slug ? <Link href={`/servers/profile?slug=${encodeURIComponent(row.server_slug)}`}>{row.server_name}</Link> : row.server_name}</td>
                  <td className="py-3 pr-3 text-zinc-400">{row.category_label ?? "N/A"}</td>
                  <td className="py-3 pr-3 text-right font-black text-white">{formatNumber(row.points)}</td>
                  <td className="py-3 text-right text-zinc-400">{row.win_loss ?? "N/A"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ListOrEmpty>
      <Link href="/leaderboards" className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-violet-300/24 bg-violet-500/16 px-4 text-xs font-black uppercase text-white">View Full Leaderboard</Link>
    </Panel>
  );
}

function UpcomingEventsPanel({ events }: { events: PulseEventSummary[] }) {
  return (
    <Panel>
      <PanelTitle icon={CalendarDays} title="Upcoming Events" href="/events/tournaments?status=upcoming" />
      <ListOrEmpty items={events} emptyTitle="No upcoming events." emptyBody="New events will appear here when registration opens.">
        {events.slice(0, 4).map((event) => (
          <Link key={event.id} href={`/events/${event.slug}`} className="grid grid-cols-[72px_1fr_auto] gap-3 rounded-lg border border-white/8 bg-black/22 p-2.5 transition hover:border-violet-300/28">
            <span className="overflow-hidden rounded-md border border-white/8 bg-violet-500/12">
              {event.artwork_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={event.artwork_url} alt="" loading="lazy" className="h-14 w-full object-cover" />
              ) : <span className="grid h-14 place-items-center"><Flag className="h-5 w-5 text-violet-200" /></span>}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black uppercase text-white">{event.name}</span>
              <span className="block text-xs text-zinc-500">{event.event_type_label}</span>
            </span>
            <span className="text-right text-[10px] font-black uppercase text-violet-200">{startsIn(event.starts_at)}</span>
          </Link>
        ))}
      </ListOrEmpty>
    </Panel>
  );
}

function AchievementsPanel({ achievements }: { achievements: PulseAchievement[] }) {
  return (
    <Panel>
      <PanelTitle icon={Trophy} title="Server Achievements" />
      <ListOrEmpty items={achievements} emptyTitle="No achievements yet." emptyBody="Earned achievements and real progress appear here.">
        {achievements.slice(0, 4).map((item) => {
          const progress = item.progress == null ? null : Math.max(0, Math.min(100, item.progress));
          return (
            <div key={item.id} className="rounded-lg border border-white/8 bg-black/22 p-3">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-500/12 text-cyan-100"><Trophy className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-white">{item.name}</p>
                  <p className="text-xs text-zinc-500">{item.requirement}</p>
                </div>
              </div>
              {progress != null ? (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-cyan-300" style={{ width: `${progress}%` }} /></div>
                  <p className="mt-1 text-right text-[10px] font-black uppercase text-zinc-500">{item.current ?? 0}/{item.target ?? 0}</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </ListOrEmpty>
    </Panel>
  );
}

function SameCategoryPanel() {
  return (
    <Panel>
      <PanelTitle icon={ShieldCheck} title="Same-Category Matching" />
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        DZN Pulse matches events with the same category for a fair, competitive experience. Only fight your equals.
      </p>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {CATEGORY_STEPS.map((step, index) => (
          <div key={step} className="rounded-lg border border-white/8 bg-black/22 p-2 text-center">
            <span className="mx-auto grid h-7 w-7 place-items-center rounded-full border border-violet-300/28 bg-violet-500/18 text-xs font-black text-white">{index + 1}</span>
            <p className="mt-2 text-[9px] font-black uppercase text-zinc-400">{step}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {CATEGORY_CHIPS.map((chip) => <span key={chip} className="rounded-md border border-violet-300/22 bg-violet-500/10 px-2.5 py-1 text-[10px] font-black uppercase text-violet-100">{chip}</span>)}
      </div>
    </Panel>
  );
}

function RecentActivityPanel({ activity }: { activity: PulseActivity[] }) {
  return (
    <Panel>
      <PanelTitle icon={Activity} title="Recent Activity" />
      <ListOrEmpty items={activity} emptyTitle="No recent activity." emptyBody="Live DZN activity appears here when available.">
        {activity.slice(0, 4).map((item) => (
          <Link key={item.id} href={item.action_url ?? "/events"} className="flex gap-3 rounded-lg border border-white/8 bg-black/22 p-3 transition hover:border-violet-300/28">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.7)]" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-white">{item.title}</span>
              <span className="block text-xs text-zinc-500">{item.subtitle}</span>
            </span>
            <span className="text-[10px] font-bold uppercase text-zinc-600">{timeAgo(item.created_at)}</span>
          </Link>
        ))}
      </ListOrEmpty>
    </Panel>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.25)] ${className}`}>{children}</section>;
}

function PanelTitle({ icon: Icon, title, href }: { icon: LucideIcon; title: string; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase text-white"><Icon className="h-4 w-4 text-violet-200" />{title}</h2>
      {href ? <Link href={href} className="text-[10px] font-black uppercase text-violet-200 transition hover:text-white">View all</Link> : null}
    </div>
  );
}

function ListOrEmpty<T>({ items, emptyTitle, emptyBody, children }: { items: T[]; emptyTitle: string; emptyBody: string; children: ReactNode }) {
  if (!items.length) return <EmptyPanel icon={Radio} title={emptyTitle} body={emptyBody} />;
  return <div className="mt-4 grid gap-3">{children}</div>;
}

function EmptyPanel({ icon: Icon, title, body, href, action }: { icon: LucideIcon; title: string; body: string; href?: string; action?: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-white/10 bg-black/18 p-5 text-center">
      <div>
        <Icon className="mx-auto h-8 w-8 text-violet-200" />
        <p className="mt-3 text-sm font-black uppercase text-white">{title}</p>
        <p className="mt-2 text-sm text-zinc-500">{body}</p>
        {href ? <Link href={href} className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg border border-violet-300/24 bg-violet-500/16 px-4 text-xs font-black uppercase text-white">{action ?? "Open"}</Link> : null}
      </div>
    </div>
  );
}

function PulseSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-3" aria-label="Loading DZN Pulse">
      {[0, 1, 2].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />)}
    </div>
  );
}

function PulseError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-amber-300/24 bg-amber-400/10 p-4 text-sm font-bold text-amber-50">
      <p>DZN Pulse could not be loaded.</p>
      <p className="mt-1 text-xs text-amber-100/80">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-amber-200/30 px-3 py-2 text-[10px] font-black uppercase text-amber-50">Retry</button>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="flex items-center gap-2 text-xs font-black text-white"><Icon className="h-4 w-4 text-violet-200" />{formatNumber(value)}</div>
      <p className="mt-1 text-[10px] font-black uppercase text-zinc-500">{label}</p>
    </div>
  );
}

function SmallValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-black/24 p-2">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 font-black text-white">{value}</p>
    </div>
  );
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(Number(value ?? 0));
}

function timeAgo(value: string | null | undefined) {
  const time = value ? Date.parse(value) : 0;
  if (!time) return "Just now";
  const diff = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function startsIn(value: string | null) {
  const time = value ? Date.parse(value) : 0;
  if (!time) return "TBD";
  const diff = Math.max(0, time - Date.now());
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Soon";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
