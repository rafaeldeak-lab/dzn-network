import { Suspense } from "react";

import { OwnerEventsPage } from "@/components/owner/owner-events-page";
import { OwnerPanelSkeleton } from "@/components/ui/loading-skeletons";

export default function OwnerEventsCreateRoute() {
  return (
    <Suspense fallback={<OwnerPanelSkeleton />}>
      <OwnerEventsPage mode="create" />
    </Suspense>
  );
}
