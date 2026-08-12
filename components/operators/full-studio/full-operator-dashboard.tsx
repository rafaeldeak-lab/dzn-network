import { CalendarCheck2, Medal, Shirt, Trophy, Users } from "lucide-react";
import Link from "next/link";

import { FullOperatorCard } from "@/components/operators/full-studio/full-operator-card";
import { OperatorProgressBar } from "@/components/operators/engagement/operator-progress-bar";
import { OperatorResetCountdown } from "@/components/operators/engagement/operator-reset-countdown";
import { OperatorSectionNav } from "@/components/operators/engagement/operator-section-nav";
import { SiteHeader } from "@/components/site-header";
import { getFullOperatorDemoLoadout } from "@/lib/operators/full-customisation/demo-profiles";
import { buildOperatorMasterySummary } from "@/lib/operators/full-customisation/loadouts";
import { getNextOperatorDailyReset } from "@/lib/operators/engagement/reset-windows";

export function FullOperatorDashboard({ demoMode }: { demoMode: boolean }) {
  const primary = getFullOperatorDemoLoadout("rafael");
  const secondary = getFullOperatorDemoLoadout("viperx");
  const mastery = buildOperatorMasterySummary(12840, Object.values(primary.selectedItemIds).filter(Boolean) as string[]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#02030a] text-zinc-100">
      <SiteHeader active="operators" returnTo="/operators" />
      <OperatorSectionNav engagementEnabled />
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_76%_10%,rgba(34,197,94,.22),transparent_30%),radial-gradient(circle_at_16%_4%,rgba(34,211,238,.2),transparent_32%),linear-gradient(180deg,#06131e,#02030a)]" />
        <div className="relative mx-auto grid max-w-7xl gap-6 px-4 py-8 xl:grid-cols-[290px_minmax(0,1fr)_340px]">
          <aside className="grid content-start gap-4 rounded-lg border border-orange-300/18 bg-orange-300/[0.045] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-200">Daily login streak</p>
            <h2 className="text-2xl font-black uppercase text-white">4-day signal</h2>
            <OperatorResetCountdown label="Daily reset" resetAt={getNextOperatorDailyReset("2026-06-01T13:00:00.000Z")} />
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 7 }, (_, index) => (
                <span key={index} className={`min-h-14 rounded border p-1 text-center text-[9px] font-black uppercase ${index < 4 ? "border-emerald-300/35 bg-emerald-300/12 text-emerald-50" : "border-white/10 bg-black/24 text-zinc-400"}`}>Day<br />{index + 1}</span>
              ))}
            </div>
            <p className="text-xs font-black uppercase text-orange-100">Next fixed reward: Signal Grid background</p>
            <div className="grid gap-2">
              {["Check in to DZN Operators", "Open Character Studio", "View Operator leaderboard"].map((challenge, index) => (
                <div key={challenge} className="rounded border border-white/10 bg-black/24 p-2">
                  <p className="text-[11px] font-black uppercase text-white">{challenge}</p>
                  <OperatorProgressBar value={index === 1 ? 0 : 1} max={1} label="Fixed daily target" accent="orange" />
                </div>
              ))}
            </div>
            <Link href="/operators/challenges" className="rounded border border-orange-300/24 bg-orange-300/10 p-3 text-center text-xs font-black uppercase text-orange-50">View all challenges</Link>
          </aside>

          <section className="grid content-start gap-5">
            <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
              <div>
                <h1 className="break-words text-5xl font-black uppercase leading-[0.95] text-white md:text-7xl">DZN Operators</h1>
                <p className="mt-3 text-2xl font-black uppercase text-cyan-100">Customise. Represent. Compete.</p>
                <p className="mt-4 max-w-3xl text-sm font-bold leading-6 text-zinc-300">
                  Build a tactical DZN identity from procedural body, face, armour, weapon, card, power, and loadout modules. All rewards remain cosmetic.
                </p>
                {demoMode ? (
                  <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs font-black uppercase text-amber-100">
                    Local preview only - not verified telemetry, not production entitlement, and not a subscription.
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link href="/operators/studio" className="rounded-lg bg-cyan-300 px-5 py-3 text-xs font-black uppercase text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100">Go to Studio</Link>
                  <Link href="/operators/player?id=rafael" className="rounded-lg border border-white/10 bg-white/[0.04] px-5 py-3 text-xs font-black uppercase text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100">View Operator Card</Link>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FullOperatorCard loadout={primary} playerName="Rafael" level={24} rank="Network Champion" variant="leaderboard" />
                <FullOperatorCard loadout={secondary} playerName="ViperX" level={21} rank="Sentinel" variant="leaderboard" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-5">
              <Metric icon={Medal} label="Operator level" value={String(mastery.totalOperatorLevel)} />
              <Metric icon={Trophy} label="Season rank" value="#1" />
              <Metric icon={CalendarCheck2} label="Total XP" value={mastery.xp.toLocaleString()} />
              <Metric icon={Shirt} label="Operators unlocked" value={String(mastery.unlockedItemCount)} />
              <Metric icon={Users} label="Loadouts saved" value="7" />
            </div>
          </section>

          <aside className="grid content-start gap-4">
            <FullOperatorCard loadout={primary} playerName="Rafael" level={24} rank="Network Champion" variant="compact" />
            <Panel title="Recent activity" rows={["Saved Rafael Signal Assault", "Equipped Recon Pulse", "Unlocked DZN AR-4 skin"]} />
            <Panel title="Upcoming rewards" rows={[mastery.nextUnlock, "Pandora Signal Patch", "Seven-Day Vanguard frame"]} />
          </aside>
        </div>
      </section>
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-8 lg:grid-cols-3">
        <Panel title="Operator Card preview" rows={["Actual equipped loadout", "Primary weapon visible", "Power slots shown"]} />
        <Panel title="Challenge snapshot" rows={["3 daily targets visible", "XP earned equally", "No premium multiplier"]} />
        <Panel title="Rank progression" rows={[`Level ${mastery.totalOperatorLevel}`, mastery.rankLabel, `Next: ${mastery.nextUnlock}`]} />
      </section>
    </main>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Medal; label: string; value: string }) {
  return (
    <article className="rounded-lg border border-white/10 bg-black/28 p-4">
      <Icon size={18} className="text-cyan-200" aria-hidden="true" />
      <p className="mt-3 text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-black uppercase text-white">{value}</p>
    </article>
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
