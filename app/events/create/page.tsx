import { Suspense } from "react";

import { EventCreatePage } from "@/components/events/events-platform";

export default function CreateEventRoute() {
  return (
    <Suspense fallback={<EventsCreateFallback />}>
      <EventCreatePage />
    </Suspense>
  );
}

function EventsCreateFallback() {
  return <main className="min-h-screen bg-[#02030a]" />;
}
