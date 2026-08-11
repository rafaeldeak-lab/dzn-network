import { Check, Lock, Sparkles } from "lucide-react";

import { canUseOperatorItem } from "@/lib/operators/loadout";
import type { OperatorCosmeticItem, OperatorPlanTier } from "@/lib/operators/types";

type OperatorCosmeticGridProps = {
  items: OperatorCosmeticItem[];
  planTier: OperatorPlanTier;
  selectedItemId: string | undefined;
  readOnly: boolean;
  onSelectItem: (item: OperatorCosmeticItem) => void;
};

export function OperatorCosmeticGrid({ items, planTier, selectedItemId, readOnly, onSelectItem }: OperatorCosmeticGridProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Cosmetic item grid">
      {items.map((item) => {
        const selected = item.id === selectedItemId;
        const locked = !canUseOperatorItem(planTier, item);
        const disabled = readOnly || locked;

        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelectItem(item)}
            aria-pressed={selected}
            aria-describedby={locked ? `${item.id}-lock` : undefined}
            className={`group min-h-36 rounded-lg border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed ${
              selected
                ? "border-cyan-300/45 bg-cyan-300/[0.09] text-white"
                : locked
                  ? "border-amber-300/18 bg-amber-300/[0.04] text-zinc-300"
                  : "border-white/10 bg-white/[0.035] text-zinc-200 hover:border-cyan-300/28 hover:bg-cyan-300/[0.055]"
            }`}
          >
            <span
              className="block h-12 rounded border border-white/12"
              style={{
                background:
                  item.preview.pattern === "grid"
                    ? `linear-gradient(135deg, ${item.preview.swatch}, #02030a), linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px)`
                    : item.preview.pattern === "signal"
                      ? `linear-gradient(90deg, transparent, ${item.preview.swatch}, transparent)`
                      : `linear-gradient(135deg, ${item.preview.swatch}, #02030a)`,
              }}
              aria-hidden="true"
            />
            <span className="mt-3 flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block text-sm font-black uppercase">{item.displayName}</span>
                <span className="mt-1 block text-xs font-bold leading-5 text-zinc-400">{item.description}</span>
              </span>
              {selected ? <Check className="shrink-0 text-cyan-200" size={18} aria-hidden="true" /> : locked ? <Lock className="shrink-0 text-amber-200" size={18} aria-hidden="true" /> : <Sparkles className="shrink-0 text-zinc-500" size={18} aria-hidden="true" />}
            </span>
            <span className="mt-3 flex flex-wrap gap-2">
              <span className="rounded border border-white/10 bg-black/24 px-2 py-1 text-[10px] font-black uppercase text-zinc-300">{item.rarity}</span>
              <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${item.entitlement === "premium" ? "border-amber-300/24 bg-amber-300/10 text-amber-100" : "border-emerald-300/18 bg-emerald-300/10 text-emerald-100"}`}>
                {item.entitlement}
              </span>
            </span>
            {locked ? (
              <span id={`${item.id}-lock`} className="mt-2 block text-xs font-bold leading-5 text-amber-100">
                Premium cosmetic preview is locked. Free competition access is unchanged.
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
