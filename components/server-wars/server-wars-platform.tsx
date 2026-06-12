"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, Crown, RefreshCw, Shield, Swords, Trophy } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { fetchJsonWithRetry } from "@/lib/client-fetch";

type WarStanding = {
  rank: number;
  serverId: string;
  serverName: string;
  serverSlug: string | null;
  category: string | null;
  score: number;
  metricBreakdown?: Record<string, unknown>;
  contributorSummary?: {
    topKillers?: Array<{ playerName: string; value: number }>;
    topBuilders?: Array<{ playerName: string; value: number }>;
    topActivity?: Array<{ playerName: string; value: number }>;
    notes?: string[];
  };
  snapshotAt: string;
};

type WarEvent = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  eventType: string;
  category: string | null;
  eligibleCategories: string[];
  status: string;
  scoringRulesetKey: string;
  scoringRulesetTitle: string;
  startsAt: string;
  endsAt: string;
  packageRequired: string;
  finalizedAt: string | null;
  standings: WarStanding[];
  awaitingSnapshot: boolean;
};

type ServerWarsPayload = {
  ok: boolean;
  generated_at?: string;
  rulesets?: Array<{ key: string; title: string; eligibleCategories: string[]; packageRequired: string; scoreEstimated?: boolean }>;
  events?: WarEvent[];
  champions?: Array<{ serverId: string; serverName: string; serverSlug: string | null; title: string; category: string | null; awardedAt: string | null }>;
  message?: string;
};

type WarDetailPayload = {
  ok: boolean;
  event: WarEvent | null;
  participants?: Array<{ serverId: string; serverName: string; serverSlug: string | null; categoryAtEntry: string | null; status: string }>;
  results?: Array<{ serverId: string; serverName: string; serverSlug: string | null; finalRank: number; finalScore: number }>;
  trophies?: Array<{ serverId: string; title: string; category: string | null; awardedAt: string }>;
  message?: string;
};

const emptyPayload: ServerWarsPayload = {
  ok: true,
  events: [],
  champions: [],
  rulesets: [],
};

