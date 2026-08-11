import { OperatorProgressBar } from "@/components/operators/engagement/operator-progress-bar";
import { OperatorRankEmblem } from "@/components/operators/engagement/operator-rank-emblem";
import { OperatorSectionNav } from "@/components/operators/engagement/operator-section-nav";
import { DEMO_OPERATOR_STATE } from "@/lib/operators/engagement/demo-data";
import { getOperatorRankProgress, OPERATOR_RANKS } from "@/lib/operators/engagement/ranks";

export function OperatorRankPage() {
  const progress = getOperatorRankProgress(DEMO_OPERATOR_STATE.xp);

  return (
    <>
      <OperatorSectionNav engagementEnabled />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-8">
        <div className="rounded-lg border border-cyan-300/18 bg-cyan-300/[0.045] p-5">
          <div className="flex items-center gap-4">
            <OperatorRankEmblem label={progress.currentRank.displayName} level={progress.currentRank.level} active />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">DZN Operator Rank</p>
              <h1 className="mt-1 text-4xl font-black uppercase text-white">{progress.currentRank.displayName}</h1>
              <p className="mt-2 text-sm font-bold text-zinc-300">{progress.totalXp.toLocaleString()} total XP · {progress.xpRemaining.toLocaleString()} XP to next rank</p>
            </div>
          </div>
          <div className="mt-5">
            <OperatorProgressBar value={progress.progressPercent} max={100} label="Current-rank progress" accent="cyan" />
          </div>
          <p className="mt-4 rounded-lg border border-violet-300/18 bg-violet-300/10 p-3 text-xs font-black uppercase text-violet-100">
            Exact next reward: {progress.nextReward?.exactContents ?? "All rank rewards claimed"} · fixed known rewards only.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {OPERATOR_RANKS.map((rank) => {
            const active = rank.id === progress.currentRank.id;
            const unlocked = rank.minXp <= progress.totalXp;
            return (
              <article key={rank.id} className={`rounded-lg border p-4 ${active ? "border-cyan-300/30 bg-cyan-300/10" : "border-white/10 bg-white/[0.035]"}`}>
                <div className="flex items-center gap-3">
                  <OperatorRankEmblem label={rank.displayName} level={rank.level} active={active} />
                  <div>
                    <h2 className="text-xl font-black uppercase text-white">{rank.displayName}</h2>
                    <p className="text-xs font-black uppercase text-zinc-400">Level {rank.level} · {rank.minXp.toLocaleString()} XP</p>
                  </div>
                </div>
                <p className="mt-4 rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-black uppercase text-zinc-200">
                  {unlocked ? "Unlocked" : "Locked"} · Reward: {rank.reward.exactContents}
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
