"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  Check,
  ChevronRight,
  CircleAlert,
  Clock,
  Crown,
  Radio,
  Sparkles,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { fetchJsonWithRetry } from "@/lib/client-fetch";

const NOTIFICATION_POLL_MS = 60_000;
const POPUP_POLL_MS = 60_000;
const SESSION_DISMISSALS_KEY = "dzn:pulse:session-dismissals:v1";
const PENDING_DISMISSALS_KEY = "dzn:pulse:pending-dismissals:v1";

type PulseConfig = {
  ok: boolean;
  dznPulseEnabled: boolean;
  discordNotificationsEnabled: boolean;
};

export type PulseFilter = "all" | "events" | "scores" | "achievements" | "news";

export type PulseNotification = {
  id: string;
  type: string;
  category: PulseFilter;
  category_label: string;
  title: string;
  body: string;
  image_url: string | null;
  action_url: string | null;
  server_id: string | null;
  server_name: string | null;
  event_id: string | null;
  event_name: string | null;
  priority: number;
  read_at: string | null;
  created_at: string;
  expires_at: string | null;
  metadata: Record<string, unknown>;
};

type NotificationsResponse = {
  ok: boolean;
  items: PulseNotification[];
  unreadCount: number;
  nextCursor: string | null;
};

type PulseServer = {
  id: string;
  name: string;
  category: string | null;
  category_label: string | null;
  current_players: number | null;
  max_players: number | null;
  already_entered: boolean;
};

type PulsePopup = {
  campaign_id: string;
  slug: string;
  type: string;
  title: string;
  body: string;
  image_url: string | null;
  action_url: string | null;
  event_id: string | null;
  event_slug: string | null;
  event_name: string | null;
  event_category: string | null;
  event_category_label: string | null;
  event_type: string | null;
  event_status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  metadata: Record<string, unknown>;
  compatible_servers: PulseServer[];
  incompatible_servers: Array<PulseServer & { reason: string }>;
  link_server_url: string | null;
};

type PulsePopupsResponse = {
  ok: boolean;
  items: PulsePopup[];
  selected: PulsePopup | null;
};

type PendingDismissalRecord = {
  campaignId: string;
  mode: "snooze" | "forever" | "joined";
  serverId: string | null;
  createdAt: number;
  expiresAt: number | null;
};

type PulseContextValue = {
  enabled: boolean;
  drawerOpen: boolean;
  unreadCount: number;
  filter: PulseFilter;
  notifications: PulseNotification[];
  notificationsLoading: boolean;
  notificationsError: string;
  lastLoadedAt: string | null;
  setFilter: (filter: PulseFilter) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  refreshNotifications: () => Promise<void>;
  markRead: (notification: PulseNotification) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearRead: () => Promise<void>;
};

const PulseContext = createContext<PulseContextValue | null>(null);

let configPromise: Promise<PulseConfig> | null = null;

