"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DznLivePresenceCounter } from "./dzn-live-presence-counter";
import {
  dznCommsMessageHistoryChannelId,
  dznCommsMessageHistoryLoadingState,
  dznCommsMessageHistoryStaticState,
  isDznCommsMessageHistoryUiEnabled,
  loadDznCommsMessageHistory,
  type DznCommsMessageHistoryMessage,
  type DznCommsMessageHistoryUiState,
} from "./dzn-comms-message-history";
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  ChevronDown,
  Hash,
  Link2,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Pin,
  Plus,
  Radio,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  VolumeX,
  Zap,
  type LucideIcon,
} from "lucide-react";

type CommsSurfaceKey = "global" | "new_players" | "server_owners" | "events" | "pandora_squad" | "support";
type CommsTone = "cyan" | "violet" | "amber" | "emerald" | "rose";
type MemberRole = "Owner" | "Mod" | "VIP" | "Member" | "AI";

type CommsChannel = {
  key: CommsSurfaceKey;
  label: string;
  description: string;
  unread: number;
  locked?: boolean;
  tone: CommsTone;
};

type CommsMember = {
  name: string;
  role: MemberRole;
  level?: string;
  status: "online" | "away" | "preview";
  tone: CommsTone;
};

type CommsMessage = {
  id: string;
  author: string;
  role: MemberRole;
  time: string;
  body: string;
  badge?: string;
  tone: CommsTone;
  visibility?: "visible" | "locked";
  source?: "static" | "message_history";
  reactions?: Array<{ emoji: string; label: string; count: number }>;
  actions?: Array<{ label: string; href?: string }>;
};

type CommsSurface = {
  key: CommsSurfaceKey;
  label: string;
  eyebrow: string;
  mode: "Global Chat" | "Private Group" | "Support";
  summary: string;
  onlineLabel: string;
  pinnedTitle: string;
  pinnedBody: string;
  composerLabel: string;
  composerPlaceholder: string;
  checklist?: string[];
  messages: CommsMessage[];
};

const publicChannels: CommsChannel[] = [
  { key: "global", label: "Global Chat", description: "Public DZN player discussion", unread: 12, tone: "cyan" },
  { key: "new_players", label: "New Players", description: "Getting started and account help", unread: 5, tone: "emerald" },
  { key: "server_owners", label: "Server Owners", description: "Setup and owner guidance", unread: 3, tone: "amber" },
  { key: "events", label: "Events", description: "Tournaments and community listings", unread: 1, tone: "violet" },
  { key: "support", label: "DZN Assist", description: "Website support only preview", unread: 0, tone: "cyan" },
];

const privateGroups: CommsChannel[] = [
  { key: "pandora_squad", label: "Pandora Squad", description: "Invite-only trusted group", unread: 8, locked: true, tone: "violet" },
];

const staticMembers: CommsMember[] = [
  { name: "Rafael DZN", role: "Owner", level: "Level 12", status: "online", tone: "cyan" },
  { name: "NovaRift", role: "Mod", level: "Level 9", status: "online", tone: "emerald" },
  { name: "StellarOps", role: "VIP", level: "Level 8", status: "away", tone: "amber" },
  { name: "IronWolf_21", role: "Member", level: "Level 6", status: "online", tone: "rose" },
  { name: "ShadowByte", role: "Member", level: "Level 5", status: "online", tone: "violet" },
  { name: "LunaFox", role: "Member", level: "Level 4", status: "online", tone: "cyan" },
];

const safetyToggles = [
  { label: "Profanity filter", state: "On", icon: ShieldCheck },
  { label: "Spam protection", state: "On", icon: Zap },
  { label: "Link protection", state: "On", icon: Link2 },
  { label: "Invite approval", state: "On", icon: Lock },
] as const;

const safetyLadder = [
  { step: "1", label: "Message blocked", detail: "Message is not sent.", tone: "cyan" },
  { step: "2", label: "Friendly warning", detail: "Keep it positive.", tone: "violet" },
  { step: "3", label: "10-minute timeout", detail: "Short break after repeats.", tone: "amber" },
  { step: "4", label: "Staff review", detail: "Serious issues escalate.", tone: "rose" },
] as const;

const supportActions = [
  { label: "Setup Help", icon: ShieldCheck },
  { label: "Server Linking", icon: Link2 },
  { label: "Event Guides", icon: CalendarDays },
] as const;

