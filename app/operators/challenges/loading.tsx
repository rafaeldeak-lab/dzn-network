export default function OperatorsChallengesLoading() {
  return (
    <main className="min-h-screen bg-[#02030a] px-4 py-8 text-zinc-100">
      <div className="mx-auto grid max-w-7xl gap-5">
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="h-3 w-44 rounded bg-orange-300/20" />
          <div className="mt-4 h-10 w-3/4 rounded bg-white/10" />
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-12 rounded-lg bg-white/10" />)}
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-56 rounded-lg border border-white/10 bg-white/[0.035]" />)}
        </div>
      </div>
    </main>
  );
}
