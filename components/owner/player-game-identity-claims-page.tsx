"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ManagedGameIdentityLinks } from "./managed-game-identity-links";

type ReviewCheck = {
  label: string;
  detail: string;
  status: "ready" | "warning";
};

type ClaimReviewContext = {
  evidence_status: "ready_for_owner_review";
  account_label: string;
  server_label: string;
  game_profile_label: string;
  checks: ReviewCheck[];
  approve_when: string[];
  reject_when: string[];
  missing_evidence_guidance: string;
  boundary: string;
};

type PlayerGameIdentityClaim = {
  id: string;
  user_id: string;
  requester_discord_id?: string;
  account_name: string | null;
  linked_server_id: string;
  player_profile_id: string;
  player_id: string;
  submitted_player_id?: string;
  player_name: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requested_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  server_name: string | null;
  public_slug: string | null;
  reviewer_name: string | null;
  review_context?: ClaimReviewContext;
};

type ClaimsPayload = {
  ok: boolean;
  source: "player_game_identity_claims" | "unavailable";
  private: boolean;
  owner_or_admin_only: boolean;
  claims: PlayerGameIdentityClaim[];
  boundary: string;
  message?: string;
  error?: string;
};

type LoadState = "loading" | "ready" | "unauthorized" | "error";
type ReviewAction = "approve" | "reject";
type ClaimLoadResult =
  | { state: "unauthorized" }
  | { state: "ready"; claims: PlayerGameIdentityClaim[]; boundary: string };

const NOTE_LIMIT = 240;

export function PlayerGameIdentityClaimsPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [claims, setClaims] = useState<PlayerGameIdentityClaim[]>([]);
  const [payloadBoundary, setPayloadBoundary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyClaim, setBusyClaim] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchClaims = useCallback(async (): Promise<ClaimLoadResult> => {
    const response = await fetch("/api/owner/player-game-identity-claims", {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    });

    if (response.status === 401) {
      return { state: "unauthorized" };
    }

    if (!response.ok) {
      throw new Error("Player stat link checks could not be loaded.");
    }

    const payload = (await response.json()) as ClaimsPayload;
    if (!payload.ok || payload.source !== "player_game_identity_claims" || !Array.isArray(payload.claims)) {
      throw new Error("The review queue is temporarily unavailable. Refresh to try again.");
    }
    return {
      state: "ready",
      claims: payload.claims ?? [],
      boundary: payload.boundary ?? "",
    };
  }, []);

  const applyLoadResult = useCallback((result: ClaimLoadResult) => {
    if (result.state === "unauthorized") {
      setState("unauthorized");
      return;
    }

    setClaims(result.claims);
    setPayloadBoundary(result.boundary);
    setState("ready");
  }, []);

  const loadClaims = useCallback(async () => {
    setError(null);
    setState("loading");

    try {
      applyLoadResult(await fetchClaims());
    } catch (loadError) {
      setState("error");
      setError(loadError instanceof Error ? loadError.message : "Player stat link checks could not be loaded.");
    }
  }, [applyLoadResult, fetchClaims]);

  useEffect(() => {
    let active = true;

    async function loadInitialClaims() {
      try {
        const result = await fetchClaims();
        if (!active) return;
        applyLoadResult(result);
      } catch (loadError) {
        if (!active) return;
        setState("error");
        setError(loadError instanceof Error ? loadError.message : "Player stat link checks could not be loaded.");
      }
    }

    void loadInitialClaims();
    return () => {
      active = false;
    };
  }, [applyLoadResult, fetchClaims]);

  const pendingCount = useMemo(() => claims.filter((claim) => claim.status === "pending").length, [claims]);

  async function submitReview(claim: PlayerGameIdentityClaim, action: ReviewAction) {
    const note = (notes[claim.id] ?? "").trim().slice(0, NOTE_LIMIT);
    setBusyClaim(claim.id);
    setActionMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/owner/player-game-identity-claims/${encodeURIComponent(claim.id)}`, {
        method: "PATCH",
        cache: "no-store",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action, note }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;

      if (!response.ok || result?.ok === false) {
        throw new Error(result?.message ?? "This claim could not be reviewed.");
      }

      setActionMessage(result?.message ?? (action === "approve" ? "Link request approved." : "Link request rejected."));
      setNotes((current) => {
        const next = { ...current };
        delete next[claim.id];
        return next;
      });
      await loadClaims();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "This claim could not be reviewed.");
    } finally {
      setBusyClaim(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#02030a] px-4 py-6 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_16%_10%,rgba(34,211,238,0.12),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.16),transparent_34%)]" />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Link href="/owner" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
              Owner Console
            </Link>
            <Link href="/dashboard" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
              Server Dashboard
            </Link>
          </div>
          <button
            type="button"
            onClick={() => void loadClaims()}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 hover:bg-cyan-300/20"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh Queue
          </button>
        </div>

        <section className="rounded-lg border border-cyan-300/20 bg-black/45 p-5 shadow-[0_0_48px_rgba(34,211,238,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Private owner/admin review
              </p>
              <h1 className="mt-3 text-3xl font-black uppercase text-white md:text-4xl">Player Stat Link Checks</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
                Review the exact game ID a logged-in player submitted, confirm the evidence with the right server owner or DZN admin, then approve or reject the link. Names are only context.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Pending</p>
              <p className="mt-1 text-3xl font-black text-white">{pendingCount}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <BoundaryPill title="Exact ID only" body="No display-name matching." />
            <BoundaryPill title="Owner scoped" body="Cross-owner reviews stay denied." />
            <BoundaryPill title="Stats display only" body="No billing or score effect." />
          </div>
        </section>

        {actionMessage ? (
          <StatusBanner tone="success" message={actionMessage} />
        ) : null}
        {error ? (
          <StatusBanner tone="error" message={error} />
        ) : null}

        {state === "loading" ? <LoadingState /> : null}
        {state === "unauthorized" ? <UnauthorizedState /> : null}
        {state === "error" ? <ErrorState message={error ?? "Player stat link checks could not be loaded."} /> : null}
        {state === "ready" && claims.length === 0 ? <EmptyState boundary={payloadBoundary} /> : null}
        {state === "ready" && claims.length > 0 ? (
          <section className="grid gap-4">
            {claims.map((claim) => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                note={notes[claim.id] ?? ""}
                busy={busyClaim === claim.id}
                onNoteChange={(value) => setNotes((current) => ({ ...current, [claim.id]: value.slice(0, NOTE_LIMIT) }))}
                onReview={(action) => void submitReview(claim, action)}
              />
            ))}
          </section>
        ) : null}
      </div>
      <div className="mx-auto w-full max-w-6xl"><ManagedGameIdentityLinks /></div>
    </main>
  );
}

function BoundaryPill({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
      <p className="text-xs font-black uppercase text-white">{title}</p>
      <p className="mt-1 text-xs font-semibold text-zinc-400">{body}</p>
    </div>
  );
}

function StatusBanner({ tone, message }: { tone: "success" | "error"; message: string }) {
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role={tone === "success" ? "status" : "alert"}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-bold ${
        tone === "success"
          ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
          : "border-rose-300/25 bg-rose-300/10 text-rose-100"
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="grid gap-3">
      {[0, 1].map((index) => (
        <div key={index} className="h-56 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
      ))}
    </section>
  );
}

function UnauthorizedState() {
  return (
    <section className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-5">
      <h2 className="text-xl font-black text-white">Log in to review player stat links</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-amber-100/85">
        This queue is private to the matching server owner or a DZN admin. Log in with Discord, then return here to check pending requests.
      </p>
      <Link href="/login?returnTo=%2Fowner%2Fplayer-game-identity-claims" className="mt-4 inline-flex rounded-lg border border-amber-200/30 bg-black/25 px-4 py-3 text-xs font-black uppercase text-amber-50 hover:bg-black/35">
        Log In With Discord
      </Link>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-rose-300/25 bg-rose-300/10 p-5">
      <h2 className="text-xl font-black text-white">Review queue unavailable</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-rose-100/85">{message}</p>
    </section>
  );
}

function EmptyState({ boundary }: { boundary: string }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
      <h2 className="text-xl font-black text-white">No pending player stat checks</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
        When a logged-in player asks to connect their Discord account to an imported game profile, it will appear here for the matching server owner or DZN admin.
      </p>
      {boundary ? <p className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-3 text-xs font-bold leading-5 text-cyan-100">{boundary}</p> : null}
    </section>
  );
}

function ClaimCard({
  claim,
  note,
  busy,
  onNoteChange,
  onReview,
}: {
  claim: PlayerGameIdentityClaim;
  note: string;
  busy: boolean;
  onNoteChange: (value: string) => void;
  onReview: (action: ReviewAction) => void;
}) {
  const context = claim.review_context ?? fallbackReviewContext(claim);
  const exactId = claim.submitted_player_id ?? "Not available";
  const serverHref = claim.public_slug ? `/servers/${claim.public_slug}` : null;
  const requesterDiscordId = claim.requester_discord_id;

  return (
    <article className="rounded-lg border border-white/10 bg-black/45 p-4 shadow-[0_0_36px_rgba(0,0,0,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">Pending player link</p>
          <h2 className="mt-1 text-2xl font-black text-white">{claim.account_name || "DZN Player"}</h2>
          <p className="mt-1 text-sm font-semibold text-zinc-400">Requested {formatDate(claim.requested_at)}</p>
        </div>
        <span className="rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-xs font-black uppercase text-amber-100">
          Needs owner check
        </span>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="grid min-w-0 gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailBox label="Server" value={claim.server_name || "DZN Server"} href={serverHref} />
            <DetailBox label="Imported game profile" value={claim.player_name || "Name not available"} />
            <DetailBox label="Submitted game ID" value={exactId} emphasis />
            <DetailBox label="Public-safe masked ID" value={claim.player_id || "Not available"} />
            <DetailBox label="Request reference" value={claim.id} />
            <DetailBox label="DZN account reference" value={claim.user_id} />
            <DetailBox label="Requesting Discord account" value={requesterDiscordId || "Not recorded"} />
            <DetailBox label="Requested action" value="Link this game account's statistics to this DZN account" />
          </div>

          <section className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] p-3">
            <h3 className="text-sm font-black uppercase text-cyan-50">What to check</h3>
            <div className="mt-3 grid gap-2">
              {context.checks.map((check) => (
                <div key={`${claim.id}-${check.label}`} className="flex gap-3 rounded-md border border-white/10 bg-black/25 p-3">
                  {check.status === "ready" ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-200" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-200" aria-hidden="true" />
                  )}
                  <div>
                    <p className="text-xs font-black uppercase text-white">{check.label}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-zinc-400">{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-3">
          <GuidanceList title="Approve only when" items={context.approve_when} tone="approve" />
          <GuidanceList title="Reject when" items={context.reject_when} tone="reject" />
          <section className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-3">
            <h3 className="text-sm font-black uppercase text-amber-50">Missing evidence</h3>
            <p className="mt-2 text-xs font-semibold leading-5 text-amber-100/85">{context.missing_evidence_guidance}</p>
          </section>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.035] p-3">
        <label className="text-xs font-black uppercase text-zinc-200" htmlFor={`review-note-${claim.id}`}>
          Optional review note
        </label>
        <textarea
          id={`review-note-${claim.id}`}
          value={note}
          maxLength={NOTE_LIMIT}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="Example: Exact owner proof checked, or reject reason for the player."
          className="mt-2 min-h-20 w-full resize-y rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/45"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs font-semibold leading-5 text-zinc-500">{context.boundary}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onReview("reject")}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-xs font-black uppercase text-rose-100 hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <XCircle className="size-4" aria-hidden="true" />
              Reject Request
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onReview("approve")}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-xs font-black uppercase text-emerald-100 hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Approve Link
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function DetailBox({ label, value, href, emphasis = false }: { label: string; value: string; href?: string | null; emphasis?: boolean }) {
  const content = href ? (
    <Link href={href} className="inline-flex min-w-0 items-center gap-2 text-cyan-100 hover:text-cyan-50">
      <span className="truncate">{value}</span>
      <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
    </Link>
  ) : (
    <span className="block whitespace-normal [overflow-wrap:anywhere]">{value}</span>
  );

  return (
    <div className={`min-w-0 rounded-lg border p-3 ${emphasis ? "border-cyan-300/25 bg-cyan-300/10" : "border-white/10 bg-white/[0.035]"}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className={`mt-2 min-w-0 text-sm font-black ${emphasis ? "text-cyan-50" : "text-white"}`}>{content}</p>
    </div>
  );
}

