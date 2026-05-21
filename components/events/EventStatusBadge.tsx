import { Radio, ShieldAlert, Timer, Trophy } from "lucide-react";

import { cn } from "./event-format";
import type { EventStatus } from "./event-data";

export function EventStatusBadge({ status }: { status: EventStatus | string }) {
  const normalized = String(status ?? "upcoming").toLowerCase();
  const live = normalized === "live";
  const ended = normalized === "ended";
  const registration = normalized === "registration_open";
  const Icon = live ? Radio : ended ? Trophy : registration ? ShieldAlert : Timer;
  const label = live ? "LIVE" : registration ? "REGISTRATION OPEN" : ended ? "ENDED" : normalized.replace(/_/g, " ").toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-normal",
        live && "border-rose-300/45 bg-rose-500/15 text-rose-100 shadow-[0_0_18px_rgba(244,63,94,0.22)]",
        !live && !ended && "border-violet-300/35 bg-violet-500/12 text-violet-100",
        ended && "border-amber-300/35 bg-amber-500/12 text-amber-100",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", live && "animate-pulse")} />
      {label}
    </span>
  );
}
