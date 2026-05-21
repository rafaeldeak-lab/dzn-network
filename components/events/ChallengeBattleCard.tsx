import { Lock, Radio, Zap } from "lucide-react";

import type { EventMatch } from "./event-data";
import { ServerCategoryBadge } from "./ServerCategoryBadge";

export function ChallengeBattleCard({ match, locked = true }: { match: EventMatch; locked?: boolean }) {
  return (
    <article className="rounded-lg border border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.18),transparent_36%),radial-gradient(circle_at_80%_0%,rgba(251,146,60,0.16),transparent_36%),rgba(3,7,18,0.9)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-md border border-cyan-300/28 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-black uppercase text-cyan-100">
          <Radio className="h-3.5 w-3.5 animate-pulse" />
          Connected Node
        </span>
        <div className="flex items-center gap-2">
          {locked ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-300/28 bg-violet-500/12 px-2.5 py-1 text-[10px] font-black uppercase text-violet-100">
              <Lock className="h-3.5 w-3.5" />
              Pro / Partner
            </span>
          ) : null}
          <ServerCategoryBadge category={match.category} label={match.category_label} compact />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div>
          <div className="text-[10px] font-black uppercase text-cyan-200">Blue Side</div>
          <div className="mt-1 text-sm font-black uppercase text-white">{match.left_server.server_name}</div>
          <div className="mt-2 font-mono text-2xl font-black text-cyan-100">{match.left_score}</div>
        </div>
        <Zap className="h-5 w-5 text-violet-200" />
        <div className="text-right">
          <div className="text-[10px] font-black uppercase text-orange-200">Orange Side</div>
          <div className="mt-1 text-sm font-black uppercase text-white">{match.right_server.server_name}</div>
          <div className="mt-2 font-mono text-2xl font-black text-orange-100">{match.right_score}</div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 text-[10px] uppercase text-zinc-500">
        <span className="rounded-md border border-white/8 bg-white/[0.03] p-2">Roster verified</span>
        <span className="rounded-md border border-white/8 bg-white/[0.03] p-2">Metric tally live</span>
      </div>
    </article>
  );
}
