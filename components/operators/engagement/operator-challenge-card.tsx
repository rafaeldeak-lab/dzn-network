import { CheckCircle2, LockKeyhole, RadioTower } from "lucide-react";

import { OperatorProgressBar } from "@/components/operators/engagement/operator-progress-bar";
import { getChallengeCompletionState } from "@/lib/operators/engagement/progress";
import type { OperatorChallenge, OperatorChallengeProgress } from "@/lib/operators/engagement/types";

type OperatorChallengeCardProps = {
  challenge: OperatorChallenge;
  progress?: OperatorChallengeProgress;
  demoMode?: boolean;
  onSimulate?: (metric: OperatorChallenge["metric"], amount: number) => void;
};

export function OperatorChallengeCard({ challenge, progress, demoMode = false, onSimulate }: OperatorChallengeCardProps) {
  const status = getChallengeCompletionState(challenge, progress);
  const value = progress?.value ?? 0;
  const complete = status === "completed" || status === "claimed";
  const accent = challenge.category === "daily" ? "orange" : challenge.category === "seasonal" ? "violet" : challenge.category === "community" ? "emerald" : "cyan";

  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{challenge.category} · {challenge.source}</p>
          <h3 className="mt-1 text-lg font-black uppercase text-white">{challenge.title}</h3>
          <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">{challenge.description}</p>
        </div>
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg border ${complete ? "border-emerald-300/30 bg-emerald-300/12 text-emerald-100" : "border-orange-300/25 bg-orange-300/10 text-orange-100"}`}>
          {complete ? <CheckCircle2 aria-hidden="true" size={20} /> : <RadioTower aria-hidden="true" size={20} />}
        </div>
      </div>
      <div className="mt-4">
        <OperatorProgressBar value={value} max={challenge.target} label={`${status} progress`} accent={accent} />
      </div>
      <div className="mt-4 grid gap-2 text-xs font-black uppercase text-zinc-300 sm:grid-cols-3">
        <span className="rounded-lg border border-white/10 bg-black/24 p-2">{challenge.xpReward} XP</span>
        <span className="rounded-lg border border-white/10 bg-black/24 p-2">{challenge.reward?.exactContents ?? "DZN Field Pack XP"}</span>
        <span className="rounded-lg border border-white/10 bg-black/24 p-2">{challenge.privacy}</span>
      </div>
      {demoMode && onSimulate ? (
        <button
          type="button"
          onClick={() => onSimulate(challenge.metric, demoAmount(challenge.target))}
          className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-cyan-300/24 bg-cyan-300/10 px-3 text-xs font-black uppercase text-cyan-50 transition hover:bg-cyan-300/18 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
        >
          <LockKeyhole size={15} aria-hidden="true" />
          Simulate progress
        </button>
      ) : null}
    </article>
  );
}

function demoAmount(target: number): number {
  if (target >= 10_000) return Math.min(target, 10_000);
  if (target >= 30) return Math.min(target, 10);
  return 1;
}
