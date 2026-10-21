"use client";

import { Bot, ChevronRight, CircleHelp, Crown, Send, ShieldCheck, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { DZN_ASSIST_GUIDES, type DznAssistLink } from "@/lib/dzn-assist";
import {
  answerDznAssist,
  parseDznAssistRankings,
  type DznAssistRankingRow,
} from "@/lib/dzn-assist-runtime";
import { DZN_PUBLIC_DISCORD_INVITE_URL } from "@/lib/public-discord";
import { DZN_SUPPORT_EMAIL, DZN_SUPPORT_EMAIL_HREF } from "@/lib/support";

type AssistMessage = {
  id: string;
  role: "assist" | "visitor";
  text: string;
  links?: DznAssistLink[];
  players?: DznAssistRankingRow[];
  servers?: DznAssistRankingRow[];
  updatedAt?: string | null;
};

const ownerDiscordAccessUiEnabled = process.env.NEXT_PUBLIC_DZN_OWNER_DISCORD_ACCESS_UI_ENABLED === "true";
const initialMessage: AssistMessage = {
  id: "dzn-assist-intro",
  role: "assist",
  text: "I am DZN Assist. I can guide you around the public DZN website, point you to the right account or server flow, and show the current public top ten when you ask. I cannot access private account, payment, player, moderation, Discord, or server-secret information.",
};
const quickPrompts = ["How do I set up my server?", "How do I link DayZ stats?", "Show the top players", "Show the top servers"];

export function DznAssist() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AssistMessage[]>([initialMessage]);
  const [loadingRankings, setLoadingRankings] = useState(false);
  const requestRef = useRef(0);
  const visibleGuides = useMemo(
    () => DZN_ASSIST_GUIDES.filter((guide) => guide.id !== "server-owner-discord-access" || ownerDiscordAccessUiEnabled),
    [],
  );

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

  async function sendQuestion(question: string) {
    const text = question.trim().slice(0, 360);
    if (!text || loadingRankings) return;
    const requestId = ++requestRef.current;
    const reply = answerDznAssist(text, { guides: visibleGuides });
    setMessages((current) => [...current,
      { id: `visitor-${requestId}`, role: "visitor", text },
      { id: `assist-${requestId}`, role: "assist", text: reply.message, links: reply.links },
    ]);
    setDraft("");

    if (!reply.wantsRankings) return;
    setLoadingRankings(true);
    try {
      const response = await fetch("/api/public/leaderboards", {
        cache: "no-store",
        credentials: "omit",
        headers: { accept: "application/json" },
      });
      const rankings = response.ok ? parseDznAssistRankings(await response.json()) : null;
      if (requestId !== requestRef.current) return;
      const players = reply.showPlayers ? rankings?.players ?? [] : [];
      const servers = reply.showServers ? rankings?.servers ?? [] : [];
      const hasRows = players.length > 0 || servers.length > 0;
      setMessages((current) => [...current, {
        id: `assist-rankings-${requestId}`,
        role: "assist",
        text: hasRows
          ? "Here are the latest public standings available from DZN right now."
          : "No public standings are available right now. You can check the full public leaderboard again shortly.",
        links: [{ href: "/leaderboards", label: "Open full leaderboards" }],
        players,
        servers,
        updatedAt: rankings?.updatedAt ?? null,
      }]);
    } catch {
      if (requestId === requestRef.current) {
        setMessages((current) => [...current, {
          id: `assist-rankings-unavailable-${requestId}`,
          role: "assist",
          text: "I could not load the public leaderboard right now. No saved or guessed standings are shown.",
          links: [{ href: "/leaderboards", label: "Open full leaderboards" }],
        }]);
      }
    } finally {
      if (requestId === requestRef.current) setLoadingRankings(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendQuestion(draft);
  }

  return (
    <section id="dzn-assist" aria-labelledby="dzn-assist-title" className="scroll-mt-6 overflow-hidden border border-violet-300/20 bg-[#060715] shadow-[0_22px_70px_rgba(0,0,0,0.35)]">
      <header className="flex flex-col gap-3 border-b border-white/10 bg-[linear-gradient(90deg,rgba(124,58,237,0.14),transparent_42%)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-violet-300/30 bg-violet-300/10 text-violet-100"><Bot className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">DZN Assist</p>
            <h2 id="dzn-assist-title" className="mt-1 text-lg font-black uppercase text-white sm:text-xl">Public support desk</h2>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-2 border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-black uppercase text-emerald-100"><span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden="true" /> Ready to guide</span>
      </header>

      <div className="grid min-w-0 lg:grid-cols-[13rem_minmax(0,1fr)_15rem]">
        <aside className="border-b border-white/10 bg-black/15 p-3 lg:border-b-0 lg:border-r">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Ask about</p>
          <div className="mt-3 grid gap-1">
            {quickPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => void sendQuestion(prompt)} disabled={loadingRankings} className="border-l-2 border-transparent px-3 py-2 text-left text-xs font-bold leading-5 text-zinc-300 transition hover:border-violet-300 hover:bg-violet-300/8 hover:text-white disabled:cursor-wait disabled:opacity-60">{prompt}</button>)}
          </div>
          <div className="mt-4 border-t border-white/8 pt-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Public only</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-zinc-400">No account lookups, private player data, payment details, reports, credentials, or hidden server information.</p>
          </div>
        </aside>

        <div className="min-w-0 p-3 sm:p-4">
          <div role="log" aria-live="polite" aria-relevant="additions text" className="h-[min(32rem,48svh)] min-h-72 space-y-4 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
            {messages.map((message) => <AssistMessageRow key={message.id} message={message} />)}
            {loadingRankings ? <div className="flex items-center gap-2 text-xs font-bold text-violet-100"><span className="h-2 w-2 animate-pulse rounded-full bg-violet-300" aria-hidden="true" />Checking the public standings…</div> : null}
          </div>
          <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2 border border-white/12 bg-black/25 p-2" aria-label="Ask DZN Assist">
            <CircleHelp className="ml-1 h-5 w-5 shrink-0 text-violet-200" aria-hidden="true" />
            <input value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 360))} disabled={loadingRankings} placeholder="Ask about DZN, a server, your next step, or public rankings…" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm font-semibold text-white placeholder:text-zinc-500 focus:outline-none disabled:opacity-60" />
            <button type="submit" disabled={!draft.trim() || loadingRankings} className="grid h-10 w-10 shrink-0 place-items-center border border-violet-300/30 bg-violet-300/12 text-violet-100 transition enabled:hover:border-violet-200 enabled:hover:bg-violet-300/20 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send question to DZN Assist"><Send className="h-4 w-4" aria-hidden="true" /></button>
          </form>
          <p className="mt-2 text-[11px] font-semibold leading-5 text-zinc-500">Questions stay in this browser. DZN Assist requests the existing public leaderboard only when you ask for rankings.</p>
        </div>

        <aside className="border-t border-white/10 bg-black/15 p-3 lg:border-t-0 lg:border-l">
          <div className="flex items-center gap-2 text-sm font-black uppercase text-white"><ShieldCheck className="h-4 w-4 text-cyan-200" aria-hidden="true" /> Need private help?</div>
          <p className="mt-2 text-xs font-semibold leading-5 text-zinc-400">Use a private support route for a signed-in account, a payment, or sensitive server assistance. Never post credentials in Global Chat.</p>
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

