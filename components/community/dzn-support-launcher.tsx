"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { Bot, CalendarDays, LifeBuoy, Link2, Lock, MessageCircle, Send, ShieldCheck, X } from "lucide-react";

const hiddenLauncherPrefixes = ["/community", "/dashboard/admin"] as const;

const launcherPrompts = [
  { label: "Setup help", icon: ShieldCheck, detail: "Owner setup and plan route guidance." },
  { label: "Server linking", icon: Link2, detail: "Public help before owner-only setup steps." },
  { label: "Event guides", icon: CalendarDays, detail: "Where to find events and tournaments." },
] as const;

export function DznSupportLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const safeReturnTo = useMemo(() => safePathname(pathname), [pathname]);

  if (hiddenLauncherPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return null;
  }

  return (
    <aside
      className="fixed right-4 z-[65] w-[min(calc(100vw-2rem),360px)] text-white sm:right-5"
      style={{ bottom: "calc(var(--dzn-beta-ticker-height, 0px) + 1rem)" }}
      aria-label="DZN Assist static support launcher"
      data-dzn-support-launcher="static-local-preview"
    >
      {open ? (
        <section className="overflow-hidden rounded-lg border border-cyan-300/30 bg-slate-950/92 shadow-[0_22px_88px_rgba(0,0,0,0.46),0_0_42px_rgba(34,211,238,0.14)] backdrop-blur-xl">
          <header className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-black uppercase text-white">
                <Bot className="h-5 w-5 text-cyan-100" aria-hidden="true" />
                DZN Assist
              </p>
              <p className="mt-1 text-[11px] font-black uppercase text-cyan-100">Website support only</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:border-cyan-300/30 hover:text-white"
              aria-label="Close DZN Assist preview"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div className="p-4">
            <p className="text-sm font-semibold leading-6 text-zinc-300">
              Static support preview. No message is sent, no history is stored, no analytics are called, and no AI provider is connected.
            </p>
            <div className="mt-4 grid gap-2">
              {launcherPrompts.map((prompt) => {
                const Icon = prompt.icon;
                return (
                  <button
                    key={prompt.label}
                    type="button"
                    disabled
                    className="flex min-h-14 cursor-not-allowed items-center gap-3 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-left opacity-75"
                    title="Support actions are disabled in the static DZN Assist prototype."
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-cyan-300/24 bg-cyan-400/10 text-cyan-100">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-black uppercase text-zinc-100">{prompt.label}</span>
                      <span className="mt-0.5 block text-xs font-semibold leading-5 text-zinc-500">{prompt.detail}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_42px] overflow-hidden rounded border border-white/10 bg-black/40">
              <input
                disabled
                value=""
                onChange={() => undefined}
                aria-describedby="dzn-assist-launcher-disabled"
                placeholder="Ask about DZN..."
                className="h-11 min-w-0 bg-transparent px-3 text-sm font-semibold text-zinc-400 outline-none placeholder:text-zinc-500"
              />
              <button type="button" disabled className="grid h-11 cursor-not-allowed place-items-center border-l border-white/10 text-cyan-200 opacity-60" aria-label="DZN Assist send disabled">
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p id="dzn-assist-launcher-disabled" className="mt-2 text-xs font-semibold leading-5 text-zinc-500">
              Support composer disabled in this prototype. Account-specific help will require login in a later approved runtime slice.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Link href={`/login?returnTo=${encodeURIComponent(safeReturnTo)}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-cyan-300/30 bg-cyan-400/10 px-3 text-xs font-black uppercase text-cyan-100 transition hover:bg-cyan-400/16">
                <Lock className="h-4 w-4" aria-hidden="true" />
                Login
              </Link>
              <Link href="/community" className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-violet-300/30 bg-violet-400/10 px-3 text-xs font-black uppercase text-violet-100 transition hover:bg-violet-400/16">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                DZN Comms
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto flex min-h-14 max-w-full items-center gap-3 rounded-lg border border-cyan-300/32 bg-slate-950/88 px-4 py-3 text-left shadow-[0_18px_70px_rgba(0,0,0,0.38),0_0_34px_rgba(34,211,238,0.14)] backdrop-blur-xl transition hover:border-cyan-200/60 hover:bg-cyan-950/82"
          aria-label="Open DZN Assist static support preview"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded border border-cyan-300/30 bg-cyan-400/12 text-cyan-100">
            <LifeBuoy className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-black uppercase text-white">DZN Assist</span>
            <span className="mt-0.5 block truncate text-[11px] font-semibold text-cyan-100">Static support preview</span>
          </span>
        </button>
      )}
    </aside>
  );
}

function safePathname(pathname: string | null) {
  if (!pathname || !pathname.startsWith("/") || pathname.startsWith("//")) return "/";
  return pathname;
}
