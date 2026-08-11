"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const primaryLinks = [
  { href: "/operators", label: "Dashboard" },
  { href: "/operators/challenges", label: "Challenges" },
  { href: "/operators/rank", label: "Rank" },
  { href: "/operators/leaderboards", label: "Leaderboard" },
];

const secondaryLinks = [
  { href: "/operators/player?id=rafael", label: "Player" },
  { href: "/operators/server?slug=pandora-dayz", label: "Server" },
  { href: "/operators/studio", label: "Studio" },
];

export function OperatorSectionNav({ engagementEnabled }: { engagementEnabled: boolean }) {
  const pathname = usePathname();
  const links = engagementEnabled ? primaryLinks : [{ href: "/operators", label: "Dashboard" }, { href: "/operators/studio", label: "Studio" }];

  return (
    <nav className="sticky top-0 z-20 border-b border-white/10 bg-[#02030a]/92 px-4 py-3 backdrop-blur" aria-label="DZN Operators section navigation">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {links.map((link) => {
            const active = pathname === link.href || (link.href !== "/operators" && pathname.startsWith(link.href.split("?")[0]));
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-lg px-4 py-3 text-xs font-black uppercase transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                  active ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.035] text-zinc-200 hover:border-cyan-300/30"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
        {engagementEnabled ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {secondaryLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="shrink-0 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[10px] font-black uppercase text-zinc-300 transition hover:border-emerald-300/30 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
              >
                {link.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
