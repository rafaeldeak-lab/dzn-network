import type { Metadata } from "next";

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
      <OperatorHub demoMode={flags.demoMode} />
    </OperatorFeatureGuard>
  );
}
