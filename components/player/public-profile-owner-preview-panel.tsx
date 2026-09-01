"use client";

import {
  CheckCircle2,
  Clipboard,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Share2,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

type OwnerPreviewSection = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
};

type PublicPlayerProfilePayload = {
  ok: true;
  handle: string;
  href: string;
  display_name: string;
  published_at: string | null;
  updated_at: string | null;
  sections: {
    display_name: { visible: boolean; value: string | null };
    gameplay_summary: {
      visible: boolean;
      totals: {
        kills: number;
        deaths: number;
        suicides: number;
        longest_kill_distance: number;
        linked_public_servers: number;
      } | null;
      last_seen_at: string | null;
    };
    featured_server: {
      visible: boolean;
      server: {
        public_slug: string;
        href: string;
        server_name: string;
        server_type: string;
        platform: string | null;
        map_name: string | null;
        kills: number;
        deaths: number;
        longest_kill_distance: number;
        last_seen_at: string | null;
      } | null;
    };
    xp_progress: FutureSection;
    challenge_progress: FutureSection;
    calling_cards: FutureSection;
    award_dates: FutureSection;
  };
  privacy: {
    public_profile_enabled: true;
    visible_sections: string[];
  };
  safety: {
    public_safe: true;
    read_only: true;
    presentation_only: true;
    private_identifiers_exposed: false;
    raw_award_evidence_exposed: false;
  };
  fairness_boundary: string[];
};

type FutureSection = {
  visible: boolean;
  status: "not_available_yet" | "hidden";
  message: string;
};

type PreviewState =
  | { status: "disabled"; data: null; message: string }
  | { status: "missing_handle"; data: null; message: string }
  | { status: "loading"; data: null; message: string }
  | { status: "ready"; data: PublicPlayerProfilePayload; message: null }
  | { status: "hidden"; data: null; message: string }
  | { status: "error"; data: null; message: string };

type RemotePreviewState = Extract<PreviewState, { status: "ready" | "hidden" | "error" }> & {
  requestKey: string;
};

type ShareAction = "idle" | "opened" | "copied_link" | "copied_handle" | "shared" | "fallback" | "error";

type ShareState = {
  action: ShareAction;
  message: string | null;
  occurredAt: string | null;
  shareKey: string;
};

const emptyShareState: ShareState = { action: "idle", message: null, occurredAt: null, shareKey: "" };

