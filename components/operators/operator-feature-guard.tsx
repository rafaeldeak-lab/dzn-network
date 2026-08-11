import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

type OperatorFeatureGuardProps = {
  enabled: boolean;
  children: ReactNode;
};

export function OperatorFeatureGuard({ enabled, children }: OperatorFeatureGuardProps) {
  if (enabled) return <>{children}</>;

  return (
    <main className="min-h-screen bg-[#02030a] px-4 py-8 text-zinc-100">
      <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center">
        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-6 shadow-[0_24px_70px_rgba(0,0,0,.38)]">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
              <ShieldAlert aria-hidden="true" size={24} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Feature flag disabled</p>
              <h1 className="mt-2 text-3xl font-black uppercase text-white">DZN Operators are not enabled in this environment</h1>
              <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-zinc-300">
                The route is intentionally hidden from navigation unless NEXT_PUBLIC_DZN_OPERATORS_ENABLED is exactly true.
                No subscription, purchase, operator state, or competition data was changed.
              </p>
              <Link href="/" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg border border-cyan-300/24 bg-cyan-300/10 px-4 text-xs font-black uppercase text-cyan-50 transition hover:bg-cyan-300/18 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200">
                Return to DZN
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
