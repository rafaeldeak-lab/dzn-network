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
  const dateLabel = Number.isFinite(resetTime) ? formatUtcDate(resetTime) : "UTC schedule unavailable";

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-black uppercase text-cyan-100" aria-live="polite">
      <span>{label}: {remaining}</span>
      <span className="text-cyan-100/70">{dateLabel}</span>
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

const UTC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatUtcDate(ms: number): string {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return "UTC schedule unavailable";
  const day = date.getUTCDate();
  const month = UTC_MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hour}:${minute} UTC`;
}
