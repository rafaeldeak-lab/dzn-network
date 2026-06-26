"use client";

import { useEffect, useState } from "react";

import { formatDate, relativeTimeLabel } from "./event-format";

export function ClientTimeUntil({
  value,
  fallback = "TBD",
}: {
  value: string | null | undefined;
  fallback?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const firstUpdate = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 60_000);
    return () => {
      window.clearTimeout(firstUpdate);
      window.clearInterval(interval);
    };
  }, []);

  if (!value) return <>{fallback}</>;
  if (now === null) return <>{formatDate(value)}</>;
  return <>{relativeTimeLabel(value, now)}</>;
}