export function PublicProfileOwnerPreviewPanel({
  publicProfileEnabled,
  publicProfileHref,
  publicProfileHandle,
  sections,
}: {
  publicProfileEnabled: boolean;
  publicProfileHref: string | null;
  publicProfileHandle: string | null;
  sections: OwnerPreviewSection[];
}) {
  const [remotePreviewState, setRemotePreviewState] = useState<RemotePreviewState | null>(null);
  const [shareState, setShareState] = useState<ShareState>(emptyShareState);

  const validatedHref = safePublicProfileHref(publicProfileHref);
  const validatedHandle = safePublicProfileHandle(publicProfileHandle) ?? handleFromHref(validatedHref);
  const sectionVisibilityKey = sections
    .map((section) => `${section.key}:${section.enabled ? "1" : "0"}`)
    .sort()
    .join("|");
  const requestKey = `${publicProfileEnabled ? "public" : "private"}:${validatedHandle ?? "no-handle"}:${validatedHref ?? "no-href"}:${sectionVisibilityKey}`;
  const basePreviewState = previewStateFromInputs(publicProfileEnabled, validatedHref, validatedHandle);
  const previewState: PreviewState = basePreviewState.status === "loading" && remotePreviewState?.requestKey === requestKey
    ? withoutRequestKey(remotePreviewState)
    : basePreviewState;
  const shareKey = validatedHref ?? validatedHandle ?? "no-public-profile";
  const activeShareState = shareState.shareKey === shareKey ? shareState : emptyShareState;
  const profileUrl = profileUrlFromHref(validatedHref);

  useEffect(() => {
    let active = true;
    if (basePreviewState.status !== "loading" || !validatedHandle) return;

    fetch(`/api/public/players/${encodeURIComponent(validatedHandle)}`, {
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as Partial<PublicPlayerProfilePayload> & { message?: string } | null;
        if (!active) return;

        if (response.status === 404) {
          setRemotePreviewState({
            requestKey,
            status: "hidden",
            data: null,
            message: payload?.message ?? "The public profile is currently hidden or unavailable to visitors.",
          });
          return;
        }
        if (!response.ok || !payload?.ok) {
          setRemotePreviewState({
            requestKey,
            status: "error",
            data: null,
            message: payload?.message ?? "The public profile preview could not be loaded right now.",
          });
          return;
        }

        setRemotePreviewState({ requestKey, status: "ready", data: payload as PublicPlayerProfilePayload, message: null });
      })
      .catch(() => {
        if (active) {
          setRemotePreviewState({
            requestKey,
            status: "error",
            data: null,
            message: "The public profile preview could not be loaded right now.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [basePreviewState.status, requestKey, validatedHandle]);

  function recordShareAction(action: ShareAction, message: string) {
    setShareState({ action, message, occurredAt: new Date().toISOString(), shareKey });
  }

  async function copyProfileLink() {
    if (!profileUrl || !navigator.clipboard?.writeText) {
      recordShareAction("fallback", "Clipboard is unavailable in this browser. Select the visible link and copy it manually.");
      return;
    }

    try {
      await navigator.clipboard.writeText(profileUrl);
      recordShareAction("copied_link", "Public profile link copied for this page session.");
    } catch {
      recordShareAction("fallback", "Clipboard access was blocked. Select the visible link and copy it manually.");
    }
  }

  async function copyProfileHandle() {
    if (!validatedHandle || !navigator.clipboard?.writeText) {
      recordShareAction("fallback", "Clipboard is unavailable in this browser. Select the visible handle and copy it manually.");
      return;
    }

    try {
      await navigator.clipboard.writeText(validatedHandle);
      recordShareAction("copied_handle", "Public profile handle copied for this page session.");
    } catch {
      recordShareAction("fallback", "Clipboard access was blocked. Select the visible handle and copy it manually.");
    }
  }

  async function shareProfileLink() {
    if (!profileUrl || !navigator.share) {
      recordShareAction("fallback", "Browser sharing is unavailable here. Copy the profile link instead.");
      return;
    }

    try {
      await navigator.share({
        title: "DZN Public Player Profile",
        text: "View this DZN public player profile.",
        url: profileUrl,
      });
      recordShareAction("shared", "Browser share sheet opened for this page session.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      recordShareAction("error", "Browser sharing could not open. Copy the profile link instead.");
    }
  }

  const readyToShare = Boolean(previewState.status === "ready" && publicProfileEnabled && validatedHref && profileUrl);
  const sectionRows = previewState.status === "ready"
    ? publicProfileSectionRows(previewState.data)
    : settingsPreviewRows(sections);

  return (
    <section className="rounded-lg border border-cyan-300/25 bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.14),transparent_34%),radial-gradient(circle_at_92%_18%,rgba(168,85,247,0.13),transparent_30%),rgba(2,6,23,0.84)] p-5 shadow-[0_0_42px_rgba(34,211,238,0.12)] backdrop-blur">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-cyan-300/35 bg-cyan-300/10 text-cyan-100">
            <Eye aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-black uppercase text-white">How My Public Profile Looks</h2>
            <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
              This private owner preview mirrors the visitor-safe public profile response. Opening, copying, or sharing this link stores no share history and makes no server-side change.
            </p>
          </div>
        </div>
        <PreviewStatusBadge state={previewState} />
      </div>

      <div className="mt-5 grid gap-4">
        <div className="min-w-0 rounded-lg border border-white/10 bg-slate-950/70 p-4">
          <PreviewHero state={previewState} handle={validatedHandle} href={validatedHref} />

          {previewState.status === "ready" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <MiniMetric label="Public Servers" value={String(previewState.data.sections.gameplay_summary.totals?.linked_public_servers ?? 0)} visible={previewState.data.sections.gameplay_summary.visible} />
              <MiniMetric label="Kills" value={String(previewState.data.sections.gameplay_summary.totals?.kills ?? 0)} visible={previewState.data.sections.gameplay_summary.visible} />
              <MiniMetric label="Longest" value={formatDistance(previewState.data.sections.gameplay_summary.totals?.longest_kill_distance ?? 0)} visible={previewState.data.sections.gameplay_summary.visible} />
            </div>
          ) : null}

          {previewState.status === "ready" && previewState.data.sections.featured_server.server ? (
            <Link
              href={previewState.data.sections.featured_server.server.href}
              className="mt-4 block rounded-md border border-cyan-300/20 bg-cyan-300/8 p-4 transition hover:border-cyan-100/55"
            >
              <span className="block text-xs font-black uppercase text-cyan-100">Featured Server</span>
              <span className="mt-1 block break-words text-base font-black uppercase text-white [overflow-wrap:anywhere]">
                {previewState.data.sections.featured_server.server.server_name}
              </span>
              <span className="mt-2 block text-sm font-semibold leading-6 text-slate-300">
                {previewState.data.sections.featured_server.server.server_type} - {previewState.data.sections.featured_server.server.platform ?? "Platform TBA"} - {previewState.data.sections.featured_server.server.map_name ?? "Map TBA"}
              </span>
            </Link>
          ) : null}

          <div className="mt-4 grid gap-2">
            {sectionRows.map((section) => (
              <PreviewSectionRow key={section.key} section={section} />
            ))}
          </div>
        </div>

        <aside className="min-w-0 rounded-lg border border-white/10 bg-slate-950/70 p-4">
          <p className="text-sm font-black uppercase text-white">Owner Share Controls</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
            These controls only use this browser session. They do not save share history, update profile settings, or call tracking endpoints.
          </p>

          {readyToShare ? (
            <div className="mt-4 rounded-md border border-cyan-300/20 bg-cyan-300/8 p-3">
              <label htmlFor="public-profile-url" className="text-[10px] font-black uppercase text-cyan-100">
                Public URL
              </label>
              <input
                id="public-profile-url"
                value={profileUrl}
                readOnly
                className="mt-2 w-full rounded-md border border-cyan-300/20 bg-slate-950/80 px-3 py-2 text-xs font-bold text-cyan-50 outline-none"
                aria-label="Current public profile URL"
              />
              {validatedHandle ? (
                <p className="mt-2 break-words text-xs font-bold uppercase text-cyan-100 [overflow-wrap:anywhere]">@{validatedHandle}</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-amber-300/25 bg-amber-300/10 p-3">
              <p className="text-sm font-black uppercase text-amber-50">Share link locked</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-amber-50/85">
                {shareLockCopy(previewState)}
              </p>
            </div>
          )}

          <div className="mt-4 grid gap-2">
            {readyToShare && validatedHref ? (
              <Link
                href={validatedHref}
                target="_blank"
                rel="noreferrer"
                onClick={() => recordShareAction("opened", "Public profile opened for this page session.")}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-cyan-200/55 bg-cyan-300 px-3 text-xs font-black uppercase text-slate-950 transition hover:bg-cyan-200"
              >
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
                Open Public Page
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex min-h-10 cursor-not-allowed items-center justify-center gap-2 rounded-md border border-slate-500/25 bg-slate-700/35 px-3 text-xs font-black uppercase text-slate-400 opacity-70"
              >
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
                Open Public Page
              </button>
            )}
            <button
              type="button"
              onClick={copyProfileLink}
              disabled={!readyToShare}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/12 bg-white/8 px-3 text-xs font-black uppercase text-white transition hover:border-cyan-200/45 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-55"
              aria-label="Copy public profile link"
            >
              {activeShareState.action === "copied_link" ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-200" /> : <Clipboard aria-hidden="true" className="h-4 w-4" />}
              Copy Link
            </button>
            <button
              type="button"
              onClick={copyProfileHandle}
              disabled={!readyToShare || !validatedHandle}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/12 bg-white/8 px-3 text-xs font-black uppercase text-white transition hover:border-cyan-200/45 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-55"
              aria-label="Copy public profile handle"
            >
              {activeShareState.action === "copied_handle" ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-200" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
              Copy Handle
            </button>
            <button
              type="button"
              onClick={shareProfileLink}
              disabled={!readyToShare}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-violet-300/25 bg-violet-300/12 px-3 text-xs font-black uppercase text-violet-50 transition hover:border-violet-200/50 hover:bg-violet-300/18 disabled:cursor-not-allowed disabled:opacity-55"
              aria-label="Share public profile link with the browser share sheet"
            >
              <Share2 aria-hidden="true" className="h-4 w-4" />
              Share
            </button>
          </div>

          {activeShareState.message ? (
            <p
              className={`mt-4 rounded-md border p-3 text-sm font-semibold leading-6 ${
                activeShareState.action === "error" || activeShareState.action === "fallback"
                  ? "border-amber-300/25 bg-amber-300/10 text-amber-50"
                  : "border-emerald-300/25 bg-emerald-300/10 text-emerald-50"
              }`}
              aria-live="polite"
            >
              {activeShareState.message} {activeShareState.occurredAt ? <span className="block text-xs uppercase opacity-75">Last action: {formatTime(activeShareState.occurredAt)}</span> : null}
            </p>
          ) : (
            <p className="mt-4 rounded-md border border-white/10 bg-white/6 p-3 text-xs font-bold leading-5 text-slate-400" aria-live="polite">
              No copy, open, or share action in this page session.
            </p>
          )}
        </aside>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <BoundaryTile icon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />} text="Preview/share controls are client-side convenience only and cannot save privacy settings." />
        <BoundaryTile icon={<Trophy aria-hidden="true" className="h-4 w-4" />} text="Profile sharing cannot affect billing, rankings, discovery, reviews, events, XP, calling cards, Server Wars, CTF, or competitive eligibility." />
      </div>
    </section>
  );
}

function withoutRequestKey(state: RemotePreviewState): PreviewState {
  if (state.status === "ready") return { status: "ready", data: state.data, message: null };
  if (state.status === "hidden") return { status: "hidden", data: null, message: state.message };
  return { status: "error", data: null, message: state.message };
}

function previewStateFromInputs(
  publicProfileEnabled: boolean,
  publicProfileHref: string | null,
  publicProfileHandle: string | null,
): PreviewState {
  if (!publicProfileEnabled) {
    return {
      status: "disabled",
      data: null,
      message: "Public profile display is off, so visitors cannot view this profile.",
    };
  }
  if (!safePublicProfileHref(publicProfileHref) || !(safePublicProfileHandle(publicProfileHandle) ?? handleFromHref(publicProfileHref))) {
    return {
      status: "missing_handle",
      data: null,
      message: "Public profile display is saved, but no generated visitor handle is available yet.",
    };
  }
  return {
    status: "loading",
    data: null,
    message: "Loading the same public-safe profile data visitors can see.",
  };
}

function PreviewStatusBadge({ state }: { state: PreviewState }) {
  const status = previewStatus(state);
  return (
    <span className={`inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-black uppercase ${status.tone}`}>
      {status.icon}
      {status.label}
    </span>
  );
}

function previewStatus(state: PreviewState) {
  if (state.status === "ready") {
    return {
      label: "Visitor Preview Ready",
      tone: "border-emerald-300/35 bg-emerald-300/12 text-emerald-100",
      icon: <Eye aria-hidden="true" className="h-4 w-4" />,
    };
  }
  if (state.status === "loading") {
    return {
      label: "Checking",
      tone: "border-cyan-300/35 bg-cyan-300/12 text-cyan-100",
      icon: <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />,
    };
  }
  if (state.status === "hidden" || state.status === "disabled" || state.status === "missing_handle") {
    return {
      label: "Hidden From Visitors",
      tone: "border-amber-300/35 bg-amber-300/12 text-amber-100",
      icon: <EyeOff aria-hidden="true" className="h-4 w-4" />,
    };
  }
  return {
    label: "Preview Unavailable",
    tone: "border-rose-300/35 bg-rose-300/12 text-rose-100",
    icon: <EyeOff aria-hidden="true" className="h-4 w-4" />,
  };
}

function PreviewHero({ state, handle, href }: { state: PreviewState; handle: string | null; href: string | null }) {
  if (state.status === "ready") {
    return (
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
        <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/12 text-2xl font-black text-cyan-50">
          {initialsFromName(state.data.display_name)}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100">Visitor View Mirror</p>
          <p className="mt-1 break-words text-2xl font-black uppercase leading-tight text-white [overflow-wrap:anywhere]">{state.data.display_name}</p>
          <p className="mt-2 break-words text-xs font-black uppercase text-slate-400 [overflow-wrap:anywhere]">@{state.data.handle}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">Updated {formatDate(state.data.updated_at)}. Only saved visible sections are shown here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
      <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-slate-500/30 bg-slate-700/25 text-slate-300">
        {state.status === "loading" ? <Loader2 aria-hidden="true" className="h-7 w-7 animate-spin" /> : <EyeOff aria-hidden="true" className="h-7 w-7" />}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-100">Visitor View Mirror</p>
        <p className="mt-1 break-words text-2xl font-black uppercase leading-tight text-white [overflow-wrap:anywhere]">
          {state.status === "loading" ? "Loading Public Preview" : "Public Profile Hidden"}
        </p>
        <p className="mt-2 break-words text-xs font-black uppercase text-slate-400 [overflow-wrap:anywhere]">
          {handle ? `@${handle}` : href ?? "No visitor link yet"}
        </p>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{state.message}</p>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, visible }: { label: string; value: string; visible: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${visible ? "border-cyan-300/20 bg-cyan-300/8" : "border-slate-500/20 bg-slate-700/16"}`}>
      <p className="text-xl font-black text-white">{visible ? value : "Hidden"}</p>
      <p className="mt-1 text-[10px] font-black uppercase text-slate-400">{label}</p>
    </div>
  );
}

type PreviewSectionRowModel = {
  key: string;
  label: string;
  visible: boolean;
  detail: string;
};

function PreviewSectionRow({ section }: { section: PreviewSectionRowModel }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-white/6 p-3">
      <span className="min-w-0">
        <span className="block break-words text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{section.label}</span>
        <span className="mt-1 block text-xs font-semibold leading-5 text-slate-400">{section.detail}</span>
      </span>
      <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black uppercase ${
        section.visible ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100" : "border-rose-300/25 bg-rose-300/10 text-rose-100"
      }`}>
        {section.visible ? <Eye aria-hidden="true" className="h-3 w-3" /> : <EyeOff aria-hidden="true" className="h-3 w-3" />}
        {section.visible ? "Visible" : "Hidden"}
      </span>
    </div>
  );
}

function BoundaryTile({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300/20 bg-amber-300/8 p-3 text-sm font-semibold leading-6 text-amber-50">
      <span className="mt-1 shrink-0 text-amber-100">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function shareLockCopy(state: PreviewState) {
  if (state.status === "loading") return "The public visitor response is still loading. Sharing unlocks after the visitor-safe preview is ready.";
  if (state.status === "hidden") return "The public visitor response is hidden right now, so sharing stays locked until the profile is visible.";
  if (state.status === "error") return "The public visitor response could not be checked, so sharing stays locked until the preview can be verified.";
  if (state.status === "missing_handle") return "Save public profile preferences and wait for a generated handle before sharing the visitor page.";
  return "Publish your profile and save preferences before sharing the visitor page.";
}

function publicProfileSectionRows(data: PublicPlayerProfilePayload): PreviewSectionRowModel[] {
  return [
    {
      key: "display_name",
      label: "Display Name",
      visible: data.sections.display_name.visible,
      detail: data.sections.display_name.visible ? "Visitors can see the public display name." : "Visitors see the generic DZN Player label.",
    },
    {
      key: "gameplay_summary",
      label: "Gameplay Summary",
      visible: data.sections.gameplay_summary.visible,
      detail: data.sections.gameplay_summary.totals ? "Visitors can see safe aggregate gameplay totals." : "Gameplay totals are hidden or not available.",
    },
    {
      key: "featured_server",
      label: "Featured Server",
      visible: data.sections.featured_server.visible,
      detail: data.sections.featured_server.server ? "Visitors can open the public-safe featured server." : "Featured server details are hidden or not available.",
    },
    {
      key: "xp_progress",
      label: "XP Progress",
      visible: data.sections.xp_progress.visible,
      detail: data.sections.xp_progress.message,
    },
    {
      key: "challenge_progress",
      label: "Challenge Progress",
      visible: data.sections.challenge_progress.visible,
      detail: data.sections.challenge_progress.message,
    },
    {
      key: "calling_cards",
      label: "Calling Cards",
      visible: data.sections.calling_cards.visible,
      detail: data.sections.calling_cards.message,
    },
    {
      key: "award_dates",
      label: "Award Dates",
      visible: data.sections.award_dates.visible,
      detail: data.sections.award_dates.message,
    },
  ];
}

function settingsPreviewRows(sections: OwnerPreviewSection[]): PreviewSectionRowModel[] {
  return sections
    .filter((section) => section.key !== "public_profile_enabled")
    .map((section) => ({
      key: section.key,
      label: section.label,
      visible: section.enabled,
      detail: section.enabled
        ? "Saved as visible when the public visitor response has safe data for this section."
        : section.description,
    }));
}

function safePublicProfileHref(value: string | null | undefined) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (/^\/players\/[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(text) && !text.includes("--")) return text;
  return null;
}

function safePublicProfileHandle(value: string | null | undefined) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(text) && !text.includes("--")) return text;
  return null;
}

function handleFromHref(href: string | null | undefined) {
  const safeHref = safePublicProfileHref(href);
  if (!safeHref) return null;
  return safePublicProfileHandle(safeHref.split("/").pop());
}

function profileUrlFromHref(href: string | null) {
  if (!href) return "";
  try {
    return new URL(href, "https://dayz-network.com").toString();
  } catch {
    return "";
  }
}

function initialsFromName(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "D";
}

function formatDistance(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0m";
  return `${Math.round(value)}m`;
}

function formatDate(value: string | null) {
  if (!value) return "recently";
  const normalizedValue = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
