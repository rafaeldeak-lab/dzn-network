"use client";

import Image from "next/image";
import {
  AlertTriangle,
  ArrowDown,
  Bot,
  Flag,
  Hash,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { DznAssist } from "./dzn-assist";
import { DznUpdatesFeed } from "./dzn-updates-feed";
import { DznLivePresenceCounter } from "./dzn-live-presence-counter";
import { CommsMessageTime } from "./comms-message-time";
import { mergeDeletionNotices, type DeletionNotice } from "./deletion-notices";
import {
  addCommsReaction,
  deleteCommsMessage,
  loadCommsHistory,
  loadCommsTyping,
  removeCommsReaction,
  reportCommsMessage,
  sendCommsMessage,
  setCommsTyping,
  type CommsHistoryMessage,
  type CommsHistoryPayload,
  type CommsReactionMutation,
} from "./comms-history-client";

type CommsHistoryState =
  | { status: "static"; payload: CommsHistoryPayload; message: string }
  | { status: "loading"; payload: CommsHistoryPayload; message: string }
  | { status: "ready"; payload: CommsHistoryPayload; message: string }
  | { status: "fallback"; payload: CommsHistoryPayload; message: string };

const historyUiEnabled = process.env.NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED === "true";
const liveUiEnabled = process.env.NEXT_PUBLIC_DZN_COMMS_LIVE_UI_ENABLED === "true";
const presenceUiEnabled = process.env.NEXT_PUBLIC_DZN_COMMS_PUBLIC_ONLINE_COUNTER_ENABLED === "true";
const privateGroupsUiEnabled = process.env.NEXT_PUBLIC_DZN_COMMS_PRIVATE_GROUPS_UI_ENABLED === "true";
const ownerDiscordAccessUiEnabled = process.env.NEXT_PUBLIC_DZN_OWNER_DISCORD_ACCESS_UI_ENABLED === "true";
// A deployed client learns its available Comms controls from the same-origin
// history response. Local development remains explicitly default-off.
const productionRuntimeProbeEnabled = process.env.NODE_ENV === "production";
const historyProbeEnabled = historyUiEnabled || liveUiEnabled || productionRuntimeProbeEnabled;
const DELETED_MESSAGE_NOTICE_MS = 2_000;
const CAPABILITY_PROBE_RETRY_DELAY_MS = 5_000;
const CAPABILITY_PROBE_RETRY_LIMIT = 3;
const MESSAGE_RAIL_BOTTOM_TOLERANCE_PX = 32;

type MessageRailMetrics = Pick<HTMLDivElement, "clientHeight" | "scrollHeight" | "scrollTop">;
type MessageRailTimelineItem = Pick<CommsHistoryMessage, "created_at" | "id">;
export type DznCommsMessageRailBoundary = Readonly<{ createdAt: string; messageId: string }>;

export function isDznCommsMessageRailAtBottom({ clientHeight, scrollHeight, scrollTop }: MessageRailMetrics) {
  return scrollHeight - scrollTop - clientHeight <= MESSAGE_RAIL_BOTTOM_TOLERANCE_PX;
}

function compareUtf8Text(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] < rightBytes[index] ? -1 : 1;
  }
  return leftBytes.length === rightBytes.length ? 0 : leftBytes.length < rightBytes.length ? -1 : 1;
}

function compareDznCommsMessageRailBoundary(left: DznCommsMessageRailBoundary, right: DznCommsMessageRailBoundary) {
  const timestampOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return timestampOrder === 0 ? compareUtf8Text(left.messageId, right.messageId) : timestampOrder;
}

export function latestDznCommsMessageRailBoundary(messages: readonly MessageRailTimelineItem[]) {
  let latest: DznCommsMessageRailBoundary | null = null;
  for (const message of messages) {
    if (!message.created_at || !Number.isFinite(Date.parse(message.created_at))) continue;
    const candidate = { createdAt: message.created_at, messageId: message.id };
    if (!latest || compareDznCommsMessageRailBoundary(candidate, latest) > 0) latest = candidate;
  }
  return latest;
}

export function countDznCommsMessagesNewerThanBoundary(
  previousBoundary: DznCommsMessageRailBoundary | null,
  messages: readonly MessageRailTimelineItem[],
) {
  if (!previousBoundary) return 0;
  return messages.filter((message) => {
    if (!message.created_at || !Number.isFinite(Date.parse(message.created_at))) return false;
    return compareDznCommsMessageRailBoundary(
      { createdAt: message.created_at, messageId: message.id },
      previousBoundary,
    ) > 0;
  }).length;
}

