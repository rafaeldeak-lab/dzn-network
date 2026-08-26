"use client";

import { Circle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type DznPresenceScope = "site" | "community" | "global_chat";

type DznPresencePayload = {
  ok?: boolean;
  scope?: DznPresenceScope;
  label?: string;
  onlineCount?: number | null;
  precision?: "approximate" | "unavailable";
  updatedAt?: string;
  ttlSeconds?: number;
  status?: "active" | "disabled" | "unavailable";
};

type PresenceState = {
  label: string;
  source: "live" | "static" | "fallback";
};

type DznLivePresenceCounterProps = {
  scope?: DznPresenceScope;
  fallbackLabel: string;
  title?: string;
};

const CLIENT_COUNTER_ENABLED = process.env.NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED === "true";
const PRESENCE_REFRESH_MS = 30_000;
const PRESENCE_REQUEST_TIMEOUT_MS = 4_000;

export function DznLivePresenceCounter({
  scope = "community",
  fallbackLabel,
  title = "Aggregate DZN presence only. No player names or identities are shown.",
}: DznLivePresenceCounterProps) {
  const [state, setState] = useState<PresenceState>(() => ({ label: fallbackLabel, source: "static" }));
  const endpoint = useMemo(() => `/api/dzn-comms/presence?scope=${encodeURIComponent(scope)}`, [scope]);

  useEffect(() => {
    if (!CLIENT_COUNTER_ENABLED) {
      return;
    }

    let cancelled = false;
    let nextRefresh: number | null = null;

    async function refreshPresence() {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), PRESENCE_REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("DZN presence unavailable");
        }
        const payload = (await response.json()) as DznPresencePayload;
        if (!cancelled) setState(stateFromPayload(payload, fallbackLabel));
      } catch {
        if (!cancelled) setState({ label: fallbackLabel, source: "fallback" });
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) {
          nextRefresh = window.setTimeout(refreshPresence, PRESENCE_REFRESH_MS);
        }
      }
    }

    void refreshPresence();

    return () => {
      cancelled = true;
      if (nextRefresh) window.clearTimeout(nextRefresh);
    };
  }, [endpoint, fallbackLabel, scope]);

  const displayState = CLIENT_COUNTER_ENABLED ? state : { label: fallbackLabel, source: "static" as const };
  const stateLabel = displayState.source === "live" ? "Live public aggregate" : "Static fallback";

  return (
    <span
      className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-emerald-300/30 bg-emerald-400/12 px-3 text-xs font-black uppercase text-emerald-100"
      title={title}
      data-dzn-live-presence-counter="public-safe-aggregate"
      data-dzn-presence-state={displayState.source}
      data-dzn-presence-fallback="static"
    >
      <Circle className="h-3.5 w-3.5 fill-emerald-300/70 text-emerald-200" aria-hidden="true" />
      <span aria-live="polite">{displayState.label}</span>
      <span className="sr-only">{stateLabel}; no identifying public output.</span>
    </span>
  );
}

function stateFromPayload(payload: DznPresencePayload, fallbackLabel: string): PresenceState {
  if (
    payload.ok === true &&
    payload.status === "active" &&
    payload.precision === "approximate" &&
    Number.isInteger(payload.onlineCount) &&
    typeof payload.onlineCount === "number" &&
    payload.onlineCount >= 0
  ) {
    return {
      label: `${payload.onlineCount.toLocaleString()} online`,
      source: "live",
    };
  }

  return {
    label: fallbackLabel,
    source: "fallback",
  };
}
