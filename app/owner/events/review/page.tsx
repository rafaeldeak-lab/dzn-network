import { Suspense } from "react";

import { OwnerEventDraftReviewPage } from "@/components/owner/owner-event-draft-review-page";
import { OwnerPanelSkeleton } from "@/components/ui/loading-skeletons";

export default function OwnerEventsReviewRoute() {
  return (
    <Suspense fallback={<OwnerPanelSkeleton />}>
      <OwnerEventDraftReviewPage />
    </Suspense>
  );
}