const staticCommsSurfaces: Record<CommsSurfaceKey, CommsSurface> = {
  global: {
    key: "global",
    label: "# Global Chat",
    eyebrow: "Public Channels",
    mode: "Global Chat",
    summary: "Free logged-in player community preview. Composer disabled until real chat is approved.",
    onlineLabel: "128 online",
    pinnedTitle: "Welcome to DZN Global",
    pinnedBody: "Be respectful, stay on topic, and never share private account details.",
    composerLabel: "Global chat composer preview",
    composerPlaceholder: "Message #global-chat - disabled in prototype",
    messages: [
      {
        id: "global-rafael",
        author: "Rafael DZN",
        role: "Owner",
        time: "10:12 AM",
        badge: "Owner",
        tone: "cyan",
        body: "Welcome everyone. If you are new, check #new-players and say hi. Let's build the best servers and community together.",
        reactions: [
          { emoji: "\u{1F680}", label: "Boost", count: 14 },
          { emoji: "\u{1F44B}", label: "Wave", count: 9 },
          { emoji: "\u{1F49C}", label: "Heart", count: 12 },
        ],
      },
      {
        id: "global-nova",
        author: "NovaRift",
        role: "Mod",
        time: "10:18 AM",
        badge: "Mod",
        tone: "emerald",
        body: "Reminder: tonight's Survival Showdown starts in 2 hours. Sign up in #events if you have not yet.",
        reactions: [
          { emoji: "\u{1F3C6}", label: "Trophy", count: 8 },
          { emoji: "\u{1F525}", label: "Fire", count: 6 },
          { emoji: "\u{1F3AF}", label: "Target", count: 7 },
        ],
      },
      {
        id: "global-iron",
        author: "IronWolf_21",
        role: "Member",
        time: "10:24 AM",
        badge: "Member",
        tone: "rose",
        body: "Just finished linking my server - smooth process. Thanks for the guide.",
        reactions: [{ emoji: "\u{1F44D}", label: "Thumbs up", count: 6 }],
      },
      {
        id: "global-filtered",
        author: "DZN Safety",
        role: "AI",
        time: "10:26 AM",
        tone: "cyan",
        body: "A message was filtered to keep chat welcoming.",
      },
      {
        id: "global-shadow",
        author: "ShadowByte",
        role: "Member",
        time: "10:28 AM",
        badge: "Member",
        tone: "violet",
        body: "Quick question: do challenge XP bonuses stack during events, or just the base amount?",
      },
      {
        id: "global-nova-answer",
        author: "NovaRift",
        role: "Mod",
        time: "10:30 AM",
        badge: "Mod",
        tone: "emerald",
        body: "Base amount plus event bonus. Check the challenge details for specifics. Happy grinding.",
        reactions: [{ emoji: "\u{1F44D}", label: "Thumbs up", count: 5 }],
      },
    ],
  },
  new_players: {
    key: "new_players",
    label: "# New Players",
    eyebrow: "Public Channels",
    mode: "Global Chat",
    summary: "Starter guidance for free logged-in players using DZN for the first time.",
    onlineLabel: "42 online",
    pinnedTitle: "New Player Checklist",
    pinnedBody: "Log in with Discord, open Player Hub, save servers, and review privacy before sharing your public profile.",
    composerLabel: "New players composer preview",
    composerPlaceholder: "Message #new-players - disabled in prototype",
    checklist: ["Discord login", "Open Player Hub", "Save a server", "Review privacy"],
    messages: [
      {
        id: "new-assist",
        author: "DZN Assist",
        role: "AI",
        time: "9:44 AM",
        badge: "Website support only",
        tone: "cyan",
        body: "Start at Player Hub to see matched communities, saved servers, events, challenges, and your profile entry points.",
        actions: [{ label: "Open Player Hub", href: "/player" }],
      },
      {
        id: "new-luna",
        author: "LunaFox",
        role: "Member",
        time: "9:51 AM",
        badge: "Member",
        tone: "violet",
        body: "Saved my first server and found its community page. The opt-in profile controls make sense.",
      },
    ],
  },
  server_owners: {
    key: "server_owners",
    label: "# Server Owners",
    eyebrow: "Public Channels",
    mode: "Global Chat",
    summary: "Public owner-help preview. Actual setup still goes through pricing and the entitlement gate.",
    onlineLabel: "23 online",
    pinnedTitle: "Owner Setup Boundary",
    pinnedBody: "Player login is free. Server setup, linking, publishing, and management stay behind Starter or Pro.",
    composerLabel: "Server owners composer preview",
    composerPlaceholder: "Message #server-owners - disabled in prototype",
    checklist: ["Choose owner plan", "Confirm entitlement", "Link server", "Publish profile"],
    messages: [
      {
        id: "owner-assist",
        author: "DZN Assist",
        role: "AI",
        time: "11:02 AM",
        badge: "Website support only",
        tone: "cyan",
        body: "Owner setup starts from pricing. Starter has a 2-day trial then 2 GBP/month. Pro is 10 GBP/month.",
        actions: [{ label: "Owner Plans", href: "/pricing?intent=owner_setup&returnTo=%2Fsetup" }],
      },
      {
        id: "owner-stellar",
        author: "StellarOps",
        role: "VIP",
        time: "11:08 AM",
        badge: "VIP",
        tone: "amber",
        body: "Pro looks right for multiple servers and better announcement tools. Good that ranks stay fair.",
      },
    ],
  },
  events: {
    key: "events",
    label: "# Events",
    eyebrow: "Public Channels",
    mode: "Global Chat",
    summary: "Suggested event and tournament coordination preview. Scoring remains outside chat.",
    onlineLabel: "31 online",
    pinnedTitle: "Event Chat Is Presentation Only",
    pinnedBody: "Event discussion can guide players, but brackets, approvals, scoring, and eligibility stay in their own systems.",
    composerLabel: "Events composer preview",
    composerPlaceholder: "Message #events - disabled in prototype",
    messages: [
      {
        id: "events-nova",
        author: "NovaRift",
        role: "Mod",
        time: "12:05 PM",
        badge: "Mod",
        tone: "emerald",
        body: "Survival Showdown roster locks later today. Check event pages for official state, not chat messages.",
        actions: [{ label: "Open Events", href: "/events" }],
      },
      {
        id: "events-shadow",
        author: "ShadowByte",
        role: "Member",
        time: "12:11 PM",
        badge: "Member",
        tone: "violet",
        body: "That makes sense. Chat can help coordinate, but the event page is the source of truth.",
      },
    ],
  },
  pandora_squad: {
    key: "pandora_squad",
    label: "Pandora Squad",
    eyebrow: "Private Groups",
    mode: "Private Group",
    summary: "Invite-only group preview. Future access must require a trusted DZN membership bridge.",
    onlineLabel: "8 members",
    pinnedTitle: "Server Launch Checklist",
    pinnedBody: "Trusted private groups can coordinate setup, staff roles, launch posts, and safety guidance.",
    composerLabel: "Pandora Squad composer preview",
    composerPlaceholder: "Message Pandora Squad - disabled in prototype",
    checklist: ["Verify ownership", "Finish server profile", "Invite moderators", "Publish announcement"],
    messages: [
      {
        id: "pandora-rafael",
        author: "Rafael DZN",
        role: "Owner",
        time: "10:12 AM",
        badge: "Owner",
        tone: "cyan",
        body: "Let's lock in today and finish the server setup. We are close - just a few things left on the checklist.",
      },
      {
        id: "pandora-nova",
        author: "NovaRift",
        role: "Mod",
        time: "10:13 AM",
        badge: "Mod",
        tone: "emerald",
        body: "I'll handle the moderator invites and permissions. Looking good so far.",
      },
      {
        id: "pandora-stellar",
        author: "StellarOps",
        role: "Member",
        time: "10:14 AM",
        badge: "Member",
        tone: "amber",
        body: "I'll draft the launch announcement. Any theme ideas?",
        reactions: [{ emoji: "\u{1F44D}", label: "Thumbs up", count: 3 }],
      },
      {
        id: "pandora-assist",
        author: "DZN Assist",
        role: "AI",
        time: "10:16 AM",
        badge: "Website support only",
        tone: "cyan",
        body: "I found the approved server-linking guide. Want the 3-step checklist?",
        actions: [
          { label: "Show Checklist" },
          { label: "Open Guide", href: "/pricing?intent=owner_setup&returnTo=%2Fsetup" },
        ],
      },
    ],
  },
  support: {
    key: "support",
    label: "DZN Assist",
    eyebrow: "Support",
    mode: "Support",
    summary: "Static support preview. Public DZN website info only, with no bot runtime or model call.",
    onlineLabel: "Website support only",
    pinnedTitle: "Support Boundary",
    pinnedBody: "DZN Assist can explain public setup, pricing, player surfaces, and events. Private account help must require login in a later runtime slice.",
    composerLabel: "DZN Assist question preview",
    composerPlaceholder: "Ask about DZN - disabled in prototype",
    messages: [
      {
        id: "support-assist",
        author: "DZN Assist",
        role: "AI",
        time: "Preview",
        badge: "No AI call",
        tone: "cyan",
        body: "This is a static shell. A later approved slice must define source policy, privacy boundaries, cost controls, logging, and rollback before any AI support bot is connected.",
        actions: [
          { label: "Setup Help", href: "/pricing?intent=owner_setup&returnTo=%2Fsetup" },
          { label: "Player Hub", href: "/player" },
          { label: "Events", href: "/events" },
        ],
      },
    ],
  },
};

