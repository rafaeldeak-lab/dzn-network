import type { Metadata } from "next";

import { FullOperatorStudio } from "@/components/operators/full-studio/full-operator-studio";
import { OperatorFeatureGuard } from "@/components/operators/operator-feature-guard";
import { OperatorStudio } from "@/components/operators/operator-studio";
import { SiteHeader } from "@/components/site-header";
import { getDznOperatorsFeatureFlags } from "@/lib/operators/feature-flags";

export const metadata: Metadata = {
  title: "DZN Character Studio | DZN Network",
  description: "Preview DZN Operator Loadouts and Operator Card presentation with cosmetic-only fairness guarantees.",
};

export default function OperatorsStudioPage() {
  const flags = getDznOperatorsFeatureFlags();

  return (
    <OperatorFeatureGuard enabled={flags.enabled}>
      <main className="min-h-screen overflow-x-hidden bg-[#02030a] text-zinc-100">
        <SiteHeader active="operators" returnTo="/operators/studio" />
        <section className="mx-auto max-w-7xl px-4 py-8">
          <div className="mb-6 rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">DZN Character Studio</p>
            <h1 className="mt-2 text-4xl font-black uppercase text-white">{flags.fullStudioEnabled ? "DZN Full Operator Customisation" : "DZN Operator Wardrobe"}</h1>
            <p className="mt-3 max-w-4xl text-sm font-bold leading-6 text-zinc-300">
              {flags.fullStudioEnabled
                ? "Build a procedural tactical DZN Operator with identity, wardrobe, weapons, powers, loadouts, and Operator Card presentation. Demo state is local and non-authoritative."
                : "Build and validate preview-only cosmetic loadouts. Free mode remains fully competitive with locked customization. Premium demo mode is local preview only and must never be treated as a real subscription."}
            </p>
          </div>
          {flags.fullStudioEnabled ? <FullOperatorStudio demoMode={flags.demoMode} /> : <OperatorStudio demoMode={flags.demoMode} />}
        </section>
      </main>
    </OperatorFeatureGuard>
  );
}
