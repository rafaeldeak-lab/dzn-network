import Link from "next/link";
import { Swords, Users } from "lucide-react";

import type { EventMatch } from "./event-data";
import { formatNumber, shortTimeUntil } from "./event-format";
import { ServerCategoryBadge } from "./ServerCategoryBadge";

export function LiveBattleCard({ match, eventSlug = "dzn-season-1" }: { match: EventMatch; eventSlug?: string }) {
  const total = Math.max(1, match.left_score + match.right_score);
  const leftPct = Math.round((match.left_score / total) * 100);
  const rightPct = 100 - leftPct;
  return (
    <article className="rounded-lg border border-white/10 bg-[linear-gradient(135deg,rgba(14,165,233,0.11),rgba(124,58,237,0.1)),rgba(2,6,23,0.84)] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.3)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-md border border-rose-300/35 bg-rose-500/14 px-2.5 py-1 text-[10px] font-black uppercase text-rose-100">
          <Swords className="h-3.5 w-3.5 animate-pulse" />
          LIVE BATTLE
        </span>
        <ServerCategoryBadge category={match.category} label={match.category_label} compact />
      </div>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <BattleSide name={match.left_server.server_name} score={match.left_score} tone="cyan" />
        <span className="rounded-full border border-white/10 bg-black/38 px-2 py-1 text-[10px] font-black uppercase text-zinc-500">VS</span>
        <BattleSide name={match.right_server.server_name} score={match.right_score} tone="orange" alignRight />
      </div>
      <div className="mt-4 overflow-hidden rounded-full border border-white/10 bg-white/[0.06]">
        <div className="flex h-2">
          <span className="bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.7)]" style={{ width: `${leftPct}%` }} />
          <span className="bg-orange-300 shadow-[0_0_18px_rgba(251,146,60,0.7)]" style={{ width: `${rightPct}%` }} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-[10px] uppercase text-zinc-500">
        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />Same category only</span>
        <span>{match.starts_at ? shortTimeUntil(match.starts_at) : "Standby"}</span>
      </div>
      <Link href={`/events/${eventSlug}/bracket`} className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-4 py-2.5 text-xs font-black uppercase text-cyan-50 transition hover:bg-cyan-400/18">
        Open Bracket
      </Link>
    </article>
  );
}

function BattleSide({ name, score, tone, alignRight = false }: { name: string; score: number; tone: "cyan" | "orange"; alignRight?: boolean }) {
  return (
    <div className={alignRight ? "text-right" : ""}>
      <div className="text-xs font-black uppercase text-white">{name}</div>
      <div className={`mt-1 font-mono text-3xl font-black ${tone === "cyan" ? "text-cyan-100" : "text-orange-100"}`}>{formatNumber(score)}</div>
    </div>
  );
}
