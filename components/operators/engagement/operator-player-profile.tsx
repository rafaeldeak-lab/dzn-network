"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { OperatorCard } from "@/components/operators/operator-card";
import { OperatorProgressBar } from "@/components/operators/engagement/operator-progress-bar";
import { OperatorRankEmblem } from "@/components/operators/engagement/operator-rank-emblem";
import { OperatorSectionNav } from "@/components/operators/engagement/operator-section-nav";
import { buildOperatorPlayerProfile } from "@/lib/operators/engagement/profile-builders";
import { getOperatorRankProgress } from "@/lib/operators/engagement/ranks";
import { buildOperatorCardPresentation, getDefaultOperatorLoadout } from "@/lib/operators/loadout";

export function OperatorPlayerProfile() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "rafael";
  const profile = buildOperatorPlayerProfile(id);
  const presentation = buildOperatorCardPresentation(getDefaultOperatorLoadout());

  return (
    <>
      <OperatorSectionNav engagementEnabled />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-8">
        {!profile ? (
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-6">
            <h1 className="text-3xl font-black uppercase text-white">Operator unavailable</h1>
            <p className="mt-3 text-sm font-bold leading-6 text-zinc-300">The requested public Operator profile is unavailable or no longer visible.</p>
            <Link href="/operators/leaderboards" className="mt-5 inline-flex rounded-lg bg-cyan-300 px-4 py-3 text-xs font-black uppercase text-slate-950">Back to leaderboard</Link>
          </article>
        ) : (
          <>
            <div className="grid items-start gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
              <OperatorCard presentation={{ ...presentation, displayName: profile.favouriteLoadoutLabel, callSign: profile.displayName }} compact />
              <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Public Operator profile</p>
                <h1 className="mt-2 text-4xl font-black uppercase text-white">{profile.displayName}</h1>
                <p className="mt-2 text-sm font-bold text-zinc-300">Public DZN identifier: {profile.publicRef} · Linked server: {profile.linkedServerName}</p>
                <p className="mt-3 rounded-lg border border-cyan-300/18 bg-cyan-300/10 p-3 text-xs font-black uppercase text-cyan-100">
                  Preview data - not live network standings. Public aggregate values are demo-safe and non-authoritative.
                </p>
                <p className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-3 text-xs font-black uppercase text-emerald-100">
                  No raw coordinates, private Discord ID, internal database ID, session metadata, or authentication data is exposed.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <ProfileStat label="Operator XP" value={profile.totalXp.toLocaleString()} />
                  <ProfileStat label="Current streak" value={`${profile.currentStreak} days`} />
                  <ProfileStat label="Favourite loadout" value={profile.favouriteLoadoutLabel} />
                </div>
              </article>
            </div>
            <ProfileDetails profile={profile} />
          </>
        )}
      </section>
    </>
  );
}

function ProfileDetails({ profile }: { profile: NonNullable<ReturnType<typeof buildOperatorPlayerProfile>> }) {
  const rank = getOperatorRankProgress(profile.totalXp);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="grid gap-5">
        <article className="rounded-lg border border-cyan-300/18 bg-cyan-300/[0.045] p-5">
          <div className="flex items-center gap-4">
            <OperatorRankEmblem label={rank.currentRank.displayName} level={rank.currentRank.level} active />
            <div>
              <h2 className="text-2xl font-black uppercase text-white">{rank.currentRank.displayName}</h2>
              <p className="text-xs font-black uppercase text-zinc-400">{rank.xpRemaining} XP to next rank</p>
            </div>
          </div>
          <div className="mt-4">
            <OperatorProgressBar value={rank.progressPercent} max={100} label="Rank progress" />
          </div>
        </article>
        <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <h2 className="text-2xl font-black uppercase text-white">Completion summary</h2>
          <div className="mt-4 grid gap-4">
            <OperatorProgressBar value={profile.dailyCompletionPercent} max={100} label="Daily completion" accent="orange" />
            <OperatorProgressBar value={profile.weeklyCompletionPercent} max={100} label="Weekly completion" />
            <OperatorProgressBar value={profile.seasonalCompletionPercent} max={100} label="Seasonal completion" accent="violet" />
          </div>
        </article>
        <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <h2 className="text-2xl font-black uppercase text-white">Public aggregate summary</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            <ProfileStat label="Kills" value={String(profile.combatSummary.confirmedKills)} />
            <ProfileStat label="Deaths" value={String(profile.combatSummary.confirmedDeaths)} />
            <ProfileStat label="Longest" value={`${profile.combatSummary.longestKillM}m`} />
            <ProfileStat label="Travel" value={`${profile.combatSummary.travelKm}km`} />
            <ProfileStat label="Cells" value={String(profile.combatSummary.exploredCells)} />
          </div>
        </article>
      </section>
      <aside className="grid content-start gap-5">
        <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <h2 className="text-xl font-black uppercase text-white">Achievements</h2>
          <div className="mt-3 grid gap-2">
            {profile.achievements.map((achievement) => (
              <p key={achievement.id} className="rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-bold text-zinc-300">{achievement.title}</p>
            ))}
          </div>
        </article>
        <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <h2 className="text-xl font-black uppercase text-white">Leaderboard positions</h2>
          <div className="mt-3 grid gap-2">
            {Object.entries(profile.leaderboardPositions).map(([period, position]) => (
              <p key={period} className="rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-black uppercase text-zinc-200">{period.replace("_", " ")}: #{position}</p>
            ))}
          </div>
        </article>
        <Link href="/operators/leaderboards" className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-3 text-xs font-black uppercase text-cyan-50">Back to leaderboard</Link>
        <Link href={`/operators/server?slug=${profile.linkedServerSlug}`} className="rounded-lg border border-emerald-300/25 bg-emerald-300/10 p-3 text-xs font-black uppercase text-emerald-50">Linked server dashboard</Link>
      </aside>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/24 p-3">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-black uppercase text-white">{value}</p>
    </div>
  );
}
