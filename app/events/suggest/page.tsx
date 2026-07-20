import Link from "next/link";

export default function SuggestCompetitionRoute() {
  return (
    <main className="min-h-screen bg-[#02030a] px-4 py-10 text-zinc-100">
      <section className="mx-auto max-w-3xl rounded-lg border border-white/10 bg-white/[0.035] p-6 shadow-[0_30px_110px_rgba(0,0,0,0.34)]">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">Competition Suggestions</p>
        <h1 className="mt-2 text-3xl font-black uppercase text-white">Community suggestions are coming soon</h1>
        <p className="mt-4 text-sm leading-6 text-zinc-300">
          Community competition suggestions are coming soon. Official DZN events are created and published by the DZN platform creator.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/events" className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-xs font-black uppercase text-cyan-50 hover:bg-cyan-300/20">
            View events
          </Link>
          <Link href="/servers" className="rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-xs font-black uppercase text-zinc-300 hover:text-white">
            Browse servers
          </Link>
        </div>
      </section>
    </main>
  );
}
