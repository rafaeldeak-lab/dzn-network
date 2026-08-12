"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { FullOperatorCard } from "@/components/operators/full-studio/full-operator-card";
import { OperatorProgressBar } from "@/components/operators/engagement/operator-progress-bar";
import { OperatorSectionNav } from "@/components/operators/engagement/operator-section-nav";
import { getFullOperatorItem } from "@/lib/operators/full-customisation/catalog";
import { getFullOperatorPlayer } from "@/lib/operators/full-customisation/demo-profiles";

export function FullOperatorPlayerProfile() {
  const id = useSearchParams().get("id") ?? "rafael";
  const player = getFullOperatorPlayer(id);

  if (!player) {
    return (
      <>
        <OperatorSectionNav engagementEnabled />
        <section className="mx-auto max-w-7xl px-4 py-8">
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-6">
            <h1 className="text-3xl font-black uppercase text-white">Operator unavailable</h1>
            <p className="mt-3 text-sm font-bold leading-6 text-zinc-300">The requested public Operator profile is unavailable or no longer visible.</p>
            <Link href="/operators/leaderboards" className="mt-5 inline-flex rounded-lg bg-cyan-300 px-4 py-3 text-xs font-black uppercase text-slate-950">Back to leaderboard</Link>
          </article>
        </section>
      </>
    );
  }

  const loadout = player.equippedLoadout;
  const tabs = ["Overview", "Operator Card", "Loadouts", "Challenges", "Stats"];

  return (
    <>
      <OperatorSectionNav engagementEnabled />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-8">
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(360px,460px)_minmax(0,1fr)]">
          <FullOperatorCard loadout={loadout} playerName={player.displayName} level={player.level} rank={player.rank} variant="full" />
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Public DZN Operator profile</p>
            <h1 className="mt-2 text-5xl font-black uppercase leading-none text-white">{player.displayName}</h1>
            <p className="mt-3 text-sm font-bold text-zinc-300">Public DZN reference: {player.publicRef} - Linked server: {player.linkedServerName}</p>
            <p className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-3 text-xs font-black uppercase text-emerald-100">
              Privacy-safe public page. No raw coordinates, private Discord ID, internal database ID, session metadata, or authentication data is exposed.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button key={tab} type="button" className="min-h-10 rounded border border-white/10 bg-black/24 px-3 text-[10px] font-black uppercase text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200">
                  {tab}
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              <Stat label="Level" value={String(player.level)} />
              <Stat label="Rank" value={player.rank} />
              <Stat label="XP" value={player.xp.toLocaleString()} />
              <Stat label="Loadouts" value={String(player.loadoutCount)} />
            </div>
            <div className="mt-5">
              <OperatorProgressBar value={player.xp % 1200} max={1200} label="Progress to next rank" />
            </div>
          </article>
        </div>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid gap-5">
            <Panel title="Featured loadout" rows={[
              loadout.displayName,
              getFullOperatorItem(loadout.weapon.primaryWeaponItemId)?.displayName ?? "Primary weapon",
              getFullOperatorItem(loadout.weapon.secondaryWeaponItemId)?.displayName ?? "Secondary weapon",
              getFullOperatorItem(loadout.weapon.meleeWeaponItemId)?.displayName ?? "Melee weapon",
            ]} />
            <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
              <h2 className="text-2xl font-black uppercase text-white">Challenge progress</h2>
              <div className="mt-4 grid gap-4">
                <OperatorProgressBar value={80} max={100} label="Daily completion" accent="orange" />
                <OperatorProgressBar value={65} max={100} label="Weekly completion" />
                <OperatorProgressBar value={49} max={100} label="Seasonal completion" accent="violet" />
              </div>
            </article>
            <Panel title="Privacy-safe aggregate stats" rows={[
              `${player.aggregateStats.confirmedKills} confirmed kills`,
              `${player.aggregateStats.confirmedDeaths} confirmed deaths`,
              `${player.aggregateStats.longestKillM}m longest kill`,
              `${player.aggregateStats.travelKm}km travel`,
              `${player.aggregateStats.exploredCells} aggregate cells explored`,
            ]} />
          </div>
          <aside className="grid content-start gap-5">
            <Panel title="Equipped powers" rows={Object.values(loadout.powerSlots).map((itemId) => getFullOperatorItem(itemId)?.displayName ?? "Empty power slot")} />
            <Panel title="Recent achievements" rows={player.achievements} />
            <Panel title="Leaderboard positions" rows={Object.entries(player.leaderboardPositions).map(([period, position]) => `${period.replace("_", " ")} #${position}`)} />
            <Link href={`/operators/server?slug=${player.linkedServerSlug}`} className="rounded-lg border border-emerald-300/25 bg-emerald-300/10 p-3 text-xs font-black uppercase text-emerald-50">Linked server Operator dashboard</Link>
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
