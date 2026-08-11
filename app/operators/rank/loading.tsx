export default function OperatorsRankLoading() {
  return (
    <main className="min-h-screen bg-[#02030a] px-4 py-8 text-zinc-100">
      <div className="mx-auto grid max-w-7xl gap-5">
        <div className="h-48 rounded-lg border border-cyan-300/18 bg-cyan-300/[0.045]" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, index) => <div key={index} className="h-40 rounded-lg border border-white/10 bg-white/[0.035]" />)}
        </div>
      </div>
    </main>
  );
}
