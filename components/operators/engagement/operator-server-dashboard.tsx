"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { OperatorProgressBar } from "@/components/operators/engagement/operator-progress-bar";
import { OperatorResetCountdown } from "@/components/operators/engagement/operator-reset-countdown";
import { OperatorSectionNav } from "@/components/operators/engagement/operator-section-nav";
import { buildOperatorServerCommunityProfile } from "@/lib/operators/engagement/profile-builders";
import { OPERATOR_DEMO_NOW } from "@/lib/operators/engagement/demo-data";
import { getNextOperatorWeeklyReset } from "@/lib/operators/engagement/reset-windows";

export function OperatorServerDashboard() {
  const searchParams = useSearchParams();
  const slug = searchParams.get("slug") ?? "pandora-dayz";
  const server = buildOperatorServerCommunityProfile(slug);

  return (
    <>
      <OperatorSectionNav engagementEnabled />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-8">
        {!server ? (
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-6">
            <h1 className="text-3xl font-black uppercase text-white">Server Operator dashboard unavailable</h1>
            <p className="mt-3 text-sm font-bold text-zinc-300">The requested server community profile is unavailable.</p>
          </article>
        ) : (
          <>
            <article className="rounded-lg border border-emerald-300/18 bg-emerald-300/[0.045] p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">Server Operator Dashboard</p>
              <h1 className="mt-2 text-4xl font-black uppercase text-white">{server.serverName}</h1>
              <p className="mt-2 text-sm font-bold text-zinc-300">{server.mapName} · {server.category} · {server.playerSlots}</p>
              <p className="mt-3 rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-black uppercase text-zinc-200">
                Read-only Phase 2 UI foundation. No owner XP grants, reward editing, leaderboard manipulation, production write APIs, or D1 writes.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                <ServerStat label="Community rank" value={server.communityRank} />
                <ServerStat label="Season position" value={`#${server.seasonPosition}`} />
                <ServerStat label="Weekly XP" value={server.weeklyXp.toLocaleString()} />
                <ServerStat label="Active Operators" value={String(server.activeOperators)} />
              </div>
            </article>
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="grid gap-5">
                <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-2xl font-black uppercase text-white">Community challenges</h2>
                    <OperatorResetCountdown label="Community reset" resetAt={getNextOperatorWeeklyReset(OPERATOR_DEMO_NOW)} />
                  </div>
                  <div className="mt-4 grid gap-4">
                    {server.communityChallenges.map((challenge) => (
                      <div key={challenge.id} className="rounded-lg border border-white/10 bg-black/24 p-4">
                        <h3 className="text-lg font-black uppercase text-white">{challenge.title}</h3>
                        <p className="mt-1 text-xs font-black uppercase text-emerald-100">Fixed reward: {challenge.reward.exactContents}</p>
                        <div className="mt-3">
                          <OperatorProgressBar value={challenge.progress} max={challenge.target} label={challenge.metric} accent="emerald" />
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
                <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                  <h2 className="text-2xl font-black uppercase text-white">Top community Operators</h2>
                  <div className="mt-4 grid gap-3">
                    {server.topOperators.map((operator) => (
                      <Link key={operator.id} href={`/operators/player?id=${operator.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/24 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">
                        <span className="text-sm font-black uppercase text-white">#{operator.position} {operator.displayName}</span>
                        <span className="text-xs font-black uppercase text-emerald-100">{operator.xp.toLocaleString()} XP</span>
                      </Link>
                    ))}
                  </div>
                </article>
              </div>
              <aside className="grid content-start gap-5">
                <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                  <h2 className="text-xl font-black uppercase text-white">Recent community achievements</h2>
                  <div className="mt-3 grid gap-2">
                    {server.recentAchievements.map((achievement) => (
                      <p key={achievement.id} className="rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-bold text-zinc-300">{achievement.title}</p>
                    ))}
                  </div>
                </article>
                <Link href={server.publicServerHref} className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-3 text-xs font-black uppercase text-cyan-50">Public server profile</Link>
                <Link href="/operators/leaderboards" className="rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-black uppercase text-zinc-200">Community leaderboard</Link>
              </aside>
            </section>
          </>
        )}
      </section>
    </>
  );
}

function ServerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-3">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-black uppercase text-white">{value}</p>
    </div>
  );
}