export function ServerWarsPage() {
  const searchParams = useSearchParams();
  const selectedEventId = searchParams.get("event");
  const [payload, setPayload] = useState<ServerWarsPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const liveEvents = useMemo(() => (payload.events ?? []).filter((event) => event.status === "live"), [payload.events]);
  const upcomingEvents = useMemo(() => (payload.events ?? []).filter((event) => event.status === "scheduled"), [payload.events]);
  const completedEvents = useMemo(() => (payload.events ?? []).filter((event) => event.status === "completed"), [payload.events]);

  useEffect(() => {
    let active = true;
    loadServerWars().then((data) => {
      if (!active) return;
      setPayload(data);
      setError(data.message ?? "");
      setLoading(false);
    }).catch((loadError) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : "Server Wars are temporarily unavailable.");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  if (selectedEventId) {
    return <ServerWarDetailPage eventId={selectedEventId} />;
  }

  return (
    <div className="min-h-screen bg-[#02030a] text-white">
      <SiteHeader active="events" returnTo="/events/server-wars" />
      <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-4 pb-12 pt-4 sm:px-6">
        <ServerWarsHero />
        {error ? <SoftNotice message={error} /> : null}
        <section className="grid gap-4 lg:grid-cols-3">
          <WarSummaryCard title="Live Server Wars" value={String(liveEvents.length)} icon={Swords} />
          <WarSummaryCard title="Upcoming Challenges" value={String(upcomingEvents.length)} icon={CalendarDays} />
          <WarSummaryCard title="Current Champions" value={String(payload.champions?.length ?? 0)} icon={Crown} />
        </section>
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <WarEventGroup title="Live Events" events={liveEvents} loading={loading} />
            <WarEventGroup title="Scheduled Challenges" events={upcomingEvents} loading={loading} />
            <WarEventGroup title="Recent Winners" events={completedEvents} loading={loading} />
          </div>
          <aside className="space-y-5">
            <ChampionPanel champions={payload.champions ?? []} />
            <RulesetPanel rulesets={payload.rulesets ?? []} />
            <div className="rounded-xl border border-violet-300/18 bg-violet-500/10 p-4 text-sm font-bold leading-6 text-violet-50">
              Plans affect hosting, presentation, visibility, and archive display only. They do not change competition scoring.
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

export function ServerWarDetailPage({ eventId }: { eventId: string }) {
  const [payload, setPayload] = useState<WarDetailPayload>({ ok: true, event: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchJsonWithRetry<WarDetailPayload>(`/api/public/server-wars/${encodeURIComponent(eventId)}`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
      retries: 1,
      timeoutMs: 10_000,
    }).then((data) => {
      if (!active) return;
      setPayload(data);
      setError(data.message ?? "");
      setLoading(false);
    }).catch((loadError) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : "This Server War is temporarily unavailable.");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [eventId]);

  const event = payload.event;

  return (
    <div className="min-h-screen bg-[#02030a] text-white">
      <SiteHeader active="events" returnTo={`/events/server-wars/${eventId}`} />
      <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-4 pb-12 pt-4 sm:px-6">
        <Link href="/events/server-wars" className="w-fit rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 hover:text-white">
          Server Wars
        </Link>
        {loading ? <SkeletonPanel /> : null}
        {error ? <SoftNotice message={error} /> : null}
        {event ? (
          <>
            <section className="overflow-hidden rounded-2xl border border-violet-300/20 bg-[#080b19] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">Server VS Server</p>
              <h1 className="mt-3 text-4xl font-black uppercase leading-none text-white sm:text-6xl">{event.title}</h1>
              <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-zinc-300">{event.description ?? "Event-window score snapshots from real ADM-derived activity."}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Pill>{event.status}</Pill>
                <Pill>{event.scoringRulesetTitle}</Pill>
                <Pill>{event.eligibleCategories.join(" / ")}</Pill>
                {event.awaitingSnapshot ? <Pill>Awaiting score snapshot</Pill> : null}
              </div>
            </section>
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <StandingsPanel event={event} />
              <aside className="space-y-5">
                <InfoPanel title="Window" rows={[
                  ["Starts", formatDate(event.startsAt)],
                  ["Ends", formatDate(event.endsAt)],
                  ["Package", event.packageRequired],
                  ["Finalized", event.finalizedAt ? formatDate(event.finalizedAt) : "Not yet"],
                ]} />
                <ParticipantPanel participants={payload.participants ?? []} />
                <TrophyPanel trophies={payload.trophies ?? []} />
              </aside>
            </section>
          </>
        ) : !loading ? (
          <EmptyState title="Server War not found" text="This event is unavailable or not public." />
        ) : null}
      </main>
    </div>
  );
}

export function ServerWarsTeaser() {
  const [payload, setPayload] = useState<ServerWarsPayload>(emptyPayload);
  useEffect(() => {
    let active = true;
    loadServerWars(4).then((data) => {
      if (active) setPayload(data);
    }).catch(() => null);
    return () => {
      active = false;
    };
  }, []);
  const events = payload.events ?? [];
  return (
    <section className="rounded-xl border border-violet-300/20 bg-violet-500/[0.08] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">Server Wars MVP</p>
          <h2 className="mt-1 text-xl font-black uppercase text-white">Server VS Server standings</h2>
        </div>
        <Link href="/events/server-wars" className="rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-black uppercase text-cyan-50 hover:bg-cyan-300/10">
          View Server Wars
        </Link>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {events.length ? events.slice(0, 4).map((event) => <MiniWarCard key={event.id} event={event} />) : (
          <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm font-bold text-zinc-300">
            No active Server Wars yet. Public pages will keep rendering while events await score snapshots.
          </div>
        )}
      </div>
    </section>
  );
}

async function loadServerWars(limit = 12) {
  return fetchJsonWithRetry<ServerWarsPayload>(`/api/public/server-wars?limit=${limit}`, {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
    retries: 1,
    timeoutMs: 10_000,
  });
}

function ServerWarsHero() {
  return (
    <section className="overflow-hidden rounded-2xl border border-violet-300/20 bg-[radial-gradient(circle_at_20%_0%,rgba(168,85,247,0.24),transparent_34%),linear-gradient(135deg,rgba(5,8,20,0.96),rgba(2,6,23,0.9))] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.42)] sm:p-7">
      <div className="max-w-4xl">
        <p className="inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
          DZN Server Wars
        </p>
        <h1 className="mt-4 text-4xl font-black uppercase leading-none text-white sm:text-6xl lg:text-7xl">
          Servers are the competitors
        </h1>
        <p className="mt-4 max-w-2xl text-sm font-bold leading-6 text-zinc-300">
          Event-window score snapshots rank servers by real ADM-derived combat, build, activity, travel, and exploration metrics. Players appear only as contributors.
        </p>
      </div>
    </section>
  );
}

function WarSummaryCard({ title, value, icon: Icon }: { title: string; value: string; icon: typeof Swords }) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <Icon className="h-5 w-5 text-cyan-200" />
      <p className="mt-3 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{title}</p>
      <p className="mt-1 text-3xl font-black text-white">{value}</p>
    </article>
  );
}

function WarEventGroup({ title, events, loading }: { title: string; events: WarEvent[]; loading: boolean }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black uppercase text-white">{title}</h2>
        <Shield className="h-4 w-4 text-violet-200" />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {loading ? <SkeletonPanel /> : events.length ? events.map((event) => <WarCard key={event.id} event={event} />) : (
          <EmptyState title="Awaiting events" text="No Server Wars in this group yet." />
        )}
      </div>
    </section>
  );
}

function WarCard({ event }: { event: WarEvent }) {
  return (
    <article className="rounded-xl border border-white/10 bg-black/24 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill>{event.status}</Pill>
        <Pill>{event.category ?? "open"}</Pill>
      </div>
      <h3 className="mt-3 text-lg font-black uppercase text-white">{event.title}</h3>
      <p className="mt-2 line-clamp-2 text-sm font-bold leading-6 text-zinc-400">{event.description ?? event.scoringRulesetTitle}</p>
      <StandingsList standings={event.standings} awaiting={event.awaitingSnapshot} />
      <Link href={`/events/server-wars?event=${encodeURIComponent(event.slug)}`} className="mt-4 inline-flex rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-black uppercase text-cyan-50 hover:bg-cyan-300/10">
        View event
      </Link>
    </article>
  );
}

function MiniWarCard({ event }: { event: WarEvent }) {
  return (
    <Link href={`/events/server-wars?event=${encodeURIComponent(event.slug)}`} className="rounded-lg border border-white/10 bg-black/24 p-3 transition hover:border-cyan-300/30">
      <p className="text-xs font-black uppercase text-white">{event.title}</p>
      <p className="mt-1 text-[11px] font-bold uppercase text-zinc-500">{event.status} · {event.scoringRulesetTitle}</p>
    </Link>
  );
}

function StandingsPanel({ event }: { event: WarEvent }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
      <h2 className="text-lg font-black uppercase text-white">Live Standings Snapshot</h2>
      <StandingsList standings={event.standings} awaiting={event.awaitingSnapshot} large />
    </section>
  );
}

