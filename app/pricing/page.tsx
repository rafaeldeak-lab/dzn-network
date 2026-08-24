"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function PricingPage() {
  useEffect(() => {
    window.location.replace("/#pricing");
  }, []);

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#02030a] px-5 py-10 text-white">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_28%_24%,rgba(139,92,246,0.26),transparent_30%),radial-gradient(circle_at_72%_56%,rgba(14,165,233,0.2),transparent_32%),linear-gradient(180deg,rgba(2,3,10,0.28)_0%,rgba(2,3,10,0.92)_100%)]" />
      <section className="relative z-10 w-full max-w-xl rounded-lg border border-violet-300/35 bg-black/56 p-7 text-center shadow-[0_0_52px_rgba(139,92,246,0.24)] backdrop-blur-xl sm:p-9">
        <p className="text-xs font-black uppercase tracking-normal text-cyan-100">Pricing comparison</p>
        <h1 className="mt-3 text-3xl font-black uppercase text-white sm:text-5xl">Opening Starter vs Pro</h1>
        <p className="mt-4 text-sm leading-6 text-zinc-300 sm:text-base">
          Pricing now lives inside the homepage comparison window so new owners can review the trial-safe Starter path next to Pro.
        </p>
        <Link
          href="/#pricing"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-lg border border-violet-200/45 bg-violet-500 px-5 py-3 text-xs font-black uppercase text-white shadow-[0_0_36px_rgba(139,92,246,0.48)] transition hover:bg-violet-400"
        >
          Open Pricing Comparison
        </Link>
      </section>
    </main>
  );
}
