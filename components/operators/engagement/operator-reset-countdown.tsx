"use client";

import { useEffect, useMemo, useState } from "react";

type OperatorResetCountdownProps = {
  resetAt: string;
  label: string;
};

export function OperatorResetCountdown({ resetAt, label }: OperatorResetCountdownProps) {
  const resetTime = useMemo(() => Date.parse(resetAt), [resetAt]);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const first = window.setTimeout(update, 0);
    const id = window.setInterval(update, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  const remaining = now === null || !Number.isFinite(resetTime) ? "UTC reset window" : formatRemaining(resetTime - now);

  return (
    <p className="text-xs font-black uppercase text-cyan-100" aria-live="polite">
      {label}: {remaining} · {new Date(Number.isFinite(resetTime) ? resetTime : 0).toISOString().replace(".000Z", " UTC")}
    </p>
  );
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "reset available";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${mins}m`;
}
