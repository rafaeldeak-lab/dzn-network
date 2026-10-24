"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Eye, RadioTower, Star, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { formatPublicServerName } from "@/lib/public-display-text";

const SERVER_RAIL_REFRESH_MS = 30_000;
const SERVER_RAIL_REQUEST_TIMEOUT_MS = 10_000;
const SERVER_RAIL_INITIAL_RETRY_DELAY_MS = 1_500;

type RailItem = {
  id: string;
  slug: string | null;
  name: string;
  logoUrl: string | null;
  category: string;
  currentPlayers: number | null;
  maxPlayers: number | null;
  playerCountStatus?: string;
  ratingAverage: number | null;
  reviewCount: number;
  viewsLast7Days: number;
  listingPlanKey: "free" | "starter" | "pro";
  isPro: boolean;
};

type RailResponse = {
  ok: boolean;
  items?: RailItem[];
  generated_at?: string;
  stale?: boolean;
};

function isStaleEmptyRailResponse(payload: RailResponse) {
  return payload.stale === true && (payload.items?.length ?? 0) === 0;
}

type RailLoaderOptions = {
  fetchRail: (signal: AbortSignal) => Promise<Response>;
  onPayload: (payload: RailResponse) => void;
  onUnavailable: () => void;
  onSettled: () => void;
  timeoutMs?: number;
};

export function createRailLoader({
  fetchRail,
  onPayload,
  onUnavailable,
  onSettled,
  timeoutMs = SERVER_RAIL_REQUEST_TIMEOUT_MS,
}: RailLoaderOptions) {
  let disposed = false;
  let requestInFlight = false;
  let activeRequestController: AbortController | null = null;

  const load = async () => {
    if (requestInFlight || disposed) return;
    requestInFlight = true;
    const requestController = new AbortController();
    activeRequestController = requestController;
    const requestTimeout = globalThis.setTimeout(() => requestController.abort(), timeoutMs);
    try {
      const response = await fetchRail(requestController.signal);
      const payload = response.ok ? await response.json() as RailResponse : null;
      if (payload?.ok && Array.isArray(payload.items)) onPayload(payload);
      else onUnavailable();
    } catch {
      if (!disposed) onUnavailable();
    } finally {
      globalThis.clearTimeout(requestTimeout);
      if (activeRequestController === requestController) activeRequestController = null;
      requestInFlight = false;
      if (!disposed) onSettled();
    }
  };

  return {
    load,
    dispose() {
      disposed = true;
      activeRequestController?.abort();
    },
  };
}

