export default function OperatorsStudioLoading() {
  return (
    <main className="min-h-screen bg-[#02030a] px-4 py-8 text-zinc-100">
      <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="grid gap-5">
          <div className="h-[28rem] rounded-lg border border-white/10 bg-white/[0.035]" />
          <div className="h-72 rounded-lg border border-white/10 bg-white/[0.035]" />
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="h-3 w-48 rounded bg-cyan-300/20" />
          <div className="mt-4 h-9 w-72 rounded bg-white/10" />
          <div className="mt-6 flex gap-2 overflow-hidden">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-10 w-28 shrink-0 rounded-lg bg-white/10" />
            ))}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-36 rounded-lg bg-white/10" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
