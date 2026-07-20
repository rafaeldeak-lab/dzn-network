import { Suspense } from "react";

import { OwnerEventsPage } from "@/components/owner/owner-events-page";

export default function OwnerEventsRoute() {
  return (
    <Suspense fallback={<OwnerEventsFallback />}>
      <OwnerEventsPage />
    </Suspense>
  );
}

function OwnerEventsFallback() {
  return <main className="min-h-screen bg-[#02030a]" />;
}
