import { Trophy, RadioTower, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { AnimatedBackground } from "@/components/dzn/animated-background";
import { DznLogo } from "@/components/dzn/dzn-logo";

export default function LeaderboardsPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-5 py-6 text-white sm:px-6 lg:px-8">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col">
        <nav className="flex items-center justify-between">
          <DznLogo />
          <div className="flex items-center gap-3">
            <Link href="/servers" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/35 hover:text-white">
              Servers
            </Link>
            <Link href="/signup" className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-black uppercase text-white shadow-[0_0_26px_rgba(139,92,246,0.35)] transition hover:bg-violet-400">
              Add Your Server
            </Link>
          </div>
        </nav>

        <section className="grid flex-1 place-items-center py-16">
          <div className="glass-surface animated-border max-w-3xl rounded-lg p-8 text-center sm:p-10">
            <div className="relative z-10">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-lg border border-violet-300/25 bg-violet-500/15 text-violet-100 shadow-[0_0_38px_rgba(139,92,246,0.38)]">
                <Trophy className="h-8 w-8" />
              </div>
              <h1 className="mt-7 text-4xl font-black uppercase text-white sm:text-5xl">Global Leaderboards</h1>
              <p className="mt-4 text-lg leading-8 text-zinc-300">
                Global leaderboards are coming soon. Servers are currently being verified and prepared for stat syncing.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-4 text-left">
                  <RadioTower className="h-6 w-6 text-cyan-100" />
                  <p className="mt-3 text-sm font-black uppercase text-white">Verified servers first</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">Only connected DZN servers will feed the first ranked season.</p>
                </div>
                <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-4 text-left">
                  <ShieldCheck className="h-6 w-6 text-emerald-100" />
                  <p className="mt-3 text-sm font-black uppercase text-white">ADM sync pending</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">Kill tracking starts once the ADM sync engine is active.</p>
                </div>
              </div>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Link href="/servers" className="inline-flex h-12 items-center justify-center rounded-lg bg-violet-500 px-5 text-xs font-black uppercase text-white shadow-[0_0_28px_rgba(139,92,246,0.42)] transition hover:bg-violet-400">
                  Browse Servers
                </Link>
                <Link href="/signup" className="inline-flex h-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-5 text-xs font-black uppercase text-zinc-100 transition hover:border-violet-300/35 hover:text-white">
                  Add Your Server
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
