export default function OperatorsLoading() {
  return (
    <main className="min-h-screen bg-[#02030a] px-4 py-8 text-zinc-100">
      <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-6">
          <div className="h-3 w-36 rounded bg-cyan-300/20" />
          <div className="mt-5 h-14 w-3/4 rounded bg-white/10" />
          <div className="mt-4 h-4 w-full rounded bg-white/10" />
          <div className="mt-2 h-4 w-2/3 rounded bg-white/10" />
          <div className="mt-6 h-12 w-44 rounded-lg bg-cyan-300/20" />
        </div>
        <div className="h-96 rounded-lg border border-white/10 bg-white/[0.035]" />
      </div>
    </main>
  );
}
