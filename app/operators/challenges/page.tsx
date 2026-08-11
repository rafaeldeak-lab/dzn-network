import type { Metadata } from "next";

import { OperatorChallengesPage } from "@/components/operators/engagement/operator-challenges-page";
import { OperatorFeatureGuard } from "@/components/operators/operator-feature-guard";
import { SiteHeader } from "@/components/site-header";
import { getDznOperatorsFeatureFlags } from "@/lib/operators/feature-flags";

export const metadata: Metadata = {
  title: "DZN Operator Challenges | DZN Network",
  description: "Daily, weekly, seasonal, and server community DZN Operator challenges with fixed cosmetic rewards.",
};

export default function OperatorsChallengesRoute() {
  const flags = getDznOperatorsFeatureFlags();

  return (
    <OperatorFeatureGuard enabled={flags.enabled && flags.engagementEnabled}>
      <main className="min-h-screen bg-[#02030a] text-zinc-100">
        <SiteHeader active="operators" returnTo="/operators/challenges" />
        <OperatorChallengesPage demoMode={flags.demoMode} />
      </main>
    </OperatorFeatureGuard>
  );
}
