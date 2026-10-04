"use client";

import { Bot, ChevronRight, CircleHelp, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DZN_ASSIST_CATEGORIES, DZN_ASSIST_GUIDES } from "@/lib/dzn-assist";
import { DZN_PUBLIC_DISCORD_INVITE_URL } from "@/lib/public-discord";
import { DZN_SUPPORT_EMAIL, DZN_SUPPORT_EMAIL_HREF } from "@/lib/support";

type AssistCategory = (typeof DZN_ASSIST_CATEGORIES)[number];

export function DznAssist() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AssistCategory>("All");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const guides = useMemo(() => DZN_ASSIST_GUIDES.filter((guide) => {
    if (category !== "All" && guide.category !== category) return false;
    if (!normalizedQuery) return true;
    return [guide.title, guide.summary, guide.category, ...guide.keywords]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  }), [category, normalizedQuery]);

  useEffect(() => {
    if (window.location.hash !== "#dzn-assist") return;
    let cancelled = false;
    const scrollToAssist = () => {
      if (!cancelled && window.location.hash === "#dzn-assist") {
        document.getElementById("dzn-assist")?.scrollIntoView({ block: "start" });
      }
    };
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToAssist));
    const settledLayoutTimer = window.setTimeout(scrollToAssist, 400);
    void document.fonts?.ready.then(scrollToAssist);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settledLayoutTimer);
    };
  }, []);

  return (
    <section id="dzn-assist" aria-labelledby="dzn-assist-title" className="scroll-mt-6 overflow-hidden rounded-lg border border-violet-300/20 bg-[#070817] shadow-[0_22px_70px_rgba(0,0,0,0.35)]">
      <div className="grid gap-5 border-b border-white/10 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-violet-300/30 bg-violet-300/10 text-violet-100"><Bot className="h-6 w-6" aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-200">DZN Assist</p>
            <h2 id="dzn-assist-title" className="mt-1 text-2xl font-black uppercase text-white sm:text-3xl">Find the right next step</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-zinc-300">Search trusted DZN guidance for accounts, player links, server setup, billing and community tools.</p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-black uppercase text-emerald-100"><span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden="true" /> Guided help live</span>
      </div>

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <label htmlFor="dzn-assist-search" className="text-xs font-black uppercase tracking-[0.16em] text-zinc-300">What do you need help with?</label>
          <div className="mt-2 flex min-h-12 items-center gap-3 rounded-md border border-white/12 bg-black/30 px-3 focus-within:border-violet-300/50 focus-within:ring-2 focus-within:ring-violet-300/15">
            <Search className="h-5 w-5 shrink-0 text-violet-200" aria-hidden="true" />
            <input id="dzn-assist-search" type="search" value={query} onChange={(event) => setQuery(event.target.value.slice(0, 120))} placeholder="Try: link stats, server setup, payment..." className="min-w-0 flex-1 bg-transparent py-3 text-sm font-semibold text-white placeholder:text-zinc-500 focus:outline-none" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2" aria-label="DZN Assist topics">
            {DZN_ASSIST_CATEGORIES.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`min-h-9 rounded-md border px-3 text-xs font-black uppercase transition ${category === item ? "border-violet-300/55 bg-violet-300/16 text-white" : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/25 hover:text-white"}`}>{item}</button>)}
          </div>
          <div className="mt-5 grid gap-3" aria-live="polite">
            {guides.map((guide) => (
              <article key={guide.id} className="rounded-md border border-white/10 bg-black/24 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-violet-200">{guide.category}</p>
                <h3 className="mt-1 text-base font-black text-white">{guide.title}</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-zinc-300">{guide.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">{guide.links.map((link) => <Link key={link.href} href={link.href} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/8 px-3 text-xs font-black uppercase text-cyan-100 transition hover:border-cyan-200/55 hover:text-white">{link.label}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>)}</div>
              </article>
            ))}
            {guides.length === 0 ? <div className="rounded-md border border-amber-300/20 bg-amber-300/8 p-4"><p className="font-black text-amber-100">No matching guide yet</p><p className="mt-2 text-sm font-semibold leading-6 text-zinc-300">Try a shorter search, choose All, or contact DZN support using the private options beside this list.</p></div> : null}
          </div>
        </div>
        <aside className="space-y-3">
          <div className="rounded-md border border-cyan-300/20 bg-cyan-300/7 p-4"><div className="flex items-center gap-2 text-sm font-black uppercase text-white"><ShieldCheck className="h-5 w-5 text-cyan-200" aria-hidden="true" /> Private by design</div><p className="mt-2 text-xs font-semibold leading-5 text-zinc-300">Your search stays in this browser. DZN Assist does not send prompts, inspect your account, read private server data or change settings.</p></div>
          <div className="rounded-md border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-sm font-black uppercase text-white"><CircleHelp className="h-5 w-5 text-violet-200" aria-hidden="true" /> Need a person?</div>
            <p className="mt-2 text-xs font-semibold leading-5 text-zinc-300">Use a private support channel for account-specific help. Never post credentials or payment details in Global Chat.</p>
            <div className="mt-3 grid gap-2"><a href={DZN_SUPPORT_EMAIL_HREF} className="flex min-h-10 items-center justify-between rounded-md border border-white/10 px-3 text-xs font-black text-zinc-100 hover:border-cyan-300/35">Email support <span className="sr-only">at {DZN_SUPPORT_EMAIL}</span><ChevronRight className="h-4 w-4" aria-hidden="true" /></a><a href={DZN_PUBLIC_DISCORD_INVITE_URL} className="flex min-h-10 items-center justify-between rounded-md border border-white/10 px-3 text-xs font-black text-zinc-100 hover:border-cyan-300/35">DZN Discord <ChevronRight className="h-4 w-4" aria-hidden="true" /></a></div>
          </div>
        </aside>
      </div>
    </section>
  );
}
