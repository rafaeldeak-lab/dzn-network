import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

export function OperatorWebglFallback({ loadout }: { loadout: FullOperatorLoadout }) {
  return (
    <div
      className="grid min-h-[32rem] place-items-center rounded-lg border border-emerald-300/20 bg-[radial-gradient(circle_at_50%_20%,rgba(34,197,94,.16),transparent_35%),linear-gradient(180deg,#06121c,#02030a)] p-6 text-center"
      role="img"
      aria-label={`${loadout.displayName} non-WebGL tactical Operator fallback`}
    >
      <div className="max-w-sm">
        <div className="mx-auto h-72 w-32 rounded-t-[48px] border border-cyan-300/28 bg-[linear-gradient(180deg,#1f2937,#020617)] shadow-[0_0_60px_rgba(34,211,238,.2)]">
          <div className="mx-auto mt-5 h-16 w-16 rounded-full bg-[#b77955]" />
          <div className="mx-auto mt-4 h-24 w-24 rounded-lg border border-emerald-300/22 bg-emerald-300/15" />
          <div className="mx-auto mt-3 h-3 w-28 rounded-full bg-cyan-300/80" />
        </div>
        <h2 className="mt-5 text-xl font-black uppercase text-white">{loadout.displayName}</h2>
        <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">
          WebGL is unavailable. The full Operator remains accessible through item lists, loadout summaries, and the Operator Card.
        </p>
      </div>
    </div>
  );
}
