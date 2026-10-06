"use client";

import { Bot, ChevronRight, MessageCircle, MessagesSquare, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function DznCommsLauncher() {
  const pathname = usePathname() ?? "/";
  const disclosureRef = useRef<HTMLDetailsElement | null>(null);
  const didMountRef = useRef(false);

  function closeDisclosure() {
    const disclosure = disclosureRef.current;
    if (!disclosure) return;
    disclosure.open = false;
    disclosure.querySelector<HTMLElement>("summary")?.focus();
  }

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    disclosureRef.current?.removeAttribute("open");
  }, [pathname]);

  if (pathname.startsWith("/community")) return null;

  return (
    <details
      ref={disclosureRef}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDisclosure();
        }
      }}
      className="group fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex max-w-[calc(100vw-2rem)] flex-col-reverse items-end gap-2 md:right-auto md:left-[max(1rem,env(safe-area-inset-left))] md:items-start"
    >
      <summary
        aria-label="Chat and Help"
        title="Chat and Help"
        className="group flex h-12 min-w-12 list-none items-center justify-center gap-2 rounded-md border border-cyan-200/55 bg-[#07111f]/98 px-3 text-cyan-100 shadow-[0_0_0_3px_rgba(2,6,23,0.9),0_10px_28px_rgba(0,0,0,0.42),0_0_24px_rgba(34,211,238,0.24)] backdrop-blur-xl transition hover:border-white hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 [&::-webkit-details-marker]:hidden"
      >
        <MessagesSquare className="h-5 w-5 group-open:hidden" aria-hidden="true" />
        <X className="hidden h-5 w-5 group-open:block" aria-hidden="true" />
        <span className="text-left leading-none">
          <span className="block text-[0.7rem] font-black uppercase text-white">Chat &amp; Help</span>
          <span className="mt-1 block text-[0.62rem] font-bold uppercase text-cyan-200">Chat &amp; help</span>
        </span>
        <ChevronRight className="hidden h-4 w-4 text-cyan-300 transition md:block group-hover:translate-x-0.5 group-open:rotate-90" aria-hidden="true" />
      </summary>

      <div className="hidden group-open:block">
        <section
          id="dzn-comms-launcher-panel"
          aria-label="DZN Comms quick access"
          className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-cyan-300/30 bg-[#050914]/98 shadow-[0_18px_60px_rgba(0,0,0,0.58)] backdrop-blur-xl"
        >
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <MessagesSquare className="h-5 w-5 text-cyan-200" aria-hidden="true" />
              <span className="text-sm font-black uppercase text-white">DZN Comms</span>
            </div>
            <button
              type="button"
              onClick={closeDisclosure}
              className="grid h-9 w-9 place-items-center rounded-md border border-white/10 text-zinc-300 transition hover:border-cyan-300/40 hover:text-white"
              aria-label="Close DZN Comms menu"
              title="Close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div className="grid gap-2 p-3">
            <Link
              href="/community#dzn-assist"
              className="group flex min-h-14 items-center gap-3 rounded-md border border-violet-300/20 bg-violet-300/6 px-3 py-2 transition hover:border-violet-200/45 hover:bg-violet-300/10"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-violet-300/20 bg-violet-300/8 text-violet-100">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black uppercase text-white">DZN Assist</span>
                <span className="mt-0.5 block text-xs font-bold text-emerald-200">Guided help live</span>
              </span>
              <ChevronRight className="h-4 w-4 text-violet-200 transition group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>

            <Link
              href="/community#global-chat"
              className="group flex min-h-14 items-center gap-3 rounded-md border border-cyan-300/25 bg-cyan-300/8 px-3 py-2 transition hover:border-cyan-200/55 hover:bg-cyan-300/12"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black uppercase text-white">Global Chat</span>
                <span className="mt-0.5 block text-xs font-bold text-cyan-100">Open Global Chat</span>
              </span>
              <ChevronRight className="h-4 w-4 text-cyan-200 transition group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </div>
    </details>
  );
}
