import type { Metadata } from "next";

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
      <main className="min-h-screen bg-[#02030a] text-zinc-100">
        <SiteHeader active="operators" returnTo="/operators/studio" />
        <section className="mx-auto max-w-7xl px-4 py-8">
          <div className="mb-6 rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">DZN Character Studio</p>
            <h1 className="mt-2 text-4xl font-black uppercase text-white">DZN Operator Wardrobe</h1>
            <p className="mt-3 max-w-4xl text-sm font-bold leading-6 text-zinc-300">
              Build and validate preview-only cosmetic loadouts. Free mode remains fully competitive with locked customization. Premium
              demo mode is local preview only and must never be treated as a real subscription.
            </p>
          </div>
          <OperatorStudio demoMode={flags.demoMode} />
        </section>
      </main>
    </OperatorFeatureGuard>
  );
}
