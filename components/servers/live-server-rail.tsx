"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, RadioTower, Star, Users } from "lucide-react";
import Link from "next/link";

type RailItem = {
  id: string;
  slug: string | null;
  name: string;
  logoUrl: string | null;
  category: string;
  currentPlayers: number | null;
  maxPlayers: number | null;
  ratingAverage: number | null;
  reviewCount: number;
  listingPlanKey: "free" | "pro";
  isPro: boolean;
};

type RailResponse = {
  ok: boolean;
  items?: RailItem[];
};

const placeholderItems: RailItem[] = [
  {
    id: "placeholder-beta",
    slug: null,
    name: "Servers joining beta now",
    logoUrl: null,
    category: "DZN Network",
    currentPlayers: null,
    maxPlayers: null,
    ratingAverage: null,
    reviewCount: 0,
    listingPlanKey: "free",
    isPro: false,
  },
  {
    id: "placeholder-free",
    slug: null,
    name: "Free listings are open",
    logoUrl: null,
    category: "Free Listing",
    currentPlayers: null,
    maxPlayers: null,
    ratingAverage: null,
    reviewCount: 0,
    listingPlanKey: "free",
    isPro: false,
  },
  {
    id: "placeholder-pro",
    slug: null,
    name: "Pro adverts unlock visuals",
    logoUrl: null,
    category: "Pro Listing",
    currentPlayers: null,
    maxPlayers: null,
    ratingAverage: null,
    reviewCount: 0,
    listingPlanKey: "pro",
    isPro: true,
  },
];

export function LiveServerRail({ className = "" }: { className?: string }) {
  const [items, setItems] = useState<RailItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/server-rail", {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() as Promise<RailResponse> : null))
      .then((payload) => {
        if (payload?.ok && Array.isArray(payload.items)) setItems(payload.items);
      })
      .catch(() => null)
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, []);

  const displayItems = items.length ? items : placeholderItems;
  const railItems = useMemo(() => [...displayItems, ...displayItems], [displayItems]);
  const isPlaceholder = loaded && items.length === 0;

  return (
    <section className={`dzn-live-server-rail ${className}`} aria-label="Live DZN server rail">
      <div className="dzn-live-server-rail__header">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">Live DZN Server Rail</p>
          <h2 className="mt-1 text-xl font-black uppercase text-white">Connected communities moving through the network</h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-100">
          <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.9)]" aria-hidden="true" />
          {isPlaceholder ? "Beta onboarding" : "Cached live data"}
        </span>
      </div>
      <div className="dzn-live-server-rail__viewport" tabIndex={0}>
        <div className="dzn-live-server-rail__track">
          {railItems.map((item, index) => (
            <RailCard key={`${item.id}-${index}`} item={item} duplicate={index >= displayItems.length} />
          ))}
        </div>
      </div>
    </section>
  );
}

function RailCard({ item, duplicate }: { item: RailItem; duplicate: boolean }) {
  const content = (
    <div className={`dzn-live-server-card ${item.isPro ? "dzn-live-server-card--pro" : ""}`} aria-hidden={duplicate || undefined}>
      <div className="dzn-live-server-card__icon">
        {item.logoUrl ? <img src={item.logoUrl} alt="" loading="lazy" /> : <RadioTower className="h-5 w-5" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-black uppercase text-white">{item.name}</h3>
          {item.isPro ? <span className="rounded border border-violet-300/30 bg-violet-400/12 px-1.5 py-0.5 text-[9px] font-black uppercase text-violet-100">Pro</span> : null}
        </div>
        <p className="mt-1 truncate text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-400">{item.category}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-zinc-300">
          <span className="inline-flex items-center gap-1" aria-label={ratingLabel(item)}>
            <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-hidden="true" />
            {item.reviewCount > 0 && item.ratingAverage ? `${item.ratingAverage.toFixed(1)} (${item.reviewCount})` : "No reviews yet"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5 text-cyan-200" aria-hidden="true" />
            {playersLabel(item)}
          </span>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-violet-100/70" aria-hidden="true" />
    </div>
  );

  if (!item.slug || duplicate) return content;
  return (
    <Link href={`/servers/profile?slug=${encodeURIComponent(item.slug)}`} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200">
      {content}
    </Link>
  );
}

function playersLabel(item: RailItem) {
  if (typeof item.currentPlayers === "number" && typeof item.maxPlayers === "number" && item.maxPlayers > 0) return `${item.currentPlayers}/${item.maxPlayers}`;
  if (typeof item.currentPlayers === "number") return `${item.currentPlayers} online`;
  return "Players syncing";
}

function ratingLabel(item: RailItem) {
  if (item.reviewCount > 0 && item.ratingAverage) return `Rated ${item.ratingAverage.toFixed(1)} out of 5 from ${item.reviewCount} reviews.`;
  return "No reviews yet.";
}
