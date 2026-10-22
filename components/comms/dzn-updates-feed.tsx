"use client";

import { BellRing, ChevronRight, Gamepad2, MessageCircle, MonitorUp, Server, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { formatDznUpdateDate, officialDznUpdates, type DznUpdateCategory } from "@/lib/dzn-updates";

const categoryIcons = {
  Community: MessageCircle,
  Website: MonitorUp,
  Games: Gamepad2,
  Servers: Server,
} satisfies Record<DznUpdateCategory, typeof BellRing>;

export function DznUpdatesFeed({ standalone = false }: { standalone?: boolean }) {
  const updates = officialDznUpdates();
  const Heading = standalone ? "h1" : "h2";

  return (
    <section id="dzn-updates" className={`scroll-mt-6 ${standalone ? "mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12" : ""}`} aria-labelledby="dzn-updates-title">
      <header className="border-b border-white/10 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-violet-300/30 bg-violet-400/10 text-violet-100 shadow-[0_0_24px_rgba(167,139,250,0.15)]">
              <BellRing className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">Official DZN release log</p>
              <Heading id="dzn-updates-title" className="mt-1 text-xl font-black uppercase text-white">DZN Updates</Heading>
            </div>
          </div>
          <span className="inline-flex min-h-9 items-center gap-2 border border-violet-300/20 bg-violet-300/8 px-3 text-[10px] font-black uppercase tracking-[0.15em] text-violet-100">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Verified releases
          </span>
        </div>
        <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-zinc-300">
          Material player and server-owner changes are recorded with their matching DZN website release. This is an official, read-only feed, not activity generated to make Global Chat look busy.
        </p>
      </header>

      <ol className="divide-y divide-white/10">
        {updates.map((update) => {
          const Icon = categoryIcons[update.category];
          return (
            <li key={update.id}>
              <Link href={update.href} className="group grid gap-3 py-5 transition hover:bg-white/[0.025] sm:grid-cols-[2.8rem_minmax(0,1fr)_auto] sm:items-start sm:px-2">
                <span className="grid h-10 w-10 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-violet-200">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-black text-white">{update.title}</span>
                    <span className="border border-white/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-zinc-400">{update.audience}</span>
                  </span>
                  <span className="mt-1.5 block max-w-3xl text-sm leading-6 text-zinc-400">{update.summary}</span>
                </span>
                <span className="flex items-center gap-2 text-xs font-bold text-zinc-500 sm:pt-1">
                  <time dateTime={update.publishedAt}>{formatDznUpdateDate(update.publishedAt)}</time>
                  <ChevronRight className="h-4 w-4 text-violet-200 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