export function DznPulseProvider({
  children,
  enablePopups = false,
}: {
  children: ReactNode;
  enablePopups?: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<PulseFilter>("all");
  const [notifications, setNotifications] = useState<PulseNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const unreadInFlightRef = useRef(false);
  const listInFlightRef = useRef(false);
  const listRequestSeqRef = useRef(0);
  const pendingListRefreshRef = useRef(false);
  const refreshNotificationsRef = useRef<(() => Promise<void>) | null>(null);
  const filterRef = useRef<PulseFilter>(filter);
  const bellButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    loadPulseConfig()
      .then((config) => {
        if (!cancelled) setEnabled(Boolean(config.dznPulseEnabled));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshUnread = useCallback(async () => {
    if (!enabled || unreadInFlightRef.current || document.visibilityState === "hidden") return;
    unreadInFlightRef.current = true;
    try {
      const response = await fetchJsonWithRetry<{ ok: boolean; unreadCount: number }>("/api/dzn-pulse/notifications/unread-count", {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
        retries: 0,
        timeoutMs: 8000,
      });
      setUnreadCount(Math.max(0, Number(response.unreadCount ?? 0) || 0));
    } catch {
      setUnreadCount(0);
    } finally {
      unreadInFlightRef.current = false;
    }
  }, [enabled]);

  const refreshNotifications = useCallback(async () => {
    if (!enabled) return;
    if (listInFlightRef.current) {
      pendingListRefreshRef.current = true;
      return;
    }
    const requestId = ++listRequestSeqRef.current;
    const requestFilter = filterRef.current;
    listInFlightRef.current = true;
    setNotificationsLoading(true);
    setNotificationsError("");
    try {
      const params = new URLSearchParams({ filter: requestFilter, limit: "20" });
      const response = await fetchJsonWithRetry<NotificationsResponse>(`/api/dzn-pulse/notifications?${params.toString()}`, {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
        retries: 1,
        timeoutMs: 10_000,
      });
      if (requestId !== listRequestSeqRef.current || requestFilter !== filterRef.current) return;
      setNotifications(response.items ?? []);
      setUnreadCount(Math.max(0, Number(response.unreadCount ?? 0) || 0));
      setLastLoadedAt(new Date().toISOString());
    } catch (error) {
      if (requestId !== listRequestSeqRef.current || requestFilter !== filterRef.current) return;
      setNotificationsError(error instanceof Error ? error.message : "Notifications could not be loaded.");
    } finally {
      if (requestId === listRequestSeqRef.current) setNotificationsLoading(false);
      listInFlightRef.current = false;
      if (pendingListRefreshRef.current) {
        pendingListRefreshRef.current = false;
        window.setTimeout(() => {
          void refreshNotificationsRef.current?.();
        }, 0);
      }
    }
  }, [enabled]);

  useEffect(() => {
    refreshNotificationsRef.current = refreshNotifications;
  }, [refreshNotifications]);

  useEffect(() => {
    if (!enabled) return;
    const firstRefresh = window.setTimeout(() => {
      void refreshUnread();
    }, 0);
    const interval = window.setInterval(() => {
      void refreshUnread();
    }, NOTIFICATION_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshUnread();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onFocus = () => {
      void refreshUnread();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(firstRefresh);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refreshUnread]);

  useEffect(() => {
    if (!drawerOpen || !enabled) return;
    const timer = window.setTimeout(() => {
      void refreshNotifications();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [drawerOpen, enabled, filter, refreshNotifications]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    window.setTimeout(() => bellButtonRef.current?.focus(), 0);
  }, []);

  const markRead = useCallback(async (notification: PulseNotification) => {
    if (notification.read_at) {
      if (notification.action_url) navigateToInternal(notification.action_url);
      return;
    }
    const previousNotifications = notifications;
    const previousUnread = unreadCount;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: readAt } : item));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await fetchJsonWithRetry(`/api/dzn-pulse/notifications/${encodeURIComponent(notification.id)}/read`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        retries: 0,
      });
      if (notification.action_url) navigateToInternal(notification.action_url);
    } catch {
      setNotifications(previousNotifications);
      setUnreadCount(previousUnread);
    }
  }, [notifications, unreadCount]);

  const markAllRead = useCallback(async () => {
    const previousNotifications = notifications;
    const previousUnread = unreadCount;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
    setUnreadCount(0);
    try {
      await fetchJsonWithRetry("/api/dzn-pulse/notifications/read-all", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        retries: 0,
      });
    } catch {
      setNotifications(previousNotifications);
      setUnreadCount(previousUnread);
    }
  }, [notifications, unreadCount]);

  const clearRead = useCallback(async () => {
    const previousNotifications = notifications;
    setNotifications((current) => current.filter((item) => !item.read_at));
    try {
      await fetchJsonWithRetry("/api/dzn-pulse/notifications/clear-read", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        retries: 0,
      });
    } catch {
      setNotifications(previousNotifications);
    }
  }, [notifications]);

  const value = useMemo<PulseContextValue>(() => ({
    enabled,
    drawerOpen,
    unreadCount,
    filter,
    notifications,
    notificationsLoading,
    notificationsError,
    lastLoadedAt,
    setFilter,
    openDrawer,
    closeDrawer,
    refreshNotifications,
    markRead,
    markAllRead,
    clearRead,
  }), [
    clearRead,
    closeDrawer,
    drawerOpen,
    enabled,
    filter,
    lastLoadedAt,
    markAllRead,
    markRead,
    notifications,
    notificationsError,
    notificationsLoading,
    openDrawer,
    refreshNotifications,
    unreadCount,
  ]);

  return (
    <PulseContext.Provider value={value}>
      {children}
      {enabled ? <DznPulseDrawer /> : null}
      {enabled && enablePopups ? <EventPopupManager /> : null}
      {enabled ? <PulseBellFocusBridge buttonRef={bellButtonRef} /> : null}
    </PulseContext.Provider>
  );
}

