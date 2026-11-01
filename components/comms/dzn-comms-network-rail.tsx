"use client";

import Link from "next/link";
import { CalendarDays, ChevronRight, Circle, Radio, Server, Users } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type CommsEvent = {
  id: string;
  slug: string;
  name: string;
  event_type_label: string;
  category_label: string;
  status: string;
  registered_servers: number;
  starts_at: string | null;
};

type CommsServer = {
  id: string;
  slug: string;
  name: string;
  category: string;
  currentPlayers: number | null;
  maxPlayers: number | null;
  playerCountStatus: string;
};

type NetworkState = {
  status: "loading" | "ready" | "unavailable";
  events: CommsEvent[];
  servers: CommsServer[];
};

const initialState: NetworkState = { status: "loading", events: [], servers: [] };

/**
 * The event and server rail is deliberately built from existing public read
 * endpoints. It never invents a fixture score, online count, crest or event.
 */
export function DznCommsNetworkRail({ onNavigate }: { onNavigate?: () => void }) {
  const [activeTab, setActiveTab] = useState<"events" | "members">("events");
  const [network, setNetwork] = useState<NetworkState>(initialState);

  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: number | undefined;

    const refresh = async () => {
      try {
        const [eventsResponse, serversResponse] = await Promise.all([
          fetch("/api/events?limit=4", {
            cache: "no-store",
            credentials: "omit",
            headers: { accept: "application/json" },
            signal: controller.signal,
          }),
          fetch("/api/public/server-rail", {
            cache: "no-store",
            credentials: "omit",
            headers: { accept: "application/json" },
            signal: controller.signal,
          }),
        ]);
        const [eventsPayload, serversPayload] = await Promise.all([
          eventsResponse.json().catch(() => null),
          serversResponse.json().catch(() => null),
        ]);
        if (controller.signal.aborted) return;
        setNetwork({
          status: eventsResponse.ok && serversResponse.ok ? "ready" : "unavailable",
          events: parseEvents(eventsPayload),
          servers: parseServers(serversPayload),
        });
      } catch {
        if (!controller.signal.aborted) setNetwork((current) => ({ ...current, status: "unavailable" }));
      } finally {
        if (!controller.signal.aborted) refreshTimer = window.setTimeout(() => void refresh(), 60_000);
      }
    };

    void refresh();
    return () => {
      controller.abort();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, []);

  const liveEvent = useMemo(
    () => network.events.find((event) => event.status === "live") ?? null,
    [network.events],
  );
  const nextEvent = useMemo(
    () => network.events.find((event) => ["registration_open", "upcoming", "standby"].includes(event.status)) ?? null,
    [network.events],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="DZN network activity">
      <div className="grid grid-cols-2 border-b border-white/8 px-3 pt-2">
        <button
          type="button"
          onClick={() => setActiveTab("events")}
          aria-pressed={activeTab === "events"}
          className={`flex min-h-11 items-center justify-center gap-2 border-b-2 px-2 text-[10px] font-black uppercase tracking-[0.13em] transition ${activeTab === "events" ? "border-violet-300 text-violet-100" : "border-transparent text-zinc-500 hover:text-zinc-200"}`}
        >
          <Radio className="h-4 w-4" aria-hidden="true" /> Events
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("members")}
          aria-pressed={activeTab === "members"}
          className={`flex min-h-11 items-center justify-center gap-2 border-b-2 px-2 text-[10px] font-black uppercase tracking-[0.13em] transition ${activeTab === "members" ? "border-violet-300 text-violet-100" : "border-transparent text-zinc-500 hover:text-zinc-200"}`}
        >
          <Users className="h-4 w-4" aria-hidden="true" /> Servers
        </button>
      </div>

      {activeTab === "events" ? <div className="space-y-3 p-3">
        <EventCard event={liveEvent ?? nextEvent} live={liveEvent !== null} unavailable={network.status === "unavailable"} onNavigate={onNavigate} />
        <UpcomingCard event={liveEvent ? nextEvent : null} onNavigate={onNavigate} />
      </div> : <div className="space-y-3 p-3">
        <section className="rounded-xl border border-white/10 bg-[#070b17]/92 p-3 shadow-[0_14px_42px_rgba(0,0,0,0.26)]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-white"><Server className="h-4 w-4 text-violet-200" aria-hidden="true" /> Servers in this chat</h2>
            <Link href="/servers" onClick={onNavigate} className="text-[10px] font-black uppercase tracking-[0.1em] text-violet-200 hover:text-white">All</Link>
          </div>
          <div className="mt-3 space-y-2">
            {network.servers.length > 0 ? network.servers.slice(0, 4).map((server) => <ServerRow key={server.id} server={server} onNavigate={onNavigate} />) : <EmptyState
              icon={<Server className="h-5 w-5" aria-hidden="true" />}
              title={network.status === "loading" ? "Loading connected servers" : "No public servers to show"}
              body={network.status === "unavailable" ? "The public server directory is unavailable right now." : "Published connected servers will appear here."}
            />}
          </div>
        </section>
        <Link href="/events" onClick={onNavigate} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-violet-300/22 bg-violet-500/10 px-3 text-xs font-black uppercase tracking-[0.1em] text-violet-100 transition hover:border-violet-200/60 hover:bg-violet-500/18">
          <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4" aria-hidden="true" /> Browse competition</span><ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>}
    </section>
  );
}

