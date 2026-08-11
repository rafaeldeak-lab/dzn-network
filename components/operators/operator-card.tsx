import { BadgeCheck, ShieldCheck } from "lucide-react";

import { OperatorAvatar } from "@/components/operators/operator-avatar";
import type { OperatorCardPresentation } from "@/lib/operators/types";

type OperatorCardProps = {
  presentation: OperatorCardPresentation;
  compact?: boolean;
};

export function OperatorCard({ presentation, compact = false }: OperatorCardProps) {
  const selected = presentation.selectedItems;

  return (
    <article className="relative overflow-hidden rounded-lg border border-cyan-300/18 bg-slate-950/74 shadow-[0_24px_70px_rgba(0,0,0,.42)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(34,211,238,.16),transparent_28%),radial-gradient(circle_at_10%_5%,rgba(249,115,22,.12),transparent_34%)]" />
      <div className="relative grid gap-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">DZN Operator Card</p>
            <h2 className="mt-1 text-xl font-black uppercase text-white">{presentation.displayName}</h2>
            <p className="text-xs font-bold uppercase text-zinc-400">{presentation.callSign}</p>
          </div>
          <div className="grid h-12 w-12 place-items-center rounded-lg border border-emerald-300/20 bg-emerald-300/10 text-emerald-100">
            <ShieldCheck aria-hidden="true" size={22} />
          </div>
        </div>

        <OperatorAvatar presentation={presentation} size={compact ? "sm" : "md"} />

        <div className="grid gap-2">
          <div className="grid grid-cols-3 gap-2">
            <CardMeta label="Frame" value={selected.frame.displayName} />
            <CardMeta label="Pose" value={selected.pose.displayName} />
            <CardMeta label="Slots" value={String(presentation.showcaseSlots)} />
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/25 p-3 text-xs font-bold leading-5 text-zinc-300">
            <BadgeCheck className="mt-0.5 shrink-0 text-emerald-200" size={16} aria-hidden="true" />
            <span>{presentation.fairnessNotice} Operator cosmetics do not alter rank, score, eligibility, votes, matchmaking, rewards, or telemetry.</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function CardMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-2">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-xs font-black text-zinc-100">{value}</p>
    </div>
  );
}
