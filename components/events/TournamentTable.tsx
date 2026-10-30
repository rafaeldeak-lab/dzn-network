import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { CompetitiveEvent } from "./event-data";
import { ClientTimeUntil } from "./ClientTimeUntil";
import { formatDate } from "./event-format";
import { EventStatusBadge } from "./EventStatusBadge";
import { ServerCategoryBadge } from "./ServerCategoryBadge";

export function TournamentTable({ events }: { events: CompetitiveEvent[] }) {
  if (!events.length) {
    return (
      <section className="border border-dashed border-violet-300/26 bg-[radial-gradient(circle_at_16%_0%,rgba(124,58,237,0.12),transparent_32%),rgba(5,9,21,0.84)] p-7 text-center">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-200">Nothing published yet</p>
        <h2 className="mt-2 text-2xl font-black uppercase text-white">The official tournament board is waiting for its first verified entry.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Filters remain ready for real schedules. When an authorised organiser publishes a competition, its actual date, server count, category and status will appear here.</p>
      </section>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-[#050915]/90">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-white/[0.04] text-[10px] font-black uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-4">Event</th>
            <th className="px-4 py-4">Status</th>
            <th className="px-4 py-4">Category</th>
            <th className="hidden px-4 py-4 text-right md:table-cell">Teams/Servers</th>
            <th className="hidden px-4 py-4 text-right lg:table-cell">Players</th>
            <th className="hidden px-4 py-4 md:table-cell">Start Date</th>
            <th className="px-4 py-4 text-right">Ends / Starts</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-t border-white/8 transition hover:bg-white/[0.035]">
              <td className="px-4 py-4">
                <div className="font-black uppercase text-white">{event.name}</div>
                <div className="mt-1 text-xs text-zinc-500">{event.event_type_label}</div>
              </td>
              <td className="px-4 py-4"><EventStatusBadge status={event.status} /></td>
              <td className="px-4 py-4"><ServerCategoryBadge category={event.category} label={event.category_label} compact /></td>
              <td className="hidden px-4 py-4 text-right font-mono text-zinc-200 md:table-cell">{event.registered_servers}</td>
              <td className="hidden px-4 py-4 text-right font-mono text-zinc-200 lg:table-cell">{event.total_participants}</td>
              <td className="hidden px-4 py-4 text-zinc-400 md:table-cell">{formatDate(event.starts_at)}</td>
              <td className="px-4 py-4 text-right">
                <Link href={`/events/${event.slug}`} className="inline-flex items-center gap-2 rounded-md border border-violet-300/28 bg-violet-500/12 px-3 py-2 text-[10px] font-black uppercase text-violet-100 transition hover:bg-violet-500/22">
                  <ClientTimeUntil value={event.status === "live" ? event.ends_at : event.starts_at} />
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
