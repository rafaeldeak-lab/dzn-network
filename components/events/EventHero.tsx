import Link from "next/link";
import { ArrowLeft, Brackets, Lightbulb, ShieldCheck, Sparkles, Trophy, Users } from "lucide-react";

import type { CompetitiveEvent } from "./event-data";
import { eventImageStyle, formatNumber } from "./event-format";
import { CountdownTimer } from "./CountdownTimer";
import { EventStatusBadge } from "./EventStatusBadge";
import { ServerCategoryBadge } from "./ServerCategoryBadge";

export function EventHero({ event, detail = false }: { event?: CompetitiveEvent | null; detail?: boolean }) {
  if (!detail) {
    return (
      <section data-events-hero className="relative min-h-[250px] overflow-hidden border-y border-cyan-300/18 bg-[url('/media/server-wars-showdown/server-wars-banner-concept.webp')] bg-cover bg-center shadow-[0_24px_80px_rgba(0,0,0,0.38)] sm:min-h-[290px]">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(1,5,15,0.97)_0%,rgba(1,5,15,0.76)_48%,rgba(1,5,15,0.3)_74%,rgba(1,5,15,0.72)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,transparent,#02030a)]" />
        <div className="relative flex min-h-[250px] flex-col justify-end px-5 py-7 sm:min-h-[290px] sm:px-8">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase text-cyan-200">
              <Sparkles className="h-4 w-4" />
              Survive · Compete · Belong
            </div>
            <h1 className="mt-2 text-4xl font-black uppercase text-white sm:text-6xl">Events &amp; Tournaments</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-zinc-200 sm:text-base">Join verified DayZ competitions, follow live brackets, and build a history your community can prove.</p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[10px] font-black uppercase text-zinc-200">
              <span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-cyan-300" />Real communities</span>
              <span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-300" />Verified results</span>
              <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" />Category-safe play</span>
            </div>
          </div>
          <Link href="/events/suggest" className="mt-6 inline-flex w-fit items-center justify-center gap-2 rounded-md border border-cyan-300/45 bg-cyan-400/16 px-4 py-2.5 text-xs font-black uppercase text-white transition hover:bg-cyan-400/26">
            <Lightbulb className="h-4 w-4" />
            Suggest Competition
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
