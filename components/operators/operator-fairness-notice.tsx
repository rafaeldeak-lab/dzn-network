import { Scale, ShieldCheck } from "lucide-react";

export function OperatorFairnessNotice() {
  const guarantees = [
    "Full competition participation",
    "Normal leaderboards and public stats",
    "No rank, score, vote, seed, reward, or matchmaking modifier",
  ];

  return (
    <section className="rounded-lg border border-emerald-300/18 bg-emerald-300/[0.055] p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-emerald-300/22 bg-emerald-300/10 text-emerald-100">
          <Scale aria-hidden="true" size={20} />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">Fairness lock</p>
          <h2 className="mt-1 text-xl font-black uppercase text-white">Cosmetic only - no competitive advantage</h2>
          <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-zinc-300">
            DZN Operators are presentation and identity only. Premium cosmetics never alter competition score, K/D, event points,
            eligibility, votes, rankings, seeding, tournament slots, server enrollment priority, matchmaking, rewards, telemetry,
            verification confidence, score multipliers, or server publicity scoring.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {guarantees.map((guarantee) => (
          <div key={guarantee} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-xs font-black uppercase text-zinc-100">
            <ShieldCheck className="shrink-0 text-emerald-200" size={16} aria-hidden="true" />
            <span>{guarantee}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
