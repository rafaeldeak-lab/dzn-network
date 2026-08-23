type SkeletonProps = {
  className?: string;
  label?: string;
};

function skeletonClass(className = "") {
  return `dzn-skeleton ${className}`.trim();
}

export function TextSkeleton({ className = "h-4 w-32", label }: SkeletonProps) {
  return <span aria-label={label} className={skeletonClass(className)} />;
}

export function CardSkeleton({ className = "min-h-40", label = "Loading card" }: SkeletonProps) {
  return (
    <div aria-busy="true" aria-label={label} className={`rounded-lg border border-white/10 bg-white/[0.035] p-4 ${className}`}>
      <TextSkeleton className="h-3 w-24" />
      <TextSkeleton className="mt-4 h-7 w-3/5" />
      <TextSkeleton className="mt-3 h-4 w-full" />
      <TextSkeleton className="mt-2 h-4 w-4/5" />
      <div className="mt-5 grid grid-cols-3 gap-2">
        <TextSkeleton className="h-9 w-full" />
        <TextSkeleton className="h-9 w-full" />
        <TextSkeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="grid min-h-14 items-center gap-3 border-b border-white/8 px-3 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Array.from({ length: columns }).map((_, index) => <TextSkeleton key={index} className="h-4 w-full" />)}
    </div>
  );
}

export function ServerCardSkeleton() {
  return (
    <div aria-busy="true" className="flex min-h-28 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <TextSkeleton className="h-14 w-14 shrink-0" />
      <div className="min-w-0 flex-1">
        <TextSkeleton className="h-5 w-3/4" />
        <TextSkeleton className="mt-3 h-4 w-1/2" />
        <TextSkeleton className="mt-3 h-3 w-full" />
      </div>
    </div>
  );
}

export function EventCardSkeleton() {
  return <CardSkeleton className="min-h-52" label="Loading event card" />;
}

export function LeaderboardSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading leaderboard" className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <TextSkeleton className="h-6 w-48" />
      <div className="mt-4 overflow-hidden rounded-lg border border-white/8">
        {Array.from({ length: 6 }).map((_, index) => <TableRowSkeleton key={index} columns={4} />)}
      </div>
    </section>
  );
}

export function OwnerPanelSkeleton() {
  return (
    <main aria-busy="true" className="min-h-screen bg-[#02030a] px-4 py-6 text-zinc-100">
      <div className="mx-auto grid max-w-6xl gap-4">
        <CardSkeleton className="min-h-44" label="Loading owner panel" />
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </main>
  );
}

export function SuggestionsBoardSkeleton() {
  return (
    <main aria-busy="true" className="min-h-screen bg-[#02030a] px-4 py-8 text-zinc-100">
      <div className="mx-auto grid max-w-6xl gap-5">
        <CardSkeleton className="min-h-48" label="Loading suggestions header" />
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="grid gap-3">
            {Array.from({ length: 4 }).map((_, index) => <EventCardSkeleton key={index} />)}
          </div>
          <CardSkeleton className="min-h-96" label="Loading suggestion form" />
        </div>
      </div>
    </main>
  );
}

export function PublicRouteSkeleton({ variant = "events" }: { variant?: "events" | "servers" | "leaderboards" | "pulse" }) {
  const cards = variant === "leaderboards" ? 1 : variant === "servers" ? 6 : 4;
  return (
    <main aria-busy="true" className="min-h-screen bg-[#02030a] px-4 py-8 text-zinc-100">
      <div className="mx-auto grid max-w-7xl gap-5">
        <CardSkeleton className="min-h-56" label={`Loading ${variant} header`} />
        {variant === "leaderboards" ? (
          <LeaderboardSkeleton />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: cards }).map((_, index) => variant === "servers" ? <ServerCardSkeleton key={index} /> : <EventCardSkeleton key={index} />)}
          </div>
        )}
      </div>
    </main>
  );
}