const staticPayload: CommsHistoryPayload = {
  ok: true,
  generated_at: "static-preview",
  read_only: true,
  presentation_only: true,
  channel: {
    slug: "global-chat",
    kind: "public",
    name: "Global Chat",
    description: "Public messages appear here when DZN Comms is available.",
    visibility: "public",
  },
  access: {
    public_channel: true,
    private_group_membership_required: false,
    current_user_member_role: null,
  },
  available_channels: [{
    slug: "global-chat",
    kind: "public",
    name: "Global Chat",
    description: "Public DZN community chat.",
    visibility: "public",
    current_user_member_role: null,
  }],
  messages: [],
  page: { next_cursor: null, has_more: false, limit: 30 },
  feature_flags: {
    route_enabled: false,
    sending_enabled: false,
    private_groups_enabled: false,
    reactions_enabled: false,
    reactions_write_enabled: false,
    reactions_custom_emoji_enabled: false,
    reactions_custom_emoji_write_enabled: false,
    typing_enabled: false,
    typing_write_enabled: false,
    report_actions_enabled: false,
    moderation_mutations_enabled: false,
    self_delete_enabled: false,
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
  const [selectedChannel, setSelectedChannel] = useState("global-chat");
  const selectedChannelRef = useRef("global-chat");
  const historyRequestGenerationRef = useRef(0);
  const privateAccessRequestGenerationRef = useRef(0);
  const messageLogRef = useRef<HTMLDivElement | null>(null);
  const messageLogChannelRef = useRef<string | null>(null);
  const messageLogBoundaryRef = useRef<DznCommsMessageRailBoundary | null>(null);
  const followLatestMessagesRef = useRef(true);
  const deletionNoticeTimeoutsRef = useRef(new Map<string, number>());
  const [deletionNotices, setDeletionNotices] = useState<ReadonlyMap<string, DeletionNotice>>(() => new Map());
  const [deletedMessageIds, setDeletedMessageIds] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [composerMessage, setComposerMessage] = useState("");
  const [loadingEarlierMessages, setLoadingEarlierMessages] = useState(false);
  const [historyPageMode, setHistoryPageMode] = useState<"latest" | "earlier">("latest");
  const [unseenMessageCount, setUnseenMessageCount] = useState(0);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const sendAttemptRef = useRef<{ channelSlug: string; draft: string; requestId: string } | null>(null);
  const typingSessionChannelRef = useRef<string | null>(null);
  const [history, setHistory] = useState<CommsHistoryState>(() => ({
    status: historyProbeEnabled ? "loading" : "static",
    payload: staticPayload,
    message: historyProbeEnabled
      ? "Checking whether DZN Global Chat is available."
      : "Message history is not active here. No messages are shown.",
  }));
  const isUpdatesChannel = selectedChannel === "dzn-updates";
  const liveHistoryRuntimeEnabled = history.status === "ready" && history.payload.feature_flags.sending_enabled;

  useEffect(() => {
    if (!historyProbeEnabled || selectedChannel === "dzn-updates") return;
    // Public history pauses while the visitor reads a selected page. Private groups keep
    // polling their authorization and controls so access revocations take effect promptly.
    if (historyPageMode === "earlier" && selectedChannel === "global-chat") return;
    const retainPrivateEarlierPage = historyPageMode === "earlier" && selectedChannel !== "global-chat";

    const controller = new AbortController();
    let poller: number | undefined;
    let retryTimer: number | undefined;
    let capabilityProbeRetries = 0;
    const refresh = () => {
      // Private access checks must not invalidate an in-flight earlier-page request.
      // They only refresh membership and capabilities while preserving that page.
      const requestGeneration = retainPrivateEarlierPage
        ? ++privateAccessRequestGenerationRef.current
        : ++historyRequestGenerationRef.current;
      const isCurrentRequest = () => retainPrivateEarlierPage
        ? privateAccessRequestGenerationRef.current === requestGeneration
        : historyRequestGenerationRef.current === requestGeneration;
      return loadCommsHistory(controller.signal, { channelSlug: selectedChannel })
      .then((payload) => {
        if (
          controller.signal.aborted
          || !isCurrentRequest()
          || selectedChannelRef.current !== selectedChannel
          || payload.channel.slug !== selectedChannel
        ) return;
        setHistory((current) => ({
          status: "ready",
          payload: retainPrivateEarlierPage && current.status === "ready" && current.payload.channel.slug === selectedChannel
            ? { ...payload, messages: current.payload.messages, page: current.payload.page }
            : payload,
          message: payload.feature_flags.sending_enabled ? `${payload.channel.name} is live. English only. Keep it respectful and report abuse.` : "Message history is available. Sending is not enabled yet.",
        }));
      })
      .catch(() => {
        if (
          controller.signal.aborted
          || !isCurrentRequest()
          || selectedChannelRef.current !== selectedChannel
        ) return;
        if (selectedChannel !== "global-chat") {
          setLoadingEarlierMessages(false);
          setHistoryPageMode("latest");
          setHistory({
            status: "loading",
            payload: staticPayload,
            message: "Private group access changed. Returning to Global Chat.",
          });
          selectedChannelRef.current = "global-chat";
          setSelectedChannel("global-chat");
          return;
        }
        setHistory((current) => current.status === "ready"
          ? { ...current, message: `${current.payload.channel.name} could not refresh. Showing the last received messages while DZN reconnects.` }
          : {
              status: "fallback",
              payload: staticPayload,
              message: "Message history is temporarily unavailable. No old or fabricated messages are shown.",
            });
        if (poller === undefined && capabilityProbeRetries < CAPABILITY_PROBE_RETRY_LIMIT) {
          capabilityProbeRetries += 1;
          retryTimer = window.setTimeout(() => void refresh(), CAPABILITY_PROBE_RETRY_DELAY_MS);
        }
      });
    };
    void refresh();
    if (liveHistoryRuntimeEnabled || selectedChannel !== "global-chat") {
      poller = window.setInterval(() => void refresh(), 5_000);
    }

    return () => {
      controller.abort();
      if (poller !== undefined) window.clearInterval(poller);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [selectedChannel, historyPageMode, liveHistoryRuntimeEnabled]);

  useEffect(() => {
    const selectChannelFromHash = () => {
      const nextChannel = window.location.hash === "#dzn-updates" ? "dzn-updates" : "global-chat";
      if (selectedChannelRef.current === nextChannel) return;
      historyRequestGenerationRef.current += 1;
      setDraft("");
      setComposerMessage("");
      setLoadingEarlierMessages(false);
      setHistoryPageMode("latest");
      prepareMessageRailForChannelChange();
      selectedChannelRef.current = nextChannel;
      if (nextChannel === "global-chat") {
        setHistory({
          status: historyProbeEnabled ? "loading" : "static",
          payload: staticPayload,
          message: historyProbeEnabled ? "Opening Global Chat." : "Message history is not active here. No messages are shown.",
        });
      }
      setSelectedChannel(nextChannel);
    };
    selectChannelFromHash();
    window.addEventListener("hashchange", selectChannelFromHash);
    return () => window.removeEventListener("hashchange", selectChannelFromHash);
  }, []);

  useEffect(() => {
    if (!isUpdatesChannel || window.location.hash !== "#dzn-updates") return;
    document.getElementById("dzn-updates")?.scrollIntoView({ block: "start" });
  }, [isUpdatesChannel]);

  useEffect(() => () => {
    for (const timeout of deletionNoticeTimeoutsRef.current.values()) window.clearTimeout(timeout);
    deletionNoticeTimeoutsRef.current.clear();
  }, []);

  const payload = history.payload;
  const visibleMessages = useMemo(
    () => mergeDeletionNotices(payload.messages, deletionNotices, deletedMessageIds, payload.channel.slug),
    [deletedMessageIds, deletionNotices, payload.channel.slug, payload.messages],
  );
  const historyReady = history.status === "ready";
  const recentSpeakers = useMemo(() => historyReady ? recentVisibleSpeakers(visibleMessages) : [], [historyReady, visibleMessages]);
  const sendingEnabled = historyReady && payload.feature_flags.sending_enabled;
  const reportActionsEnabled = historyReady && payload.feature_flags.report_actions_enabled;
  const selfDeleteUiEnabled = historyReady && payload.feature_flags.self_delete_enabled;
  const reactionsEnabled = historyReady && payload.feature_flags.reactions_enabled;
  const reactionsWriteEnabled = historyReady && payload.feature_flags.reactions_write_enabled;
  const customEmojiReactionsEnabled = historyReady && payload.feature_flags.reactions_custom_emoji_enabled;
  const customEmojiReactionsWriteEnabled = historyReady && payload.feature_flags.reactions_custom_emoji_write_enabled;
  const typingReadEnabled = historyReady && payload.feature_flags.typing_enabled && payload.channel.slug === "global-chat";
  const typingWriteEnabled = historyReady && payload.feature_flags.typing_write_enabled && payload.channel.slug === "global-chat";
  const statusLabel = useMemo(() => statusCopy(history.status, sendingEnabled), [history.status, sendingEnabled]);

  useEffect(() => {
    if (!typingReadEnabled) return;
    const controller = new AbortController();
    const refresh = () => {
      void loadCommsTyping(controller.signal, payload.channel.slug)
        .then((response) => {
          if (!controller.signal.aborted && selectedChannelRef.current === response.channel_slug) {
            setTypingNames(response.typers.map((typer) => typer.display_name));
          }
        })
        .catch(() => { if (!controller.signal.aborted) setTypingNames([]); });
    };
    refresh();
    const interval = window.setInterval(refresh, 3_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [payload.channel.slug, typingReadEnabled]);

  const hasDraft = draft.trim().length > 0;
  useEffect(() => {
    const activeChannel = typingSessionChannelRef.current;
    if (!typingWriteEnabled || !hasDraft || sending) {
      if (activeChannel) {
        typingSessionChannelRef.current = null;
        void setCommsTyping(activeChannel, false).catch(() => undefined);
      }
      return;
    }
    const channel = payload.channel.slug;
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      typingSessionChannelRef.current = channel;
      void setCommsTyping(channel, true).catch(() => undefined);
    };
    update();
    const interval = window.setInterval(update, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (typingSessionChannelRef.current === channel) {
        typingSessionChannelRef.current = null;
        void setCommsTyping(channel, false).catch(() => undefined);
      }
    };
  }, [hasDraft, payload.channel.slug, sending, typingWriteEnabled]);

  useEffect(() => {
    if (!historyReady || isUpdatesChannel) return;
    const log = messageLogRef.current;
    if (!log) return;

    const channelChanged = messageLogChannelRef.current !== payload.channel.slug;
    const previousBoundary = messageLogBoundaryRef.current;
    messageLogChannelRef.current = payload.channel.slug;
    messageLogBoundaryRef.current = latestDznCommsMessageRailBoundary(visibleMessages);

    if (channelChanged || followLatestMessagesRef.current) {
      window.requestAnimationFrame(() => {
        const currentLog = messageLogRef.current;
        if (currentLog) currentLog.scrollTo({ top: currentLog.scrollHeight, behavior: "auto" });
      });
      setUnseenMessageCount((count) => count === 0 ? count : 0);
      return;
    }

    if (historyPageMode === "earlier") return;
    const newlyLoadedMessageCount = countDznCommsMessagesNewerThanBoundary(previousBoundary, visibleMessages);
    if (newlyLoadedMessageCount > 0) setUnseenMessageCount((count) => count + newlyLoadedMessageCount);
  }, [historyReady, historyPageMode, isUpdatesChannel, payload.channel.slug, visibleMessages]);

  const canSend = sendingEnabled && draft.trim().length > 0 && !sending;
  const selectedChannelAccessLabel = isUpdatesChannel
    ? "Official updates"
    : sendingEnabled
    ? "Live now"
    : history.status === "ready"
      ? "Read-only history"
      : history.status === "loading"
        ? "Checking access"
        : "Preview only";

  function selectUpdatesChannel() {
    if (selectedChannelRef.current === "dzn-updates") return;
    historyRequestGenerationRef.current += 1;
    setDraft("");
    setComposerMessage("");
    setLoadingEarlierMessages(false);
    setHistoryPageMode("latest");
    prepareMessageRailForChannelChange();
    selectedChannelRef.current = "dzn-updates";
    setSelectedChannel("dzn-updates");
    if (window.location.hash !== "#dzn-updates") window.history.replaceState(null, "", "#dzn-updates");
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    const targetChannel = payload.channel.slug;
    if (selectedChannelRef.current !== targetChannel) {
      setComposerMessage("The selected channel changed. Review the channel and send again.");
      return;
    }
    const pendingAttempt = sendAttemptRef.current?.channelSlug === targetChannel && sendAttemptRef.current.draft === draft
      ? sendAttemptRef.current
      : { channelSlug: targetChannel, draft, requestId: crypto.randomUUID() };
    sendAttemptRef.current = pendingAttempt;
    setSending(true);
    setComposerMessage("");
    try {
      await sendCommsMessage(targetChannel, draft, pendingAttempt.requestId);
      sendAttemptRef.current = null;
      if (selectedChannelRef.current === targetChannel) {
        setDraft("");
        setComposerMessage(`Message sent to ${payload.channel.name}.`);
      }
      if (selectedChannelRef.current !== targetChannel) return;
      setLoadingEarlierMessages(false);
      setHistoryPageMode("latest");
      scrollMessageRailToLatest();
      const requestGeneration = ++historyRequestGenerationRef.current;
      try {
        const refreshed = await loadCommsHistory(new AbortController().signal, { channelSlug: targetChannel });
        if (
          historyRequestGenerationRef.current === requestGeneration
          && selectedChannelRef.current === targetChannel
          && refreshed.channel.slug === targetChannel
        ) {
          setHistory({ status: "ready", payload: refreshed, message: `Message sent to ${refreshed.channel.name}.` });
        }
      } catch {
        if (historyRequestGenerationRef.current === requestGeneration && selectedChannelRef.current === targetChannel) {
          setHistory((current) => ({ ...current, message: "Message sent. Chat history will refresh shortly." }));
        }
      }
    } catch (error) {
      if (selectedChannelRef.current === targetChannel) {
        setComposerMessage(error instanceof Error ? error.message : "Message could not be sent.");
      }
    } finally {
      setSending(false);
    }
  }

  function applyReactionMutation(messageId: string, mutation: CommsReactionMutation) {
    const targetChannel = payload.channel.slug;
    if (!historyReady || selectedChannelRef.current !== targetChannel) return;
    setHistory((current) => {
      if (current.status !== "ready" || current.payload.channel.slug !== targetChannel) return current;
      return {
        ...current,
        payload: {
          ...current.payload,
          messages: current.payload.messages.map((message) => {
            if (message.id !== messageId) return message;
            const reactions = message.reactions ?? { revision: mutation.revision, available_reactions: [], counts: [] };
            const counts = reactions.counts.filter((reaction) => reaction.key !== mutation.reaction.key);
            if (mutation.reaction.count > 0) counts.push(mutation.reaction);
            return { ...message, reactions: { ...reactions, revision: mutation.revision, counts } };
          }),
        },
      };
    });
  }

  async function loadEarlierMessages() {
    const targetChannel = payload.channel.slug;
    const cursor = payload.page.next_cursor;
    if (!historyReady || !cursor || loadingEarlierMessages || selectedChannelRef.current !== targetChannel) return;

    const scrollPosition = messageLogRef.current
      ? { height: messageLogRef.current.scrollHeight, top: messageLogRef.current.scrollTop }
      : null;
    const requestGeneration = ++historyRequestGenerationRef.current;
    followLatestMessagesRef.current = false;
    setUnseenMessageCount(0);
    setLoadingEarlierMessages(true);
    setHistoryPageMode("earlier");
    try {
      const earlier = await loadCommsHistory(new AbortController().signal, { channelSlug: targetChannel, cursor });
      if (
        historyRequestGenerationRef.current !== requestGeneration
        || selectedChannelRef.current !== targetChannel
        || earlier.channel.slug !== targetChannel
      ) return;
      setHistory((current) => {
        if (current.status !== "ready" || current.payload.channel.slug !== targetChannel) return current;
        const currentIds = new Set(current.payload.messages.map((message) => message.id));
        const unseenEarlier = earlier.messages.filter((message) => !currentIds.has(message.id));
        return {
          ...current,
          payload: {
            ...earlier,
            messages: [...unseenEarlier, ...current.payload.messages],
          },
          message: unseenEarlier.length > 0 ? "Earlier messages loaded. Return to latest messages to refresh this channel." : "No additional earlier messages are available.",
        };
      });
      if (scrollPosition) {
        window.requestAnimationFrame(() => {
          const log = messageLogRef.current;
          if (log) log.scrollTop = scrollPosition.top + (log.scrollHeight - scrollPosition.height);
        });
      }
    } catch {
      if (historyRequestGenerationRef.current === requestGeneration && selectedChannelRef.current === targetChannel) {
        setHistory((current) => ({ ...current, message: "Earlier messages could not load. Showing the messages already received." }));
        setHistoryPageMode("latest");
      }
    } finally {
      if (historyRequestGenerationRef.current === requestGeneration && selectedChannelRef.current === targetChannel) {
        setLoadingEarlierMessages(false);
      }
    }
  }

  function returnToLatestMessages() {
    if (historyPageMode !== "earlier") return;
    historyRequestGenerationRef.current += 1;
    setLoadingEarlierMessages(false);
    setHistoryPageMode("latest");
    scrollMessageRailToLatest();
    setHistory((current) => ({ ...current, message: `Returning to the latest ${current.payload.channel.name} messages.` }));
  }

  function prepareMessageRailForChannelChange() {
    messageLogChannelRef.current = null;
    messageLogBoundaryRef.current = null;
    followLatestMessagesRef.current = true;
    setUnseenMessageCount(0);
  }

  function scrollMessageRailToLatest() {
    followLatestMessagesRef.current = true;
    setUnseenMessageCount(0);
    window.requestAnimationFrame(() => {
      const log = messageLogRef.current;
      if (log) log.scrollTo({ top: log.scrollHeight, behavior: "auto" });
    });
  }

  function handleMessageLogScroll() {
    const log = messageLogRef.current;
    if (!log) return;
    const atBottom = isDznCommsMessageRailAtBottom(log);
    followLatestMessagesRef.current = atBottom;
    if (atBottom) setUnseenMessageCount(0);
  }

  function handleMessageDeleted(messageId: string, deletedChannelSlug: string) {
    const deletedMessage = visibleMessages.find((item) => item.id === messageId);
    if (!deletedMessage) return;
    const notice: CommsHistoryMessage = {
      ...deletedMessage,
      author_display_name: "DZN Safety",
      author_role_label: "System",
      body: "Message deleted.",
      visibility_state: "deleted",
      can_delete: false,
      reactions: undefined,
    };
    setDeletedMessageIds((current) => {
      if (current.has(messageId)) return current;
      const next = new Set(current);
      next.add(messageId);
      return next;
    });
    // A newer deletion replaces any earlier placeholder, while the tombstones
    // continue to hide every deleted row from the public chat.
    for (const timeout of deletionNoticeTimeoutsRef.current.values()) window.clearTimeout(timeout);
    deletionNoticeTimeoutsRef.current.clear();

    setDeletionNotices(new Map([[messageId, { channelSlug: deletedChannelSlug, message: notice }]]));
    setHistory((current) => ({
      ...current,
      payload: {
        ...current.payload,
        messages: current.payload.messages.map((item) => item.id === messageId
          ? notice
          : item),
      },
    }));

    const timeout = window.setTimeout(() => {
      deletionNoticeTimeoutsRef.current.delete(messageId);
      setDeletionNotices((current) => current.has(messageId) ? new Map() : current);
      setHistory((current) => {
        if (current.payload.channel.slug !== deletedChannelSlug) return current;
        return {
          ...current,
          payload: {
            ...current.payload,
            messages: current.payload.messages.filter((item) => item.visibility_state !== "deleted"),
          },
        };
      });
    }, DELETED_MESSAGE_NOTICE_MS);
    deletionNoticeTimeoutsRef.current.set(messageId, timeout);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#03050d] pb-24 pt-4 text-zinc-100 sm:pt-6">
      <section className="mx-auto flex w-full max-w-[92rem] flex-col gap-3 px-4 sm:px-6 lg:px-8">
        <nav aria-label="DZN communication tools" className="flex flex-wrap items-center gap-x-1 gap-y-2 border-y border-white/10 bg-[#050812]/92 px-2 py-2">
          <a href="#global-chat" onClick={() => {
            if (selectedChannelRef.current === "global-chat") return;
            historyRequestGenerationRef.current += 1;
            setDraft("");
            setComposerMessage("");
            setLoadingEarlierMessages(false);
            setHistoryPageMode("latest");
            prepareMessageRailForChannelChange();
            selectedChannelRef.current = "global-chat";
            setHistory({ status: "loading", payload: staticPayload, message: "Opening Global Chat." });
            setSelectedChannel("global-chat");
          }} className="group inline-flex min-h-10 items-center gap-2 border-l-2 border-cyan-300/70 px-3 py-2 text-sm font-black uppercase text-white transition hover:bg-cyan-300/8">
            <MessageCircle className="h-4 w-4 text-cyan-200" aria-hidden="true" />
            <span>DZN Comms</span>
            <span className="text-[10px] tracking-[0.14em] text-emerald-200">{selectedChannelAccessLabel}</span>
          </a>
          <a href="#dzn-updates" onClick={selectUpdatesChannel} className="group inline-flex min-h-10 items-center gap-2 border-l-2 border-violet-300/70 px-3 py-2 text-sm font-black uppercase text-white transition hover:bg-violet-300/8">
            <Megaphone className="h-4 w-4 text-violet-200" aria-hidden="true" />
            <span>DZN Updates</span>
          </a>
          <a href="#dzn-assist" className="group inline-flex min-h-10 items-center gap-2 border-l-2 border-violet-300/70 px-3 py-2 text-sm font-black uppercase text-white transition hover:bg-violet-300/8">
            <Bot className="h-4 w-4 text-violet-200" aria-hidden="true" />
            <span>DZN Assist</span>
          </a>
          {ownerDiscordAccessUiEnabled ? <a href="/login?returnTo=%2Fdiscord-owner-access" className="group inline-flex min-h-10 items-center gap-2 border-l-2 border-amber-300/70 px-3 py-2 text-sm font-black uppercase text-white transition hover:bg-amber-300/8">
            <ShieldCheck className="h-4 w-4 text-amber-200" aria-hidden="true" />
            <span>Owner access</span>
          </a> : null}
        </nav>

        <div id="global-chat" className="scroll-mt-6 overflow-hidden rounded-md border border-cyan-400/20 bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.16),transparent_32%),radial-gradient(circle_at_88%_0%,rgba(168,85,247,0.13),transparent_28%),rgba(5,9,22,0.92)] shadow-[0_22px_70px_rgba(0,0,0,0.38)]">
          <div className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-cyan-300/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.18)]">
                <MessageCircle className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">DZN Comms</p>
                <h1 className="mt-1 text-2xl font-black uppercase leading-none text-white sm:text-3xl">{isUpdatesChannel ? "DZN Updates" : payload.channel.name}</h1>
                <p className="mt-1.5 max-w-2xl text-sm font-semibold leading-5 text-zinc-300">
                  {isUpdatesChannel
                    ? "Verified DZN product and community release notes for players and server owners."
                    : payload.channel.description ?? "Discord-authenticated members can talk in this moderated DZN channel."}
                </p>
              </div>
            </div>
            <div className={presenceUiEnabled && !isUpdatesChannel ? "grid gap-2 sm:grid-cols-3 lg:w-[420px]" : "grid gap-2 sm:grid-cols-2 lg:w-[280px]"}>
              <StatusPill label="History" value={isUpdatesChannel ? "Permanent" : statusLabel} tone={isUpdatesChannel || history.status === "ready" ? "cyan" : "violet"} />
              <StatusPill label="Runtime" value={isUpdatesChannel ? "Official" : sendingEnabled ? "Live" : "Read Only"} tone={isUpdatesChannel || sendingEnabled ? "cyan" : "gold"} />
              {!isUpdatesChannel && presenceUiEnabled ? <DznLivePresenceCounter /> : null}
            </div>
          </div>

          {!isUpdatesChannel ? <div className="border-b border-white/10 bg-black/20 px-4 py-2.5 sm:px-5">
            <div className="flex items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span className="inline-flex shrink-0 items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400"><span className="h-2 w-2 rounded-full bg-emerald-300" /> Recent</span>
              {recentSpeakers.length > 0 ? recentSpeakers.map((member) => <span key={`${member.author_display_name}:${member.author_role_label}`} className="inline-flex shrink-0 items-center gap-2 text-xs font-bold text-zinc-200"><span className="grid h-6 w-6 place-items-center rounded-full border border-violet-300/35 bg-violet-400/15 text-[10px] text-violet-100">{initials(member.author_display_name)}</span>{member.author_display_name}</span>) : <span className="text-xs font-semibold text-zinc-500">Conversation is quiet.</span>}
            </div>
          </div> : null}

          <div className="grid gap-0 lg:grid-cols-[14.5rem_minmax(0,1fr)_15rem]">
            <aside className="border-b border-white/10 bg-black/18 p-3 lg:border-b-0 lg:border-r">
              <PanelTitle icon={Hash} label="Channels" />
              <div className="mt-3 space-y-2">
                {payload.available_channels
                  .filter((channel) => channel.kind === "public" || privateGroupsUiEnabled)
                  .map((channel) => (
                    <ChannelButton
                      key={channel.slug}
                      active={!isUpdatesChannel && channel.slug === payload.channel.slug}
                      icon={channel.kind === "private_group" ? LockKeyhole : Hash}
                      label={channel.name}
                      meta={channel.kind === "private_group" ? channel.current_user_member_role ?? "Member" : sendingEnabled ? "Live" : "Read-only"}
                      onSelect={() => {
                        if (channel.slug === selectedChannelRef.current) return;
                        historyRequestGenerationRef.current += 1;
                        setDraft("");
                        setComposerMessage("");
                        setLoadingEarlierMessages(false);
                        setHistoryPageMode("latest");
                        prepareMessageRailForChannelChange();
                        selectedChannelRef.current = channel.slug;
                        setHistory({ status: "loading", payload: staticPayload, message: "Opening the selected DZN Comms channel." });
                        setSelectedChannel(channel.slug);
                      }}
                    />
                  ))}
                <ChannelButton
                  active={isUpdatesChannel}
                  icon={Megaphone}
                  label="DZN Updates"
                  meta="Official"
                  onSelect={selectUpdatesChannel}
                />
              </div>
              <div className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/8 p-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-200">Community Safety</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-zinc-300">
                  English only. Do not post abuse, invites, secrets, threats or personal information. Report abuse instead of replying to it.
                </p>
              </div>
            </aside>

            <section className="min-w-0 border-b border-white/10 p-3 sm:p-4 lg:border-b-0 lg:border-r">
              {isUpdatesChannel ? <DznUpdatesFeed /> : <>
              <div className="flex flex-col gap-2 border-b border-white/10 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">#{payload.channel.slug}</p>
                  <h2 className="mt-1 text-xl font-black uppercase text-white">{payload.channel.name}</h2>
                </div>
                <span className="w-fit rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-zinc-300">
                  {visibleMessages.length === 1 ? "1 message" : `${visibleMessages.length} messages`}
                </span>
              </div>

              <div role="status" aria-live="polite" className="mt-3 border-l-2 border-cyan-300/55 bg-cyan-300/6 px-3 py-2">
                <p className="text-xs font-bold leading-5 text-cyan-50">{history.message}</p>
              </div>

              <div className="relative mt-3">
                <div
                  ref={messageLogRef}
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions text"
                  onScroll={handleMessageLogScroll}
                  className="h-[min(32rem,calc(100svh-18rem))] min-h-64 max-h-[46svh] divide-y divide-white/8 overflow-y-auto overscroll-contain border border-white/8 bg-black/20 px-3 [scrollbar-color:rgba(103,232,249,0.45)_rgba(255,255,255,0.03)] [scrollbar-gutter:stable] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-cyan-200/45 [&::-webkit-scrollbar-track]:bg-[#060a12] [&::-webkit-scrollbar]:w-2 lg:max-h-[28rem]"
                >
                {historyReady && (payload.page.has_more || historyPageMode === "earlier") ? <div className="flex items-center justify-center gap-2 border-b border-white/8 py-3">
                  {historyPageMode === "earlier" ? <button type="button" onClick={returnToLatestMessages} className="min-h-8 border border-white/12 bg-white/[0.035] px-3 text-xs font-bold text-zinc-300 transition hover:border-cyan-300/35 hover:bg-cyan-300/10 hover:text-white">Latest messages</button> : null}
                  {payload.page.has_more ? <button type="button" onClick={() => void loadEarlierMessages()} disabled={loadingEarlierMessages} className="min-h-8 border border-cyan-300/25 bg-cyan-300/8 px-3 text-xs font-bold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/15 disabled:cursor-wait disabled:opacity-60">{loadingEarlierMessages ? "Loading history..." : "Load earlier messages"}</button> : null}
                </div> : null}
                {visibleMessages.length > 0 ? visibleMessages.map((message) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    reportEnabled={reportActionsEnabled}
                    deleteEnabled={selfDeleteUiEnabled}
                    reactionsEnabled={reactionsEnabled}
                    reactionsWriteEnabled={reactionsWriteEnabled}
                    customEmojiReactionsEnabled={customEmojiReactionsEnabled}
                    customEmojiReactionsWriteEnabled={customEmojiReactionsWriteEnabled}
                    onReactionChanged={(mutation) => applyReactionMutation(message.id, mutation)}
                    onMessageDeleted={(messageId) => handleMessageDeleted(messageId, payload.channel.slug)}
                  />
                )) : (
                  <div className="grid min-h-28 place-items-center px-4 py-7 text-center">
                    <div>
                      <p className="text-sm font-black text-zinc-100">No public messages yet</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-zinc-400">
                        {history.status === "ready"
                          ? "Start the conversation when sending is available."
                          : history.status === "static"
                            ? "No placeholder conversation is displayed."
                            : "DZN will reconnect automatically when message history returns."}
                      </p>
                    </div>
                  </div>
                )}
                </div>
                {unseenMessageCount > 0 ? <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3" aria-live="polite">
                  <button type="button" onClick={scrollMessageRailToLatest} className="pointer-events-auto inline-flex min-h-9 items-center gap-2 rounded-md border border-cyan-200/55 bg-[#071421]/95 px-3 text-xs font-black text-cyan-50 shadow-[0_10px_28px_rgba(0,0,0,0.45)] transition hover:border-cyan-100 hover:bg-cyan-300/15" aria-label={`Jump to the latest message. ${unseenMessageCount} unread ${unseenMessageCount === 1 ? "message" : "messages"}.`}>
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    {unseenMessageCount === 1 ? "1 new message" : `${unseenMessageCount} new messages`}
                  </button>
                </div> : null}
              </div>

              {typingReadEnabled && typingNames.length > 0 ? <p role="status" aria-live="polite" className="mt-2 min-h-5 px-1 text-xs font-semibold text-zinc-400">
                {typingCopy(typingNames)}
              </p> : <div className="mt-2 min-h-5" aria-hidden="true" />}

              <form onSubmit={handleSend} className="mt-3 flex items-end gap-2 rounded-md border border-white/10 bg-[#060b14]/92 p-2" aria-label="DZN Comms message composer">
                <textarea
                  disabled={!sendingEnabled || sending}
                  value={draft}
                  onChange={(event) => setDraft([...event.target.value].slice(0, 2_000).join(""))}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || !canSend) return;
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }}
                  placeholder={sendingEnabled ? `Message ${payload.channel.name}` : "Sending unavailable"}
                  rows={1}
                  className="min-h-10 max-h-28 min-w-0 flex-1 resize-y bg-transparent px-2 py-2 text-sm font-semibold leading-5 text-zinc-300 placeholder:text-zinc-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-cyan-300/20 bg-cyan-400/10 text-cyan-500 opacity-60"
                  aria-label={sendingEnabled ? "Send message" : "Send is unavailable"}
                >
                  <Send className="h-5 w-5" aria-hidden="true" />
                </button>
              </form>
              {composerMessage ? <p role="alert" className="mt-2 text-sm font-bold text-amber-200">{composerMessage}</p> : null}
              </>}
            </section>

            <aside className="bg-black/18 p-3">
              <PanelTitle icon={ShieldCheck} label="Channel details" />
              <div className="mt-3 space-y-2">
                {isUpdatesChannel ? <>
                  <SafetyCard icon={ShieldCheck} label="Verified source" value="Entries are released with their matching DZN website change." />
                  <SafetyCard icon={Megaphone} label="Read-only" value="Official updates do not create or imitate player activity." />
                  <SafetyCard icon={MessageCircle} label="Global Chat" value="Player conversation stays in its own moderated channel." />
                </> : <>
                  <SafetyCard icon={ShieldCheck} label="Authenticated" value="Discord login required to send" />
                  <SafetyCard icon={AlertTriangle} label="Moderation" value="English-only filters, reports and owner actions" />
                  <SafetyCard icon={Bot} label="DZN Assist" value="Guided public help is available below." />
                </>}
              </div>
              <details className="mt-4 rounded-md border border-violet-300/18 bg-violet-400/8 p-3">
                <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.16em] text-violet-200">Fair boundary</summary>
                <ul className="mt-3 space-y-2 text-xs font-semibold leading-5 text-zinc-300">
                  {(isUpdatesChannel
                    ? ["Only material DZN releases belong in this channel.", "Update entries are distinct from chat messages and private notifications.", "The feed contains no player, account, payment, or server-private information."]
                    : payload.fairness_boundary.slice(0, 4)).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
            </aside>
          </div>
        </div>
        <DznAssist />
      </section>
    </main>
  );
}

