import Link from "next/link";
import { ArrowUpRight, Flag, Users } from "lucide-react";

import type { CompetitiveEvent } from "./event-data";
import { eventImageStyle, formatNumber, shortTimeUntil } from "./event-format";
import { EventStatusBadge } from "./EventStatusBadge";
import { ServerCategoryBadge } from "./ServerCategoryBadge";

export function TournamentCard({ event, compact = false }: { event: CompetitiveEvent; compact?: boolean }) {
  const live = event.status === "live";
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-white/10 bg-[#060a17]/92 shadow-[0_20px_70px_rgba(0,0,0,0.32)] transition hover:-translate-y-0.5 hover:border-violet-300/35 hover:shadow-[0_0_46px_rgba(124,58,237,0.18)]">
      <div className={`${compact ? "h-32" : "h-44"} bg-cover bg-center ring-1 ring-inset ring-white/8`} style={eventImageStyle(event.banner_url)}>
        <div className="flex h-full flex-col justify-between p-3">
          <div className="flex items-start justify-between gap-2">
            <EventStatusBadge status={event.status} />
            <ServerCategoryBadge category={event.category} label={event.category_label} compact />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase text-white/70">
              <span>Progress</span>
              <span>{Math.min(100, Math.round(event.progress_percent))}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
              <span className="block h-full rounded-full bg-[linear-gradient(90deg,#7c3aed,#22d3ee)] shadow-[0_0_18px_rgba(34,211,238,0.55)]" style={{ width: `${Math.min(100, event.progress_percent)}%` }} />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="text-[10px] font-black uppercase text-violet-200">{event.event_type_label}</div>
        <h3 className="mt-1 text-xl font-black uppercase tracking-normal text-white">{event.name}</h3>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-400">{event.description}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] uppercase text-zinc-500">
          <span className="rounded-md border border-white/8 bg-white/[0.03] p-2"><Users className="mb-1 h-3.5 w-3.5 text-cyan-200" />{formatNumber(event.registered_servers)} servers</span>
          <span className="rounded-md border border-white/8 bg-white/[0.03] p-2"><Flag className="mb-1 h-3.5 w-3.5 text-violet-200" />{formatNumber(event.match_count)} rounds</span>
          <span className="rounded-md border border-white/8 bg-white/[0.03] p-2">{live ? "Ends" : "Starts"}<br />{shortTimeUntil(live ? event.ends_at : event.starts_at)}</span>
        </div>
        <Link href={`/events/${event.slug}`} className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300/35 bg-violet-500/16 px-4 py-2.5 text-xs font-black uppercase text-violet-50 transition hover:bg-violet-500/26">
          View Event
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}