export function DznCommsVisualShell() {
  const [activeSurfaceKey, setActiveSurfaceKey] = useState<CommsSurfaceKey>("global");
  const [historyRetryNonce, setHistoryRetryNonce] = useState(0);
  const activeSurface = staticCommsSurfaces[activeSurfaceKey];
  const messageHistoryUiEnabled = useMemo(() => isDznCommsMessageHistoryUiEnabled(), []);
  const messageHistoryState = useDznCommsMessageHistory(activeSurfaceKey, historyRetryNonce, messageHistoryUiEnabled);
  const activeMessages = useMemo(
    () => messageHistoryState.status === "live"
      ? messageHistoryState.messages.map(toCommsMessageFromHistory)
      : activeSurface.messages,
    [activeSurface.messages, messageHistoryState],
  );
  const activeMembers = useMemo(
    () => activeSurfaceKey === "pandora_squad" ? staticMembers.slice(0, 5) : staticMembers,
    [activeSurfaceKey],
  );
  const activeIsPrivate = activeSurface.mode === "Private Group";

  return (
    <main
      className="dzn-comms-page relative min-h-screen overflow-hidden bg-[#02030a] text-white"
      data-dzn-comms-prototype="static-local-mock-data"
      data-dzn-comms-reactions="emoji-static-preview"
      data-dzn-comms-message-history-ui={messageHistoryUiEnabled ? "enabled-read-only" : "disabled-static-fallback"}
      data-dzn-comms-history-source={messageHistoryState.status === "live" ? "read-only-message-history" : "static-fallback"}
    >
      <DznCommsBackground />

      <section className="relative z-10 mx-auto w-full max-w-[1520px] px-4 pb-8 pt-28 sm:px-6 lg:px-8">
        <div className="grid gap-4 rounded-lg border border-cyan-300/20 bg-black/38 p-4 shadow-[0_0_80px_rgba(34,211,238,0.12)] backdrop-blur-xl lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded border border-violet-300/30 bg-violet-400/12 px-3 py-1.5 text-[11px] font-black uppercase text-violet-100">
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              {messageHistoryUiEnabled ? "Read-Only History" : "Static Prototype"}
            </span>
            <h1 className="mt-4 break-words text-5xl font-black uppercase leading-none text-white [overflow-wrap:anywhere] sm:text-7xl">
              DZN Comms
            </h1>
            <p className="mt-2 text-base font-black uppercase text-cyan-100 sm:text-lg">
              Connect. Coordinate. Get support.
            </p>
            <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-zinc-300">
              {messageHistoryUiEnabled
                ? "Read-only local/test message history can load for approved channels. The composer, reactions, reports, DZN Assist, tracking, billing, and competitive systems remain disconnected."
                : "Static local mock data only. The shell previews support, global player chat, and private group chat without message storage, real sending, bot runtime, tracking, billing changes, or competitive-system impact."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DznLivePresenceCounter scope="community" fallbackLabel="128 online" />
            <StatusPill tone="amber" icon={ShieldAlert} label="Composer disabled" />
            <StatusPill tone="cyan" icon={Bot} label="No AI call" />
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
          <DznCommsChannelRail activeKey={activeSurfaceKey} onSelect={setActiveSurfaceKey} />

          <section className="min-w-0 rounded-lg border border-cyan-300/18 bg-slate-950/74 shadow-[0_26px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl">
            <DznCommsFeedHeader surface={activeSurface} privateMode={activeIsPrivate} />
            <PinnedGuidance surface={activeSurface} />
            <MessageHistoryStatusBanner
              state={messageHistoryState}
              onRetry={() => setHistoryRetryNonce((value) => value + 1)}
            />
            <div className="grid gap-3 px-3 py-3 sm:px-4">
              {activeMessages.map((message) => (
                <CommsMessageRow key={message.id} message={message} />
              ))}
              {messageHistoryState.status === "live" ? null : <FilteredMessageNotice />}
              {activeIsPrivate ? <StaticWarningPreview /> : null}
            </div>
            <StaticComposer surface={activeSurface} />
          </section>

          <aside className="grid gap-4">
            <DznAssistPanel onSelectSupport={() => setActiveSurfaceKey("support")} />
            <ChannelSafetyPanel privateMode={activeIsPrivate} />
            <MemberPresencePanel members={activeMembers} privateMode={activeIsPrivate} />
          </aside>
        </div>
      </section>
    </main>
  );
}

function useDznCommsMessageHistory(
  surfaceKey: CommsSurfaceKey,
  retryNonce: number,
  uiEnabled: boolean,
): DznCommsMessageHistoryUiState {
  const activationKey = useDznCommsSurfaceActivationKey(surfaceKey);
  const requestKey = `${activationKey}:${retryNonce}`;
  const channelId = dznCommsMessageHistoryChannelId(surfaceKey);
  const [loadedState, setLoadedState] = useState<{
    requestKey: string;
    state: DznCommsMessageHistoryUiState;
  } | null>(null);

  useEffect(() => {
    if (!uiEnabled || !channelId) return;

    let active = true;

    void loadDznCommsMessageHistory({ surfaceKey }).then((nextState) => {
      if (active) setLoadedState({ requestKey, state: nextState });
    });

    return () => {
      active = false;
    };
  }, [channelId, requestKey, surfaceKey, uiEnabled]);

  if (!uiEnabled) return dznCommsMessageHistoryStaticState("client-flag-disabled");
  if (!channelId) return dznCommsMessageHistoryStaticState("support-static");
  if (loadedState?.requestKey !== requestKey) return dznCommsMessageHistoryLoadingState();
  return loadedState.state;
}

function useDznCommsSurfaceActivationKey(surfaceKey: CommsSurfaceKey) {
  const activeSurface = useRef<{ surfaceKey: CommsSurfaceKey; generation: number }>({
    surfaceKey,
    generation: 0,
  });

  if (activeSurface.current.surfaceKey !== surfaceKey) {
    activeSurface.current = {
      surfaceKey,
      generation: activeSurface.current.generation + 1,
    };
  }

  return `${activeSurface.current.surfaceKey}:${activeSurface.current.generation}`;
}

function toCommsMessageFromHistory(message: DznCommsMessageHistoryMessage): CommsMessage {
  const role = roleFromHistoryLabel(message.author.roleLabel);
  return {
    id: message.id,
    author: message.author.displayName,
    role,
    time: formatHistoryTime(message.createdAt),
    body: message.body,
    badge: message.author.roleLabel ?? undefined,
    tone: toneForHistoryRole(role),
    visibility: message.visibility,
    source: "message_history",
  };
}

function roleFromHistoryLabel(label: string | null): MemberRole {
  if (label === "Owner" || label === "Mod" || label === "VIP" || label === "AI") return label;
  if (label === "Website Support") return "AI";
  return "Member";
}

function toneForHistoryRole(role: MemberRole): CommsTone {
  if (role === "Owner" || role === "AI") return "cyan";
  if (role === "Mod") return "emerald";
  if (role === "VIP") return "amber";
  return "violet";
}

function formatHistoryTime(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Saved";
  const date = new Date(parsed);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

function MessageHistoryStatusBanner({
  state,
  onRetry,
}: {
  state: DznCommsMessageHistoryUiState;
  onRetry: () => void;
}) {
  const tone = state.status === "live" ? "emerald" : state.status === "loading" ? "cyan" : state.status === "fallback" && state.reason === "private-denied" ? "violet" : "amber";
  const Icon = state.status === "live" ? ShieldCheck : state.status === "loading" ? Radio : ShieldAlert;
  const reason = "reason" in state ? state.reason : state.status;

  return (
    <section
      className={`mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 rounded border px-3 py-2 sm:mx-4 ${toneClasses(tone).soft}`}
      data-dzn-comms-message-history-state={state.status}
      data-dzn-comms-message-history-reason={reason}
      aria-live="polite"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block break-words text-[11px] font-black uppercase [overflow-wrap:anywhere]">{state.label}</span>
          <span className="block break-words text-xs font-semibold leading-5 text-zinc-300 [overflow-wrap:anywhere]">{state.detail}</span>
        </span>
      </span>
      {state.canRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-8 shrink-0 items-center justify-center rounded border border-white/14 bg-black/28 px-3 text-[11px] font-black uppercase text-white transition hover:bg-black/40"
        >
          Refresh
        </button>
      ) : null}
    </section>
  );
}

function DznCommsBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <Image
        src="/media/dzn-pricing-bg-layer.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="dzn-comms-bg-layer object-cover"
      />
      <Image
        src="/media/dzn-pricing-fog-ember-overlay.png"
        alt=""
        fill
        sizes="100vw"
        className="dzn-comms-fog-layer object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,3,10,0.96)_0%,rgba(2,3,10,0.68)_48%,rgba(2,3,10,0.94)_100%),linear-gradient(180deg,rgba(2,3,10,0.5)_0%,rgba(2,3,10,0.94)_82%)]" />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.035)_0_1px,transparent_1px_78px),repeating-linear-gradient(0deg,rgba(34,211,238,0.025)_0_1px,transparent_1px_64px)] opacity-45" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
    </div>
  );
}

