import { Suspense } from "react";

import { TournamentDashboard } from "@/components/events/tournament-dashboard";

export default function RegisterEventPage() {
  return (
    <Suspense fallback={<RegisterEventFallback />}>
      <TournamentDashboard />
    </Suspense>
  );
}

function RegisterEventFallback() {
  return (
    <main className="min-h-screen bg-[#03050d] px-4 py-8 text-zinc-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="h-10 w-64 animate-pulse rounded bg-white/10" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
          <div className="h-64 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
        </div>
      </div>
    </main>
  );
}
