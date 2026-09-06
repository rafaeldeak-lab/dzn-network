import { Suspense } from "react";

import { PlayerGameIdentityClaimsPage } from "@/components/owner/player-game-identity-claims-page";
import { OwnerPanelSkeleton } from "@/components/ui/loading-skeletons";

export default function OwnerPlayerGameIdentityClaimsRoute() {
  return (
    <Suspense fallback={<OwnerPanelSkeleton />}>
      <PlayerGameIdentityClaimsPage />
    </Suspense>
  );
}
