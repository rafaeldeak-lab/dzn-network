"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { DznLogo } from "@/components/dzn/dzn-logo";

export function AuthShell({
  title,
  description,
  actionLabel = "Login with Discord",
  authStartHref = "/api/auth/discord/start",
  resolveAuthMode = false,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  authStartHref?: string;
  resolveAuthMode?: boolean;
}) {
  const [startHref, setStartHref] = useState(authStartHref);

  useEffect(() => {
    if (!resolveAuthMode) return;

    let active = true;
    fetch("/api/auth/mode", { cache: "no-store", credentials: "include" })
      .then((response) => response.json() as Promise<{ mockAuth?: boolean }>)
      .then((data) => {
        if (!active) return;
        setStartHref(data.mockAuth ? "/api/auth/mock/start" : "/api/auth/discord/start");
      })
      .catch(() => null);

    return () => {
      active = false;
    };
  }, [resolveAuthMode]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-5 py-8 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(139,92,246,0.28),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.16),transparent_28%),linear-gradient(180deg,#02030a_0%,#07101f_52%,#02030a_100%)]" />
      <div className="scanline absolute inset-0 opacity-20" />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col">
        <nav className="flex items-center justify-between">
          <DznLogo />
          <Link
            href="/"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/40 hover:bg-violet-400/10"
          >
            Home
          </Link>
        </nav>
        <section className="grid flex-1 items-center gap-10 py-16 lg:grid-cols-[0.9fr_1.1fr]">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: "easeOut" }}
          >
            <div className="mb-6 inline-flex items-center gap-3 text-sm font-bold text-violet-100/80">
              <ShieldCheck className="h-5 w-5" />
              Owner verification
            </div>
            <h1 className="text-4xl font-black uppercase leading-tight sm:text-6xl">
              {title}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-300">
              {description}
            </p>
            <a
              href={startHref}
              className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-violet-500 px-5 text-xs font-black uppercase text-white shadow-[0_0_34px_rgba(139,92,246,0.55)] transition hover:bg-violet-400"
            >
              {actionLabel}
              <ArrowRight className="h-4 w-4" />
            </a>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.1, ease: "easeOut" }}
            className="glass-surface animated-border rounded-lg p-6"
          >
            <div className="relative z-10 space-y-4">
              {[
                "Discord owner/admin guild selection",
                "Nitrado token validation server-side only",
                "Encrypted Nitrado token storage in Cloudflare D1",
                "DayZ service detection before go-live",
              ].map((item) => (
                <div key={item} className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <p className="text-sm font-bold text-zinc-100">{item}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </section>
      </div>
    </main>
  );
}