export function LiveServerRail({ className = "" }: { className?: string }) {
  const [items, setItems] = useState<RailItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [responseStale, setResponseStale] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const hasConfirmedResponseRef = useRef(false);
  const initialFailureCountRef = useRef(0);
  const initialRetryTimerRef = useRef<number | null>(null);
  const initialRetryUsesFreshRequestRef = useRef(false);
  const loaderRef = useRef<ReturnType<typeof createRailLoader> | null>(null);

  useEffect(() => {
    const clearInitialRetry = () => {
      if (initialRetryTimerRef.current !== null) window.clearTimeout(initialRetryTimerRef.current);
      initialRetryTimerRef.current = null;
    };

    const scheduleInitialRetry = () => {
      clearInitialRetry();
      initialRetryUsesFreshRequestRef.current = true;
      setReconnecting(true);
      initialRetryTimerRef.current = window.setTimeout(() => {
        initialRetryTimerRef.current = null;
        void loaderRef.current?.load();
      }, SERVER_RAIL_INITIAL_RETRY_DELAY_MS);
    };

    const loader = createRailLoader({
      fetchRail: (signal) => fetch("/api/public/server-rail", {
          cache: initialRetryUsesFreshRequestRef.current ? "no-store" : "default",
          headers: { accept: "application/json" },
          signal,
        }),
      onPayload: (payload) => {
        if (!hasConfirmedResponseRef.current && isStaleEmptyRailResponse(payload)) {
          if (initialFailureCountRef.current === 0) {
            initialFailureCountRef.current += 1;
            scheduleInitialRetry();
            return;
          }
          initialRetryUsesFreshRequestRef.current = false;
          setReconnecting(false);
          setResponseStale(true);
          return;
        }
        hasConfirmedResponseRef.current = true;
        initialFailureCountRef.current = 0;
        initialRetryUsesFreshRequestRef.current = false;
        clearInitialRetry();
        setReconnecting(false);
        setItems((currentItems) => (
          payload.stale === true && payload.items?.length === 0 && currentItems.length > 0
            ? currentItems
            : payload.items ?? []
        ));
        setResponseStale(payload.stale === true);
      },
      onUnavailable: () => {
        if (!hasConfirmedResponseRef.current && initialFailureCountRef.current === 0) {
          initialFailureCountRef.current += 1;
          scheduleInitialRetry();
          return;
        }
        initialRetryUsesFreshRequestRef.current = false;
        setReconnecting(false);
        setResponseStale(true);
      },
      onSettled: () => setLoaded(true),
    });
    loaderRef.current = loader;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loader.load();
    };

    void loader.load();
    const refreshTimer = window.setInterval(refreshWhenVisible, SERVER_RAIL_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      clearInitialRetry();
      initialRetryUsesFreshRequestRef.current = false;
      loaderRef.current = null;
      loader.dispose();
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const railItems = useMemo(() => dedupeRailItems(items), [items]);
  const hasItems = railItems.length > 0;

  return (
    <section className={`dzn-live-server-rail ${className}`} aria-label="Live DZN server rail">
      <div className="dzn-live-server-rail__header">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">Live DZN Server Rail</p>
          <h2 className="mt-1 text-xl font-black uppercase text-white">Connected communities moving through the network</h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-100">
          <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.9)]" aria-hidden="true" />
          {!loaded ? "Loading listings" : reconnecting ? "Reconnecting listings" : responseStale ? "Latest data unavailable" : hasItems ? "Latest server data" : "No live listings"}
        </span>
      </div>
      {hasItems ? (
        <div className="dzn-live-server-rail__viewport" tabIndex={0}>
          <div className={`dzn-live-server-rail__track ${railItems.length === 1 ? "dzn-live-server-rail__track--single" : ""}`}>
            {railItems.map((item) => (
              <RailCard key={railIdentity(item)} item={item} />
            ))}
          </div>
        </div>
      ) : (
        <div className="dzn-live-server-rail__empty" role="status" aria-live="polite">
          <span className="dzn-live-server-rail__empty-icon" aria-hidden="true">
            <RadioTower className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <strong>{!loaded ? "Loading connected server listings" : reconnecting ? "Reconnecting live server listings" : responseStale ? "Server listings are temporarily unavailable" : "No public server listings are available right now"}</strong>
            <p>{!loaded ? "Real server records will appear here when the network response is ready." : reconnecting ? "Rechecking the latest verified server records now." : responseStale ? "The latest server data could not be confirmed. Try again shortly or browse the server directory." : "Only verified public servers appear here. Check the server directory for the latest available listings."}</p>
          </div>
          {loaded ? (
            <Link href="/servers" className="dzn-live-server-rail__empty-link">
              Browse servers
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
}

function RailCard({ item }: { item: RailItem }) {
  const displayName = formatPublicServerName(item.name);

  useEffect(() => {
    trackRailImpression(item.id);
  }, [item.id]);

  const content = (
    <div className={`dzn-live-server-card ${item.isPro ? "dzn-live-server-card--pro" : ""}`} data-rail-card-id={railIdentity(item)}>
      <div className="dzn-live-server-card__icon">
        {item.logoUrl ? <Image src={item.logoUrl} alt="" width={48} height={48} unoptimized /> : <RadioTower className="h-5 w-5" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="dzn-live-server-card__title">{displayName}</h3>
          {item.isPro ? <span className="rounded border border-violet-300/30 bg-violet-400/12 px-1.5 py-0.5 text-[9px] font-black uppercase text-violet-100">Pro</span> : null}
        </div>
        <p className="mt-1 truncate text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-400">{item.category}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-zinc-300">
          <span className="inline-flex items-center gap-1" aria-label={ratingLabel(item)}>
            <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-hidden="true" />
            {item.reviewCount > 0 && item.ratingAverage ? `${item.ratingAverage.toFixed(1)} (${item.reviewCount})` : "No reviews yet"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5 text-cyan-200" aria-hidden="true" />
            {playersLabel(item)}
          </span>
          <span className="inline-flex items-center gap-1" aria-label={`${formatViewsLabel(item.viewsLast7Days)} in the last 7 days`}>
            <Eye className="h-3.5 w-3.5 text-violet-200" aria-hidden="true" />
            {formatViewsLabel(item.viewsLast7Days)}
          </span>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-violet-100/70" aria-hidden="true" />
    </div>
  );

  if (!item.slug) return content;
  return (
    <Link href={`/servers/profile?slug=${encodeURIComponent(item.slug)}`} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200">
      {content}
    </Link>
  );
}

function playersLabel(item: RailItem) {
  if (item.playerCountStatus && item.playerCountStatus !== "fresh") return "Players syncing";
  if (typeof item.currentPlayers === "number" && typeof item.maxPlayers === "number" && item.maxPlayers > 0) return `${item.currentPlayers}/${item.maxPlayers}`;
  if (typeof item.currentPlayers === "number") return `${item.currentPlayers} online`;
  return "Players syncing";
}

function formatViewsLabel(value: number) {
  const views = Math.max(0, Math.floor(Number(value) || 0));
  const display = views >= 1000 ? `${(views / 1000).toFixed(views >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(views);
  return `${display} ${views === 1 ? "view" : "views"}`;
}

function trackRailImpression(serverId: string) {
  if (typeof window === "undefined" || !serverId) return;

  const payload = JSON.stringify({ serverId, eventType: "impression", source: "live_server_rail", promotionId: null });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/public/promotions/track", new Blob([payload], { type: "application/json" }));
      return;
    }
    void fetch("/api/public/promotions/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // View telemetry must never block discovery or navigation.
  }
}

function dedupeRailItems(items: RailItem[]) {
  const unique = new Map<string, RailItem>();
  for (const item of items) {
    const identity = railIdentity(item);
    if (!unique.has(identity)) unique.set(identity, item);
  }
  return [...unique.values()];
}

function railIdentity(item: RailItem) {
  return (item.slug?.trim().toLowerCase() || item.id.trim().toLowerCase());
}

function ratingLabel(item: RailItem) {
  if (item.reviewCount > 0 && item.ratingAverage) return `Rated ${item.ratingAverage.toFixed(1)} out of 5 from ${item.reviewCount} reviews.`;
  return "No reviews yet.";
}