function StandingsList({ standings, awaiting, large = false }: { standings: WarStanding[]; awaiting: boolean; large?: boolean }) {
  if (awaiting || !standings.length) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-white/15 bg-black/20 p-4 text-sm font-bold text-zinc-300">
        Awaiting score snapshot. Core pages continue to render while scoring catches up.
      </div>
    );
  }
  return (
    <ol className="mt-4 space-y-2">
      {standings.slice(0, large ? 20 : 3).map((standing) => (
        <li key={`${standing.serverId}-${standing.rank}`} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-white">#{standing.rank} {standing.serverName}</p>
            <p className="text-[11px] font-bold uppercase text-zinc-500">{standing.category ?? "Unclassified"} · snapshot {formatDate(standing.snapshotAt)}</p>
          </div>
          <strong className="text-lg font-black text-cyan-100">{formatNumber(standing.score)}</strong>
        </li>
      ))}
    </ol>
  );
}

function ChampionPanel({ champions }: { champions: NonNullable<ServerWarsPayload["champions"]> }) {
  return (
    <section className="rounded-xl border border-amber-300/20 bg-amber-300/[0.08] p-4">
      <h2 className="flex items-center gap-2 text-lg font-black uppercase text-white"><Crown className="h-4 w-4 text-amber-200" /> Current Champions</h2>
      <div className="mt-3 space-y-2">
        {champions.length ? champions.map((champion) => (
          <div key={`${champion.serverId}-${champion.title}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-sm font-black text-white">{champion.title}</p>
            <p className="mt-1 text-xs font-bold text-zinc-400">{champion.serverName}</p>
          </div>
        )) : <EmptyState title="No champions yet" text="Completed Server Wars will award current titles." />}
      </div>
    </section>
  );
}

function RulesetPanel({ rulesets }: { rulesets: NonNullable<ServerWarsPayload["rulesets"]> }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
      <h2 className="text-lg font-black uppercase text-white">MVP Categories</h2>
      <div className="mt-3 space-y-2">
        {rulesets.slice(0, 8).map((ruleset) => (
          <div key={ruleset.key} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-sm font-black text-white">{ruleset.title}</p>
            <p className="mt-1 text-xs font-bold uppercase text-zinc-500">{ruleset.eligibleCategories.join(" / ")} · {ruleset.packageRequired}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ParticipantPanel({ participants }: { participants: NonNullable<WarDetailPayload["participants"]> }) {
  return (
    <InfoPanel title="Participants" rows={participants.length ? participants.map((participant) => [
      participant.serverName,
      `${participant.status} · ${participant.categoryAtEntry ?? "uncategorized"}`,
    ]) : [["Awaiting participants", "No public participants yet"]]} />
  );
}

function TrophyPanel({ trophies }: { trophies: NonNullable<WarDetailPayload["trophies"]> }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
      <h2 className="flex items-center gap-2 text-lg font-black uppercase text-white"><Trophy className="h-4 w-4 text-amber-200" /> Trophy Cabinet</h2>
      <div className="mt-3 space-y-2">
        {trophies.length ? trophies.map((trophy) => (
          <div key={`${trophy.serverId}-${trophy.title}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-sm font-black text-white">{trophy.title}</p>
            <p className="mt-1 text-xs font-bold text-zinc-500">{formatDate(trophy.awardedAt)}</p>
          </div>
        )) : <EmptyState title="No trophies awarded" text="Finalized events write permanent trophies." />}
      </div>
    </section>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
      <h2 className="text-lg font-black uppercase text-white">{title}</h2>
      <dl className="mt-3 space-y-3">
        {rows.map(([label, value]) => (
          <div key={`${label}-${value}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</dt>
            <dd className="mt-1 text-sm font-bold text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SoftNotice({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm font-bold text-cyan-50">
      {message}
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-4">
      <p className="text-sm font-black uppercase text-white">{title}</p>
      <p className="mt-1 text-sm font-bold leading-6 text-zinc-400">{text}</p>
    </div>
  );
}

function SkeletonPanel() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
      <RefreshCw className="h-5 w-5 animate-spin text-cyan-200" />
      <p className="mt-3 text-sm font-bold text-zinc-300">Loading Server Wars snapshots...</p>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-200">
      {children}
    </span>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "TBD";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "TBD" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(Number.isFinite(value) ? value : 0));
}
