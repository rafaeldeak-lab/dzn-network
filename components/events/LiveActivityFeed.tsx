import { Activity, ChevronRight } from "lucide-react";

import type { EventActivity } from "./event-data";
import { ClientTimeUntil } from "./ClientTimeUntil";

export function LiveActivityFeed({ activity }: { activity: EventActivity[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-black uppercase text-white">
          <Activity className="h-4 w-4 text-rose-200" />
          Recent Activity
        </div>
        <span className="text-[10px] font-black uppercase text-violet-200">View all</span>
      </div>
      <div className="mt-4 space-y-3">
        {activity.length ? activity.slice(0, 6).map((item) => (
          <div key={item.id} className="group flex items-start gap-3 rounded-md border border-white/8 bg-black/20 p-3">
            <span className="mt-1 h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,0.8)]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-100">{item.message}</p>
              <p className="mt-1 text-[10px] uppercase text-zinc-500">{item.event_name ?? "DZN Event"} - <ClientTimeUntil value={item.created_at} /></p>
            </div>
            <ChevronRight className="h-4 w-4 text-zinc-600 transition group-hover:text-violet-200" />
          </div>
        )) : (
          <div className="rounded-md border border-dashed border-white/10 p-4 text-sm text-zinc-400">Live event feed will activate once registration and score updates begin.</div>
        )}
      </div>
    </section>
  );
}
