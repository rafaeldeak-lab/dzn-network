"use client";

import { Circle } from "lucide-react";
import { useEffect, useState } from "react";

type PresenceState = { count: number | null; state: "static" | "live" | "fallback" };
const enabled = process.env.NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED === "true";
const endpoint = "/api/comms/presence?scope=global_chat";

export function DznLivePresenceCounter() {
  const [presence, setPresence] = useState<PresenceState>({ count: null, state: "static" });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let authenticated = false;

    async function readAuth() {
      const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "include", signal: controller.signal });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => null) as { authenticated?: unknown } | null;
      return payload?.authenticated === true;
    }

    async function refresh() {
      try {
        let response = await fetch(endpoint, { method: authenticated ? "POST" : "GET", cache: "no-store", credentials: "include", redirect: "error", signal: controller.signal });
        if (authenticated && !response.ok) {
          response = await fetch(endpoint, { method: "GET", cache: "no-store", credentials: "include", redirect: "error", signal: controller.signal });
        }
        const payload = await response.json() as { ok?: unknown; online_count?: unknown; precision?: unknown };
        if (!response.ok || payload.ok !== true || payload.precision !== "approximate" || !Number.isSafeInteger(payload.online_count) || Number(payload.online_count) < 0) throw new Error("invalid presence");
        if (!controller.signal.aborted) setPresence({ count: Number(payload.online_count), state: "live" });
      } catch {
        if (!controller.signal.aborted) setPresence({ count: null, state: "fallback" });
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 30_000);
      }
    }

    void readAuth().catch(() => false).then((value) => { authenticated = value; return refresh(); });
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, []);

  if (!enabled) return null;

  const label = presence.state === "live" && presence.count !== null ? `${presence.count.toLocaleString()} online` : "Presence unavailable";
  return (
    <span className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/8 px-3 text-xs font-black uppercase text-emerald-100" data-dzn-presence-state={enabled ? presence.state : "static"}>
      <Circle className="h-3 w-3 fill-emerald-300 text-emerald-200" aria-hidden="true" />
      <span aria-live="polite">{label}</span>
      <span className="sr-only">Approximate aggregate only. No player identities are shown.</span>
    </span>
  );
}
