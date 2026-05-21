import { Shield } from "lucide-react";

import { cn } from "./event-format";

const CATEGORY_CLASSES: Record<string, string> = {
  deathmatch: "border-rose-300/40 bg-rose-500/12 text-rose-100",
  pvp: "border-orange-300/40 bg-orange-500/12 text-orange-100",
  pve: "border-cyan-300/40 bg-cyan-500/12 text-cyan-100",
  pvp_pve: "border-violet-300/40 bg-violet-500/12 text-violet-100",
  hardcore: "border-red-300/40 bg-red-500/12 text-red-100",
  roleplay: "border-sky-300/40 bg-sky-500/12 text-sky-100",
  faction_wars: "border-fuchsia-300/40 bg-fuchsia-500/12 text-fuchsia-100",
  vanilla: "border-zinc-300/30 bg-zinc-500/12 text-zinc-100",
  modded: "border-blue-300/40 bg-blue-500/12 text-blue-100",
};

export function ServerCategoryBadge({ category, label, compact = false }: { category: string | null | undefined; label?: string | null; compact?: boolean }) {
  const key = category ?? "modded";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border font-black uppercase tracking-normal", compact ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]", CATEGORY_CLASSES[key] ?? CATEGORY_CLASSES.modded)}>
      <Shield className="h-3.5 w-3.5" />
      {label ?? key.replace(/_/g, " ")}
    </span>
  );
}
