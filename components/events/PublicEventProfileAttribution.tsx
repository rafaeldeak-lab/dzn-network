import Link from "next/link";
import { UserRound } from "lucide-react";

import type { PublicProfileAttribution } from "./event-data";

export function PublicEventProfileAttribution({
  profile,
  label = "Hosted by",
  compact = false,
  className = "",
}: {
  profile?: PublicProfileAttribution | null;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const attribution = normalizePublicProfileAttribution(profile);
  if (!attribution) return null;
  const text = `${label} ${attribution.display_name}`;
  return (
    <Link
      href={attribution.public_href}
      aria-label={`View ${attribution.display_name}'s public DZN profile`}
      className={`inline-flex max-w-full items-center gap-1.5 rounded border border-cyan-300/22 bg-cyan-400/10 font-black uppercase text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-300/14 ${compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]"} ${className}`}
    >
      <UserRound className={`${compact ? "h-3 w-3" : "h-3.5 w-3.5"} shrink-0`} />
      <span className="truncate">{text}</span>
    </Link>
  );
}

export function normalizePublicProfileAttribution(value: unknown): PublicProfileAttribution | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const publicHandle = normalizePublicProfileHandle(record.public_handle);
  if (!publicHandle) return null;
  const expectedHref = `/players/${publicHandle}`;
  const expectedApiHref = `/api/public/player-profiles/${publicHandle}`;
  if (!(record.public_href === expectedHref && record.public_api_href === expectedApiHref)) return null;
  return {
    display_name: publicEventProfileName(record.display_name),
    public_handle: publicHandle,
    public_href: expectedHref,
    public_api_href: expectedApiHref,
  };
}

function normalizePublicProfileHandle(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/.test(text) ? text : null;
}

function publicEventProfileName(value: unknown) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.slice(0, 48) || "DZN Player";
}