function DznCommsChannelRail({
  activeKey,
  onSelect,
}: {
  activeKey: CommsSurfaceKey;
  onSelect: (key: CommsSurfaceKey) => void;
}) {
  return (
    <aside className="rounded-lg border border-cyan-300/18 bg-black/54 p-3 shadow-[0_22px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <RailSection title="Public Channels" icon={Users}>
        {publicChannels.map((channel) => (
          <ChannelButton key={channel.key} channel={channel} active={activeKey === channel.key} onSelect={onSelect} />
        ))}
      </RailSection>

      <RailSection title="Private Groups" icon={Lock}>
        {privateGroups.map((channel) => (
          <ChannelButton key={channel.key} channel={channel} active={activeKey === channel.key} onSelect={onSelect} />
        ))}
      </RailSection>

      <div className="mt-4 grid gap-2">
        <button
          type="button"
          disabled
          className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded border border-cyan-300/30 bg-cyan-400/10 px-3 text-xs font-black uppercase text-cyan-100 opacity-70"
          title="Group creation is disabled in the static DZN Comms prototype."
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create Group
        </button>
        <button
          type="button"
          disabled
          className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded border border-violet-300/30 bg-violet-400/10 px-3 text-xs font-black uppercase text-violet-100 opacity-70"
          title="Invite controls require a future trusted membership implementation."
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Invite Members
        </button>
      </div>
    </aside>
  );
}

