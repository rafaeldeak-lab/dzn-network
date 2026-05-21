import { Crown, Lock } from "lucide-react";

import type { EventServer } from "./event-data";
import { formatNumber } from "./event-format";
import { PremiumLockedCard } from "./PremiumLockedCard";
import { ServerCategoryBadge } from "./ServerCategoryBadge";

export function LeaderboardTeaser({ rows, locked = true, title = "TOP 10 MASTER TEASER" }: { rows: EventServer[]; locked?: boolean; title?: string }) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#050915]/86 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-black uppercase text-white">
          <Crown className="h-4 w-4 text-amber-200" />
          {title}
        </div>
        {locked ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-violet-300/30 bg-violet-500/12 px-2 py-1 text-[10px] font-black uppercase text-violet-100">
            <Lock className="h-3 w-3" />
            Teaser Mode
          </span>
        ) : null}
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-white/8">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-white/[0.04] text-[10px] uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">Server</th>
              <th className="px-3 py-3">Category</th>
              <th className="px-3 py-3 text-right">Points</th>
              <th className="hidden px-3 py-3 text-right sm:table-cell">W/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row, index) => (
              <tr key={row.registration_id ?? row.server_id} className="border-t border-white/8 text-zinc-200">
                <td className="px-3 py-3 font-mono text-zinc-500">{row.rank ?? index + 1}</td>
                <td className="px-3 py-3 font-black text-white">{row.server_name}</td>
                <td className="px-3 py-3"><ServerCategoryBadge category={row.category} label={row.category_label} compact /></td>
                <td className="px-3 py-3 text-right font-mono font-black text-cyan-100">{formatNumber(row.score)}</td>
                <td className="hidden px-3 py-3 text-right font-mono text-zinc-400 sm:table-cell">{row.wins}-{row.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {locked ? (
        <div className="mt-4">
          <PremiumLockedCard message="Only top 10 rankings are visible in teaser mode. Unlock full event analytics with DZN Pro." />
        </div>
      ) : null}
    </section>
  );
}