function EventCard({ event, live, unavailable, onNavigate }: { event: CommsEvent | null; live: boolean; unavailable: boolean; onNavigate?: () => void }) {
  if (!event) {
    return <section className="rounded-xl border border-white/10 bg-[#070b17]/92 p-4 shadow-[0_14px_42px_rgba(0,0,0,0.26)]">
      <EmptyState
        icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />}
        title={unavailable ? "Event feed unavailable" : "No live event right now"}
        body={unavailable ? "Try again shortly or browse the events hub." : "When a verified event goes live, its real status and counts appear here."}
      />
      <Link href="/events" onClick={onNavigate} className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-violet-300/30 bg-violet-500/18 px-3 text-xs font-black uppercase text-white transition hover:bg-violet-500/28">Browse events <ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
    </section>;
  }

  return <section className="overflow-hidden rounded-xl border border-violet-300/24 bg-[radial-gradient(circle_at_50%_-10%,rgba(139,92,246,0.34),transparent_47%),linear-gradient(180deg,#11122a,#070b17)] shadow-[0_14px_42px_rgba(0,0,0,0.32)]">
    <div className="border-b border-white/8 px-3 py-2.5">
      <span className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${live ? "border-rose-300/40 bg-rose-500/16 text-rose-100" : "border-cyan-300/30 bg-cyan-400/10 text-cyan-100"}`}>
        <Circle className={`h-2.5 w-2.5 ${live ? "fill-rose-400 text-rose-300" : "fill-cyan-300 text-cyan-200"}`} aria-hidden="true" /> {live ? "Live event" : "Next event"}
      </span>
      <p className="mt-3 break-words text-base font-black uppercase leading-5 text-white">{event.name}</p>
      <p className="mt-1 text-xs font-bold text-zinc-400">{event.event_type_label} · {event.category_label}</p>
    </div>
    <div className="border-b border-white/8">
      <Metric label="Registered servers" value={event.registered_servers} />
    </div>
    <Link href={`/events/${encodeURIComponent(event.slug)}`} onClick={onNavigate} className="m-3 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-violet-300/34 bg-violet-500/22 px-3 text-xs font-black uppercase text-white transition hover:bg-violet-500/32">
      Open event <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  </section>;
}

function UpcomingCard({ event, onNavigate }: { event: CommsEvent | null; onNavigate?: () => void }) {
  if (!event) return null;
  return <Link href={`/events/${encodeURIComponent(event.slug)}`} onClick={onNavigate} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#070b17]/92 p-3 transition hover:border-violet-300/35">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-violet-300/24 bg-violet-500/12 text-violet-100"><CalendarDays className="h-4 w-4" aria-hidden="true" /></span>
    <span className="min-w-0 flex-1"><span className="block text-[10px] font-black uppercase tracking-[0.12em] text-violet-200">Next up</span><span className="mt-1 block truncate text-sm font-black uppercase text-white">{event.name}</span></span>
    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
  </Link>;
}

function ServerRow({ server, onNavigate }: { server: CommsServer; onNavigate?: () => void }) {
  const playerCopy = server.playerCountStatus === "fresh" && server.currentPlayers !== null
    ? `${server.currentPlayers}${server.maxPlayers !== null ? `/${server.maxPlayers}` : ""} online`
    : "Status unavailable";
  return <Link href={`/servers/profile?slug=${encodeURIComponent(server.slug)}`} onClick={onNavigate} className="flex min-h-14 items-center gap-3 rounded-lg border border-white/8 bg-black/22 px-3 py-2 transition hover:border-violet-300/35 hover:bg-violet-500/8">
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-violet-300/22 bg-violet-500/12 text-[11px] font-black text-violet-100">{initials(server.name)}</span>
    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-black uppercase text-white">{server.name}</span><span className="mt-0.5 block truncate text-[10px] font-bold text-zinc-500">{server.category}</span></span>
    <span className={`text-right text-[10px] font-black uppercase ${server.playerCountStatus === "fresh" && server.currentPlayers !== null ? "text-emerald-200" : "text-zinc-500"}`}>{playerCopy}</span>
  </Link>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="px-3 py-3 text-center"><p className="text-lg font-black text-white">{Number(value ?? 0).toLocaleString()}</p><p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</p></div>;
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <div className="grid min-h-28 place-items-center rounded-lg border border-dashed border-white/10 bg-black/18 p-3 text-center"><div><span className="mx-auto grid w-fit text-violet-200">{icon}</span><p className="mt-2 text-xs font-black uppercase text-white">{title}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{body}</p></div></div>;
}

function parseEvents(value: unknown): CommsEvent[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { events?: unknown }).events)) return [];
  return (value as { events: unknown[] }).events.flatMap((item): CommsEvent[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (!text(row.id, 120) || !slug(row.slug) || !text(row.name, 140) || !text(row.event_type_label, 80) || !text(row.category_label, 80) || !text(row.status, 40)) return [];
    return [{
      id: row.id as string, slug: row.slug as string, name: row.name as string, event_type_label: row.event_type_label as string,
      category_label: row.category_label as string, status: String(row.status).toLowerCase(),
      registered_servers: nonNegativeNumber(row.registered_servers),
      starts_at: nullableDate(row.starts_at),
    }];
  }).slice(0, 4);
}

function parseServers(value: unknown): CommsServer[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) return [];
  return (value as { items: unknown[] }).items.flatMap((item): CommsServer[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (!text(row.id, 120) || !slug(row.slug) || !text(row.name, 140) || !text(row.category, 80)) return [];
    const currentPlayers = nullableNonNegativeNumber(row.currentPlayers);
    const maxPlayers = nullableNonNegativeNumber(row.maxPlayers);
    return [{
      id: row.id as string, slug: row.slug as string, name: row.name as string, category: row.category as string,
      currentPlayers, maxPlayers, playerCountStatus: text(row.playerCountStatus, 32) ?? "unknown",
    }];
  }).slice(0, 4);
}

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim() && value.length <= max ? value : null;
}

function slug(value: unknown) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,120}[a-z0-9]$/.test(value) ? value : null;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function nullableNonNegativeNumber(value: unknown) {
  return value === null ? null : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nullableDate(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "D";
}
