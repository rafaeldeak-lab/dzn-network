"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { FullOperatorCard } from "@/components/operators/full-studio/full-operator-card";
import { OperatorProgressBar } from "@/components/operators/engagement/operator-progress-bar";
import { OperatorResetCountdown } from "@/components/operators/engagement/operator-reset-countdown";
import { OperatorSectionNav } from "@/components/operators/engagement/operator-section-nav";
import { getFullOperatorServer } from "@/lib/operators/full-customisation/demo-profiles";

export function FullOperatorServerDashboard() {
  const slug = useSearchParams().get("slug") ?? "pandora-dayz";
  const server = getFullOperatorServer(slug);
  const tabs = ["Overview", "Players", "Competitions", "Operators", "Settings"];

  if (!server) {
    return (
      <>
        <OperatorSectionNav engagementEnabled />
        <section className="mx-auto max-w-7xl px-4 py-8">
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-6">
            <h1 className="text-3xl font-black uppercase text-white">Server Operator dashboard unavailable</h1>
            <p className="mt-3 text-sm font-bold text-zinc-300">The requested server community profile is unavailable.</p>
          </article>
        </section>
      </>
    );
  }

  return (
    <>
      <OperatorSectionNav engagementEnabled />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-8">
        <article className="rounded-lg border border-emerald-300/18 bg-emerald-300/[0.045] p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">Server Operator Dashboard</p>
          <h1 className="mt-2 text-5xl font-black uppercase leading-none text-white">{server.serverName}</h1>
          <p className="mt-3 text-sm font-bold text-zinc-300">{server.mapName} - {server.slots} - {server.region} - {server.activeState}</p>
          <p className="mt-3 rounded-lg border border-cyan-300/18 bg-cyan-300/10 p-3 text-xs font-black uppercase text-cyan-100">
            Read-only Phase 3 preview. Admin quick actions are preview-only and disabled unless future reviewed demo controls are explicitly enabled.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button key={tab} type="button" disabled={tab === "Settings"} className="min-h-10 rounded border border-white/10 bg-black/24 px-3 text-[10px] font-black uppercase text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">
                {tab}{tab === "Settings" ? " preview locked" : ""}
              </button>
            ))}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Stat label="Server Operator rank" value={server.operatorRank} />
            <Stat label="Season rank" value={`#${server.seasonRank}`} />
            <Stat label="Weekly XP" value={server.weeklyXp.toLocaleString()} />
            <Stat label="Community reward" value={server.communityChallenge.fixedReward} />
          </div>
        </article>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid gap-5">
            <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-black uppercase text-white">{server.communityChallenge.title}</h2>
                  <p className="mt-1 text-xs font-black uppercase text-emerald-100">Fixed reward: {server.communityChallenge.fixedReward}</p>
                </div>
                <OperatorResetCountdown label="Challenge ends" resetAt={server.communityChallenge.endsAt} />
              </div>
              <div className="mt-4">
                <OperatorProgressBar value={server.communityChallenge.progress} max={server.communityChallenge.target} label="Community aggregate progress" accent="emerald" />
              </div>
            </article>

            <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
              <h2 className="text-2xl font-black uppercase text-white">Top server Operators</h2>
              <div className="mt-4 grid gap-3">
                {server.topOperators.map((player) => (
                  <Link key={player.id} href={`/operators/player?id=${player.id}`} className="grid gap-3 rounded-lg border border-white/10 bg-black/24 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
                    <FullOperatorCard loadout={player.equippedLoadout} playerName={player.displayName} level={player.level} rank={player.rank} variant="server-row" />
                    <span className="min-w-0">
                      <span className="block text-sm font-black uppercase text-white">{player.displayName}</span>
                      <span className="block text-xs font-bold uppercase text-zinc-400">{player.rank} - {player.equippedLoadout.displayName}</span>
                    </span>
                    <span className="text-xs font-black uppercase text-emerald-100">{player.xp.toLocaleString()} XP</span>
                  </Link>
                ))}
              </div>
            </article>
          </div>
          <aside className="grid content-start gap-5">
            <Panel title="Recent community achievements" rows={server.recentAchievements} />
            <Panel title="Disabled preview-only admin actions" rows={["No arbitrary XP grants", "No player banning", "No server restart", "No reward editing", "No score modification"]} />
            <Link href="/servers/preview" className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-3 text-xs font-black uppercase text-cyan-50">Public server profile</Link>
          </aside>
        </section>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-3">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-black uppercase text-white">{value}</p>
    </div>
  );
}

function Panel({ title, rows }: { title: string; rows: string[] }) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
      <h2 className="text-xl font-black uppercase text-white">{title}</h2>
      <div className="mt-3 grid gap-2">
        {rows.map((row) => (
          <p key={row} className="rounded border border-white/10 bg-black/24 p-3 text-xs font-black uppercase text-zinc-200">{row}</p>
        ))}
      </div>
    </article>
  );
}
