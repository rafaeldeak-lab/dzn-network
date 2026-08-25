"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CheckCircle2, Clipboard, EyeOff, Share2, UserRound } from "lucide-react";

type ShareState = "idle" | "copied" | "shared" | "error";

export function PublicProfileSharePanel({
  publicHref,
  publicProfileEnabled,
  context = "profile",
  className = "",
}: {
  publicHref?: string | null;
  publicProfileEnabled?: boolean;
  context?: "hub" | "profile";
  className?: string;
}) {
  const [shareState, setShareState] = useState<ShareState>("idle");
  const ready = Boolean(publicProfileEnabled && publicHref);
  const profileUrl = ready ? absoluteProfileUrl(publicHref) : "";

  async function copyProfileLink() {
    if (!profileUrl) return;
    try {
      await navigator.clipboard.writeText(profileUrl);
      setShareState("copied");
    } catch {
      setShareState("error");
    }
  }

  async function shareProfileLink() {
    if (!profileUrl || !nativeShareAvailable()) {
      setShareState("error");
      return;
    }
    try {
      await navigator.share({
        title: "DZN Public Profile",
        text: "View this DZN public player profile.",
        url: profileUrl,
      });
      setShareState("shared");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareState("error");
    }
  }

  if (!ready) {
    return (
      <section className={`rounded-lg border border-white/10 bg-white/[0.045] p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded border border-zinc-300/20 bg-zinc-400/10 text-zinc-300">
            <EyeOff className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black uppercase text-white">Public Profile Not Published</p>
            <p className="mt-2 text-sm font-bold leading-6 text-zinc-400">
              Turn on public profile display from your player profile settings to create a shareable DZN link.
            </p>
            <Link href="/player/profile" className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded border border-cyan-300/25 bg-cyan-400/12 px-3 py-2 text-xs font-black uppercase text-cyan-50 transition hover:bg-cyan-400/18">
              Open Profile Settings
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`rounded-lg border border-cyan-300/24 bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.16),transparent_38%),rgba(255,255,255,0.045)] p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase text-white">Public Profile Link</p>
          <p className="mt-2 break-all text-xs font-bold leading-5 text-cyan-50/78">{profileUrl}</p>
          <p className="mt-2 text-xs font-bold leading-5 text-zinc-400">
            {context === "hub" ? "This is your published DZN profile entry point from the Player Hub." : "Only sections you saved as visible appear on the public page."}
          </p>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded border border-cyan-300/25 bg-cyan-400/12 text-cyan-100">
          <UserRound className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Link href={publicHref ?? "/player/profile"} className="inline-flex min-h-10 items-center justify-center gap-2 rounded bg-cyan-400 px-3 py-2 text-xs font-black uppercase text-slate-950 transition hover:bg-cyan-300">
          View
          <ArrowRight className="h-4 w-4" />
        </Link>
        <button type="button" onClick={copyProfileLink} className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-white/12 bg-white/8 px-3 py-2 text-xs font-black uppercase text-white transition hover:bg-white/12">
          {shareState === "copied" ? <CheckCircle2 className="h-4 w-4 text-emerald-200" /> : <Clipboard className="h-4 w-4" />}
          Copy
        </button>
        <button
          type="button"
          onClick={shareProfileLink}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-violet-300/24 bg-violet-400/12 px-3 py-2 text-xs font-black uppercase text-violet-50 transition hover:bg-violet-400/18"
        >
          <Share2 className="h-4 w-4" />
          Share
        </button>
      </div>
      {shareState === "error" ? (
        <p className="mt-3 text-xs font-bold leading-5 text-rose-200">Link sharing is unavailable in this browser. The profile page can still be opened directly.</p>
      ) : shareState === "shared" ? (
        <p className="mt-3 text-xs font-bold leading-5 text-emerald-200">Profile share sheet opened.</p>
      ) : shareState === "copied" ? (
        <p className="mt-3 text-xs font-bold leading-5 text-emerald-200">Public profile link copied.</p>
      ) : null}
    </section>
  );
}

function nativeShareAvailable() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

function absoluteProfileUrl(href: string | null | undefined) {
  if (!href) return "";
  if (typeof window === "undefined") return href;
  try {
    return new URL(href, window.location.origin).toString();
  } catch {
    return href;
  }
}
