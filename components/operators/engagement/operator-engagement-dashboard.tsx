import { CalendarCheck2, Medal, Trophy, Users } from "lucide-react";
import Link from "next/link";

import { OperatorCard } from "@/components/operators/operator-card";
import { OperatorFairnessNotice } from "@/components/operators/operator-fairness-notice";
import { OperatorProgressBar } from "@/components/operators/engagement/operator-progress-bar";
import { OperatorResetCountdown } from "@/components/operators/engagement/operator-reset-countdown";
import { OperatorSectionNav } from "@/components/operators/engagement/operator-section-nav";
import { OperatorRankEmblem } from "@/components/operators/engagement/operator-rank-emblem";
import { SiteHeader } from "@/components/site-header";
import { getOperatorChallengeCatalog } from "@/lib/operators/engagement/challenges";
import { DEMO_OPERATOR_STATE, getDemoLeaderboardRows, OPERATOR_DEMO_NOW } from "@/lib/operators/engagement/demo-data";
import { getOperatorRankProgress } from "@/lib/operators/engagement/ranks";
import { OPERATOR_STREAK_REWARDS } from "@/lib/operators/engagement/rewards";
import { getNextOperatorDailyReset } from "@/lib/operators/engagement/reset-windows";
import { buildOperatorCardPresentation, getDefaultOperatorLoadout } from "@/lib/operators/loadout";

