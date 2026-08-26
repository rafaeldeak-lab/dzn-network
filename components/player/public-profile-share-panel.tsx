"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CheckCircle2, Clipboard, Copy, Eye, EyeOff, ExternalLink, Share2, ShieldCheck, UserRound } from "lucide-react";

type ShareState = "idle" | "copied" | "handle_copied" | "shared" | "error";
type ShareActivityKind = "opened" | "copied" | "handle_copied" | "shared";
type ShareActivityRecord = {
  kind: ShareActivityKind;
  label: string;
  detail: string;
  displayTime: string;
  occurredAt: number;
};

export type PublicProfileOwnerPreview = {
  displayName: string;
  avatarUrl?: string | null;
  avatarInitial: string;
  publicHandle?: string | null;
  publicHref?: string | null;
  statusLabel: string;
  statusDetail: string;
  unsavedChanges: boolean;
  visibleSectionCount: number;
  sections: Array<{
    key: string;
    label: string;
    visible: boolean;
    detail: string;
  }>;
  stats: Array<{
    key: string;
    label: string;
    value: string;
    visible: boolean;
  }>;
  warnings: string[];
};

export function PublicProfileSharePanel({
  publicHref,
  publicProfileEnabled,
  context = "profile",
  preview = null,
  className = "",
}: {
  publicHref?: string | null;
  publicProfileEnabled?: boolean;
  context?: "hub" | "profile";
  preview?: PublicProfileOwnerPreview | null;
  className?: string;
}) {
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [shareActivity, setShareActivity] = useState<Record<ShareActivityKind, ShareActivityRecord | null>>({
    opened: null,
    copied: null,
    handle_copied: null,
    shared: null,
  });
  const ready = Boolean(publicProfileEnabled && publicHref);
  const profileUrl = ready ? absoluteProfileUrl(publicHref) : "";

  function recordShareActivity(kind: ShareActivityKind) {
    const activity = shareActivityRecord(kind, new Date());
    setShareActivity((current) => ({ ...current, [kind]: activity }));
  }

  async function copyProfileLink() {
    if (!profileUrl) return;
    try {
      await navigator.clipboard.writeText(profileUrl);
      recordShareActivity("copied");
      setShareState("copied");
    } catch {
      setShareState("error");
    }
  }

  async function copyProfileHandle() {
    const handle = preview?.publicHandle;
    if (!handle) return;
    try {
      await navigator.clipboard.writeText(handle);
      recordShareActivity("handle_copied");
      setShareState("handle_copied");
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
      recordShareActivity("shared");
      setShareState("shared");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareState("error");
    }
  }

  if (!ready) {
    return (
      <section className={`dzn-public-profile-owner-share-panel rounded-lg border border-white/10 bg-white/[0.045] p-4 ${className}`}>
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
        {preview ? <PublicProfileOwnerPreviewCard preview={preview} ready={false} /> : null}
      </section>
    );
  }

  return (
    <section className={`dzn-public-profile-owner-share-panel rounded-lg border border-cyan-300/24 bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.16),transparent_38%),rgba(255,255,255,0.045)] p-4 ${className}`}>
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
      {preview ? <PublicProfileOwnerPreviewCard preview={preview} ready /> : null}
      <div className="dzn-public-profile-owner-share-actions mt-4 grid gap-2 sm:grid-cols-4">
        <Link
          href={publicHref ?? "/player/profile"}
          target="_blank"
          rel="noreferrer"
          onClick={() => recordShareActivity("opened")}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded bg-cyan-400 px-3 py-2 text-xs font-black uppercase text-slate-950 transition hover:bg-cyan-300"
        >
          View Public Page
          <ExternalLink className="h-4 w-4" />
        </Link>
        <button type="button" onClick={copyProfileLink} className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-white/12 bg-white/8 px-3 py-2 text-xs font-black uppercase text-white transition hover:bg-white/12">
          {shareState === "copied" ? <CheckCircle2 className="h-4 w-4 text-emerald-200" /> : <Clipboard className="h-4 w-4" />}
          Copy Link
        </button>
        <button type="button" onClick={copyProfileHandle} disabled={!preview?.publicHandle} className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-white/12 bg-white/8 px-3 py-2 text-xs font-black uppercase text-white transition hover:bg-white/12 disabled:cursor-not-allowed disabled:text-zinc-500">
          {shareState === "handle_copied" ? <CheckCircle2 className="h-4 w-4 text-emerald-200" /> : <Copy className="h-4 w-4" />}
          Copy Handle
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
      ) : shareState === "handle_copied" ? (
        <p className="mt-3 text-xs font-bold leading-5 text-emerald-200">Public profile handle copied.</p>
      ) : null}
      <ShareSessionFeedback activity={shareActivity} />
    </section>
  );
}

