"use client";

import { Bot, ChevronRight, CircleHelp, Crown, RotateCcw, Send, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { DZN_ASSIST_GUIDES, type DznAssistGuide, type DznAssistLink } from "@/lib/dzn-assist";
import {
  DZN_ASSIST_LOCAL_HISTORY_STORAGE_KEY,
  parseDznAssistLocalHistory,
  selectCompletedDznAssistLocalHistoryTurns,
  serializeDznAssistLocalHistory,
} from "@/lib/dzn-assist-local-history";
import {
  answerDznAssist,
  hasSensitiveDznAssistInput,
  parseDznAssistRankings,
  restoreDznAssistReply,
  type DznAssistRankingRow,
  type DznAssistReplyKind,
  type DznAssistWorkflow,
} from "@/lib/dzn-assist-runtime";
import { DZN_PUBLIC_DISCORD_INVITE_URL } from "@/lib/public-discord";
import { DZN_SUPPORT_EMAIL, DZN_SUPPORT_EMAIL_HREF } from "@/lib/support";

type AssistMessage = {
  id: string;
  role: "assist" | "visitor";
  text: string;
  links?: DznAssistLink[];
  workflows?: DznAssistWorkflow[];
  suggestedPrompts?: string[];
  guideIds?: string[];
  replyKind?: DznAssistReplyKind;
  excludeFromLocalHistory?: boolean;
  players?: DznAssistRankingRow[];
  servers?: DznAssistRankingRow[];
  updatedAt?: string | null;
};

const ownerDiscordAccessUiEnabled = process.env.NEXT_PUBLIC_DZN_OWNER_DISCORD_ACCESS_UI_ENABLED === "true";
const initialMessage: AssistMessage = {
  id: "dzn-assist-intro",
  role: "assist",
  text: "I am DZN Assist, your public DZN support guide. Tell me what you are trying to do and I will give you the clearest next step without exposing private account, player, payment, moderation, Discord, or server information.",
  suggestedPrompts: ["I want to join DZN", "Help me find a server", "How do I add my server?", "How do I link my DayZ stats?", "Show the top players"],
};
const topicPrompts = [
  { label: "Getting started", prompt: "I want to join DZN" },
  { label: "Find a server", prompt: "Help me find a server" },
  { label: "Add a server", prompt: "How do I add my server?" },
  { label: "Player stats", prompt: "How do I link my DayZ stats?" },
  { label: "Plans and billing", prompt: "Compare DZN plans" },
  { label: "Live standings", prompt: "Show the top players and servers" },
];

export function DznAssist() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AssistMessage[]>([initialMessage]);
  const [localHistoryReady, setLocalHistoryReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [loadingRankings, setLoadingRankings] = useState(false);
  const requestRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const visibleGuides = useMemo(
    () => DZN_ASSIST_GUIDES.filter((guide) => guide.id !== "server-owner-discord-access" || ownerDiscordAccessUiEnabled),
    [],
  );
  const busy = thinking || loadingRankings;
  const interactionLocked = busy || !localHistoryReady;

  useEffect(() => {
    let cancelled = false;
    const restoreTimer = window.setTimeout(() => {
      let restored = [] as ReturnType<typeof parseDznAssistLocalHistory>;
      try {
        const saved = window.localStorage.getItem(DZN_ASSIST_LOCAL_HISTORY_STORAGE_KEY);
        if (saved) restored = restoreSavedAssistMessages(parseDznAssistLocalHistory(JSON.parse(saved)), visibleGuides);
      } catch {
        // A blocked or malformed browser store must not prevent public support guidance.
      }
      if (cancelled) return;
      if (restored.length > 0) {
        setMessages((current) => current.length === 1 && current[0]?.id === initialMessage.id
          ? [initialMessage, ...restored]
          : current);
      }
      setLocalHistoryReady(true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(restoreTimer);
    };
  }, [visibleGuides]);

  useEffect(() => {
    if (!localHistoryReady) return;
    try {
      const saved = serializeDznAssistLocalHistory(selectCompletedDznAssistLocalHistoryTurns(messages.slice(1)));
      if (saved) window.localStorage.setItem(DZN_ASSIST_LOCAL_HISTORY_STORAGE_KEY, saved);
      else window.localStorage.removeItem(DZN_ASSIST_LOCAL_HISTORY_STORAGE_KEY);
    } catch {
      // Local browser storage is optional; no transcript is sent elsewhere as a fallback.
    }
  }, [localHistoryReady, messages]);

  useEffect(() => {
    let cancelled = false;
    const scrollToAssist = () => {
      if (!cancelled && window.location.hash === "#dzn-assist") {
        document.getElementById("dzn-assist")?.scrollIntoView({ block: "start" });
      }
    };
    const onHashChange = () => window.requestAnimationFrame(scrollToAssist);
    const onAssistLinkClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (link?.hash === "#dzn-assist" && link.pathname === window.location.pathname) onHashChange();
    };
    scrollToAssist();
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("click", onAssistLinkClick);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("click", onAssistLinkClick);
    };
  }, []);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: "auto" });
  }, [loadingRankings, messages, thinking]);

  async function sendQuestion(question: string) {
    const text = question.trim().slice(0, 360);
    if (!text || interactionLocked) return;
    const requestId = ++requestRef.current;
    const previousGuideIds = [...messages].reverse().find((message) => message.role === "assist" && message.guideIds?.length)?.guideIds;
    const reply = answerDznAssist(text, { guides: visibleGuides, previousGuideIds });
    const excludeFromLocalHistory = reply.kind === "boundary" || hasSensitiveDznAssistInput(text);
    setMessages((current) => [...current, { id: `visitor-${requestId}`, role: "visitor", text, excludeFromLocalHistory }]);
    setDraft("");
    setThinking(true);

    await new Promise((resolve) => window.setTimeout(resolve, 260));
    if (requestId !== requestRef.current) return;
    setMessages((current) => [...current, {
      id: `assist-${requestId}`,
      role: "assist",
      text: reply.message,
      links: reply.links,
      workflows: reply.workflows,
      suggestedPrompts: reply.suggestedPrompts,
      guideIds: reply.guideIds,
      replyKind: reply.kind,
      excludeFromLocalHistory,
    }]);
    setThinking(false);

    if (!reply.wantsRankings) return;
    setLoadingRankings(true);
    try {
      const response = await fetch("/api/public/leaderboards", {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const rankings = response.ok ? parseDznAssistRankings(await response.json()) : null;
      if (!rankings || rankings.unavailable) throw new Error("Public standings are unavailable.");
      if (requestId !== requestRef.current) return;
      const players = reply.showPlayers ? rankings.players : [];
      const servers = reply.showServers ? rankings.servers : [];
      const playersLocked = reply.showPlayers && rankings.playersLocked;
      const hasRows = players.length > 0 || servers.length > 0;
      setMessages((current) => [...current, {
        id: `assist-rankings-${requestId}`,
        role: "assist",
        text: playersLocked
          ? hasRows
            ? "Player standings require Discord sign-in. Here are the public server standings available right now."
            : "Player standings require Discord sign-in. Sign in to view the current player leaderboard."
          : hasRows
            ? rankings.stale
              ? "Live standings are refreshing. Here are the last known public standings from DZN."
              : "Here are the latest public standings available from DZN right now."
            : "No public standings are available right now. You can check the full public leaderboard again shortly.",
        links: [
          { href: "/leaderboards", label: "Open full leaderboards" },
          ...(playersLocked ? [{ href: "/login?returnTo=%2Fleaderboards", label: "Sign in to view players" }] : []),
        ],
        suggestedPrompts: ["How do I link my DayZ stats?", "How do I add my server?"],
        players,
        servers,
        updatedAt: rankings.updatedAt,
      }]);
    } catch {
      if (requestId === requestRef.current) {
        setMessages((current) => [...current, {
          id: `assist-rankings-unavailable-${requestId}`,
          role: "assist",
          text: "I could not load the public leaderboard right now. No saved or guessed standings are shown.",
          links: [{ href: "/leaderboards", label: "Open full leaderboards" }],
          suggestedPrompts: ["How do I link my DayZ stats?", "How do I add my server?"],
        }]);
      }
    } finally {
      if (requestId === requestRef.current) setLoadingRankings(false);
    }
  }

  function clearConversation() {
    if (!localHistoryReady) return;
    requestRef.current += 1;
    setDraft("");
    setThinking(false);
    setLoadingRankings(false);
    setMessages([initialMessage]);
    try {
      window.localStorage.removeItem(DZN_ASSIST_LOCAL_HISTORY_STORAGE_KEY);
    } catch {
      // The state reset remains useful even where browser storage is blocked.
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendQuestion(draft);
  }

  return (
    <section id="dzn-assist" aria-labelledby="dzn-assist-title" className="scroll-mt-6 overflow-hidden border border-violet-300/25 bg-[#060715] shadow-[0_22px_70px_rgba(0,0,0,0.35)]">
      <header className="flex flex-col gap-3 border-b border-white/10 bg-[linear-gradient(90deg,rgba(124,58,237,0.16),rgba(6,7,21,0.12)_52%,transparent)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center border border-violet-300/30 bg-violet-300/10 text-violet-100"><Bot className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">DZN Assist</p>
            <h2 id="dzn-assist-title" className="mt-1 text-lg font-black uppercase text-white sm:text-xl">Support conversation</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-black uppercase text-emerald-100"><span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden="true" /> Public guide online</span>
          <button type="button" onClick={clearConversation} disabled={!localHistoryReady} className="grid h-9 w-9 place-items-center border border-white/12 text-zinc-300 transition hover:border-violet-300/40 hover:bg-violet-300/10 hover:text-white disabled:cursor-wait disabled:opacity-60" aria-label="Clear DZN Assist conversation" title="Clear conversation"><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </header>

      <div className="grid min-w-0 xl:grid-cols-[12.5rem_minmax(0,1fr)_14rem]">
        <aside className="border-b border-white/10 bg-black/15 p-3 xl:border-b-0 xl:border-r">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Start here</p>
          <div className="mt-3 grid gap-1">
            {topicPrompts.map((topic) => <button key={topic.label} type="button" onClick={() => void sendQuestion(topic.prompt)} disabled={interactionLocked} className="group flex min-h-10 items-center justify-between border-l-2 border-transparent px-3 text-left text-xs font-bold text-zinc-300 transition hover:border-violet-300 hover:bg-violet-300/8 hover:text-white disabled:cursor-wait disabled:opacity-60"><span>{topic.label}</span><ChevronRight className="h-3.5 w-3.5 text-zinc-600 transition group-hover:text-violet-200" aria-hidden="true" /></button>)}
          </div>
          <div className="mt-4 border-t border-white/8 pt-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Conversation scope</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-zinc-400">Guidance and public standings only. Private account and payment details stay out of this chat.</p>
          </div>
        </aside>

        <div className="min-w-0 bg-[linear-gradient(180deg,rgba(17,17,34,0.56),transparent_8rem)]">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2"><Sparkles className="h-4 w-4 shrink-0 text-violet-200" aria-hidden="true" /><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.16em] text-white">DZN support desk</p><p className="mt-0.5 truncate text-[11px] font-semibold text-zinc-500">Ask naturally. I will guide you through the next public step.</p></div></div>
            <span className="hidden shrink-0 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500 sm:block">Saved on this device</span>
          </div>

          <div ref={transcriptRef} role="log" aria-live="polite" aria-relevant="additions text" className="h-[min(30rem,48svh)] min-h-72 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-gutter:stable] sm:px-5">
            {messages.map((message) => <AssistMessageRow key={message.id} message={message} onPrompt={(prompt) => void sendQuestion(prompt)} disabled={interactionLocked} />)}
            {thinking ? <div className="flex items-center gap-3 text-xs font-bold text-violet-100"><span className="grid h-8 w-8 place-items-center border border-violet-300/25 bg-violet-300/10"><Bot className="h-4 w-4" aria-hidden="true" /></span><span className="inline-flex items-center gap-1" aria-label="DZN Assist is preparing a reply"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-200 [animation-delay:-0.2s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-200 [animation-delay:-0.1s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-200" /></span></div> : null}
            {loadingRankings ? <div className="flex items-center gap-2 text-xs font-bold text-violet-100"><span className="h-2 w-2 animate-pulse rounded-full bg-violet-300" aria-hidden="true" />Checking the current public standings…</div> : null}
          </div>

          <form onSubmit={onSubmit} className="border-t border-white/10 bg-black/20 p-3 sm:p-4" aria-label="Ask DZN Assist">
            <div className="flex items-center gap-2 border border-white/12 bg-[#090a16] p-2 focus-within:border-violet-300/50">
              <CircleHelp className="ml-1 h-5 w-5 shrink-0 text-violet-200" aria-hidden="true" />
              <input aria-label="Ask DZN Assist a question" value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 360))} disabled={interactionLocked} placeholder="Ask about DZN, a server, player stats, or public standings…" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-semibold text-white placeholder:text-zinc-500 focus:outline-none disabled:opacity-60" />
              <button type="submit" disabled={!draft.trim() || interactionLocked} className="grid h-10 w-10 shrink-0 place-items-center border border-violet-300/30 bg-violet-300/12 text-violet-100 transition enabled:hover:border-violet-200 enabled:hover:bg-violet-300/20 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send question to DZN Assist"><Send className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            <p className="mt-2 text-[11px] font-semibold leading-5 text-zinc-500">Questions stay in this browser. This conversation is saved only on this device, and DZN Assist uses verified public guidance and only requests the public leaderboard when you ask for it.</p>
          </form>
        </div>

        <aside className="border-t border-white/10 bg-black/15 p-3 xl:border-t-0 xl:border-l">
          <div className="flex items-center gap-2 text-sm font-black uppercase text-white"><ShieldCheck className="h-4 w-4 text-cyan-200" aria-hidden="true" /> Private help</div>
          <p className="mt-2 text-xs font-semibold leading-5 text-zinc-400">For a signed-in account, a payment, or sensitive server help, use a private route. Never send credentials in chat.</p>
          <div className="mt-3 grid gap-2">
            <a href={DZN_SUPPORT_EMAIL_HREF} className="flex min-h-10 items-center justify-between border-l-2 border-cyan-300/45 bg-cyan-300/5 px-3 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/10">Email support <span className="sr-only">at {DZN_SUPPORT_EMAIL}</span><ChevronRight className="h-4 w-4" aria-hidden="true" /></a>
            <a href={DZN_PUBLIC_DISCORD_INVITE_URL} className="flex min-h-10 items-center justify-between border-l-2 border-violet-300/45 bg-violet-300/5 px-3 text-xs font-black text-violet-100 transition hover:bg-violet-300/10">DZN Discord <ChevronRight className="h-4 w-4" aria-hidden="true" /></a>
            {ownerDiscordAccessUiEnabled ? <Link href="/login?returnTo=%2Fdiscord-owner-access" className="flex min-h-10 items-center justify-between border-l-2 border-amber-300/45 bg-amber-300/5 px-3 text-xs font-black text-amber-100 transition hover:bg-amber-300/10">Owner access <ChevronRight className="h-4 w-4" aria-hidden="true" /></Link> : null}
          </div>
        </aside>
      </div>
    </section>
  );
}

function AssistMessageRow({ message, onPrompt, disabled }: { message: AssistMessage; onPrompt: (prompt: string) => void; disabled: boolean }) {
  const isAssist = message.role === "assist";
  return (
    <article className={isAssist ? "flex gap-3" : "flex justify-end"}>
      {isAssist ? <span className="grid h-8 w-8 shrink-0 place-items-center border border-violet-300/30 bg-violet-300/10 text-violet-100"><Bot className="h-4 w-4" aria-hidden="true" /></span> : null}
      <div className={isAssist ? "min-w-0 max-w-[48rem]" : "max-w-[44rem] border border-cyan-300/20 bg-cyan-300/8 px-3 py-2"}>
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{isAssist ? "DZN Assist" : "You"}</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-zinc-200">{message.text}</p>
        {message.workflows?.map((workflow) => <WorkflowRoute key={workflow.id} workflow={workflow} />)}
        {message.players?.length ? <RankingList icon={Trophy} label="Top players" rows={message.players} /> : null}
        {message.servers?.length ? <RankingList icon={Crown} label="Top servers" rows={message.servers} /> : null}
        {message.updatedAt ? <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">Public board refreshed {new Date(message.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
        {!message.workflows?.length && message.links?.length ? <ActionLinks links={message.links} /> : null}
        {isAssist && message.suggestedPrompts?.length ? <div className="mt-3 flex flex-wrap gap-2">{message.suggestedPrompts.map((prompt) => <button key={`${message.id}:${prompt}`} type="button" onClick={() => onPrompt(prompt)} disabled={disabled} className="border border-white/12 bg-white/[0.035] px-2.5 py-1.5 text-left text-[11px] font-bold text-zinc-300 transition hover:border-violet-300/35 hover:bg-violet-300/10 hover:text-white disabled:cursor-wait disabled:opacity-60">{prompt}</button>)}</div> : null}
      </div>
    </article>
  );
}

function restoreSavedAssistMessages(saved: ReturnType<typeof parseDznAssistLocalHistory>, guides: readonly DznAssistGuide[]): AssistMessage[] {
  return saved.map((message) => {
    if (message.role === "visitor") return message;
    const reply = restoreDznAssistReply(message.replyKind ?? "fallback", message.guideIds, { guides });
    return {
      ...message,
      text: reply.message,
      links: reply.links,
      workflows: reply.workflows,
      suggestedPrompts: reply.suggestedPrompts,
      guideIds: reply.guideIds,
      replyKind: reply.kind,
    };
  });
}

function WorkflowRoute({ workflow }: { workflow: DznAssistWorkflow }) {
  return <section className="mt-4 border-l-2 border-violet-300/60 bg-violet-300/[0.045] py-3 pl-3 pr-2" aria-label={workflow.title}>
    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-200">{workflow.category}</p>
    <h3 className="mt-1 text-sm font-black text-white">{workflow.title}</h3>
    <p className="mt-1 text-sm font-semibold leading-6 text-zinc-300">{workflow.summary}</p>
    <ol className="mt-3 space-y-2">{workflow.steps.map((step, index) => <li key={step} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 text-xs font-semibold leading-5 text-zinc-400"><span className="text-violet-200">{index + 1}</span><span>{step}</span></li>)}</ol>
    <ActionLinks links={workflow.links} />
  </section>;
}

function ActionLinks({ links }: { links: DznAssistLink[] }) {
  return <div className="mt-3 flex flex-wrap gap-2">{links.map((link) => <Link key={link.href} href={link.href} className="inline-flex min-h-8 items-center gap-1 border border-violet-300/25 bg-violet-300/8 px-2.5 text-xs font-black text-violet-100 transition hover:border-violet-200 hover:text-white">{link.label}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>)}</div>;
}

function RankingList({ icon: Icon, label, rows }: { icon: typeof Trophy; label: string; rows: DznAssistRankingRow[] }) {
  return <section className="mt-3 overflow-hidden border border-white/10 bg-black/20" aria-label={label}>
    <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-300"><Icon className="h-3.5 w-3.5 text-amber-200" aria-hidden="true" />{label}</div>
    <ol>{rows.map((row) => <li key={`${label}:${row.rank}:${row.name}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 border-b border-white/6 px-3 py-2 last:border-b-0"><span className="text-xs font-black text-violet-200">{String(row.rank).padStart(2, "0")}</span><span className="min-w-0"><strong className="block truncate text-xs text-white">{row.name}</strong>{row.detail ? <small className="block truncate text-[11px] font-semibold text-zinc-500">{row.detail}</small> : null}</span></li>)}</ol>
  </section>;
}