export function DznPulseBell({ className = "" }: { className?: string }) {
  const pulse = usePulseContextOptional();
  if (!pulse?.enabled) return null;
  const visibleCount = pulse.unreadCount > 99 ? "99+" : String(pulse.unreadCount);
  return (
    <button
      type="button"
      data-dzn-pulse-bell
      onClick={pulse.openDrawer}
      aria-label={pulse.unreadCount > 0 ? `Open DZN Pulse notifications, ${visibleCount} unread` : "Open DZN Pulse notifications"}
      className={`relative grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:border-violet-300/35 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${className}`}
    >
      <Bell className="h-4 w-4" />
      {pulse.unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 min-w-5 rounded-full border border-[#050812] bg-fuchsia-500 px-1.5 py-0.5 text-[9px] font-black leading-none text-white shadow-[0_0_16px_rgba(217,70,239,0.55)]">
          {visibleCount}
        </span>
      ) : null}
    </button>
  );
}

export function useDznPulse() {
  const context = useContext(PulseContext);
  if (!context) throw new Error("useDznPulse must be used inside DznPulseProvider");
  return context;
}

export function usePulseContextOptional() {
  return useContext(PulseContext);
}

function PulseBellFocusBridge({ buttonRef }: { buttonRef: React.MutableRefObject<HTMLButtonElement | null> }) {
  useEffect(() => {
    const latest = document.querySelector<HTMLButtonElement>("[data-dzn-pulse-bell]");
    if (latest) buttonRef.current = latest;
  }, [buttonRef]);
  return null;
}

function DznPulseDrawer() {
  const pulse = useDznPulse();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pulse.drawerOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") pulse.closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [pulse]);

  if (!pulse.drawerOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/58 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) pulse.closeDrawer();
    }}>
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dzn-pulse-drawer-title"
        className="flex h-full w-full max-w-[460px] flex-col border-l border-violet-300/24 bg-[#050812]/96 shadow-[0_0_80px_rgba(0,0,0,0.55)] sm:w-[440px]"
        onKeyDown={trapFocus}
      >
        <div className="sticky top-0 z-10 border-b border-white/10 bg-[#050812]/98 p-4 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-200">DZN Pulse</p>
              <h2 id="dzn-pulse-drawer-title" className="mt-1 text-lg font-black uppercase text-white">Stay in the loop.</h2>
              <p className="mt-1 text-xs font-bold text-zinc-400">Never miss a moment.</p>
            </div>
            <button ref={closeRef} type="button" onClick={pulse.closeDrawer} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60" aria-label="Close DZN Pulse">
              <X className="h-4 w-4" />
            </button>
          </div>
          <NotificationTabs />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {pulse.notificationsLoading && !pulse.notifications.length ? <NotificationSkeleton /> : null}
          {pulse.notificationsError ? <NotificationErrorState message={pulse.notificationsError} onRetry={pulse.refreshNotifications} /> : null}
          {!pulse.notificationsLoading && !pulse.notificationsError && !pulse.notifications.length ? <NotificationEmptyState /> : null}
          <div className="grid gap-3">
            {pulse.notifications.map((notification) => (
              <NotificationCard key={notification.id} notification={notification} onClick={() => void pulse.markRead(notification)} />
            ))}
          </div>
        </div>

        <div className="sticky bottom-0 grid gap-2 border-t border-white/10 bg-[#050812]/98 p-4 backdrop-blur-xl sm:grid-cols-[1fr_auto]">
          <button type="button" onClick={() => void pulse.markAllRead()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-xs font-black uppercase text-zinc-100 transition hover:border-violet-300/35 hover:bg-violet-500/14">
            <Check className="h-4 w-4" />
            Mark all as read
          </button>
          <Link href="/dzn-pulse" onClick={pulse.closeDrawer} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-violet-300/32 bg-violet-500/18 px-4 text-xs font-black uppercase text-violet-50 transition hover:bg-violet-500/28">
            View all
            <ChevronRight className="h-4 w-4" />
          </Link>
          <button type="button" onClick={() => void pulse.clearRead()} className="sm:col-span-2 text-[10px] font-black uppercase text-zinc-500 transition hover:text-zinc-200">
            Clear read notifications
          </button>
        </div>
      </aside>
    </div>
  );
}

