import Link from "next/link";
import type { ReactNode } from "react";

export function PolicyPage({ eyebrow, title, updated, children }: {
  eyebrow: string;
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#05070d] px-4 py-8 text-white sm:px-6 sm:py-12">
      <article className="mx-auto w-full max-w-4xl">
        <header className="border-b border-white/15 pb-7">
          <p className="text-xs font-black uppercase text-cyan-200">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-zinc-400">Last updated: {updated}</p>
        </header>
        <div className="policy-copy py-8 text-sm leading-7 text-zinc-300">{children}</div>
        <nav aria-label="DZN policies" className="flex flex-wrap gap-x-5 gap-y-3 border-t border-white/15 py-6 text-sm font-bold text-cyan-200">
          <Link href="/terms" className="underline underline-offset-4">Terms</Link>
          <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
          <Link href="/refunds" className="underline underline-offset-4">Cancellations and refunds</Link>
          <Link href="/pricing" className="underline underline-offset-4">Pricing</Link>
        </nav>
      </article>
    </main>
  );
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-white/10 py-6 first:pt-0 last:border-b-0">
      <h2 className="text-lg font-black text-white">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
