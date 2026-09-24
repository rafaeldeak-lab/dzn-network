"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  FileCheck2,
  Gamepad2,
  Home,
  ListChecks,
  RefreshCw,
  Server,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  account_avatar_url?: string | null;
  request_source?: "gamertag_lookup" | "legacy_exact_id";
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
  history: PlayerGameIdentityHistory[];
  history_has_more: boolean;
  history_next_cursor: string | null;
  boundary: string;
  message?: string;
  error?: string;
};

type PlayerGameIdentityHistory = {
  id: string;
  claim_id: string | null;
  link_id: string | null;
  linked_server_id: string;
  server_name: string | null;
  public_slug: string | null;
  user_id: string;
  account_name: string | null;
  requester_discord_id: string | null;
  player_id: string;
  player_name: string | null;
  action: "claim_approved" | "claim_rejected" | "link_revoked";
  result: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string | null;
};

type LoadState = "loading" | "ready" | "unauthorized" | "error";
type ReviewAction = "approve" | "reject";
type ClaimLoadResult =
  | { state: "unauthorized" }
  | {
      state: "ready";
      claims: PlayerGameIdentityClaim[];
      history: PlayerGameIdentityHistory[];
      historyHasMore: boolean;
      historyNextCursor: string | null;
      boundary: string;
    };

const NOTE_LIMIT = 240;

export function PlayerGameIdentityClaimsPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [claims, setClaims] = useState<PlayerGameIdentityClaim[]>([]);
  const [history, setHistory] = useState<PlayerGameIdentityHistory[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [view, setView] = useState<"pending" | "history">("pending");
  const [payloadBoundary, setPayloadBoundary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyClaim, setBusyClaim] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedClaimIndex, setSelectedClaimIndex] = useState(0);

  const fetchClaims = useCallback(async (historyCursor: string | null = null): Promise<ClaimLoadResult> => {
    const endpoint = historyCursor
      ? `/api/owner/player-game-identity-claims?${new URLSearchParams({ history_before: historyCursor })}`
      : "/api/owner/player-game-identity-claims";
    const response = await fetch(endpoint, {
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
      history: payload.history ?? [],
      historyHasMore: payload.history_has_more === true,
      historyNextCursor: typeof payload.history_next_cursor === "string" ? payload.history_next_cursor : null,
      boundary: payload.boundary ?? "",
    };
  }, []);

  const applyLoadResult = useCallback((result: ClaimLoadResult) => {
    if (result.state === "unauthorized") {
      setState("unauthorized");
      return;
    }

    setClaims(result.claims);
    setHistory(result.history);
    setHistoryHasMore(result.historyHasMore);
    setHistoryNextCursor(result.historyNextCursor);
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

  const loadOlderHistory = useCallback(async () => {
    if (historyLoading || historyNextCursor === null) return;
    setHistoryLoading(true);
    setError(null);
    try {
      const result = await fetchClaims(historyNextCursor);
      if (result.state === "unauthorized") {
        setState("unauthorized");
        return;
      }
      setHistory((current) => {
        const knownIds = new Set(current.map((item) => item.id));
        return [...current, ...result.history.filter((item) => !knownIds.has(item.id))];
      });
      setHistoryHasMore(result.historyHasMore);
      setHistoryNextCursor(result.historyNextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Older decision history could not be loaded.");
    } finally {
      setHistoryLoading(false);
    }
  }, [fetchClaims, historyLoading, historyNextCursor]);

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

  const pendingClaims = useMemo(() => claims.filter((claim) => claim.status === "pending"), [claims]);
  const pendingCount = pendingClaims.length;
  const safeSelectedClaimIndex = Math.min(selectedClaimIndex, Math.max(0, pendingClaims.length - 1));
  const selectedClaim = pendingClaims[safeSelectedClaimIndex] ?? null;

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
    <main className="min-h-screen bg-[#02050a] px-3 py-4 text-zinc-100 sm:px-5 sm:py-6">
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-black/45 px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
              <Home className="size-4" aria-hidden="true" />
              Home
            </Link>
            <Link href="/owner" className="inline-flex min-h-10 items-center rounded-md border border-white/10 bg-black/45 px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
              Owner Console
            </Link>
            <Link href="/dashboard" className="inline-flex min-h-10 items-center rounded-md border border-white/10 bg-black/45 px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
              Server Dashboard
            </Link>
          </div>
          <button
            type="button"
            onClick={() => void loadClaims()}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 hover:bg-cyan-300/20"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh Queue
          </button>
        </div>

        <section
          className="relative overflow-hidden rounded-lg border border-cyan-300/20 bg-black/70 shadow-[0_0_48px_rgba(34,211,238,0.08)]"
          style={{ backgroundImage: "url('/media/dzn-cinematic-survivor.png')", backgroundPosition: "center 48%", backgroundSize: "cover" }}
        >
          <div className="absolute inset-0 bg-[#020817]/80" aria-hidden="true" />
          <div className="relative flex flex-wrap items-center justify-between gap-5 p-5 sm:p-6">
            <div className="max-w-4xl">
              <p className="inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Private owner/admin review
              </p>
              <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl">Player Stat Link Checks</h1>
              <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-zinc-300">
                Match one DZN account to one imported game profile and verify ownership independently before making a decision. Gamertags never auto-link. A gamertag can locate a candidate but is never proof.
              </p>
            </div>
            <div className="min-w-40 rounded-lg border border-cyan-300/20 bg-[#061326]/90 px-5 py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">Pending reviews</p>
              <div className="mt-1 flex items-end justify-between gap-4">
                <p className="text-4xl font-black text-white">{pendingCount}</p>
                <ListChecks className="mb-1 size-6 text-cyan-300" aria-hidden="true" />
              </div>
              <p className="mt-1 text-xs font-semibold text-zinc-400">awaiting your decision</p>
            </div>
          </div>
        </section>

        {actionMessage ? (
          <StatusBanner tone="success" message={actionMessage} />
        ) : null}
        {error ? (
          <StatusBanner tone="error" message={error} />
        ) : null}

        {state === "ready" ? (
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/45 p-1.5" aria-label="Player link review views">
            <button type="button" onClick={() => setView("pending")} aria-pressed={view === "pending"} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-black uppercase ${view === "pending" ? "border border-cyan-300/35 bg-cyan-300/15 text-cyan-50" : "border border-transparent text-zinc-400 hover:text-white"}`}>
              <Clock3 className="size-4" aria-hidden="true" /> Pending ({pendingCount})
            </button>
            <button type="button" onClick={() => setView("history")} aria-pressed={view === "history"} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-black uppercase ${view === "history" ? "border border-violet-300/35 bg-violet-300/15 text-violet-50" : "border border-transparent text-zinc-400 hover:text-white"}`}>
              <FileCheck2 className="size-4" aria-hidden="true" /> Decision History
            </button>
          </div>
        ) : null}

        {state === "loading" ? <LoadingState /> : null}
        {state === "unauthorized" ? <UnauthorizedState /> : null}
        {state === "error" ? <ErrorState message={error ?? "Player stat link checks could not be loaded."} /> : null}
        {state === "ready" && view === "pending" && pendingClaims.length === 0 ? <EmptyState boundary={payloadBoundary} /> : null}
        {state === "ready" && view === "pending" && selectedClaim ? (
          <ClaimCard
            key={selectedClaim.id}
            claim={selectedClaim}
            note={notes[selectedClaim.id] ?? ""}
            busy={busyClaim === selectedClaim.id}
            position={safeSelectedClaimIndex + 1}
            total={pendingClaims.length}
            onPrevious={() => setSelectedClaimIndex(Math.max(0, safeSelectedClaimIndex - 1))}
            onNext={() => setSelectedClaimIndex(Math.min(pendingClaims.length - 1, safeSelectedClaimIndex + 1))}
            onNoteChange={(value) => setNotes((current) => ({ ...current, [selectedClaim.id]: value.slice(0, NOTE_LIMIT) }))}
            onReview={(action) => void submitReview(selectedClaim, action)}
          />
        ) : null}
        {state === "ready" && view === "history" && history.length === 0 ? <HistoryEmptyState /> : null}
        {state === "ready" && view === "history" && history.length > 0 ? (
          <div className="grid gap-3">
            <p className="text-xs font-semibold text-zinc-500">Showing {history.length} most recent decisions{historyHasMore ? "; older records are available." : "."}</p>
            <section className="grid gap-3" aria-label="Approval and revocation history">
              {history.map((item) => <HistoryCard key={item.id} item={item} />)}
            </section>
            {historyHasMore ? (
              <button type="button" onClick={() => void loadOlderHistory()} disabled={historyLoading} className="mx-auto inline-flex min-h-11 items-center gap-2 rounded-md border border-violet-300/30 bg-violet-300/10 px-4 py-2 text-xs font-black uppercase text-violet-50 transition hover:bg-violet-300/15 disabled:cursor-wait disabled:opacity-60">
                <RefreshCw className={`size-4 ${historyLoading ? "animate-spin" : ""}`} aria-hidden="true" />
                {historyLoading ? "Loading older decisions" : "Load older decisions"}
              </button>
            ) : null}
          </div>
        ) : null}
        {state === "ready" ? (
          <section className="rounded-lg border border-cyan-300/15 bg-[#06101b] px-4 sm:px-5">
            <ManagedGameIdentityLinks />
          </section>
        ) : null}
      </div>
    </main>
  );
}

function HistoryCard({ item }: { item: PlayerGameIdentityHistory }) {
  const labels = {
    claim_approved: { title: "Link approved", tone: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" },
    claim_rejected: { title: "Request rejected", tone: "border-rose-300/25 bg-rose-300/10 text-rose-100" },
    link_revoked: { title: "Link revoked", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
  } as const;
  const label = labels[item.action];
  return (
    <article className="rounded-lg border border-white/10 bg-black/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Authenticated owner decision</p>
          <h2 className="mt-1 text-xl font-black text-white">{item.account_name || "DZN Player"} <span className="text-zinc-500">on</span> {item.server_name || "DZN Server"}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-zinc-400"><Clock3 className="size-3.5" aria-hidden="true" />{formatDate(item.created_at)}</p>
        </div>
        <span className={`rounded-md border px-3 py-1.5 text-xs font-black uppercase ${label.tone}`}>{label.title}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <DetailBox label="Game profile" value={item.player_name || "Name not available"} />
        <DetailBox label="Resolved exact game ID" value={item.player_id || "Not recorded"} emphasis />
        <DetailBox label="Linked Discord account" value={item.requester_discord_id || "Not recorded"} />
        <DetailBox label="Decision by" value={item.actor_name || item.actor_user_id || "System actor unavailable"} />
      </div>
      <div className="mt-3 rounded-md border border-white/10 bg-white/[0.035] p-3">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Recorded reason</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-zinc-200">{item.note || "No reason was recorded for this earlier decision."}</p>
        <p className="mt-2 break-all text-[10px] font-semibold text-zinc-600">Audit reference: {item.id}</p>
      </div>
    </article>
  );
}

function HistoryEmptyState() {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
      <h2 className="text-xl font-black text-white">No recorded decisions yet</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">Approvals, rejections and revocations for servers you are authorized to manage will appear here.</p>
    </section>
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
  position,
  total,
  onPrevious,
  onNext,
  onNoteChange,
  onReview,
}: {
  claim: PlayerGameIdentityClaim;
  note: string;
  busy: boolean;
  position: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onNoteChange: (value: string) => void;
  onReview: (action: ReviewAction) => void;
}) {
  const context = claim.review_context ?? fallbackReviewContext(claim);
  const exactId = claim.submitted_player_id ?? "Not available";
  const serverHref = claim.public_slug ? `/servers/${claim.public_slug}` : null;
  const requesterDiscordId = claim.requester_discord_id;
  const [confirmed, setConfirmed] = useState({ ownership: false, match: false, account: false });
  const approvalReady = confirmed.ownership && confirmed.match && confirmed.account;
  const profileInitial = (claim.account_name || "DZN").trim().charAt(0).toUpperCase();

  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-[#050a12] shadow-[0_0_36px_rgba(0,0,0,0.28)]">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-white/10 bg-[#07111d] px-3 py-3 sm:px-4">
        <button type="button" aria-label="Previous request" onClick={onPrevious} disabled={position <= 1 || busy} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/10 px-2.5 text-xs font-black text-zinc-300 hover:border-cyan-300/30 hover:text-white disabled:opacity-35 sm:px-3">
          <ArrowLeft className="size-4" aria-hidden="true" /> <span className="hidden sm:inline">Previous</span>
        </button>
        <p className="truncate text-center text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400 sm:text-xs sm:tracking-[0.16em]">Reviewing {position} of {total}</p>
        <button type="button" aria-label="Next request" onClick={onNext} disabled={position >= total || busy} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/10 px-2.5 text-xs font-black text-zinc-300 hover:border-cyan-300/30 hover:text-white disabled:opacity-35 sm:px-3">
          <span className="hidden sm:inline">Next</span> <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="grid min-w-0 gap-4 p-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)]">
        <section className="min-w-0 rounded-lg border border-white/10 bg-[#08101b] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Player claim details</p>
              <h2 className="mt-1 text-xl font-black text-white">One account, one server, one game profile</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[10px] font-black uppercase text-amber-100">Pending</span>
              <span className="rounded-md border border-violet-300/30 bg-violet-300/10 px-2.5 py-1 text-[10px] font-black uppercase text-violet-100">Display-only link</span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 items-center gap-3 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] p-3 sm:col-span-2">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-cyan-300/30 bg-[#111d2b] text-xl font-black text-cyan-100">
                {claim.account_avatar_url ? (
                  // Discord avatar URLs are validated and assembled by the private server-side read model.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={claim.account_avatar_url} alt={`${claim.account_name || "DZN Player"} Discord profile`} className="h-full w-full object-cover" />
                ) : profileInitial}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Player / claim name</p>
                <p className="mt-1 truncate text-lg font-black text-white">{claim.account_name || "DZN Player"}</p>
                <p className="mt-1 text-xs font-semibold text-zinc-400">Requested {formatDate(claim.requested_at)}</p>
              </div>
            </div>
            <DetailBox icon={<Server className="size-4" />} label="Server" value={claim.server_name || "DZN Server"} href={serverHref} />
            <DetailBox icon={<Gamepad2 className="size-4" />} label="Imported game profile" value={claim.player_name || "Name not available"} />
            <DetailBox icon={<UserRound className="size-4" />} label="Requesting Discord account" value={requesterDiscordId || "Not recorded"} />
            <DetailBox icon={<FileCheck2 className="size-4" />} label="Request source" value={claim.request_source === "gamertag_lookup" ? "Gamertag candidate" : "Legacy exact-ID request"} />
          </div>

          <details className="group mt-3 rounded-lg border border-white/10 bg-black/25">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-black uppercase text-zinc-300">
              Technical details
              <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="grid gap-3 border-t border-white/10 p-3 sm:grid-cols-2">
              <DetailBox label="Resolved exact game ID" value={exactId} emphasis copyable />
              <DetailBox label="Public-safe masked ID" value={claim.player_id || "Not available"} copyable />
              <DetailBox label="DZN account reference" value={claim.user_id} copyable />
              <DetailBox label="Request reference" value={claim.id} copyable />
            </div>
          </details>

          <div className="mt-3 rounded-lg border border-violet-300/15 bg-violet-300/[0.05] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-200">Game stats links</p>
            <p className="mt-2 text-sm font-semibold text-zinc-300">No active verified links are shown for this request. An approved link appears in the managed links section below.</p>
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-cyan-300/20 bg-[#071421] p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200"><ShieldCheck className="size-4" aria-hidden="true" /> Decision workspace</p>
              <h2 className="mt-1 text-xl font-black text-white">Confirm the evidence, then decide</h2>
            </div>
            <div className="min-w-44 rounded-lg border border-amber-300/20 bg-amber-300/[0.07] p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">Evidence strength</p>
              <div className="mt-2 flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((bar) => <span key={bar} className={`h-2 flex-1 rounded-sm ${bar < 2 ? "bg-amber-300" : "bg-white/10"}`} />)}
              </div>
              <p className="mt-2 text-sm font-black text-amber-100">Owner verification required</p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-300/[0.06] p-3">
            <h3 className="text-sm font-black text-white">What you must confirm</h3>
            <div className="mt-3 grid gap-2">
              <VerificationToggle checked={confirmed.ownership} onChange={(checked) => setConfirmed((current) => ({ ...current, ownership: checked }))} label="Independent ownership evidence confirms this imported game profile belongs to the requesting account." />
              <VerificationToggle checked={confirmed.match} onChange={(checked) => setConfirmed((current) => ({ ...current, match: checked }))} label="The selected server and imported game profile match the evidence, not just the public gamertag." />
              <VerificationToggle checked={confirmed.account} onChange={(checked) => setConfirmed((current) => ({ ...current, account: checked }))} label="This is not a shared account, alternate user, or uncertain identity match." />
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <GuidanceList title="Approve when" items={context.approve_when} tone="approve" />
            <GuidanceList title="Reject when" items={context.reject_when} tone="reject" />
          </div>

          <details className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06]">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-black uppercase text-amber-100">Missing evidence and guidance</summary>
            <div className="grid gap-2 border-t border-amber-300/15 p-3">
              {context.checks.map((check) => <div key={`${claim.id}-${check.label}`} className="flex gap-2 text-xs font-semibold leading-5 text-zinc-300">{check.status === "ready" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />}<span><strong className="text-white">{check.label}:</strong> {check.detail}</span></div>)}
              <p className="mt-1 text-xs font-semibold leading-5 text-amber-100/85">{context.missing_evidence_guidance}</p>
            </div>
          </details>

          <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3">
            <label className="text-xs font-black uppercase text-zinc-200" htmlFor={`review-note-${claim.id}`}>Review note (optional)</label>
            <textarea id={`review-note-${claim.id}`} value={note} maxLength={NOTE_LIMIT} onChange={(event) => onNoteChange(event.target.value)} placeholder="Add evidence checked or the reason for rejection..." className="mt-2 min-h-20 w-full resize-y rounded-md border border-white/10 bg-black/35 px-3 py-2 text-sm font-semibold text-white outline-none placeholder:text-zinc-600 focus:border-cyan-300/45" />
            <p className="mt-1 text-right text-[10px] font-semibold text-zinc-600">{note.length}/{NOTE_LIMIT}</p>
          </div>

          <p className="mt-3 text-xs font-semibold leading-5 text-zinc-500">{context.boundary}</p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={busy} onClick={() => onReview("reject")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-rose-300/35 bg-rose-300/10 px-4 text-xs font-black uppercase text-rose-100 hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-50"><XCircle className="size-4" aria-hidden="true" /> Reject Request</button>
            <button type="button" disabled={busy || !approvalReady} onClick={() => onReview("approve")} title={approvalReady ? "Approve this verified link" : "Complete all three verification checks before approval"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-emerald-300/35 bg-emerald-300/15 px-4 text-xs font-black uppercase text-emerald-100 hover:bg-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 className="size-4" aria-hidden="true" /> {busy ? "Saving decision" : "Approve Link"}</button>
          </div>
        </section>
      </div>
    </article>
  );
}

function DetailBox({
  label,
  value,
  href,
  emphasis = false,
  icon,
  copyable = false,
}: {
  label: string;
  value: string;
  href?: string | null;
  emphasis?: boolean;
  icon?: ReactNode;
  copyable?: boolean;
}) {
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
      <div className="flex items-center gap-2 text-zinc-500">
        {icon ? <span className="text-cyan-300" aria-hidden="true">{icon}</span> : null}
        <p className="text-[10px] font-black uppercase tracking-[0.14em]">{label}</p>
      </div>
      <div className="mt-2 flex min-w-0 items-start gap-2">
        <p className={`min-w-0 flex-1 text-sm font-black ${emphasis ? "text-cyan-50" : "text-white"}`}>{content}</p>
        {copyable ? <CopyButton value={value} label={label} /> : null}
      </div>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-white/10 text-zinc-400 hover:border-cyan-300/30 hover:text-cyan-100"
    >
      {copied ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
    </button>
  );
}

function VerificationToggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${checked ? "border-emerald-300/30 bg-emerald-300/10" : "border-white/10 bg-black/20 hover:border-emerald-300/20"}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${checked ? "border-emerald-300 bg-emerald-300 text-[#03100b]" : "border-zinc-600 text-transparent"}`}>
        <CheckCircle2 className="size-4" aria-hidden="true" />
      </span>
      <span className="text-xs font-semibold leading-5 text-zinc-200">{label}</span>
    </label>
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
    approve_when: ["Independent owner evidence confirms the resolved exact game profile belongs to this logged-in account."],
    reject_when: ["The resolved profile, selected server, or independent ownership evidence cannot be confirmed."],
    missing_evidence_guidance: "Do not approve from the public gamertag or leaderboard position alone. Confirm ownership independently or reject the request.",
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
