import { FlaskConical, Wrench } from "lucide-react";

/**
 * A deliberately non-dismissible, low-height status notice for the public beta.
 * Keeping it in the root layout makes the maturity of the network clear even when
 * someone lands on a deep page from a shared link.
 */
export function BetaStatusBanner() {
  return (
    <aside
      aria-label="DZN Network beta status"
      className="relative z-30 border-y border-cyan-300/16 bg-[#06111c]/95 px-4 py-2 text-center shadow-[0_8px_30px_rgba(0,0,0,0.22)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-200 sm:text-xs">
        <span className="inline-flex items-center gap-1.5 font-black uppercase tracking-[0.14em] text-cyan-100">
          <FlaskConical aria-hidden="true" className="h-3.5 w-3.5" />
          DZN beta
        </span>
        <span className="hidden h-3 w-px bg-white/15 sm:block" aria-hidden="true" />
        <span>
          Regular improvements and bug fixes are being shipped while the network, competition tools, and connected-server data mature.
        </span>
        <span className="inline-flex items-center gap-1.5 text-cyan-100/90">
          <Wrench aria-hidden="true" className="h-3.5 w-3.5" />
          Live results appear only after they are verified.
        </span>
      </div>
    </aside>
  );
}
