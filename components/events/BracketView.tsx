import { Crown, Trophy } from "lucide-react";

import type { EventMatch } from "./event-data";
import { cn } from "./event-format";
import { ServerCategoryBadge } from "./ServerCategoryBadge";

export function BracketView({ matches, category, categoryLabel }: { matches: EventMatch[]; category: string; categoryLabel: string }) {
  const rounds = [1, 2, 3].map((round) => matches.filter((match) => match.round_number === round));
  const champion = matches.find((match) => match.round_number === 3 && match.winner_name)?.winner_name
    ?? matches.find((match) => match.winner_name)?.winner_name
    ?? "TBD";
  return (
    <section className="rounded-lg border border-white/10 bg-[#050915]/90 p-4 shadow-[0_22px_90px_rgba(0,0,0,0.34)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black uppercase text-white">Tournament Bracket</h2>
          <p className="mt-1 text-xs text-zinc-500">All visible pairings are locked to the same canonical server category.</p>
        </div>
        <ServerCategoryBadge category={category} label={categoryLabel} />
      </div>
      {matches.length ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr_1fr_220px]">
          {rounds.map((roundMatches, index) => (
            <div key={index} className="space-y-4">
              <div className="text-[10px] font-black uppercase text-zinc-500">{index === 0 ? "Quarter Finals" : index === 1 ? "Semi Finals" : "Finals"}</div>
              {(roundMatches.length ? roundMatches : [null]).map((match, matchIndex) => match ? (
                <BracketMatch key={match.id} match={match} />
              ) : (
                <div key={matchIndex} className="rounded-lg border border-dashed border-white/10 bg-white/[0.025] p-4 text-xs text-zinc-500">Awaiting same-category match.</div>
              ))}
            </div>
          ))}
          <div className="rounded-lg border border-amber-300/28 bg-amber-400/10 p-4 text-center">
            <Trophy className="mx-auto h-10 w-10 text-amber-200" />
            <div className="mt-4 text-[10px] font-black uppercase text-amber-100">Grand Champion</div>
            <div className="mt-1 text-lg font-black uppercase text-white">{champion}</div>
            <div className="mt-4 rounded-md border border-white/10 bg-black/24 p-3 text-xs text-zinc-400">Bracket is category-safe and generated after registration closes.</div>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-violet-300/24 bg-violet-500/8 p-8 text-center">
          <Crown className="mx-auto h-8 w-8 text-violet-200" />
          <h3 className="mt-3 text-lg font-black uppercase text-white">Bracket is being generated once registration closes.</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-400">DZN will only generate same-category pairings for this event.</p>
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-3 text-[10px] font-black uppercase text-zinc-500">
        <Legend color="violet" label="Current match" />
        <Legend color="emerald" label="Round complete" />
        <Legend color="zinc" label="Upcoming match" />
      </div>
    </section>
  );
}

function BracketMatch({ match }: { match: EventMatch }) {
  return (
    <div className={cn("rounded-lg border p-3", match.match_status === "live" ? "border-violet-300/36 bg-violet-500/12" : match.match_status === "completed" ? "border-emerald-300/24 bg-emerald-500/8" : "border-white/10 bg-white/[0.03]")}>
      <BracketTeam name={match.left_server.server_name} score={match.left_score} winner={match.winner_server_id === match.left_server.server_id} />
      <div className="my-2 h-px bg-white/10" />
      <BracketTeam name={match.right_server.server_name} score={match.right_score} winner={match.winner_server_id === match.right_server.server_id} />
    </div>
  );
}

function BracketTeam({ name, score, winner }: { name: string; score: number; winner: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn("truncate text-xs font-bold", winner ? "text-white" : "text-zinc-400")}>{name}</span>
      <span className={cn("font-mono text-sm font-black", winner ? "text-amber-100" : "text-zinc-500")}>{score}</span>
    </div>
  );
}

function Legend({ color, label }: { color: "violet" | "emerald" | "zinc"; label: string }) {
  return <span className="inline-flex items-center gap-2"><span className={cn("h-2 w-2 rounded-full", color === "violet" && "bg-violet-300", color === "emerald" && "bg-emerald-300", color === "zinc" && "bg-zinc-500")} />{label}</span>;
}