function PublicProfileOwnerPreviewCard({ preview, ready }: { preview: PublicProfileOwnerPreview; ready: boolean }) {
  const visibleStats = preview.stats.filter((stat) => stat.visible);
  return (
    <div className={`dzn-public-profile-owner-preview mt-4 overflow-hidden rounded-lg border p-4 ${ready ? "border-cyan-300/20 bg-black/30" : "border-zinc-400/15 bg-black/24"}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PreviewAvatar preview={preview} ready={ready} />
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100">How My Public Profile Looks</p>
            <p className="mt-1 break-words text-xl font-black uppercase leading-none text-white [overflow-wrap:anywhere]">{ready ? preview.displayName : "Public Profile Hidden"}</p>
            <p className="mt-2 break-words text-xs font-black uppercase tracking-[0.12em] text-zinc-500 [overflow-wrap:anywhere]">
              {ready && preview.publicHandle ? `@${preview.publicHandle}` : "No public visitor link yet"}
            </p>
          </div>
        </div>
        <span className={`inline-flex max-w-full items-center gap-1.5 rounded border px-2.5 py-1 text-[10px] font-black uppercase ${preview.unsavedChanges ? "border-amber-300/30 bg-amber-400/10 text-amber-100" : ready ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" : "border-zinc-400/20 bg-zinc-400/10 text-zinc-300"}`}>
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{preview.statusLabel}</span>
        </span>
      </div>

      <p className="mt-4 text-sm font-bold leading-6 text-zinc-300">{preview.statusDetail}</p>

      {visibleStats.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {visibleStats.slice(0, 3).map((stat) => (
            <div key={stat.key} className="rounded border border-cyan-300/18 bg-cyan-400/8 p-3">
              <p className="font-mono text-2xl font-black text-cyan-50">{stat.value}</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100/80">{stat.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded border border-zinc-400/15 bg-black/24 p-3 text-xs font-bold leading-5 text-zinc-400">
          Visitors will see the public shell with section-safe empty states until profile sections are published and visible.
        </div>
      )}

      <div className="mt-4 grid gap-2">
        {preview.sections.map((section) => (
          <div key={section.key} className="dzn-public-profile-owner-section-row flex items-center justify-between gap-3 rounded border border-white/10 bg-black/24 px-3 py-2">
            <span className="min-w-0">
              <span className="block break-words text-xs font-black uppercase text-white [overflow-wrap:anywhere]">{section.label}</span>
              <span className="mt-1 block break-words text-[10px] font-bold uppercase text-zinc-500 [overflow-wrap:anywhere]">{section.detail}</span>
            </span>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] font-black uppercase ${section.visible ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-50" : "border-rose-300/25 bg-rose-400/10 text-rose-100"}`}>
              {section.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {section.visible ? "Visible" : "Hidden"}
            </span>
          </div>
        ))}
      </div>

      {preview.warnings.length ? (
        <div className="mt-4 rounded border border-amber-300/20 bg-amber-400/10 p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-100">Public view warnings</p>
          <div className="mt-2 grid gap-1.5">
            {preview.warnings.map((warning) => (
              <p key={warning} className="text-xs font-bold leading-5 text-amber-50/88">{warning}</p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PreviewAvatar({ preview, ready }: { preview: PublicProfileOwnerPreview; ready: boolean }) {
  if (ready && preview.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={preview.avatarUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-white/10 object-cover" />
    );
  }
  return (
    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border border-cyan-300/25 bg-cyan-400/12 text-2xl font-black text-cyan-50">
      {ready ? preview.avatarInitial : <EyeOff className="h-7 w-7 text-zinc-300" />}
    </span>
  );
}

function ShareSessionFeedback({ activity }: { activity: Record<ShareActivityKind, ShareActivityRecord | null> }) {
  const rows = (["opened", "copied", "handle_copied", "shared"] satisfies ShareActivityKind[])
    .map((kind) => activity[kind])
    .filter((record): record is ShareActivityRecord => Boolean(record))
    .sort((left, right) => right.occurredAt - left.occurredAt);

  return (
    <div className="dzn-public-profile-share-session-feedback mt-4 rounded border border-white/10 bg-black/24 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100">This Page Session</p>
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">Not saved</p>
      </div>
      {rows.length ? (
        <div className="mt-3 grid gap-2">
          {rows.map((row) => (
            <div key={row.kind} className="dzn-public-profile-share-session-row flex items-center justify-between gap-3 rounded border border-white/8 bg-white/[0.035] px-3 py-2">
              <span className="min-w-0">
                <span className="block break-words text-xs font-black uppercase text-white [overflow-wrap:anywhere]">{row.label}</span>
                <span className="mt-1 block break-words text-[10px] font-bold uppercase text-zinc-500 [overflow-wrap:anywhere]">{row.detail}</span>
              </span>
              <span className="shrink-0 rounded border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 font-mono text-[10px] font-black text-cyan-50">
                {row.displayTime}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs font-bold leading-5 text-zinc-400">No copy, open, or share action has happened in this tab yet.</p>
      )}
      <p className="mt-3 text-xs font-bold leading-5 text-zinc-500">
        Private to this tab. It is not saved or sent to DZN.
      </p>
    </div>
  );
}

function shareActivityRecord(kind: ShareActivityKind, date: Date): ShareActivityRecord {
  const displayTime = formatShareActivityTime(date);
  const occurredAt = date.getTime();
  if (kind === "opened") {
    return {
      kind,
      label: "Opened Public Page",
      detail: "The public profile page was opened from this tab.",
      displayTime,
      occurredAt,
    };
  }
  if (kind === "copied") {
    return {
      kind,
      label: "Copied Profile Link",
      detail: "The full public profile link was copied in this tab.",
      displayTime,
      occurredAt,
    };
  }
  if (kind === "handle_copied") {
    return {
      kind,
      label: "Copied Profile Handle",
      detail: "The generated public handle was copied in this tab.",
      displayTime,
      occurredAt,
    };
  }
  return {
    kind,
    label: "Opened Browser Share",
    detail: "The browser share sheet opened in this tab.",
    displayTime,
    occurredAt,
  };
}

function formatShareActivityTime(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