export function recentVisibleSpeakers(messages: readonly CommsHistoryMessage[]) {
  const seen = new Set<string>();
  const newestDistinct = [...messages]
    .reverse()
    .filter((message) => message.visibility_state === "visible")
    .filter((message) => {
      const key = `${message.author_display_name}:${message.author_role_label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);

  // Keep the compact rail chronological after selecting the five latest speakers.
  return newestDistinct.reverse();
}

function MessageRow({ message, reportEnabled, deleteEnabled, reactionsEnabled, reactionsWriteEnabled, customEmojiReactionsEnabled, customEmojiReactionsWriteEnabled, onReactionChanged, onMessageDeleted }: {
  message: CommsHistoryMessage;
  reportEnabled: boolean;
  deleteEnabled: boolean;
  reactionsEnabled: boolean;
  reactionsWriteEnabled: boolean;
  customEmojiReactionsEnabled: boolean;
  customEmojiReactionsWriteEnabled: boolean;
  onReactionChanged: (mutation: CommsReactionMutation) => void;
  onMessageDeleted: (messageId: string) => void;
}) {
  const muted = message.visibility_state !== "visible";
  const canDelete = deleteEnabled && message.can_delete;
  const [reportState, setReportState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [deleteState, setDeleteState] = useState<"idle" | "deleting" | "error">("idle");
  const [reactionInputOpen, setReactionInputOpen] = useState(false);
  const [reactionEmoji, setReactionEmoji] = useState("");
  const [reactionState, setReactionState] = useState<"idle" | "saving" | "error">("idle");

  async function submitReport() {
    if (reportState === "sending" || reportState === "sent") return;
    setReportState("sending");
    try {
      await reportCommsMessage(message.id);
      setReportState("sent");
    } catch {
      setReportState("error");
    }
  }

  async function deleteMessage() {
    if (!canDelete || deleteState === "deleting" || !window.confirm("Delete this message? It will disappear from chat but remain in the 30-day platform-owner safety archive.")) return;
    setDeleteState("deleting");
    try {
      await deleteCommsMessage(message.id);
      onMessageDeleted(message.id);
    } catch {
      setDeleteState("error");
    }
  }

  async function changeReaction(reactionKey: string, reacted: boolean, addReactionKey = reactionKey) {
    if (!reactionsWriteEnabled || reactionState === "saving") return;
    setReactionState("saving");
    try {
      const mutation = reacted
        ? await removeCommsReaction(message.id, reactionKey, crypto.randomUUID())
        : await addCommsReaction(message.id, addReactionKey, crypto.randomUUID());
      setReactionEmoji("");
      setReactionInputOpen(false);
      setReactionState("idle");
      onReactionChanged(mutation);
    } catch {
      setReactionState("error");
    }
  }

  function submitCustomReaction(event: FormEvent) {
    event.preventDefault();
    if (!reactionEmoji.trim()) return;
    void changeReaction(reactionEmoji, false);
  }

  return (
    <article className={`group py-2.5 ${muted ? "bg-amber-300/[0.035]" : ""}`}>
      <div className="flex items-start gap-2.5">
        <MessageAvatar message={message} muted={muted} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-black leading-5 text-white [overflow-wrap:anywhere]">{message.author_display_name}</h3>
            <span className="rounded border border-cyan-300/20 bg-cyan-400/10 px-1.5 py-px text-[9px] font-black uppercase tracking-[0.08em] text-cyan-100">
              {message.author_role_label}
            </span>
            <CommsMessageTime value={message.created_at} />
            {(canDelete || (reportEnabled && !muted)) ? <div className="ml-auto flex items-center gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
              {reportEnabled && !muted ? <button type="button" disabled={reportState === "sending" || reportState === "sent"} onClick={() => void submitReport()} className="inline-grid h-7 w-7 place-items-center rounded-md border border-white/10 text-zinc-400 hover:border-amber-300/40 hover:text-amber-100 disabled:cursor-not-allowed disabled:text-zinc-600" title={reportState === "sent" ? "Message reported" : "Report this message to DZN moderation"} aria-label={reportState === "sending" ? "Reporting message" : reportState === "sent" ? "Message reported" : "Report this message"}><Flag className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
              {canDelete ? <button type="button" disabled={deleteState === "deleting"} onClick={() => void deleteMessage()} className="inline-grid h-7 w-7 place-items-center rounded-md border border-white/10 text-zinc-400 hover:border-red-300/40 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-60" title="Delete your message" aria-label="Delete your message"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
            </div> : null}
          </div>
          <p className={`mt-0.5 text-sm font-semibold leading-5 [overflow-wrap:anywhere] ${muted ? "text-amber-100/82" : "text-zinc-200"}`}>{message.body}</p>
          {reactionsEnabled && !muted ? <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {message.reactions?.counts.map((reaction) => (
              <button
                key={reaction.key}
                type="button"
                disabled={!reactionsWriteEnabled || reactionState === "saving"}
                onClick={() => void changeReaction(
                  reaction.key,
                  reaction.current_user_reacted,
                  reaction.key.startsWith("emoji:") ? reaction.emoji : reaction.key,
                )}
                className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-1.5 text-xs font-bold transition disabled:cursor-default disabled:opacity-75 ${reaction.current_user_reacted ? "border-cyan-200/60 bg-cyan-300/15 text-cyan-50" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-cyan-300/40 hover:bg-cyan-300/10"}`}
                aria-label={`${reaction.current_user_reacted ? "Remove" : "Add"} ${reaction.emoji} reaction`}
                title={reaction.current_user_reacted ? "Remove your reaction" : "Add this reaction"}
              >
                <span aria-hidden="true">{reaction.emoji}</span><span>{reaction.count}</span>
              </button>
            ))}
            {customEmojiReactionsEnabled && customEmojiReactionsWriteEnabled ? <button type="button" onClick={() => setReactionInputOpen((open) => !open)} disabled={reactionState === "saving"} className="inline-grid h-7 w-7 place-items-center rounded-md border border-white/10 bg-white/[0.02] text-zinc-400 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-100 disabled:opacity-60" aria-label="Add an emoji reaction" title="Add an emoji reaction"><Plus className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
            {reactionInputOpen ? <form onSubmit={submitCustomReaction} className="flex items-center gap-1" aria-label="Choose an emoji reaction">
              <input value={reactionEmoji} onChange={(event) => setReactionEmoji([...event.target.value].slice(0, 16).join(""))} className="h-7 w-14 rounded-md border border-cyan-300/30 bg-[#060b14] px-1 text-center text-sm text-white outline-none focus:border-cyan-200" inputMode="text" maxLength={32} aria-label="Emoji" autoFocus />
              <button type="submit" disabled={!reactionEmoji.trim() || reactionState === "saving"} className="h-7 rounded-md border border-cyan-300/30 px-2 text-[10px] font-black uppercase text-cyan-100 disabled:opacity-50">Add</button>
            </form> : null}
          </div> : null}
          {reactionState === "error" ? <p role="alert" className="mt-1 text-xs font-bold text-amber-200">Reaction could not be saved. Try one emoji.</p> : null}
          {deleteState === "error" ? <p role="alert" className="mt-1 text-xs font-bold text-amber-200">Message could not be deleted. Try again.</p> : null}
          {reportState === "sent" ? <p role="status" className="mt-1 text-xs font-bold text-cyan-200">Report received.</p> : null}
          {reportState === "error" ? <p role="alert" className="mt-1 text-xs font-bold text-amber-200">Report failed. Try again.</p> : null}
        </div>
      </div>
    </article>
  );
}

