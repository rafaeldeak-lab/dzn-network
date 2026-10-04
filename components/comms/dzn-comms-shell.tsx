"use client";

import {
  AlertTriangle,
  Bot,
  ChevronRight,
  Flag,
  Hash,
  LockKeyhole,
  MessageCircle,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { DznAssist } from "./dzn-assist";
import { CommsMessageTime } from "./comms-message-time";
import {
  addCommsReaction,
  loadCommsHistory,
  removeCommsReaction,
  reportCommsMessage,
  sendCommsMessage,
  type CommsHistoryMessage,
  type CommsHistoryPayload,
  type CommsReactionKey,
} from "./comms-history-client";

type CommsHistoryState =
  | { status: "static"; payload: CommsHistoryPayload; message: string }
  | { status: "loading"; payload: CommsHistoryPayload; message: string }
  | { status: "ready"; payload: CommsHistoryPayload; message: string }
  | { status: "fallback"; payload: CommsHistoryPayload; message: string };

const historyUiEnabled = process.env.NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED === "true";
const liveUiEnabled = process.env.NEXT_PUBLIC_DZN_COMMS_LIVE_UI_ENABLED === "true";
const reactionUiFlagEnabled = process.env.NEXT_PUBLIC_DZN_COMMS_REACTIONS_UI_ENABLED === "true";
const privateGroupsUiEnabled = process.env.NEXT_PUBLIC_DZN_COMMS_PRIVATE_GROUPS_UI_ENABLED === "true";

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
  available_channels: [{
    slug: "global-chat",
    kind: "public",
    name: "Global Chat",
    description: "Public DZN community chat.",
    visibility: "public",
    current_user_member_role: null,
  }],
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
  page: { next_cursor: null, has_more: false, limit: 30 },
  feature_flags: {
    route_enabled: false,
    sending_enabled: false,
    private_groups_enabled: false,
    reactions_enabled: false,
    reactions_write_enabled: false,
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
  const [selectedChannel, setSelectedChannel] = useState("global-chat");
  const selectedChannelRef = useRef("global-chat");
  const historyRequestGenerationRef = useRef(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [composerMessage, setComposerMessage] = useState("");
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "signed-out">("checking");
  const sendAttemptRef = useRef<{ channelSlug: string; draft: string; requestId: string } | null>(null);
  const reactionAttemptRef = useRef(new Map<string, string>());
  const [history, setHistory] = useState<CommsHistoryState>(() => ({
    status: historyUiEnabled || liveUiEnabled ? "loading" : "static",
    payload: staticPayload,
    message: historyUiEnabled || liveUiEnabled
      ? "Connecting to DZN Global Chat."
      : "Static fallback is active. Message history is disabled by default.",
  }));

  useEffect(() => {
    if (!historyUiEnabled && !liveUiEnabled) return;

    const controller = new AbortController();
    const refresh = () => {
      const requestGeneration = ++historyRequestGenerationRef.current;
      return loadCommsHistory(controller.signal, { channelSlug: selectedChannel })
      .then((payload) => {
        if (
          controller.signal.aborted
          || historyRequestGenerationRef.current !== requestGeneration
          || selectedChannelRef.current !== selectedChannel
          || payload.channel.slug !== selectedChannel
        ) return;
        setHistory({
          status: "ready",
          payload,
          message: liveUiEnabled && payload.feature_flags.sending_enabled ? `${payload.channel.name} is live. Keep it respectful and report abuse.` : "Message history is available. Sending is not enabled yet.",
        });
      })
      .catch(() => {
        if (
          controller.signal.aborted
          || historyRequestGenerationRef.current !== requestGeneration
          || selectedChannelRef.current !== selectedChannel
        ) return;
        if (selectedChannel !== "global-chat") {
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
              message: "Message history could not be reached, so DZN is showing the static read-only fallback.",
            });
      });
    };
    void refresh();
    const poller = window.setInterval(() => void refresh(), 5_000);

    return () => {
      controller.abort();
      window.clearInterval(poller);
    };
  }, [selectedChannel]);

  const payload = history.payload;
  const statusLabel = useMemo(() => statusCopy(history.status), [history.status]);
  const sendingEnabled = liveUiEnabled && payload.feature_flags.sending_enabled;
  const reportActionsEnabled = liveUiEnabled && payload.feature_flags.report_actions_enabled;
  const reactionUiEnabled = liveUiEnabled && reactionUiFlagEnabled && payload.feature_flags.reactions_enabled;
  const reactionWritesAvailable = reactionUiEnabled && payload.feature_flags.reactions_write_enabled;

  useEffect(() => {
    if (!reactionWritesAvailable) return;

    const controller = new AbortController();
    fetch("/api/auth/me", { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return false;
        const payload = await response.json().catch(() => null) as { authenticated?: unknown } | null;
        return payload?.authenticated === true;
      })
      .then((authenticated) => {
        if (!controller.signal.aborted) setAuthStatus(authenticated ? "authenticated" : "signed-out");
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuthStatus("signed-out");
      });
    return () => controller.abort();
  }, [reactionWritesAvailable]);

  const reactionWritesEnabled = reactionWritesAvailable && authStatus === "authenticated";
  const reactionLoginRequired = reactionWritesAvailable && authStatus === "signed-out";
  const canSend = sendingEnabled && draft.trim().length > 0 && !sending;
  const selectedChannelAccessLabel = sendingEnabled
    ? "Live now"
    : history.status === "ready"
      ? "Read-only history"
      : history.status === "loading"
        ? "Checking access"
        : "Preview only";

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

  async function handleReaction(messageId: string, reactionKey: CommsReactionKey, remove: boolean) {
    if (!reactionWritesEnabled) throw new Error("Reactions are not enabled yet.");
    const targetChannel = payload.channel.slug;
    if (selectedChannelRef.current !== targetChannel) throw new Error("The selected channel changed. Retry the reaction.");
    const addAttemptKey = `${messageId}:${reactionKey}:add`;
    const removeAttemptKey = `${messageId}:${reactionKey}:remove`;
    const attemptKey = remove ? removeAttemptKey : addAttemptKey;
    const mutationId = reactionAttemptRef.current.get(attemptKey) ?? crypto.randomUUID();
    reactionAttemptRef.current.set(attemptKey, mutationId);
    try {
      if (remove) await removeCommsReaction(messageId, reactionKey, mutationId);
      else await addCommsReaction(messageId, reactionKey, mutationId);
      reactionAttemptRef.current.delete(addAttemptKey);
      reactionAttemptRef.current.delete(removeAttemptKey);
    } catch (error) {
      throw error;
    }
    const requestGeneration = ++historyRequestGenerationRef.current;
    try {
      const refreshed = await loadCommsHistory(new AbortController().signal, { channelSlug: targetChannel });
      if (
        historyRequestGenerationRef.current === requestGeneration
        && selectedChannelRef.current === targetChannel
        && refreshed.channel.slug === targetChannel
      ) {
        setHistory({ status: "ready", payload: refreshed, message: "Reaction saved." });
      }
    } catch {
      if (historyRequestGenerationRef.current === requestGeneration && selectedChannelRef.current === targetChannel) {
        setHistory((current) => ({ ...current, message: "Reaction saved. Counts will refresh shortly." }));
      }
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#03050d] pb-24 pt-4 text-zinc-100 sm:pt-6">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 sm:px-6 lg:px-8">
        <nav aria-label="DZN communication tools" className="grid gap-2 rounded-lg border border-white/10 bg-[#060a15]/95 p-2 sm:grid-cols-2">
          <a href="#global-chat" className="group flex min-h-14 items-center gap-3 rounded-md border border-cyan-300/35 bg-cyan-300/10 px-3 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-cyan-300/30 bg-cyan-300/10 text-cyan-100"><MessageCircle className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-black uppercase text-white">DZN Comms</span><span className="block text-xs font-bold text-emerald-200">{selectedChannelAccessLabel}</span></span>
            <ChevronRight className="h-4 w-4 text-cyan-200 transition group-hover:translate-x-0.5" aria-hidden="true" />
          </a>
          <a href="#dzn-assist" className="group flex min-h-14 items-center gap-3 rounded-md border border-violet-300/20 bg-violet-300/6 px-3 py-2 transition hover:border-violet-200/45">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-violet-300/20 bg-violet-300/8 text-violet-100"><Bot className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-black uppercase text-white">DZN Assist</span><span className="block text-xs font-bold text-emerald-200">Guided help live</span></span>
            <ChevronRight className="h-4 w-4 text-violet-200 transition group-hover:translate-x-0.5" aria-hidden="true" />
          </a>
        </nav>

        <div id="global-chat" className="scroll-mt-6 overflow-hidden rounded-lg border border-cyan-400/20 bg-[radial-gradient(circle_at_18%_10%,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_88%_0%,rgba(168,85,247,0.16),transparent_30%),rgba(5,9,22,0.88)] shadow-[0_26px_80px_rgba(0,0,0,0.42)]">
          <div className="flex flex-col gap-5 border-b border-white/10 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-cyan-300/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_28px_rgba(34,211,238,0.22)]">
                <MessageCircle className="h-7 w-7" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-200">DZN Comms</p>
                <h1 className="mt-1 text-3xl font-black uppercase leading-none text-white sm:text-4xl">{payload.channel.name}</h1>
                <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-zinc-300">
                  {payload.channel.description ?? "Discord-authenticated members can talk in this moderated DZN channel."}
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:w-[330px]">
              <StatusPill label="History" value={statusLabel} tone={history.status === "ready" ? "cyan" : "violet"} />
              <StatusPill label="Runtime" value={sendingEnabled ? "Live" : "Read Only"} tone={sendingEnabled ? "cyan" : "gold"} />
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[250px_minmax(0,1fr)_300px]">
            <aside className="border-b border-white/10 bg-black/18 p-4 lg:border-b-0 lg:border-r">
              <PanelTitle icon={Hash} label="Channels" />
              <div className="mt-4 space-y-2">
                {payload.available_channels
                  .filter((channel) => channel.kind === "public" || privateGroupsUiEnabled)
                  .map((channel) => (
                    <ChannelButton
                      key={channel.slug}
                      active={channel.slug === payload.channel.slug}
                      icon={channel.kind === "private_group" ? LockKeyhole : Hash}
                      label={channel.name}
                      meta={channel.kind === "private_group" ? channel.current_user_member_role ?? "Member" : sendingEnabled ? "Live" : "Read-only"}
                      onSelect={() => {
                        if (channel.slug === selectedChannelRef.current) return;
                        historyRequestGenerationRef.current += 1;
                        setDraft("");
                        setComposerMessage("");
                        selectedChannelRef.current = channel.slug;
                        setHistory({ status: "loading", payload: staticPayload, message: "Opening the selected DZN Comms channel." });
                        setSelectedChannel(channel.slug);
                      }}
                    />
                  ))}
                <ChannelButton icon={Hash} label="New Players" meta="Future" />
                <ChannelButton icon={Hash} label="Server Owners" meta="Future" />
                {!privateGroupsUiEnabled || !payload.feature_flags.private_groups_enabled
                  ? <ChannelButton icon={LockKeyhole} label="Private Groups" meta="Unavailable" />
                  : null}
              </div>
              <div className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/8 p-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-200">Community Safety</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-zinc-300">
                  Do not post invites, secrets, threats or personal information. Report abuse instead of replying to it.
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

              <div role="status" aria-live="polite" className="mt-4 rounded-lg border border-cyan-300/18 bg-cyan-300/8 px-4 py-3">
                <p className="text-sm font-bold leading-6 text-cyan-50">{history.message}</p>
              </div>

              <div className="mt-4 space-y-3">
                {payload.messages.map((message) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    reportEnabled={reportActionsEnabled}
                    reactionUiEnabled={reactionUiEnabled}
                    reactionWriteEnabled={reactionWritesEnabled}
                    reactionLoginRequired={reactionLoginRequired}
                    onReactionChange={handleReaction}
                  />
                ))}
              </div>

              <form onSubmit={handleSend} className="mt-5 flex items-center gap-2 rounded-lg border border-white/10 bg-black/28 p-2" aria-label="DZN Comms message composer">
                <button
                  type="button"
                  disabled
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 text-zinc-500"
                  aria-label="Attachments are unavailable"
                >
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                </button>
                <input
                  disabled={!sendingEnabled || sending}
                  value={draft}
                  onChange={(event) => setDraft([...event.target.value].slice(0, 2_000).join(""))}
                  placeholder={sendingEnabled ? `Message ${payload.channel.name}` : "Sending unavailable"}
                  className="min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold text-zinc-300 placeholder:text-zinc-500 focus:outline-none"
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
            </section>

            <aside className="bg-black/18 p-4">
              <PanelTitle icon={ShieldCheck} label="Safety Contract" />
              <div className="mt-4 space-y-3">
                <SafetyCard icon={ShieldCheck} label="Authenticated" value="Discord login required to send" />
                <SafetyCard icon={AlertTriangle} label="Moderation" value="Filters, reports and owner actions" />
                <SafetyCard icon={Bot} label="DZN Assist" value="Guided public help is available below." />
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
        <DznAssist />
      </section>
    </main>
  );
}

function MessageRow({ message, reportEnabled, reactionUiEnabled, reactionWriteEnabled, reactionLoginRequired, onReactionChange }: {
  message: CommsHistoryMessage;
  reportEnabled: boolean;
  reactionUiEnabled: boolean;
  reactionWriteEnabled: boolean;
  reactionLoginRequired: boolean;
  onReactionChange: (messageId: string, reactionKey: CommsReactionKey, remove: boolean) => Promise<void>;
}) {
  const muted = message.visibility_state !== "visible";
  const [reportState, setReportState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [reactionState, setReactionState] = useState<{ key: CommsReactionKey | null; status: "idle" | "sending" | "saved" | "error" }>({ key: null, status: "idle" });

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

  async function toggleReaction(key: CommsReactionKey, reacted: boolean) {
    if (!reactionWriteEnabled || reactionState.status === "sending") return;
    setReactionState({ key, status: "sending" });
    try {
      await onReactionChange(message.id, key, reacted);
      setReactionState({ key, status: "saved" });
    } catch {
      setReactionState({ key, status: "error" });
    }
  }

  return (
    <article className={`rounded-lg border p-4 ${muted ? "border-amber-300/18 bg-amber-300/6" : "border-white/10 bg-black/22"}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border text-sm font-black ${muted ? "border-amber-200/25 bg-amber-300/10 text-amber-100" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"}`}>
          {initials(message.author_display_name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-white [overflow-wrap:anywhere]">{message.author_display_name}</h3>
            <span className="rounded border border-cyan-300/20 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-cyan-100">
              {message.author_role_label}
            </span>
            <CommsMessageTime value={message.created_at} />
          </div>
          <p className={`mt-2 text-sm font-semibold leading-6 [overflow-wrap:anywhere] ${muted ? "text-amber-100/82" : "text-zinc-200"}`}>{message.body}</p>
          {reactionUiEnabled && message.reactions && !muted ? (
            <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Message reactions">
              {message.reactions.available_reactions.map((reaction) => {
                const count = message.reactions?.counts.find((item) => item.key === reaction.key);
                const reacted = count?.current_user_reacted === true;
                if (!reactionWriteEnabled && !count) return null;
                const pending = reactionState.status === "sending" && reactionState.key === reaction.key;
                return (
                  <button
                    key={reaction.key}
                    type="button"
                    disabled={!reactionWriteEnabled || reactionState.status === "sending"}
                    aria-label={`${reacted ? "Remove" : "Add"} ${reaction.label} reaction`}
                    aria-pressed={reacted}
                    title={reactionWriteEnabled ? reaction.label : `${reaction.label} reactions`}
                    onClick={() => void toggleReaction(reaction.key, reacted)}
                    className={`inline-flex h-8 min-w-10 items-center justify-center gap-1 rounded-md border px-2 text-xs font-black transition-colors ${
                      reacted ? "border-violet-300/55 bg-violet-400/18 text-violet-100" : "border-white/10 bg-white/5 text-zinc-300"
                    } disabled:cursor-default disabled:opacity-75`}
                  >
                    <span aria-hidden="true">{reaction.emoji}</span>
                    <span>{pending ? "..." : count?.count ?? 0}</span>
                  </button>
                );
              })}
              {reactionLoginRequired ? (
                <a href="/login?returnTo=%2Fcommunity" className="text-xs font-black text-cyan-200 hover:text-white">
                  Log in to react
                </a>
              ) : null}
              {reactionState.status === "error" ? <span role="alert" className="text-xs font-bold text-amber-200">Reaction failed. Try again.</span> : null}
            </div>
          ) : null}
          {reportEnabled && !muted ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" disabled={reportState === "sending" || reportState === "sent"} onClick={() => void submitReport()} className="inline-flex items-center gap-1 text-xs font-bold text-zinc-400 hover:text-amber-200 disabled:cursor-not-allowed disabled:text-zinc-600" title="Report this message to DZN moderation">
                <Flag className="h-3.5 w-3.5" aria-hidden="true" /> {reportState === "sending" ? "Sending" : reportState === "sent" ? "Reported" : "Report"}
              </button>
              {reportState === "sent" ? <span role="status" className="text-xs font-bold text-cyan-200">Report received.</span> : null}
              {reportState === "error" ? <span role="alert" className="text-xs font-bold text-amber-200">Report failed. Try again.</span> : null}
            </div>
          ) : null}
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

function ChannelButton({ active = false, icon: Icon, label, meta, onSelect }: { active?: boolean; icon: typeof Hash; label: string; meta: string; onSelect?: () => void }) {
  return (
    <button
      type="button"
      disabled={!onSelect || active}
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left ${
        active ? "border-cyan-300/40 bg-cyan-400/12 text-white" : "border-white/8 bg-white/4 text-zinc-400"
      } disabled:cursor-default enabled:hover:border-cyan-300/30 enabled:hover:text-white`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate text-sm font-black uppercase">{label}</span>
      </span>
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">{meta}</span>
    </button>
  );
}

function SafetyCard({ id, icon: Icon, label, value }: { id?: string; icon: typeof ShieldCheck; label: string; value: string }) {
  return (
    <div id={id} className="scroll-mt-6 rounded-lg border border-white/10 bg-white/5 p-3">
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
  if (status === "ready") return liveUiEnabled ? "Live" : "History";
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