export function OperatorEngagementDashboard({ demoMode }: { demoMode: boolean }) {
  const presentation = buildOperatorCardPresentation(getDefaultOperatorLoadout());
  const rank = getOperatorRankProgress(DEMO_OPERATOR_STATE.xp);
  const challenges = getOperatorChallengeCatalog().filter((challenge) => challenge.category === "daily").slice(0, 4);
  const leaderboard = getDemoLeaderboardRows("weekly").slice(0, 3);
  const nextStreakReward = OPERATOR_STREAK_REWARDS[DEMO_OPERATOR_STATE.dailyStreak.current % OPERATOR_STREAK_REWARDS.length];

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#02030a] text-zinc-100">
      <SiteHeader active="operators" returnTo="/operators" />
      <OperatorSectionNav engagementEnabled />
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_6%,rgba(139,92,246,.18),transparent_30%),radial-gradient(circle_at_10%_0%,rgba(34,211,238,.18),transparent_32%),linear-gradient(180deg,#06101d,#02030a)]" />
        <div className="relative mx-auto grid max-w-7xl gap-6 px-4 py-8 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <h1 className="max-w-4xl break-words text-4xl font-black uppercase leading-[0.96] text-white sm:text-5xl md:text-6xl">
              DZN Operators Daily Engagement
            </h1>
            <p className="mt-4 max-w-3xl text-sm font-bold leading-6 text-zinc-300">
              Check in, complete fixed challenges, earn cosmetic Operator XP, climb original DZN ranks, and track public preview
              leaderboards. Free and premium users earn at the same rate.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <MetricTile icon={CalendarCheck2} label="Current streak" value={`${DEMO_OPERATOR_STATE.dailyStreak.current} days`} />
              <MetricTile icon={Medal} label="Operator XP" value={rank.totalXp.toLocaleString()} />
              <MetricTile icon={Trophy} label="Current rank" value={rank.currentRank.displayName} />
            </div>
            {demoMode ? (
              <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs font-black uppercase text-amber-100">
                Local demo progression only - not verified ADM telemetry, not a subscription, and not authoritative leaderboard standing.
              </p>
            ) : null}
          </div>
          <OperatorCard presentation={presentation} compact />
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl items-start gap-5 px-4 py-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)]">
        <div className="grid content-start gap-5">
          <article className="rounded-lg border border-cyan-300/16 bg-cyan-300/[0.045] p-5">
            <div className="flex items-center gap-4">
              <OperatorRankEmblem label={rank.currentRank.displayName} level={rank.currentRank.level} active />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Operator rank summary</p>
                <h2 className="mt-1 text-2xl font-black uppercase text-white">{rank.currentRank.displayName} · Level {rank.currentRank.level}</h2>
                <p className="mt-1 text-xs font-black uppercase text-zinc-400">Next reward: {rank.nextReward?.exactContents ?? "Rank ladder complete"}</p>
              </div>
            </div>
            <div className="mt-4">
              <OperatorProgressBar value={rank.totalXp - rank.currentRank.minXp} max={(rank.nextRank?.minXp ?? rank.totalXp) - rank.currentRank.minXp || 1} label={`${rank.xpRemaining} XP to next rank`} />
            </div>
            <Link href="/operators/rank" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-cyan-300 px-4 text-xs font-black uppercase text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100">
              View rank ladder
            </Link>
          </article>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-lg border border-orange-300/18 bg-orange-300/[0.045] p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-200">Daily login streak</p>
              <h2 className="mt-1 text-2xl font-black uppercase text-white">{DEMO_OPERATOR_STATE.dailyStreak.current}-day signal</h2>
              <OperatorResetCountdown label="Daily reset" resetAt={getNextOperatorDailyReset(OPERATOR_DEMO_NOW)} />
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                {OPERATOR_STREAK_REWARDS.map((reward, index) => {
                  const day = index + 1;
                  const claimed = DEMO_OPERATOR_STATE.dailyStreak.claimedCycleDays.includes(day);
                  const current = day === DEMO_OPERATOR_STATE.dailyStreak.current + 1;
                  return (
                    <div key={reward.id} className={`min-h-20 rounded-lg border p-2 text-center ${claimed ? "border-emerald-300/30 bg-emerald-300/12" : current ? "border-orange-300/35 bg-orange-300/12" : "border-white/10 bg-black/24"}`}>
                      <p className="text-[10px] font-black uppercase text-zinc-400">Day {day}</p>
                      <p className="mt-1 text-[10px] font-black uppercase leading-4 text-white">{claimed ? "Claimed" : current ? "Current" : "Upcoming"}</p>
                      <p className="mt-1 text-[10px] font-bold leading-4 text-zinc-300">{reward.exactContents}</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs font-black uppercase text-orange-100">Next fixed reward: {nextStreakReward.exactContents}</p>
            </article>

            <article className="rounded-lg border border-violet-300/18 bg-violet-300/[0.045] p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-200">Upcoming fixed rewards</p>
              <div className="mt-3 grid gap-3">
                {[rank.nextReward?.exactContents ?? "Rank ladder complete", nextStreakReward.exactContents, "Seasonal Signal Vanguard profile accent"].map((reward) => (
                  <div key={reward} className="rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-black uppercase text-zinc-100">
                    {reward}
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-200">Daily challenges</p>
                <h2 className="mt-1 text-2xl font-black uppercase text-white">Today’s fixed targets</h2>
              </div>
              <Link href="/operators/challenges" className="rounded-lg border border-orange-300/25 bg-orange-300/10 px-4 py-3 text-xs font-black uppercase text-orange-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-200">
                All challenges
              </Link>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {challenges.map((challenge) => (
                <div key={challenge.id} className="rounded-lg border border-white/10 bg-black/24 p-3">
                  <p className="text-sm font-black uppercase text-white">{challenge.title}</p>
                  <div className="mt-3">
                    <OperatorProgressBar value={DEMO_OPERATOR_STATE.challengeProgress[challenge.id]?.value ?? 0} max={challenge.target} label={`${challenge.xpReward} XP`} accent="orange" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-5">
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Weekly leaderboard snapshot</p>
            <div className="mt-4 grid gap-3">
              {leaderboard.map((row) => (
                <Link key={row.id} href={`/operators/player?id=${row.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/24 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200">
                  <span className="text-sm font-black uppercase text-white">#{row.position} {row.displayName}</span>
                  <span className="text-xs font-black uppercase text-cyan-100">{row.xp.toLocaleString()} XP</span>
                </Link>
              ))}
            </div>
            <Link href="/operators/leaderboards" className="mt-4 inline-flex text-xs font-black uppercase text-cyan-200">Full leaderboard</Link>
          </article>
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">Recent Operator activity</p>
            <div className="mt-3 grid gap-2">
              {DEMO_OPERATOR_STATE.recentActivity.map((activity) => (
                <p key={activity.id} className="rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-bold leading-5 text-zinc-300">{activity.label}</p>
              ))}
            </div>
          </article>
          <article className="rounded-lg border border-emerald-300/16 bg-emerald-300/[0.045] p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">Quick links</p>
            <div className="mt-3 grid gap-2">
              {[
                ["/operators/studio", "Character Studio"],
                ["/operators/player?id=rafael", "Player Operator page"],
                ["/operators/server?slug=pandora-dayz", "Server Operator Dashboard"],
                ["/operators/challenges", "Challenges"],
                ["/operators/leaderboards", "Leaderboards"],
              ].map(([href, label]) => (
                <Link key={href} href={href} className="rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-black uppercase text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">
                  {label}
                </Link>
              ))}
            </div>
          </article>
          <OperatorFairnessNotice />
        </aside>
      </section>
    </main>
  );
}

function MetricTile({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <Icon size={20} className="text-cyan-200" aria-hidden="true" />
      <p className="mt-3 text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-black uppercase text-white">{value}</p>
    </div>
  );
}
