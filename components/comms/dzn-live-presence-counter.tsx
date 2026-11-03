"use client";

import { Circle } from "lucide-react";
import { useEffect, useState } from "react";

type PresenceState = { count: number | null; state: "checking" | "live" | "fallback" };
const endpoint = "/api/comms/presence?scope=global_chat";

export function DznLivePresenceCounter() {
  const [presence, setPresence] = useState<PresenceState>({ count: null, state: "checking" });

  useEffect(() => {
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

  // The Worker is the sole activation authority. A browser build flag can go
  // stale after a Pages deployment, while the endpoint already verifies the
  // protected server-side counter, scope, secret and read permission.
  const live = presence.state === "live" && presence.count !== null;
  const label = live
    ? `${(presence.count ?? 0).toLocaleString()} online`
    : presence.state === "checking" ? "Checking presence" : "Presence unavailable";
  return (
    <span className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 text-xs font-black uppercase ${live ? "border-emerald-300/25 bg-emerald-300/8 text-emerald-100" : "border-white/10 bg-white/[0.03] text-zinc-400"}`} data-dzn-presence-state={presence.state}>
      <Circle className={`h-3 w-3 ${live ? "fill-emerald-300 text-emerald-200" : "fill-zinc-600 text-zinc-500"}`} aria-hidden="true" />
      <span aria-live="polite">{label}</span>
      <span className="sr-only">Approximate aggregate only. No player identities are shown. It appears only when the protected server-side presence service confirms an active result.</span>
    </span>
  );
}
