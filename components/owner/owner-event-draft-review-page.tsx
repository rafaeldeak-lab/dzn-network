"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type DraftReviewEvent = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  visibility: string;
  category: string | null;
  eventType: string | null;
  startsAt: string | null;
  endsAt: string | null;
  rules: string | null;
  rewards: string | null;
  registeredServers: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type DraftReviewPayload =
  | { ok: true; event: DraftReviewEvent; generatedAt: string }
  | { ok: false; error?: string; message?: string };

type LoadState = "loading" | "ready" | "unauthorized" | "forbidden" | "not_found" | "error";

export function OwnerEventDraftReviewPage() {
  const searchParams = useSearchParams();
  const slug = sanitizeSlug(searchParams.get("slug"));
  const [state, setState] = useState<LoadState>(slug ? "loading" : "not_found");
  const [event, setEvent] = useState<DraftReviewEvent | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const displayState = slug ? state : "not_found";

  useEffect(() => {
    if (!slug) {
      return;
    }
    let active = true;
    fetch(`/api/owner/events/${encodeURIComponent(slug)}`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          setState("unauthorized");
          return;
        }
        if (response.status === 403) {
          setState("forbidden");
          return;
        }
        if (response.status === 404) {
          setState("not_found");
          return;
        }
        const payload = await response.json() as DraftReviewPayload;
        if (!response.ok) {
          const errorPayload = payload as Extract<DraftReviewPayload, { ok: false }>;
          throw new Error(errorPayload.message ?? errorPayload.error ?? "Draft review could not be loaded.");
        }
        if (payload.ok !== true) {
          throw new Error(payload.message ?? payload.error ?? "Draft review could not be loaded.");
        }
        setEvent(payload.event);
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "Draft review could not be loaded.");
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <main className="min-h-screen bg-[#02030a] px-4 py-6 text-zinc-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <nav className="flex flex-wrap gap-3">
          <Link href="/owner/events" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:text-white">
            Event Control
          </Link>
          <Link href="/events" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:text-white">
            Public Events
          </Link>
        </nav>
        {displayState === "loading" ? <section aria-busy="true" className="h-72 animate-pulse rounded-lg border border-white/10 bg-white/[0.035]" /> : null}
        {displayState === "unauthorized" ? <AccessPanel title="Sign in required" message="Sign in with the configured platform creator account to review this draft." href="/login?returnTo=%2Fowner%2Fevents%2Freview" /> : null}
        {displayState === "forbidden" ? <AccessPanel title="403 - creator review required" message="Only the configured DZN platform creator can review converted private event drafts." /> : null}
        {displayState === "not_found" ? <AccessPanel title="Draft not found" message="No creator-managed draft is available for that review slug." /> : null}
        {displayState === "error" ? <AccessPanel title="Draft review unavailable" message={message ?? "Draft review could not be loaded."} /> : null}
        {displayState === "ready" && event ? <DraftReview event={event} /> : null}
      </div>
    </main>
  );
}

function DraftReview({ event }: { event: DraftReviewEvent }) {
  return (
    <section className="rounded-lg border border-cyan-300/20 bg-white/[0.035] p-5">
      <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-200">
        <span>Draft</span>
        <span>Private</span>
        <span>Creator review required</span>
        <span>Not publicly published</span>
      </div>
      <h1 className="mt-3 text-3xl font-black text-white">{event.name}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">{event.description ?? "No draft description has been saved yet."}</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <ReviewStat label="Status" value={event.status} />
        <ReviewStat label="Visibility" value={event.visibility} />
        <ReviewStat label="Event type" value={event.eventType ?? "unknown"} />
        <ReviewStat label="Category" value={event.category ?? "uncategorized"} />
        <ReviewStat label="Registered servers" value={String(event.registeredServers)} />
        <ReviewStat label="Slug" value={event.slug} />
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <TextBlock title="Draft rules" text={event.rules} />
        <TextBlock title="Draft rewards" text={event.rewards} />
      </div>
      <p className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-3 text-sm font-bold text-amber-50">
        This draft is private. Publication controls are intentionally not available in this remediation.
      </p>
    </section>
  );
}

function ReviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">{label}</div>
      <div className="mt-1 break-words text-sm font-bold text-white">{value}</div>
    </div>
  );
}

function TextBlock({ title, text }: { title: string; text: string | null }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
      <h2 className="text-sm font-black text-white">{title}</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{text || "Not configured yet."}</p>
    </div>
  );
}

function AccessPanel({ title, message, href }: { title: string; message: string; href?: string }) {
  return (
    <section className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-5">
      <h1 className="text-2xl font-black text-white">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">{message}</p>
      {href ? (
        <Link href={href} className="mt-4 inline-flex rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-xs font-black uppercase text-cyan-50">
          Sign in with Discord
        </Link>
      ) : null}
    </section>
  );
}

function sanitizeSlug(value: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
