import type { Metadata } from "next";

import { OperatorLeaderboardsPage } from "@/components/operators/engagement/operator-leaderboards-page";
import { OperatorFeatureGuard } from "@/components/operators/operator-feature-guard";
import { SiteHeader } from "@/components/site-header";
import { getDznOperatorsFeatureFlags } from "@/lib/operators/feature-flags";

export const metadata: Metadata = {
  title: "DZN Operator Leaderboards | DZN Network",
  description: "Preview DZN Operator weekly, monthly, seasonal, and all-time leaderboards.",
};

export default function OperatorsLeaderboardsRoute() {
  const flags = getDznOperatorsFeatureFlags();

  return (
    <OperatorFeatureGuard enabled={flags.enabled && flags.engagementEnabled}>
      <main className="min-h-screen bg-[#02030a] text-zinc-100">
        <SiteHeader active="operators" returnTo="/operators/leaderboards" />
        <OperatorLeaderboardsPage />
      </main>
    </OperatorFeatureGuard>
  );
}
