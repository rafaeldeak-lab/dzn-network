"use client";

import {
  AlertTriangle,
  Bot,
  Hash,
  LockKeyhole,
  MessageCircle,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type CommsHistoryState =
  | { status: "static"; payload: CommsHistoryPayload; message: string }
  | { status: "loading"; payload: CommsHistoryPayload; message: string }
  | { status: "ready"; payload: CommsHistoryPayload; message: string }
  | { status: "fallback"; payload: CommsHistoryPayload; message: string };

type CommsHistoryPayload = {
  ok: true;
  generated_at: string;
  read_only: true;
  presentation_only: true;
  channel: {
    slug: string;
    kind: "public" | "private_group" | "support";
    name: string;
    description: string | null;
    visibility: "public" | "private_group" | "support_private";
  };
  access: {
    public_channel: boolean;
    private_group_membership_required: boolean;
    current_user_member_role: string | null;
  };
  messages: CommsHistoryMessage[];
  feature_flags: {
    route_enabled: boolean;
    sending_enabled: false;
    reactions_enabled: false;
    report_actions_enabled: false;
    moderation_mutations_enabled: false;
    ai_assist_runtime_enabled: false;
    durable_objects_or_websockets_enabled: false;
    analytics_or_tracking_enabled: false;
  };
  fairness_boundary: string[];
};

type CommsHistoryMessage = {
  id: string;
  author_display_name: string;
  author_role_label: string;
  body: string;
  visibility_state: "visible" | "hidden" | "deleted" | "quarantined" | "expired";
  created_at: string | null;
  edited_at: string | null;
  public_safe: true;
  read_only: true;
};

const historyUiEnabled = process.env.NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED === "true";

const staticPayload: CommsHistoryPayload = {
  ok: true,
  generated_at: "static-preview",
  read_only: true,
  presentation_only: true,
  channel: {
    slug: "global-chat",
    kind: "public",
    name: "Global Chat",
    description: "Static read-only preview while the real message history route stays disabled by default.",
    visibility: "public",
  },
  access: {
    public_channel: true,
    private_group_membership_required: false,
    current_user_member_role: null,
  },
  messages: [
    {
      id: "static-1",
      author_display_name: "Rafael DZN",
      author_role_label: "Owner",
      body: "Welcome to DZN Comms. This preview is read-only until the real chat runtime and moderation gates are approved.",
      visibility_state: "visible",
      created_at: "2026-09-01T10:12:00.000Z",
      edited_at: null,
      public_safe: true,
      read_only: true,
    },
    {
      id: "static-2",
      author_display_name: "NovaRift",
      author_role_label: "Mod",
      body: "Global chat, private groups, support help, reactions and timeouts will each be approved as separate slices.",
      visibility_state: "visible",
      created_at: "2026-09-01T10:18:00.000Z",
      edited_at: null,
      public_safe: true,
      read_only: true,
    },
    {
      id: "static-3",
      author_display_name: "DZN Safety",
      author_role_label: "System",
      body: "Message hidden by DZN Safety.",
      visibility_state: "hidden",
      created_at: "2026-09-01T10:24:00.000Z",
      edited_at: null,
      public_safe: true,
      read_only: true,
    },
  ],
  feature_flags: {
    route_enabled: false,
    sending_enabled: false,
    reactions_enabled: false,
    report_actions_enabled: false,
    moderation_mutations_enabled: false,
    ai_assist_runtime_enabled: false,
    durable_objects_or_websockets_enabled: false,
    analytics_or_tracking_enabled: false,
  },
  fairness_boundary: [
    "This Comms surface is read-only.",
    "No chat activity can affect billing, rankings, discovery, reviews, events, XP, awards, Server Wars, CTF, or eligibility.",
  ],
};

export function DznCommsShell() {
  const [history, setHistory] = useState<CommsHistoryState>(() => ({
    status: historyUiEnabled ? "loading" : "static",
    payload: staticPayload,
    message: historyUiEnabled
      ? "Checking the local/test message-history read model."
      : "Static fallback is active. Message history is disabled by default.",
  }));

  useEffect(() => {
    if (!historyUiEnabled) return;

    let active = true;
    fetch("/api/comms/message-history?channel=global-chat&limit=30", {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setHistory({
            status: "fallback",
            payload: staticPayload,
            message: "Message history is unavailable, so DZN is showing the static read-only fallback.",
          });
          return;
        }

        const payload = (await response.json().catch(() => null)) as CommsHistoryPayload | null;
        if (!payload?.ok || !payload.read_only || !payload.presentation_only) {
          setHistory({
            status: "fallback",
            payload: staticPayload,
            message: "The read-history payload was not accepted, so DZN is showing the static fallback.",
          });
          return;
        }

        setHistory({
          status: "ready",
          payload,
          message: "Local/test read-history payload loaded. Sending remains disabled.",
        });
      })
      .catch(() => {
        if (!active) return;
        setHistory({
          status: "fallback",
          payload: staticPayload,
          message: "Message history could not be reached, so DZN is showing the static read-only fallback.",
        });
      });

    return () => {
      active = false;
    };
  }, []);

  const payload = history.payload;
  const statusLabel = useMemo(() => statusCopy(history.status), [history.status]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#03050d] pb-24 pt-28 text-zinc-100 sm:pt-32">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-lg border border-cyan-400/20 bg-[radial-gradient(circle_at_18%_10%,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_88%_0%,rgba(168,85,247,0.16),transparent_30%),rgba(5,9,22,0.88)] shadow-[0_26px_80px_rgba(0,0,0,0.42)]">
          <div className="flex flex-col gap-5 border-b border-white/10 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-cyan-300/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_28px_rgba(34,211,238,0.22)]">
                <MessageCircle className="h-7 w-7" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-200">DZN Comms</p>
                <h1 className="mt-1 text-3xl font-black uppercase leading-none text-white sm:text-4xl">Global Read History</h1>
                <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-zinc-300">
                  The first Comms layer is read-only and disabled by default. Live sending, reactions, moderation actions, presence,
                  private chat and AI support stay blocked for their own approval slices.
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:w-[330px]">
              <StatusPill label="History" value={statusLabel} tone={history.status === "ready" ? "cyan" : "violet"} />
              <StatusPill label="Runtime" value="No Send" tone="gold" />
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[250px_minmax(0,1fr)_300px]">
            <aside className="border-b border-white/10 bg-black/18 p-4 lg:border-b-0 lg:border-r">
              <PanelTitle icon={Hash} label="Channels" />
              <div className="mt-4 space-y-2">
                <ChannelButton active icon={Hash} label="Global Chat" meta="Read-only" />
                <ChannelButton icon={Hash} label="New Players" meta="Future" />
                <ChannelButton icon={Hash} label="Server Owners" meta="Future" />
                <ChannelButton icon={LockKeyhole} label="Private Groups" meta="Blocked" />
              </div>
              <div className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/8 p-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-200">Disabled Composer</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-zinc-300">
                  Message sending is intentionally unavailable in this foundation.
                </p>
              </div>
            </aside>

            <section className="min-w-0 border-b border-white/10 p-4 lg:border-b-0 lg:border-r">
              <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">#{payload.channel.slug}</p>
                  <h2 className="mt-1 text-xl font-black uppercase text-white">{payload.channel.name}</h2>
                </div>
                <span className="w-fit rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-zinc-300">
                  {payload.messages.length} visible rows
                </span>
              </div>

              <div className="mt-4 rounded-lg border border-cyan-300/18 bg-cyan-300/8 px-4 py-3">
                <p className="text-sm font-bold leading-6 text-cyan-50">{history.message}</p>
              </div>

              <div className="mt-4 space-y-3">
                {payload.messages.map((message) => (
                  <MessageRow key={message.id} message={message} />
                ))}
              </div>

              <form className="mt-5 flex items-center gap-2 rounded-lg border border-white/10 bg-black/28 p-2" aria-label="Disabled DZN Comms composer">
                <button
                  type="button"
                  disabled
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 text-zinc-500"
                  aria-label="Attachments are unavailable"
                >
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                </button>
                <input
                  disabled
                  value=""
                  readOnly
                  placeholder="Message sending is blocked until the approved Comms runtime slice."
                  className="min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold text-zinc-300 placeholder:text-zinc-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-cyan-300/20 bg-cyan-400/10 text-cyan-500 opacity-60"
                  aria-label="Send is unavailable"
                >
                  <Send className="h-5 w-5" aria-hidden="true" />
                </button>
              </form>
            </section>

            <aside className="bg-black/18 p-4">
              <PanelTitle icon={ShieldCheck} label="Safety Contract" />
              <div className="mt-4 space-y-3">
                <SafetyCard icon={ShieldCheck} label="Read-only first" value="GET history only" />
                <SafetyCard icon={AlertTriangle} label="Moderation" value="No mutation routes" />
                <SafetyCard icon={Bot} label="DZN Assist" value="AI runtime blocked" />
                <SafetyCard icon={Users} label="Private groups" value="Membership proof required" />
              </div>
              <div className="mt-5 rounded-lg border border-violet-300/18 bg-violet-400/8 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">Fair Boundary</p>
                <ul className="mt-3 space-y-2 text-xs font-semibold leading-5 text-zinc-300">
                  {payload.fairness_boundary.slice(0, 4).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}

function MessageRow({ message }: { message: CommsHistoryMessage }) {
  const muted = message.visibility_state !== "visible";

  return (
    <article className={`rounded-lg border p-4 ${muted ? "border-amber-300/18 bg-amber-300/6" : "border-white/10 bg-black/22"}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border text-sm font-black ${muted ? "border-amber-200/25 bg-amber-300/10 text-amber-100" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"}`}>
          {initials(message.author_display_name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-white">{message.author_display_name}</h3>
            <span className="rounded border border-cyan-300/20 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-cyan-100">
              {message.author_role_label}
            </span>
            {message.created_at ? <time className="text-xs font-semibold text-zinc-500">{formatTime(message.created_at)}</time> : null}
          </div>
          <p className={`mt-2 text-sm font-semibold leading-6 ${muted ? "text-amber-100/82" : "text-zinc-200"}`}>{message.body}</p>
        </div>
      </div>
    </article>
  );
}

function PanelTitle({ icon: Icon, label }: { icon: typeof Hash; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-zinc-300">
      <Icon className="h-4 w-4 text-cyan-200" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function ChannelButton({ active = false, icon: Icon, label, meta }: { active?: boolean; icon: typeof Hash; label: string; meta: string }) {
  return (
    <button
      type="button"
      disabled
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left ${
        active ? "border-cyan-300/40 bg-cyan-400/12 text-white" : "border-white/8 bg-white/4 text-zinc-400"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate text-sm font-black uppercase">{label}</span>
      </span>
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">{meta}</span>
    </button>
  );
}

function SafetyCard({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-cyan-200" aria-hidden="true" />
        <span className="text-xs font-black uppercase tracking-[0.14em] text-white">{label}</span>
      </div>
      <p className="mt-2 text-xs font-semibold text-zinc-400">{value}</p>
    </div>
  );
}

function StatusPill({ label, value, tone }: { label: string; value: string; tone: "cyan" | "violet" | "gold" }) {
  const toneClass = tone === "cyan"
    ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
    : tone === "gold"
      ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
      : "border-violet-300/30 bg-violet-300/10 text-violet-100";

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-80">{label}</p>
      <p className="mt-1 text-sm font-black uppercase">{value}</p>
    </div>
  );
}

function statusCopy(status: CommsHistoryState["status"]) {
  if (status === "ready") return "Local/Test";
  if (status === "loading") return "Checking";
  if (status === "fallback") return "Fallback";
  return "Static";
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "D";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
