"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

export function CountdownTimer({ target, mode = "ends" }: { target: string | null | undefined; mode?: "starts" | "ends" }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const parts = countdownParts(target, now);
  return (
    <div className="rounded-lg border border-white/10 bg-black/28 p-4">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase text-zinc-400">
        <Clock3 className="h-3.5 w-3.5 text-cyan-200" />
        Event {mode} in
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {parts.map((part) => (
          <div key={part.label} className="rounded-md border border-cyan-300/15 bg-cyan-400/8 px-2 py-2 text-center">
            <div className="font-mono text-lg font-black text-white">{part.value}</div>
            <div className="text-[9px] font-bold uppercase text-zinc-500">{part.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function countdownParts(target: string | null | undefined, now: number) {
  const targetMs = target ? new Date(target).getTime() : NaN;
  const diff = Number.isFinite(targetMs) ? Math.max(0, targetMs - now) : 0;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return [
    { label: "Days", value: String(days).padStart(2, "0") },
    { label: "Hrs", value: String(hours).padStart(2, "0") },
    { label: "Min", value: String(minutes).padStart(2, "0") },
    { label: "Sec", value: String(seconds).padStart(2, "0") },
  ];
}