function MessageAvatar({ message, muted }: { message: CommsHistoryMessage; muted: boolean }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const avatarUrl = !muted && failedAvatarUrl !== message.author_avatar_url ? message.author_avatar_url : null;

  return (
    <span className={`grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border text-xs font-black ${muted ? "border-amber-200/25 bg-amber-300/10 text-amber-100" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"}`}>
      {avatarUrl ? <Image src={avatarUrl} alt="" width={32} height={32} unoptimized className="h-full w-full object-cover" onError={() => setFailedAvatarUrl(message.author_avatar_url ?? null)} /> : initials(message.author_display_name)}
    </span>
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

function ChannelButton({ active = false, icon: Icon, label, meta, onSelect }: { active?: boolean; icon: typeof Hash; label: string; meta: string; onSelect?: () => void }) {
  return (
    <button
      type="button"
      disabled={!onSelect || active}
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center justify-between gap-2 border-l-2 px-3 py-3 text-left ${
        active ? "border-cyan-300 bg-cyan-400/12 text-white" : "border-transparent bg-white/[0.025] text-zinc-400"
      } disabled:cursor-default enabled:hover:border-cyan-300/55 enabled:hover:bg-cyan-300/6 enabled:hover:text-white`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-sm font-black uppercase leading-4">{label}</span>
      </span>
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">{meta}</span>
    </button>
  );
}

function SafetyCard({ id, icon: Icon, label, value }: { id?: string; icon: typeof ShieldCheck; label: string; value: string }) {
  return (
    <div id={id} className="scroll-mt-6 border-l-2 border-white/10 px-3 py-2">
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

function statusCopy(status: CommsHistoryState["status"], sendingEnabled: boolean) {
  if (status === "ready") return sendingEnabled ? "Live" : "History";
  if (status === "loading") return "Checking";
  return "Unavailable";
}

function typingCopy(names: readonly string[]) {
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names.slice(0, 2).join(", ")} and others are typing...`;
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "D";
}
