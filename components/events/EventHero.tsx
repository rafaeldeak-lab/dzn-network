import Link from "next/link";
import { ArrowLeft, Brackets, Plus, ShieldCheck } from "lucide-react";

import type { CompetitiveEvent } from "./event-data";
import { eventImageStyle, formatNumber } from "./event-format";
import { CountdownTimer } from "./CountdownTimer";
import { EventStatusBadge } from "./EventStatusBadge";
import { ServerCategoryBadge } from "./ServerCategoryBadge";

export function EventHero({ event, detail = false }: { event?: CompetitiveEvent | null; detail?: boolean }) {
  if (!detail) {
    return (
      <section className="relative overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(circle_at_24%_0%,rgba(124,58,237,0.26),transparent_36%),radial-gradient(circle_at_82%_8%,rgba(34,211,238,0.18),transparent_34%),rgba(3,7,18,0.86)] p-6 shadow-[0_30px_110px_rgba(0,0,0,0.42)]">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:42px_42px] opacity-20" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-4xl font-black uppercase tracking-normal text-white sm:text-6xl">EVENTS</h1>
            <p className="mt-2 text-sm font-semibold text-zinc-300">Compete. Conquer. Be remembered.</p>
            <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-black uppercase text-zinc-400">
              <span className="rounded-md border border-violet-300/25 bg-violet-500/10 px-3 py-2">SAME CATEGORY ONLY</span>
              <span className="rounded-md border border-cyan-300/25 bg-cyan-400/10 px-3 py-2">PRO / PARTNER MATCHING</span>
              <span className="rounded-md border border-rose-300/25 bg-rose-400/10 px-3 py-2">TOP 10 TEASER</span>
            </div>
          </div>
          <Link href="/dashboard" className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-300/40 bg-violet-500/22 px-5 py-3 text-xs font-black uppercase text-white shadow-[0_0_24px_rgba(124,58,237,0.26)] transition hover:bg-violet-500/32">
            <Plus className="h-4 w-4" />
            Create Event
          </Link>
        </div>
      </section>
    );
  }

  if (!event) return null;
  return (
    <section className="relative overflow-hidden rounded-xl border border-white/10 bg-cover bg-center p-6 shadow-[0_30px_110px_rgba(0,0,0,0.42)]" style={eventImageStyle(event.banner_url)}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_14%,rgba(124,58,237,0.22),transparent_28%),linear-gradient(90deg,rgba(2,6,23,0.88),rgba(2,6,23,0.46),rgba(2,6,23,0.86))]" />
      <div className="relative grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <Link href="/events" className="inline-flex items-center gap-2 text-xs font-black uppercase text-zinc-400 transition hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Events
          </Link>
          <div className="mt-5 flex flex-wrap gap-2">
            <EventStatusBadge status={event.status} />
            <ServerCategoryBadge category={event.category} label={event.category_label} />
          </div>
          <h1 className="mt-5 text-4xl font-black uppercase tracking-normal text-white sm:text-6xl">{event.name}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-300">{event.description}</p>
          <div className="mt-6 grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
            <HeroStat label="Servers" value={formatNumber(event.registered_servers)} />
            <HeroStat label="Groups" value={event.category_label} />
            <HeroStat label="Rounds" value={formatNumber(event.match_count)} />
            <HeroStat label="Format" value={event.event_type_label} />
          </div>
        </div>
        <div className="space-y-3">
          <CountdownTimer target={event.status === "live" ? event.ends_at : event.starts_at} mode={event.status === "live" ? "ends" : "starts"} />
          <Link href={`/events/${event.slug}/bracket`} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300/35 bg-violet-500/22 px-4 py-3 text-xs font-black uppercase text-white transition hover:bg-violet-500/32">
            <Brackets className="h-4 w-4" />
            View Bracket
          </Link>
          <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-xs font-black uppercase text-zinc-200">
            <ShieldCheck className="h-4 w-4" />
            Tournament Rules
          </button>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/28 p-3">
      <div className="text-[10px] font-black uppercase text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm font-black uppercase text-white">{value}</div>
    </div>
  );
}
