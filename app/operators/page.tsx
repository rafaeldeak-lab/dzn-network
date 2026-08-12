import type { Metadata } from "next";

import { OperatorEngagementDashboard } from "@/components/operators/engagement/operator-engagement-dashboard";
import { FullOperatorDashboard } from "@/components/operators/full-studio/full-operator-dashboard";
import { OperatorFeatureGuard } from "@/components/operators/operator-feature-guard";
import { OperatorHub } from "@/components/operators/operator-hub";
import { getDznOperatorsFeatureFlags } from "@/lib/operators/feature-flags";

export const metadata: Metadata = {
  title: "DZN Operators | DZN Network",
  description: "DZN Operators cosmetic identity foundation for profile, event, season, and leaderboard presentation.",
};

export default function OperatorsPage() {
  const flags = getDznOperatorsFeatureFlags();

  return (
    <OperatorFeatureGuard enabled={flags.enabled}>
      {flags.fullStudioEnabled ? (
        <FullOperatorDashboard demoMode={flags.demoMode} />
      ) : flags.engagementEnabled ? (
        <OperatorEngagementDashboard demoMode={flags.demoMode} />
      ) : (
        <OperatorHub demoMode={flags.demoMode} />
      )}
    </OperatorFeatureGuard>
  );
}
