import { Flag, Trophy } from "lucide-react";

export function SeasonBanner() {
  return (
    <section className="rounded-lg border border-violet-300/22 bg-[linear-gradient(135deg,rgba(124,58,237,0.16),rgba(34,211,238,0.08)),rgba(2,6,23,0.86)] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase text-violet-100">
            <Trophy className="h-4 w-4" />
            DZN Season 1
          </div>
          <h2 className="mt-2 text-2xl font-black uppercase text-white">Same-category wars are live</h2>
          <p className="mt-1 text-sm text-zinc-400">Deathmatch fights Deathmatch. PvP fights PvP. No mixed-category competition.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/24 bg-cyan-400/10 px-4 py-3 text-xs font-black uppercase text-cyan-100">
          <Flag className="h-4 w-4" />
          Cross-server matching
        </div>
      </div>
    </section>
  );
}