function AssistMessageRow({ message }: { message: AssistMessage }) {
  const isAssist = message.role === "assist";
  return (
    <article className={isAssist ? "flex gap-3" : "flex justify-end"}>
      {isAssist ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-violet-300/30 bg-violet-300/10 text-violet-100"><Bot className="h-4 w-4" aria-hidden="true" /></span> : null}
      <div className={isAssist ? "min-w-0 max-w-[46rem]" : "max-w-[46rem] border border-cyan-300/20 bg-cyan-300/8 px-3 py-2"}>
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{isAssist ? "DZN Assist" : "You"}</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-zinc-200">{message.text}</p>
        {message.players?.length ? <RankingList icon={Trophy} label="Top players" rows={message.players} /> : null}
        {message.servers?.length ? <RankingList icon={Crown} label="Top servers" rows={message.servers} /> : null}
        {message.updatedAt ? <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">Public board refreshed {new Date(message.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p> : null}
        {message.links?.length ? <div className="mt-3 flex flex-wrap gap-2">{message.links.map((link) => <Link key={`${message.id}:${link.href}`} href={link.href} className="inline-flex min-h-8 items-center gap-1 border border-violet-300/25 bg-violet-300/8 px-2.5 text-xs font-black text-violet-100 transition hover:border-violet-200 hover:text-white">{link.label}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>)}</div> : null}
      </div>
    </article>
  );
}

function RankingList({ icon: Icon, label, rows }: { icon: typeof Trophy; label: string; rows: DznAssistRankingRow[] }) {
  return <section className="mt-3 overflow-hidden border border-white/10 bg-black/20" aria-label={label}>
    <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-300"><Icon className="h-3.5 w-3.5 text-amber-200" aria-hidden="true" />{label}</div>
    <ol>{rows.map((row) => <li key={`${label}:${row.rank}:${row.name}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 border-b border-white/6 px-3 py-2 last:border-b-0"><span className="text-xs font-black text-violet-200">{String(row.rank).padStart(2, "0")}</span><span className="min-w-0"><strong className="block truncate text-xs text-white">{row.name}</strong>{row.detail ? <small className="block truncate text-[11px] font-semibold text-zinc-500">{row.detail}</small> : null}</span></li>)}</ol>
  </section>;
}
