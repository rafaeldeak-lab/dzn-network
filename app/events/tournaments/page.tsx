import { Suspense } from "react";

import { EventsTournamentsPage } from "@/components/events/events-platform";

export default function TournamentsPage() {
  return (
    <Suspense fallback={<EventsFallback />}>
      <EventsTournamentsPage />
    </Suspense>
  );
}

function EventsFallback() {
  return <main className="min-h-screen bg-[#02030a]" />;
}
