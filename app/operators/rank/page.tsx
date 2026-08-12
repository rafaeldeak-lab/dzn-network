import type { Metadata } from "next";

import { OperatorRankPage } from "@/components/operators/engagement/operator-rank-page";
import { OperatorFeatureGuard } from "@/components/operators/operator-feature-guard";
import { SiteHeader } from "@/components/site-header";
import { getDznOperatorsFeatureFlags } from "@/lib/operators/feature-flags";

export const metadata: Metadata = {
  title: "DZN Operator Rank | DZN Network",
  description: "DZN Operator XP, rank ladder, fixed rank rewards, and cosmetic-only progression.",
};

export default function OperatorsRankRoute() {
  const flags = getDznOperatorsFeatureFlags();

  return (
    <OperatorFeatureGuard enabled={flags.enabled && flags.engagementEnabled}>
      <main className="min-h-screen overflow-x-hidden bg-[#02030a] text-zinc-100">
        <SiteHeader active="operators" returnTo="/operators/rank" />
        <OperatorRankPage />
      </main>
    </OperatorFeatureGuard>
  );
}
