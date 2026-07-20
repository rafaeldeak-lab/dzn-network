import { Suspense } from "react";

import { OwnerEventsPage } from "@/components/owner/owner-events-page";

export default function OwnerEventsCreateRoute() {
  return (
    <Suspense fallback={<OwnerEventsCreateFallback />}>
      <OwnerEventsPage mode="create" />
    </Suspense>
  );
}

function OwnerEventsCreateFallback() {
  return <main className="min-h-screen bg-[#02030a]" />;
}
