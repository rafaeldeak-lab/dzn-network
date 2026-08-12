import { BadgeCheck, ShieldCheck, Zap } from "lucide-react";
import type { CSSProperties } from "react";

import { getFullOperatorItem } from "@/lib/operators/full-customisation/catalog";
import type { FullOperatorCardVariant, FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

type FullOperatorCardProps = {
  loadout: FullOperatorLoadout;
  playerName?: string;
  level?: number;
  rank?: string;
  variant?: FullOperatorCardVariant;
};

const cardSize: Record<FullOperatorCardVariant, string> = {
  full: "min-h-[34rem]",
  compact: "min-h-[28rem]",
  leaderboard: "min-h-40",
  mobile: "min-h-[24rem]",
  "server-row": "min-h-24",
};

export function FullOperatorCard({ loadout, playerName = "Rafael", level = 24, rank = "Network Champion", variant = "full" }: FullOperatorCardProps) {
  const frame = getFullOperatorItem(loadout.cardFrameItemId);
  const background = getFullOperatorItem(loadout.cardBackgroundItemId);
  const primary = getFullOperatorItem(loadout.weapon.primaryWeaponItemId);
  const title = getFullOperatorItem(loadout.titleItemId);
  const powers = Object.values(loadout.powerSlots).flatMap((id) => {
    const item = getFullOperatorItem(id);
    return item ? [item.displayName] : [];
  });

  const compact = variant === "leaderboard" || variant === "server-row";

  return (
    <article
      className={`relative isolate overflow-hidden rounded-lg border border-cyan-300/20 bg-slate-950 shadow-[0_24px_70px_rgba(0,0,0,.44)] ${cardSize[variant]}`}
      style={{
        "--full-card-primary": background?.material.primary ?? "#0f172a",
        "--full-card-accent": frame?.material.accent ?? "#22d3ee",
      } as CSSProperties}
      aria-label={`${playerName} DZN Operator Card using equipped loadout ${loadout.displayName}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_0%,color-mix(in_srgb,var(--full-card-accent)_28%,transparent),transparent_32%),radial-gradient(circle_at_12%_8%,color-mix(in_srgb,var(--full-card-primary)_46%,transparent),transparent_36%),linear-gradient(145deg,#02030a,#08111c_58%,#02030a)]" />
      <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className={`relative grid h-full gap-4 p-4 ${compact ? "grid-cols-[5rem_minmax(0,1fr)] items-center" : ""}`}>
        <ProceduralCardOperator loadout={loadout} compact={compact} />
        <div className={compact ? "min-w-0" : ""}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">DZN Operator Card</p>
              <h2 className={`${compact ? "text-base" : "text-2xl"} mt-1 break-words font-black uppercase text-white`}>{playerName}</h2>
              <p className="text-xs font-black uppercase text-zinc-400">{title?.displayName ?? loadout.callSign}</p>
            </div>
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-emerald-300/20 bg-emerald-300/10 text-emerald-100">
              <ShieldCheck size={20} aria-hidden="true" />
            </div>
          </div>

          {!compact ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Meta label="Level" value={String(level)} />
              <Meta label="Rank" value={rank} />
              <Meta label="Weapon" value={primary?.displayName ?? "DZN AR-4"} />
            </div>
          ) : (
            <p className="mt-1 truncate text-[11px] font-black uppercase text-cyan-100">Lvl {level} - {rank}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {(powers.length > 0 ? powers : ["Cosmetic identity"]).slice(0, compact ? 1 : 3).map((power) => (
              <span key={power} className="inline-flex items-center gap-1 rounded border border-violet-300/20 bg-violet-300/10 px-2 py-1 text-[10px] font-black uppercase text-violet-100">
                <Zap size={12} aria-hidden="true" />
                {power}
              </span>
            ))}
          </div>

          {!compact ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-white/10 bg-black/28 p-3 text-xs font-bold leading-5 text-zinc-300">
              <BadgeCheck className="mt-0.5 shrink-0 text-emerald-200" size={16} aria-hidden="true" />
              <span>Cosmetic only. Weapons, powers, levels, frames, and titles do not alter score, XP rate, eligibility, votes, matchmaking, rewards, or DayZ gameplay.</span>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ProceduralCardOperator({ loadout, compact }: { loadout: FullOperatorLoadout; compact: boolean }) {
  const upper = getFullOperatorItem(loadout.selectedItemIds.upper_body)?.material.primary ?? "#164e63";
  const armour = getFullOperatorItem(loadout.selectedItemIds.chest_plate)?.material.primary ?? "#1f2937";
  const accent = getFullOperatorItem(loadout.selectedItemIds.profile_accent)?.material.accent ?? "#22d3ee";
  return (
    <div
      className={`relative mx-auto ${compact ? "h-24 w-16" : "h-72 w-40"} shrink-0`}
      style={{
        "--full-operator-upper": upper,
        "--full-operator-armour": armour,
        "--full-operator-accent": accent,
      } as CSSProperties}
      aria-hidden="true"
    >
      <span className="absolute left-1/2 top-[6%] h-[15%] w-[42%] -translate-x-1/2 rounded-t-full border border-white/15 bg-[linear-gradient(180deg,#334155,#020617)]" />
      <span className="absolute left-1/2 top-[16%] h-[13%] w-[34%] -translate-x-1/2 rounded-[40%] bg-[#b77955]" />
      <span className="absolute left-1/2 top-[29%] h-[35%] w-[55%] -translate-x-1/2 rounded-lg border border-white/10 bg-[linear-gradient(160deg,var(--full-operator-upper),#020617)]" />
      <span className="absolute left-1/2 top-[35%] h-[22%] w-[44%] -translate-x-1/2 rounded border border-cyan-300/20 bg-[linear-gradient(180deg,var(--full-operator-armour),#020617)]" />
      <span className="absolute left-[8%] top-[33%] h-[33%] w-[14%] rotate-6 rounded-full bg-slate-900" />
      <span className="absolute right-[8%] top-[33%] h-[33%] w-[14%] -rotate-6 rounded-full bg-slate-900" />
      <span className="absolute left-[30%] top-[64%] h-[30%] w-[15%] rounded-full bg-slate-800" />
      <span className="absolute right-[30%] top-[64%] h-[30%] w-[15%] rounded-full bg-slate-800" />
      <span className="absolute left-[64%] top-[46%] h-[6%] w-[50%] -rotate-[18deg] rounded bg-[var(--full-operator-accent)] shadow-[0_0_18px_var(--full-operator-accent)]" />
      <span className="absolute left-1/2 top-[45%] h-1 w-[58%] -translate-x-1/2 rounded bg-[var(--full-operator-accent)] shadow-[0_0_14px_var(--full-operator-accent)]" />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.04] p-2">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-xs font-black uppercase text-white">{value}</p>
    </div>
  );
}