function NotificationTabs() {
  const pulse = useDznPulse();
  const tabs: Array<{ key: PulseFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "events", label: "Events" },
    { key: "scores", label: "Scores" },
    { key: "achievements", label: "Achievements" },
    { key: "news", label: "News" },
  ];
  return (
    <div className="mt-4 flex gap-1 overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => pulse.setFilter(tab.key)}
          className={`rounded-md px-3 py-2 text-[10px] font-black uppercase transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${pulse.filter === tab.key ? "bg-violet-500/35 text-white" : "text-zinc-500 hover:text-white"}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function NotificationCard({ notification, onClick }: { notification: PulseNotification; onClick: () => void }) {
  const tone = toneForNotification(notification.category);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border p-4 text-left transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${tone.border} ${tone.bg}`}
    >
      {notification.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={notification.image_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-28 transition group-hover:opacity-34" />
      ) : null}
      <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,8,18,0.96),rgba(5,8,18,0.78),rgba(5,8,18,0.92))]" />
      <span className="relative flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${tone.iconBorder} ${tone.iconBg}`}>
          <NotificationIcon type={notification.type} className={`h-5 w-5 ${tone.icon}`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {!notification.read_at ? <span className="h-2 w-2 shrink-0 rounded-full bg-fuchsia-300 shadow-[0_0_12px_rgba(217,70,239,0.85)]" /> : null}
            <span className={`text-[10px] font-black uppercase ${tone.label}`}>{notification.category_label}</span>
          </span>
          <span className="mt-1 block text-sm font-black uppercase leading-5 text-white">{notification.title}</span>
          <span className="mt-1 block text-xs font-bold leading-5 text-zinc-300">{notification.body}</span>
          <span className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase text-zinc-500">
            <Clock className="h-3.5 w-3.5" />
            {formatTimeAgo(notification.created_at)}
          </span>
        </span>
        {notification.action_url ? <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-zinc-500 transition group-hover:translate-x-0.5 group-hover:text-white" /> : null}
      </span>
    </button>
  );
}

