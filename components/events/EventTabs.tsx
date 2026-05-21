import Link from "next/link";

import { cn } from "./event-format";

const tabs = [
  { label: "CTF Tournaments", href: "/events" },
  { label: "Upcoming", href: "/events/tournaments?status=upcoming" },
  { label: "Active", href: "/events/tournaments?status=live" },
  { label: "Completed", href: "/events/tournaments?status=ended" },
  { label: "Challenges", href: "/events/challenges" },
];

export function EventTabs({ active = "CTF Tournaments" }: { active?: string }) {
  return (
    <nav className="flex flex-wrap gap-2 rounded-lg border border-white/8 bg-black/24 p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "rounded-md px-3 py-2 text-[10px] font-black uppercase text-zinc-400 transition hover:text-white",
            active === tab.label && "bg-violet-500/22 text-violet-50 shadow-[0_0_18px_rgba(124,58,237,0.22)]",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
