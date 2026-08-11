import { CheckCircle2, Save } from "lucide-react";

import type { OperatorLoadout } from "@/lib/operators/types";

type OperatorLoadoutListProps = {
  loadouts: OperatorLoadout[];
  equippedLoadoutId: string | null;
  disabled: boolean;
  onEquip: (loadoutId: string) => void;
};

export function OperatorLoadoutList({ loadouts, equippedLoadoutId, disabled, onEquip }: OperatorLoadoutListProps) {
  return (
    <div className="grid gap-2">
      {loadouts.map((loadout) => {
        const equipped = loadout.id === equippedLoadoutId;
        return (
          <button
            key={loadout.id}
            type="button"
            disabled={disabled}
            onClick={() => onEquip(loadout.id)}
            className={`flex min-h-14 items-center justify-between gap-3 rounded-lg border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed ${
              equipped
                ? "border-emerald-300/28 bg-emerald-300/[0.075] text-emerald-50"
                : "border-white/10 bg-white/[0.035] text-zinc-300 hover:border-cyan-300/24"
            }`}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-black uppercase">{loadout.displayName}</span>
              <span className="block text-xs font-bold text-zinc-500">{new Date(loadout.updatedAt).toLocaleDateString("en-US")}</span>
            </span>
            {equipped ? <CheckCircle2 className="shrink-0 text-emerald-200" size={18} aria-hidden="true" /> : <Save className="shrink-0 text-zinc-500" size={18} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