function EventPopupManager() {
  const pathname = usePathname();
  const router = useRouter();
  const eligible = pathname === "/events" ||
    pathname.startsWith("/events/tournaments") ||
    pathname.startsWith("/events/challenges") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/dzn-pulse");
  const [popup, setPopup] = useState<PulsePopup | null>(null);
  const [joining, setJoining] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const popupInFlightRef = useRef(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const refreshPopup = useCallback(async () => {
    if (!eligible || popupInFlightRef.current || !hydrated || document.visibilityState === "hidden") return;
    popupInFlightRef.current = true;
    try {
      await flushPendingDismissals();
      const response = await fetchJsonWithRetry<PulsePopupsResponse>("/api/dzn-pulse/event-popups", {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
        retries: 0,
        timeoutMs: 10_000,
      });
      const selected = response.selected;
      if (!selected || isLocallyDismissed(selected.campaign_id)) {
        setPopup(null);
        return;
      }
      setPopup(selected);
      setSelectedServerId(selected.compatible_servers[0]?.id ?? "");
    } catch {
      setPopup(null);
    } finally {
      popupInFlightRef.current = false;
    }
  }, [eligible, hydrated]);

  useEffect(() => {
    if (!eligible || !hydrated) return;
    const run = () => {
      if (document.visibilityState === "visible") void refreshPopup();
    };
    const timer = window.setTimeout(run, 0);
    const interval = window.setInterval(run, POPUP_POLL_MS);
    const onVisibility = () => run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [eligible, hydrated, refreshPopup]);

  useEffect(() => {
    if (!popup) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        recordSessionDismissal(popup.campaign_id);
        setPopup(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [popup]);

  if (!eligible || !popup) return null;

  async function dismiss(mode: "session" | "snooze" | "forever" | "joined") {
    if (!popup) return;
    if (mode === "session") {
      recordSessionDismissal(popup.campaign_id);
      setPopup(null);
      return;
    }
    recordPendingDismissal(popup.campaign_id, mode, selectedServerId || null);
    setPopup(null);
    await persistDismissal(popup.campaign_id, mode, selectedServerId || null)
      .then(() => removePendingDismissal(popup.campaign_id, mode))
      .catch(() => null);
  }

  async function joinEvent() {
    if (!popup) return;
    if (!selectedServerId) {
      if (popup.link_server_url) router.push(popup.link_server_url);
      else setMessage("Select a compatible linked server before joining.");
      return;
    }
    setJoining(true);
    setMessage("");
    try {
      const eventSlug = popup.event_slug;
      const endpoint = eventSlug
        ? `/api/events/${encodeURIComponent(eventSlug)}/join`
        : `/api/servers/${encodeURIComponent(selectedServerId)}/events/${encodeURIComponent(popup.event_id ?? "")}/enter`;
      const body = eventSlug ? { server_id: selectedServerId } : {};
      const response = await fetchJsonWithRetry<{ ok: boolean; message?: string }>(endpoint, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        retries: 0,
      });
      setMessage(response.message ?? "Event entry confirmed.");
      await dismiss("joined");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Event entry failed.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 px-3 py-6 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dzn-event-popup-title"
        aria-describedby="dzn-event-popup-description"
        className="relative max-h-[calc(100vh-48px)] w-full max-w-[920px] overflow-y-auto rounded-[18px] border border-violet-300/36 bg-[#050812] shadow-[0_0_80px_rgba(124,58,237,0.28)]"
        onKeyDown={trapFocus}
      >
        <button ref={closeButtonRef} type="button" onClick={() => void dismiss("session")} className="absolute right-4 top-4 z-20 grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-black/38 text-zinc-300 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60" aria-label="Close event popup">
          <X className="h-4 w-4" />
        </button>
        <div className="relative grid min-h-[520px] overflow-hidden md:grid-cols-[1fr_1.08fr_1fr]">
          <EventPopupSide tone="blue" server={popup.compatible_servers[0] ?? null} fallbackLabel="Blue side" />
          <div className="relative z-10 flex flex-col items-center justify-center px-6 py-12 text-center">
            <span className="inline-flex items-center gap-2 rounded-md border border-amber-300/30 bg-amber-400/12 px-3 py-1 text-[10px] font-black uppercase text-amber-100">
              <Sparkles className="h-3.5 w-3.5" />
              Featured Event
            </span>
            <p className="mt-5 text-xs font-black uppercase tracking-[0.34em] text-cyan-100">Server VS Server</p>
            <h2 id="dzn-event-popup-title" className="mt-2 text-4xl font-black uppercase leading-[0.95] text-white sm:text-5xl">
              Weekend<br />Kill Race
            </h2>
            <p id="dzn-event-popup-description" className="mt-4 max-w-sm text-xs font-black uppercase text-zinc-300">The weekend belongs to the strongest.</p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-zinc-300">{popup.body}</p>
            <div className="mt-7">
              <Countdown startsAt={popup.starts_at} endsAt={popup.ends_at} hydrated={hydrated} />
            </div>
            <div className="mt-6 w-full max-w-sm rounded-xl border border-violet-300/22 bg-black/34 p-3 text-left">
              <p className="text-[10px] font-black uppercase text-cyan-200">Top rewards preview</p>
              <p className="mt-2 text-sm font-black text-white">Victory Crate</p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">{rewardText(popup)}</p>
            </div>
            {popup.compatible_servers.length > 1 ? (
              <label className="mt-4 w-full max-w-sm text-left">
                <span className="text-[10px] font-black uppercase text-zinc-500">Select server</span>
                <select value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-black/50 px-3 py-3 text-sm font-black text-white outline-none focus:border-cyan-300/50">
                  {popup.compatible_servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
                </select>
              </label>
            ) : null}
            {message ? <p className="mt-3 text-sm font-bold text-amber-100" aria-live="polite">{message}</p> : null}
            <div className="mt-5 grid w-full max-w-sm gap-2 sm:grid-cols-2">
              <button type="button" disabled={joining} onClick={() => void joinEvent()} className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[linear-gradient(90deg,#1d9bf0,#a855f7,#f97316)] px-5 text-xs font-black uppercase text-white shadow-[0_0_34px_rgba(168,85,247,0.36)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
                {joining ? "Joining..." : popup.compatible_servers.length ? "Join Event" : "Link a Server"}
              </button>
              <Link href={popup.action_url ?? "/events"} className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/14 bg-white/[0.04] px-5 text-xs font-black uppercase text-zinc-100 transition hover:border-violet-300/35">
                View Details
              </Link>
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-3 text-[10px] font-black uppercase text-zinc-500">
              <button type="button" onClick={() => void dismiss("forever")} className="hover:text-zinc-200">Don&apos;t show again</button>
              <button type="button" onClick={() => void dismiss("snooze")} className="hover:text-zinc-200">Hide</button>
            </div>
          </div>
          <EventPopupSide tone="orange" server={popup.compatible_servers[1] ?? null} fallbackLabel="Opponent to be confirmed" />
        </div>
      </section>
    </div>
  );
}

function EventPopupSide({ tone, server, fallbackLabel }: { tone: "blue" | "orange"; server: PulseServer | null; fallbackLabel: string }) {
  const blue = tone === "blue";
  return (
    <div className={`relative min-h-[220px] overflow-hidden ${blue ? "bg-cyan-500/10" : "bg-orange-500/10"} md:min-h-full`}>
      <div className={`absolute inset-0 ${blue ? "bg-[radial-gradient(circle_at_20%_30%,rgba(34,211,238,0.32),transparent_42%),linear-gradient(90deg,rgba(5,8,18,0.2),rgba(5,8,18,0.86))]" : "bg-[radial-gradient(circle_at_80%_30%,rgba(249,115,22,0.32),transparent_42%),linear-gradient(270deg,rgba(5,8,18,0.2),rgba(5,8,18,0.86))]"}`} />
      <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className={`relative z-10 flex h-full flex-col justify-end p-6 ${blue ? "items-start text-left" : "items-end text-right"}`}>
        <p className={`text-[10px] font-black uppercase ${blue ? "text-cyan-200" : "text-orange-200"}`}>{blue ? "Blue side" : "Orange side"}</p>
        <h3 className="mt-2 text-xl font-black uppercase text-white">{server?.name ?? fallbackLabel}</h3>
        <p className={`mt-1 text-sm font-black uppercase ${blue ? "text-cyan-100" : "text-orange-100"}`}>
          {server?.current_players != null && server?.max_players != null ? `${server.current_players}/${server.max_players} players` : server?.category_label ?? "Awaiting matchup"}
        </p>
      </div>
    </div>
  );
}

function Countdown({ startsAt, endsAt, hydrated }: { startsAt: string | null; endsAt: string | null; hydrated: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hydrated) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hydrated]);
  if (!hydrated || !startsAt) {
    return <p className="text-xs font-black uppercase text-zinc-400">Event time pending</p>;
  }
  const startMs = Date.parse(startsAt);
  const endMs = endsAt ? Date.parse(endsAt) : 0;
  if (Number.isFinite(endMs) && endMs > 0 && now >= endMs) return <p className="text-sm font-black uppercase text-zinc-300">Event ended</p>;
  if (Number.isFinite(startMs) && now >= startMs) return <p className="text-sm font-black uppercase text-emerald-200">Event is live</p>;
  const remaining = Math.max(0, startMs - now);
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return (
    <div aria-label={`Event starts in ${days} days ${hours} hours ${minutes} minutes ${seconds} seconds`}>
      <p className="text-[10px] font-black uppercase text-zinc-500">Event starts in</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {[
          ["Days", days],
          ["Hrs", hours],
          ["Mins", minutes],
          ["Secs", seconds],
        ].map(([label, value]) => (
          <span key={label} className="w-16 rounded-lg border border-white/10 bg-black/44 px-2 py-2 text-center">
            <span className="block font-mono text-lg font-black text-white">{String(value).padStart(2, "0")}</span>
            <span className="block text-[9px] font-black uppercase text-zinc-500">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function NotificationSkeleton() {
  return (
    <div className="grid gap-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
      ))}
    </div>
  );
}

function NotificationEmptyState() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-6 text-center">
      <Radio className="mx-auto h-8 w-8 text-violet-200" />
      <p className="mt-3 text-sm font-black uppercase text-white">You&apos;re all caught up.</p>
      <p className="mt-2 text-sm leading-6 text-zinc-400">New event, rank, achievement, and network updates will appear here.</p>
    </div>
  );
}

function NotificationErrorState({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  return (
    <div className="mb-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm font-bold text-amber-50">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p>Notifications could not be loaded.</p>
          <p className="mt-1 text-xs text-amber-100/80">{message}</p>
          <button type="button" onClick={() => void onRetry()} className="mt-3 rounded-lg border border-amber-200/30 px-3 py-2 text-[10px] font-black uppercase text-amber-50">
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

function NotificationIcon({ type, className }: { type: string; className: string }) {
  if (type.includes("achievement") || type.includes("prize")) return <Trophy className={className} />;
  if (type.includes("rank") || type.includes("score")) return <Crown className={className} />;
  if (type.includes("news") || type.includes("announcement")) return <Radio className={className} />;
  if (type.includes("event")) return <Zap className={className} />;
  return <Activity className={className} />;
}

function toneForNotification(category: PulseFilter) {
  if (category === "scores") return tone("border-cyan-300/24", "bg-cyan-400/8", "border-cyan-300/28", "bg-cyan-400/12", "text-cyan-100", "text-cyan-200");
  if (category === "achievements") return tone("border-amber-300/28", "bg-amber-400/8", "border-amber-300/30", "bg-amber-400/12", "text-amber-100", "text-amber-200");
  if (category === "news") return tone("border-blue-300/24", "bg-blue-400/8", "border-blue-300/28", "bg-blue-400/12", "text-blue-100", "text-blue-200");
  return tone("border-violet-300/24", "bg-violet-400/8", "border-violet-300/28", "bg-violet-400/12", "text-violet-100", "text-violet-200");
}

function tone(border: string, bg: string, iconBorder: string, iconBg: string, icon: string, label: string) {
  return { border, bg, iconBorder, iconBg, icon, label };
}

function formatTimeAgo(value: string | null | undefined) {
  const time = value ? Date.parse(value) : 0;
  if (!time) return "Just now";
  const diff = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function navigateToInternal(path: string) {
  if (path.startsWith("/") && !path.startsWith("//")) {
    window.location.href = path;
  }
}

function trapFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const root = event.currentTarget;
  const focusable = Array.from(root.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"))
    .filter((item) => !item.hasAttribute("disabled") && item.tabIndex !== -1);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function loadPulseConfig() {
  configPromise ??= fetchJsonWithRetry<PulseConfig>("/api/dzn-pulse/config", {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
    retries: 0,
    timeoutMs: 8000,
  }).catch(() => ({ ok: true, dznPulseEnabled: false, discordNotificationsEnabled: false }));
  return configPromise;
}

function readStoredSet(key: string) {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = key.includes("session") ? window.sessionStorage.getItem(key) : window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function writeStoredSet(key: string, set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const value = JSON.stringify([...set]);
    if (key.includes("session")) window.sessionStorage.setItem(key, value);
    else window.localStorage.setItem(key, value);
  } catch {
    // Local fallback is best effort.
  }
}

function isLocallyDismissed(campaignId: string) {
  if (readStoredSet(SESSION_DISMISSALS_KEY).has(campaignId)) return true;
  return readPendingDismissals().some((item) => item.campaignId === campaignId);
}

function recordSessionDismissal(campaignId: string) {
  const dismissals = readStoredSet(SESSION_DISMISSALS_KEY);
  dismissals.add(campaignId);
  writeStoredSet(SESSION_DISMISSALS_KEY, dismissals);
}

function recordPendingDismissal(campaignId: string, mode: "snooze" | "forever" | "joined", serverId: string | null) {
  const pending = readPendingDismissals().filter((item) => !(item.campaignId === campaignId && item.mode === mode));
  pending.push({
    campaignId,
    mode,
    serverId,
    createdAt: Date.now(),
    expiresAt: mode === "snooze" ? Date.now() + 24 * 60 * 60 * 1000 : null,
  });
  writePendingDismissals(pending);
}

function readPendingDismissals(): PendingDismissalRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_DISMISSALS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .map((item): PendingDismissalRecord | null => {
        if (!item || typeof item !== "object") return null;
        const campaignId = typeof item.campaignId === "string" ? item.campaignId : "";
        const mode = item.mode === "snooze" || item.mode === "forever" || item.mode === "joined" ? item.mode : null;
        if (!campaignId || !mode) return null;
        const expiresAt = typeof item.expiresAt === "number" ? item.expiresAt : null;
        if (expiresAt && expiresAt <= now) return null;
        return {
          campaignId,
          mode,
          serverId: typeof item.serverId === "string" && item.serverId ? item.serverId : null,
          createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
          expiresAt,
        };
      })
      .filter((item): item is PendingDismissalRecord => Boolean(item));
  } catch {
    return [];
  }
}

function writePendingDismissals(records: PendingDismissalRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_DISMISSALS_KEY, JSON.stringify(records));
  } catch {
    // Local fallback is best effort.
  }
}

function removePendingDismissal(campaignId: string, mode?: "snooze" | "forever" | "joined") {
  writePendingDismissals(readPendingDismissals().filter((item) => item.campaignId !== campaignId || (mode && item.mode !== mode)));
}

async function flushPendingDismissals() {
  const pending = readPendingDismissals();
  for (const item of pending) {
    await persistDismissal(item.campaignId, item.mode, item.serverId)
      .then(() => removePendingDismissal(item.campaignId, item.mode))
      .catch(() => null);
  }
}

function persistDismissal(campaignId: string, mode: "snooze" | "forever" | "joined", serverId: string | null) {
  return fetchJsonWithRetry(`/api/dzn-pulse/event-popups/${encodeURIComponent(campaignId)}/dismiss`, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ mode, serverId }),
    retries: 0,
  });
}

function rewardText(popup: PulsePopup) {
  const reward = typeof popup.metadata.reward_preview === "string" ? popup.metadata.reward_preview : "";
  return reward || "Exclusive configured rewards, server banner, badge, or event prize.";
}