function RailSection({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-black uppercase text-zinc-200">
        <Icon className="h-4 w-4 text-cyan-200" aria-hidden="true" />
        {title}
      </h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function ChannelButton({
  channel,
  active,
  onSelect,
}: {
  channel: CommsChannel;
  active: boolean;
  onSelect: (key: CommsSurfaceKey) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(channel.key)}
      className={`group flex min-h-[58px] w-full items-center gap-3 rounded border px-3 py-2 text-left transition ${
        active
          ? "border-cyan-300/55 bg-cyan-400/14 text-white shadow-[0_0_22px_rgba(34,211,238,0.16)]"
          : "border-white/8 bg-white/[0.035] text-zinc-300 hover:border-cyan-300/30 hover:bg-cyan-400/8"
      }`}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded border ${toneClasses(channel.tone).soft}`}>
        {channel.locked ? <Lock className="h-4 w-4" aria-hidden="true" /> : channel.key === "support" ? <Bot className="h-4 w-4" aria-hidden="true" /> : <Hash className="h-4 w-4" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black uppercase">{channel.label}</span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-zinc-500">{channel.description}</span>
      </span>
      {channel.unread ? (
        <span className="min-w-7 rounded border border-cyan-200/30 bg-cyan-300 px-2 py-0.5 text-center text-[11px] font-black text-slate-950">
          {channel.unread}
        </span>
      ) : null}
    </button>
  );
}

function DznCommsFeedHeader({ surface, privateMode }: { surface: CommsSurface; privateMode: boolean }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
      <div className="min-w-0">
        <p className="text-[11px] font-black uppercase text-cyan-100">{surface.eyebrow}</p>
        <h2 className="mt-1 flex min-w-0 items-center gap-2 break-words text-2xl font-black uppercase leading-tight text-white [overflow-wrap:anywhere]">
          {privateMode ? <Lock className="h-5 w-5 shrink-0 text-violet-200" aria-hidden="true" /> : null}
          {surface.label}
        </h2>
        <p className="mt-1 text-xs font-semibold leading-5 text-zinc-400">{surface.summary}</p>
      </div>
      <div className="flex items-center gap-2">
        {privateMode ? (
          <StatusPill tone="violet" icon={Users} label={surface.onlineLabel} />
        ) : (
          <DznLivePresenceCounter
            scope={surface.key === "global" ? "global_chat" : "community"}
            fallbackLabel={surface.onlineLabel}
          />
        )}
        <IconButton label="Mute preview disabled" icon={VolumeX} />
        <IconButton label="Search preview disabled" icon={Search} />
        <IconButton label="More options preview disabled" icon={MoreHorizontal} />
      </div>
    </header>
  );
}

function PinnedGuidance({ surface }: { surface: CommsSurface }) {
  return (
    <section className="mx-3 mt-3 rounded border border-amber-300/24 bg-amber-300/[0.06] p-3 sm:mx-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-amber-300/30 bg-amber-300/12 text-amber-100">
            <Pin className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase text-amber-100">Pinned</p>
            <h3 className="break-words text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{surface.pinnedTitle}</h3>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">{surface.pinnedBody}</p>
      {surface.checklist?.length ? (
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {surface.checklist.map((item, index) => (
            <li key={item} className="flex items-center gap-2 rounded border border-white/8 bg-black/32 px-3 py-2 text-xs font-bold text-zinc-200">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-cyan-300/30 text-[11px] font-black text-cyan-100">
                {index + 1}
              </span>
              {item}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function CommsMessageRow({ message }: { message: CommsMessage }) {
  const tone = toneClasses(message.tone);
  return (
    <article className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 rounded border border-white/8 bg-black/28 p-3">
      <span className={`grid h-11 w-11 place-items-center rounded border text-sm font-black ${tone.soft}`}>
        {message.role === "AI" ? <Bot className="h-5 w-5" aria-hidden="true" /> : initials(message.author)}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="break-words text-sm font-black text-white [overflow-wrap:anywhere]">{message.author}</h3>
          {message.badge ? <RoleBadge label={message.badge} role={message.role} /> : null}
          {message.visibility === "locked" ? <RoleBadge label="Locked" role="AI" /> : null}
          {message.source === "message_history" ? (
            <span className="rounded border border-emerald-300/24 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-100">
              Read-only
            </span>
          ) : null}
          <span className="text-xs font-semibold text-zinc-500">{message.time}</span>
        </div>
        <p className="mt-1 break-words text-sm font-semibold leading-6 text-zinc-300 [overflow-wrap:anywhere]">{message.body}</p>
        {message.actions?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.actions.map((action) => (
              action.href ? (
                <Link
                  key={action.label}
                  href={action.href}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-cyan-300/24 bg-cyan-400/10 px-3 text-[11px] font-black uppercase text-cyan-100 transition hover:bg-cyan-400/16"
                >
                  {action.label}
                </Link>
              ) : (
                <button
                  key={action.label}
                  type="button"
                  disabled
                  className="inline-flex min-h-9 cursor-not-allowed items-center justify-center gap-2 rounded border border-cyan-300/16 bg-cyan-400/8 px-3 text-[11px] font-black uppercase text-cyan-100 opacity-70"
                >
                  {action.label}
                </button>
              )
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {message.reactions?.map((reaction) => (
            <span
              key={reaction.label}
              aria-label={`${reaction.label} reaction, ${reaction.count}`}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-cyan-300/16 bg-white/[0.055] px-2.5 py-1 text-xs font-black text-zinc-200"
              data-dzn-comms-reaction="emoji-static-preview"
            >
              <span aria-hidden="true" className="text-base leading-none">{reaction.emoji}</span>
              <span aria-hidden="true">{reaction.count}</span>
            </span>
          ))}
          <button type="button" disabled className="ml-auto inline-flex cursor-not-allowed items-center gap-1 text-[11px] font-black uppercase text-zinc-500">
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Reply
          </button>
        </div>
      </div>
    </article>
  );
}

function FilteredMessageNotice() {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-cyan-300/14 bg-cyan-400/[0.06] px-3 py-2 text-xs font-semibold text-zinc-300">
      <span className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-cyan-100" aria-hidden="true" />
        A message was filtered to keep chat welcoming.
      </span>
      <button type="button" disabled className="hidden cursor-not-allowed rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-black uppercase text-zinc-500 sm:inline-flex">
        Show details
      </button>
    </div>
  );
}

function StaticWarningPreview() {
  return (
    <section className="rounded-lg border border-violet-300/30 bg-[linear-gradient(135deg,rgba(12,10,24,0.94),rgba(28,11,50,0.84))] p-4 shadow-[0_0_46px_rgba(168,85,247,0.18)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded border border-violet-300/40 bg-violet-400/14 text-violet-100">
            <Shield className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase text-violet-100">First warning</p>
            <h3 className="break-words text-xl font-black uppercase leading-tight text-white [overflow-wrap:anywhere]">Let&apos;s keep DZN welcoming</h3>
          </div>
        </div>
        <AlertTriangle className="h-5 w-5 text-amber-100" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">
        Your message was not sent because it may contain inappropriate language. Edit it and try again in a future moderated runtime slice.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button type="button" disabled className="min-h-11 cursor-not-allowed rounded bg-cyan-300 px-3 text-xs font-black uppercase text-slate-950 opacity-70">
          Edit Message
        </button>
        <button type="button" disabled className="min-h-11 cursor-not-allowed rounded border border-cyan-300/30 bg-cyan-400/8 px-3 text-xs font-black uppercase text-cyan-100 opacity-70">
          View Chat Rules
        </button>
      </div>
      <p className="mt-3 text-xs font-semibold leading-5 text-zinc-500">
        Repeated violations can trigger a 10-minute timeout. Serious abuse is sent to staff review.
      </p>
    </section>
  );
}

function StaticComposer({ surface }: { surface: CommsSurface }) {
  return (
    <section className="border-t border-white/10 p-3 sm:p-4" aria-label={surface.composerLabel}>
      <div className="grid grid-cols-[40px_minmax(0,1fr)_44px] items-center overflow-hidden rounded border border-white/10 bg-black/40">
        <button type="button" disabled className="grid h-11 cursor-not-allowed place-items-center border-r border-white/10 text-zinc-500" aria-label="Add attachment disabled">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          disabled
          aria-describedby="dzn-comms-composer-disabled"
          value=""
          onChange={() => undefined}
          placeholder={surface.composerPlaceholder}
          className="h-11 min-w-0 bg-transparent px-3 text-sm font-semibold text-zinc-400 outline-none placeholder:text-zinc-500"
        />
        <button type="button" disabled className="grid h-11 cursor-not-allowed place-items-center border-l border-white/10 text-cyan-200 opacity-60" aria-label="Send message disabled">
          <Send className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <p id="dzn-comms-composer-disabled" className="mt-2 text-xs font-semibold text-zinc-500">
        Composer disabled in this static prototype - no messages are sent or stored.
      </p>
    </section>
  );
}

function DznAssistPanel({ onSelectSupport }: { onSelectSupport: () => void }) {
  return (
    <section className="rounded-lg border border-cyan-300/22 bg-cyan-950/34 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black uppercase text-white">
            <Bot className="h-5 w-5 text-cyan-100" aria-hidden="true" />
            DZN Assist
          </h2>
          <p className="mt-1 text-[11px] font-black uppercase text-cyan-100">Website support only</p>
        </div>
        <span className="rounded border border-cyan-300/26 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">AI boundary</span>
      </div>
      <p className="mt-4 text-sm font-semibold leading-6 text-zinc-300">
        Preview help for account setup, server linking, pricing, challenges, and events. No bot runtime or model call is connected.
      </p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_40px] overflow-hidden rounded border border-white/10 bg-black/36">
        <input disabled value="" onChange={() => undefined} placeholder="Ask about DZN..." className="h-10 min-w-0 bg-transparent px-3 text-sm font-semibold text-zinc-500 outline-none" />
        <button type="button" disabled className="grid h-10 cursor-not-allowed place-items-center border-l border-white/10 text-cyan-200 opacity-60" aria-label="DZN Assist send disabled">
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
        {supportActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              disabled
              className="grid min-h-16 cursor-not-allowed place-items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 py-2 text-[10px] font-black uppercase text-zinc-300 opacity-75"
            >
              <Icon className="h-4 w-4 text-cyan-100" aria-hidden="true" />
              {action.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onSelectSupport}
        className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded border border-cyan-300/30 bg-cyan-400/10 px-3 text-xs font-black uppercase text-cyan-100 transition hover:bg-cyan-400/16"
      >
        Open Support Surface
      </button>
    </section>
  );
}

function ChannelSafetyPanel({ privateMode }: { privateMode: boolean }) {
  return (
    <section className="rounded-lg border border-violet-300/22 bg-black/48 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase text-white">
        <ShieldCheck className="h-5 w-5 text-violet-100" aria-hidden="true" />
        {privateMode ? "Group Safety" : "Channel Safety"}
      </h2>
      <div className="mt-4 grid gap-2">
        {safetyToggles.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="flex items-center justify-between gap-3 rounded border border-white/8 bg-white/[0.035] px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                <Icon className="h-4 w-4 text-cyan-100" aria-hidden="true" />
                {item.label}
              </span>
              <span className="rounded border border-emerald-300/30 bg-emerald-400/12 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">
                {item.state}
              </span>
            </div>
          );
        })}
      </div>
      <button type="button" disabled className="mt-3 inline-flex min-h-9 cursor-not-allowed items-center gap-2 rounded border border-rose-300/22 bg-rose-400/8 px-3 text-[11px] font-black uppercase text-rose-100 opacity-70">
        <FlagIcon />
        Report Message
      </button>

      <h3 className="mt-5 text-xs font-black uppercase text-violet-100">Safety Ladder</h3>
      <ol className="mt-3 grid gap-2">
        {safetyLadder.map((item) => (
          <li key={item.step} className={`flex gap-3 rounded border px-3 py-2 ${item.step === "2" ? "border-violet-300/34 bg-violet-400/12" : "border-white/8 bg-white/[0.035]"}`}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-black ${toneClasses(item.tone as CommsTone).soft}`}>
              {item.step}
            </span>
            <span className="min-w-0">
              <span className="block break-words text-xs font-black uppercase text-white [overflow-wrap:anywhere]">{item.label}</span>
              <span className="mt-0.5 block break-words text-xs font-semibold text-zinc-500 [overflow-wrap:anywhere]">{item.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MemberPresencePanel({ members, privateMode }: { members: CommsMember[]; privateMode: boolean }) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/48 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase text-white">
        <Users className="h-5 w-5 text-cyan-100" aria-hidden="true" />
        {privateMode ? `Group Members - ${members.length}` : "Online Members - 128"}
      </h2>
      <div className="mt-4 grid gap-2">
        {members.map((member) => (
          <div key={member.name} className="flex items-center gap-3 rounded border border-white/8 bg-white/[0.035] px-3 py-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${member.status === "away" ? "bg-amber-300" : "bg-emerald-300"}`} />
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded border text-xs font-black ${toneClasses(member.tone).soft}`}>
              {initials(member.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-zinc-100">{member.name}</span>
              {member.level ? <span className="block truncate text-[11px] font-semibold text-zinc-500">{member.level}</span> : null}
            </span>
            <RoleBadge label={member.role} role={member.role} />
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusPill({ tone, icon: Icon, label }: { tone: CommsTone; icon: LucideIcon; label: string }) {
  return (
    <span className={`inline-flex min-h-9 items-center justify-center gap-2 rounded border px-3 text-xs font-black uppercase ${toneClasses(tone).soft}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

function IconButton({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <button
      type="button"
      disabled
      aria-label={label}
      title={label}
      className="grid h-9 w-9 cursor-not-allowed place-items-center rounded border border-white/10 bg-white/[0.035] text-zinc-500"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function RoleBadge({ label, role }: { label: string; role: MemberRole | string }) {
  const tone = role === "Owner" ? "cyan" : role === "Mod" ? "emerald" : role === "VIP" ? "amber" : role === "AI" ? "violet" : "rose";
  return (
    <span className={`rounded border px-2 py-0.5 text-[10px] font-black uppercase ${toneClasses(tone).soft}`}>
      {label}
    </span>
  );
}

function FlagIcon() {
  return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
}

function initials(name: string) {
  return name
    .split(/\s|_/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function toneClasses(tone: CommsTone) {
  if (tone === "violet") return { soft: "border-violet-300/30 bg-violet-400/12 text-violet-100" };
  if (tone === "amber") return { soft: "border-amber-300/30 bg-amber-400/12 text-amber-100" };
  if (tone === "emerald") return { soft: "border-emerald-300/30 bg-emerald-400/12 text-emerald-100" };
  if (tone === "rose") return { soft: "border-rose-300/30 bg-rose-400/12 text-rose-100" };
  return { soft: "border-cyan-300/30 bg-cyan-400/12 text-cyan-100" };
}
