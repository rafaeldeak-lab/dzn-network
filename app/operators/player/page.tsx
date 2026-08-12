import type { Metadata } from "next";
import { Suspense } from "react";

import { OperatorPlayerProfile } from "@/components/operators/engagement/operator-player-profile";
import { OperatorFeatureGuard } from "@/components/operators/operator-feature-guard";
import { SiteHeader } from "@/components/site-header";
import { getDznOperatorsFeatureFlags } from "@/lib/operators/feature-flags";

export const metadata: Metadata = {
  title: "DZN Operator Player Profile | DZN Network",
  description: "Static-safe public DZN Operator player profile preview with privacy-safe aggregate data.",
};

export default function OperatorsPlayerRoute() {
  const flags = getDznOperatorsFeatureFlags();

  return (
    <OperatorFeatureGuard enabled={flags.enabled && flags.engagementEnabled}>
      <main className="min-h-screen overflow-x-hidden bg-[#02030a] text-zinc-100">
        <SiteHeader active="operators" returnTo="/operators/player" />
        <Suspense fallback={<QueryPageFallback title="Loading Operator profile" />}>
          <OperatorPlayerProfile />
        </Suspense>
      </main>
    </OperatorFeatureGuard>
  );
}

function QueryPageFallback({ title }: { title: string }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <div className="h-96 rounded-lg border border-white/10 bg-white/[0.035] p-5">
        <p className="text-xs font-black uppercase text-cyan-200">{title}</p>
      </div>
    </section>
  );
}