function GuidanceList({ title, items, tone }: { title: string; items: string[]; tone: "approve" | "reject" }) {
  const Icon = tone === "approve" ? CheckCircle2 : XCircle;
  const toneClass = tone === "approve" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-rose-300/20 bg-rose-300/10 text-rose-100";

  return (
    <section className={`rounded-lg border p-3 ${toneClass}`}>
      <h3 className="text-sm font-black uppercase text-white">{title}</h3>
      <div className="mt-2 grid gap-2">
        {items.map((item) => (
          <div key={item} className="flex gap-2 text-xs font-semibold leading-5">
            <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <p>{item}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function fallbackReviewContext(claim: PlayerGameIdentityClaim): ClaimReviewContext {
  return {
    evidence_status: "ready_for_owner_review",
    account_label: claim.account_name || "DZN Player",
    server_label: claim.server_name || "DZN Server",
    game_profile_label: claim.player_name || "Imported ADM profile",
    checks: [
      {
        label: "Owner scoped",
        detail: "Only the matching server owner or DZN admin can review this claim.",
        status: "ready",
      },
      {
        label: "Name is context only",
        detail: "Never approve from display names, Discord names, public handles, or leaderboard text alone.",
        status: "warning",
      },
    ],
    approve_when: ["The exact submitted game ID belongs to this logged-in account."],
    reject_when: ["The submitted game ID, server, or owner evidence cannot be confirmed."],
    missing_evidence_guidance: "Ask the player to get the exact game ID or proof code from the server owner again.",
    boundary:
      "This review can only connect existing stats display to the right account. It does not change billing, ownership, scoring, rankings, discovery, reviews, progression, events, or competitive eligibility.",
  };
}

function formatDate(value: string | null) {
  if (!value) return "time not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
