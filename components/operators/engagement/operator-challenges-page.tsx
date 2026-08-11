"use client";

import { useMemo, useState } from "react";

import { OperatorChallengeCard } from "@/components/operators/engagement/operator-challenge-card";
import { OperatorProgressBar } from "@/components/operators/engagement/operator-progress-bar";
import { OperatorResetCountdown } from "@/components/operators/engagement/operator-reset-countdown";
import { OperatorSectionNav } from "@/components/operators/engagement/operator-section-nav";
import { getChallengesForCategory, getOperatorChallengeCatalog } from "@/lib/operators/engagement/challenges";
import { OPERATOR_DEMO_NOW, DEMO_OPERATOR_STATE } from "@/lib/operators/engagement/demo-data";
import { applyOperatorEngagementEvent, createOperatorEngagementState } from "@/lib/operators/engagement/progress";
import { getOperatorRankProgress } from "@/lib/operators/engagement/ranks";
import { getNextOperatorDailyReset, getNextOperatorSeasonReset, getNextOperatorWeeklyReset } from "@/lib/operators/engagement/reset-windows";
import type { OperatorChallengeCategory, OperatorChallengeMetric } from "@/lib/operators/engagement/types";

const categories: OperatorChallengeCategory[] = ["daily", "weekly", "seasonal", "community"];

export function OperatorChallengesPage({ demoMode }: { demoMode: boolean }) {
  const [category, setCategory] = useState<OperatorChallengeCategory>("daily");
  const [state, setState] = useState(() => createOperatorEngagementState(DEMO_OPERATOR_STATE));
  const challenges = useMemo(() => getChallengesForCategory(category), [category]);
  const nearest = getOperatorChallengeCatalog()
    .map((challenge) => ({ challenge, progress: state.challengeProgress[challenge.id]?.value ?? 0 }))
    .filter((entry) => entry.progress < entry.challenge.target)
    .sort((left, right) => (right.progress / right.challenge.target) - (left.progress / left.challenge.target))[0];
  const completed = challenges.filter((challenge) => (state.challengeProgress[challenge.id]?.value ?? 0) >= challenge.target).length;
  const rank = getOperatorRankProgress(state.xp);

  function simulate(metric: OperatorChallengeMetric, amount: number) {
    if (!demoMode) return;
    setState((current) => applyOperatorEngagementEvent(current, {
      id: `demo-${metric}-${Date.now()}`,
      metric,
      amount,
      occurredAt: OPERATOR_DEMO_NOW,
      source: metric.startsWith("operator") || metric === "character_studio_visit" ? "website" : "future_adm",
    }, OPERATOR_DEMO_NOW));
  }

  return (
    <>
      <OperatorSectionNav engagementEnabled />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-8">
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-200">DZN Operator Challenges</p>
          <h1 className="mt-2 text-4xl font-black uppercase text-white">Fixed targets, fixed cosmetic rewards</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-zinc-300">
            Current rank: {rank.currentRank.displayName}. Website interactions can run in local demo mode. ADM and event metrics are adapter-ready seeded previews, not verified telemetry.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-orange-300/18 bg-orange-300/10 p-4">
              <p className="text-xs font-black uppercase text-orange-100">Nearest completion</p>
              <h2 className="mt-1 text-xl font-black uppercase text-white">{nearest?.challenge.title ?? "All visible challenges complete"}</h2>
              {nearest ? <OperatorProgressBar value={nearest.progress} max={nearest.challenge.target} label="Nearest progress" accent="orange" /> : null}
            </div>
            <div className="rounded-lg border border-cyan-300/18 bg-cyan-300/10 p-4">
              <p className="text-xs font-black uppercase text-cyan-100">Reset window</p>
              <OperatorResetCountdown label={`${category} reset`} resetAt={resetFor(category)} />
              <OperatorProgressBar value={completed} max={challenges.length} label="Category completion" />
            </div>
          </div>
          {demoMode ? (
            <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs font-black uppercase text-amber-100">
              Local demo only - not verified DZN telemetry.
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-4" role="tablist" aria-label="Challenge categories">
          {categories.map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={category === entry}
              onClick={() => setCategory(entry)}
              className={`min-h-12 rounded-lg px-4 text-xs font-black uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                category === entry ? "bg-orange-300 text-slate-950" : "border border-white/10 bg-white/[0.035] text-zinc-200"
              }`}
            >
              {entry}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {challenges.map((challenge) => (
            <OperatorChallengeCard key={challenge.id} challenge={challenge} progress={state.challengeProgress[challenge.id]} demoMode={demoMode} onSimulate={simulate} />
          ))}
        </div>
      </section>
    </>
  );
}

function resetFor(category: OperatorChallengeCategory): string {
  if (category === "daily") return getNextOperatorDailyReset(OPERATOR_DEMO_NOW);
  if (category === "seasonal") return getNextOperatorSeasonReset(OPERATOR_DEMO_NOW);
  return getNextOperatorWeeklyReset(OPERATOR_DEMO_NOW);
}
