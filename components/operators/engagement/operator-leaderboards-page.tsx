"use client";

import Link from "next/link";
import { useState } from "react";

import { OperatorProgressBar } from "@/components/operators/engagement/operator-progress-bar";
import { OperatorRankEmblem } from "@/components/operators/engagement/operator-rank-emblem";
import { OperatorResetCountdown } from "@/components/operators/engagement/operator-reset-countdown";
import { OperatorSectionNav } from "@/components/operators/engagement/operator-section-nav";
import { getDemoLeaderboardRows, OPERATOR_DEMO_NOW } from "@/lib/operators/engagement/demo-data";
import { getOperatorRankForXp } from "@/lib/operators/engagement/ranks";
import { getNextOperatorSeasonReset, getNextOperatorWeeklyReset } from "@/lib/operators/engagement/reset-windows";
import type { OperatorLeaderboardPeriod } from "@/lib/operators/engagement/types";

const periods: OperatorLeaderboardPeriod[] = ["weekly", "monthly", "seasonal", "all_time"];

export function OperatorLeaderboardsPage() {
  const [period, setPeriod] = useState<OperatorLeaderboardPeriod>("weekly");
  const rows = getDemoLeaderboardRows(period);
  const current = rows.find((row) => row.highlighted);
  const serverRows = rows
    .reduce((acc, row) => {
      const existing = acc.find((entry) => entry.slug === row.linkedServerSlug);
      if (existing) {
        existing.xp += row.xp;
        existing.members += 1;
      } else {
        acc.push({ slug: row.linkedServerSlug, name: row.linkedServerName, xp: row.xp, members: 1 });
      }
      return acc;
    }, [] as Array<{ slug: string; name: string; xp: number; members: number }>)
    .sort((left, right) => right.xp - left.xp)
    .map((row, index) => ({ ...row, position: index + 1 }));

  return (
    <>
      <OperatorSectionNav engagementEnabled />
      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-8">
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">DZN Operator Leaderboards</p>
          <h1 className="mt-2 text-4xl font-black uppercase text-white">Preview standings, cosmetic spotlight only</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-zinc-300">
            Preview data - not live network standings. Top Operators are featured in the weekly DZN Spotlight with no competitive advantage.
          </p>
          <div className="mt-4 flex gap-2 overflow-x-auto" role="tablist" aria-label="Leaderboard periods">
            {periods.map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={period === entry}
                onClick={() => setPeriod(entry)}
                className={`min-h-11 shrink-0 rounded-lg px-4 text-xs font-black uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                  period === entry ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-black/24 text-zinc-200"
                }`}
              >
                {entry.replace("_", " ")}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <OperatorResetCountdown label="Leaderboard reset/end" resetAt={period === "seasonal" ? getNextOperatorSeasonReset(OPERATOR_DEMO_NOW) : getNextOperatorWeeklyReset(OPERATOR_DEMO_NOW)} />
          </div>
        </div>

        {current ? (
          <article className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.055] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">Current player position</p>
            <h2 className="mt-1 text-2xl font-black uppercase text-white">#{current.position} {current.displayName}</h2>
            <OperatorProgressBar value={current.xp} max={rows[0]?.xp ?? current.xp} label="Compared with top Operator" accent="emerald" />
          </article>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <h2 className="text-2xl font-black uppercase text-white">Player Operator XP</h2>
            <div className="mt-4 grid gap-3" role="list" aria-label="Player Operator leaderboard rows">
              {rows.map((row) => {
                const rank = getOperatorRankForXp(row.xp);
                return (
                  <Link
                    key={row.id}
                    href={`/operators/player?id=${row.id}`}
                    className={`grid gap-3 rounded-lg border p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 sm:grid-cols-[70px_1fr_auto] sm:items-center ${
                      row.highlighted ? "border-emerald-300/30 bg-emerald-300/10" : row.position <= 3 ? "border-cyan-300/22 bg-cyan-300/[0.06]" : "border-white/10 bg-black/24"
                    }`}
                  >
                    <div className="text-2xl font-black text-white">#{row.position}</div>
                    <div className="flex items-center gap-3">
                      <OperatorRankEmblem label={rank.displayName} level={rank.level} active={row.position <= 3} />
                      <div>
                        <p className="text-sm font-black uppercase text-white">{row.displayName}</p>
                        <p className="text-xs font-bold text-zinc-400">{row.operatorCardLabel} - {rank.displayName}</p>
                      </div>
                    </div>
                    <div className="text-right text-sm font-black uppercase text-cyan-100">{row.xp.toLocaleString()} XP</div>
                  </Link>
                );
              })}
            </div>
          </article>

          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <h2 className="text-2xl font-black uppercase text-white">Server Community Operators</h2>
            <div className="mt-4 grid gap-3" role="list" aria-label="Server community Operator leaderboard rows">
              {serverRows.map((row) => (
                <Link key={row.slug} href={`/operators/server?slug=${row.slug}`} className="rounded-lg border border-white/10 bg-black/24 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-lg font-black uppercase text-white">#{row.position} {row.name}</p>
                    <p className="text-xs font-black uppercase text-emerald-100">{row.members} operators</p>
                  </div>
                  <div className="mt-3">
                    <OperatorProgressBar value={row.xp} max={serverRows[0]?.xp ?? row.xp} label={`${row.xp.toLocaleString()} community XP`} accent="emerald" />
                  </div>
                </Link>
              ))}
            </div>
          </article>
        </section>
      </section>
    </>
  );
}
