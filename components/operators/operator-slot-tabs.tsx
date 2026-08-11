import { operatorSlotLabel } from "@/lib/operators/labels";
import { OPERATOR_COSMETIC_SLOTS, type OperatorCosmeticSlot } from "@/lib/operators/types";

type OperatorSlotTabsProps = {
  activeSlot: OperatorCosmeticSlot;
  onSelectSlot: (slot: OperatorCosmeticSlot) => void;
};

export function OperatorSlotTabs({ activeSlot, onSelectSlot }: OperatorSlotTabsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Operator cosmetic slots">
      {OPERATOR_COSMETIC_SLOTS.map((slot) => {
        const active = slot === activeSlot;
        return (
          <button
            key={slot}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelectSlot(slot)}
            className={`min-h-10 shrink-0 rounded-lg border px-3 text-xs font-black uppercase transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
              active
                ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-50"
                : "border-white/10 bg-white/[0.035] text-zinc-400 hover:border-white/20 hover:text-white"
            }`}
          >
            {operatorSlotLabel(slot)}
          </button>
        );
      })}
    </div>
  );
}
