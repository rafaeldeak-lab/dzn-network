"use client";

import { AlertTriangle, CheckCircle2, Gamepad2, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type IdentityLinkRow = {
  id: string;
  linked_server_id: string;
  player_profile_id: string;
  player_id: string;
  player_name: string | null;
  status: "active" | "revoked";
  verified_source: "owner_approved" | "dzn_admin_approved";
  verified_at: string | null;
  revoked_at: string | null;
  server_name: string | null;
  public_slug: string | null;
};

type IdentityClaimRow = {
  id: string;
  linked_server_id: string;
  player_profile_id: string;
  player_id: string;
  player_name: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requested_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  server_name: string | null;
  public_slug: string | null;
  reviewer_name: string | null;
};

type IdentityPayload = {
  ok: true;
  source: "player_game_identity_links" | "unavailable";
  private: true;
  presentation_only: true;
  active_links: IdentityLinkRow[];
  claims: IdentityClaimRow[];
  proof_flow: {
    player_step: string;
    owner_step: string;
    match_rule: string;
  };
  boundary: string;
};

type IdentityState =
  | { status: "loading"; data: null; message: null }
  | { status: "ready"; data: IdentityPayload; message: string | null }
  | { status: "error"; data: null; message: string };

type SubmitState =
  | { status: "idle"; message: null }
  | { status: "submitting"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const emptyPayload: IdentityPayload = {
  ok: true,
  source: "unavailable",
  private: true,
  presentation_only: true,
  active_links: [],
  claims: [],
  proof_flow: {
    player_step: "Submit the public server slug or DZN server ID plus the exact ADM player ID.",
    owner_step: "A matching server owner or DZN admin approves the request.",
    match_rule: "DZN links stats only by exact server plus ADM player ID, never by display name.",
  },
  boundary:
    "Verified game identity links are private account bridges for stats display only. They do not affect payment, ownership, scoring, rankings, discovery, reviews, events, XP, calling cards, Server Wars, CTF, or eligibility.",
};

export function PlayerGameIdentityLinks() {
  const [identityState, setIdentityState] = useState<IdentityState>({ status: "loading", data: null, message: null });
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle", message: null });
  const [serverRef, setServerRef] = useState("");
  const [playerId, setPlayerId] = useState("");

  useEffect(() => {
    let activeRequest = true;
    loadIdentityLinks()
      .then((result) => {
        if (!activeRequest) return;
        setIdentityState(result);
      })
      .catch(() => {
        if (activeRequest) {
          setIdentityState({ status: "error", data: null, message: "Game identity linking is not available right now." });
        }
      });

    return () => {
      activeRequest = false;
    };
  }, []);

  const data = identityState.status === "ready" ? identityState.data : null;
  const activeLinks = data?.active_links ?? [];
  const claims = data?.claims ?? [];
  const hasRows = activeLinks.length > 0 || claims.length > 0;
  const normalizedServerRef = useMemo(() => serverRef.trim(), [serverRef]);
  const normalizedPlayerId = useMemo(() => playerId.trim(), [playerId]);
  const canSubmit = normalizedServerRef.length > 0 && normalizedPlayerId.length > 0 && submitState.status !== "submitting";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitState({ status: "submitting", message: "Sending this exact ADM player ID for owner/admin approval." });
    try {
      const response = await fetch("/api/player/game-identities", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          server_slug: normalizedServerRef,
          player_id: normalizedPlayerId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !payload?.ok) {
        setSubmitState({ status: "error", message: payload?.message ?? "This identity request could not be created." });
        return;
      }

      setSubmitState({ status: "success", message: payload.message ?? "Identity claim created for owner/admin review." });
      setServerRef("");
      setPlayerId("");
      const nextState = await loadIdentityLinks();
      setIdentityState(nextState);
    } catch {
      setSubmitState({ status: "error", message: "This identity request could not be created right now." });
    }
  }

  return (
    <section className="rounded-lg border border-cyan-300/25 bg-slate-950/78 p-5 shadow-[0_0_36px_rgba(34,211,238,0.1)] backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-cyan-300/35 bg-cyan-300/10 text-cyan-100">
            <Gamepad2 aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-black uppercase text-white">Verified Game Identity</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">
              Link your Discord account to the correct ADM player ID through owner/admin approval. Names are never enough.
            </p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-black uppercase text-cyan-100">
          <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          Private Proof Flow
        </span>
      </div>

      {identityState.status === "loading" ? (
        <div className="mt-5 flex items-center gap-3 rounded-md border border-white/10 bg-white/6 p-4 text-sm font-semibold text-slate-300">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-cyan-100" />
          Checking verified identity links...
        </div>
      ) : null}

      {identityState.status === "error" ? (
        <IdentityNotice tone="amber" text={identityState.message} />
      ) : null}

      {data?.source === "unavailable" ? (
        <IdentityNotice tone="amber" text="Identity link storage is not available in this environment yet. Existing direct Discord-linked profiles remain compatible." />
      ) : null}

      {data ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div className="space-y-3">
            {hasRows ? (
              <>
                {activeLinks.map((link) => (
                  <IdentityRow
                    key={link.id}
                    title={link.server_name ?? "DZN Server"}
                    subtitle={`${link.player_name ?? "ADM player"} - ${link.player_id}`}
                    statusLabel={link.verified_source === "dzn_admin_approved" ? "DZN admin approved" : "Owner approved"}
                    statusTone="emerald"
                    href={link.public_slug ? `/servers/profile?slug=${encodeURIComponent(link.public_slug)}` : null}
                    meta={link.verified_at ? `Verified ${formatDate(link.verified_at)}` : "Verified"}
                  />
                ))}
                {claims.map((claim) => (
                  <IdentityRow
                    key={claim.id}
                    title={claim.server_name ?? "DZN Server"}
                    subtitle={`${claim.player_name ?? "ADM player"} - ${claim.player_id}`}
                    statusLabel={claim.status}
                    statusTone={claim.status === "approved" ? "emerald" : claim.status === "rejected" ? "red" : "violet"}
                    href={claim.public_slug ? `/servers/profile?slug=${encodeURIComponent(claim.public_slug)}` : null}
                    meta={claim.reviewed_at ? `Reviewed ${formatDate(claim.reviewed_at)}` : claim.requested_at ? `Requested ${formatDate(claim.requested_at)}` : "Request recorded"}
                  />
                ))}
              </>
            ) : (
              <div className="rounded-md border border-white/10 bg-white/6 p-4">
                <p className="text-sm font-black uppercase text-white">No verified game identity yet</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
                  Your public leaderboard stats will stay unlinked until an exact ADM player ID claim is approved.
                </p>
              </div>
            )}

            <div className="rounded-md border border-amber-300/20 bg-amber-300/8 p-3 text-sm font-semibold leading-6 text-amber-50">
              {data.boundary}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="rounded-md border border-cyan-300/20 bg-cyan-300/8 p-4">
            <p className="text-sm font-black uppercase text-white">Request A Link</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
              Use the public server slug from the server page and the exact ADM player ID supplied by the owner or approved evidence.
            </p>
            <label className="mt-4 block text-xs font-black uppercase text-cyan-100" htmlFor="game-identity-server-ref">
              Server slug or DZN server ID
            </label>
            <input
              id="game-identity-server-ref"
              value={serverRef}
              onChange={(event) => setServerRef(event.target.value)}
              autoComplete="off"
              className="mt-2 min-h-11 w-full rounded-md border border-white/12 bg-slate-950/80 px-3 text-sm font-semibold text-white outline-none transition focus:border-cyan-200"
              placeholder="pandora-pvp"
            />
            <label className="mt-4 block text-xs font-black uppercase text-cyan-100" htmlFor="game-identity-player-id">
              Exact ADM player ID
            </label>
            <input
              id="game-identity-player-id"
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
              autoComplete="off"
              className="mt-2 min-h-11 w-full rounded-md border border-white/12 bg-slate-950/80 px-3 text-sm font-semibold text-white outline-none transition focus:border-cyan-200"
              placeholder="7656119..."
            />
            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-cyan-200/60 bg-cyan-300 px-4 text-sm font-black uppercase text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:border-slate-500 disabled:bg-slate-700 disabled:text-slate-300"
            >
              {submitState.status === "submitting" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <CheckCircle2 aria-hidden="true" className="h-4 w-4" />}
              Request Approval
            </button>
            {submitState.message ? (
              <p className={`mt-3 rounded-md border px-3 py-2 text-sm font-semibold leading-6 ${submitState.status === "error" ? "border-red-300/25 bg-red-400/10 text-red-50" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"}`}>
                {submitState.message}
              </p>
            ) : null}
            <div className="mt-4 grid gap-2">
              <ProofStep text={data.proof_flow.player_step} />
              <ProofStep text={data.proof_flow.owner_step} />
              <ProofStep text={data.proof_flow.match_rule} />
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

async function loadIdentityLinks(): Promise<IdentityState> {
  const response = await fetch("/api/player/game-identities", {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as IdentityPayload & { message?: string } | null;
  if (response.status === 401) {
    return { status: "error", data: null, message: payload?.message ?? "Log in with Discord to view game identity links." };
  }
  if (!response.ok || !payload?.ok) {
    return { status: "ready", data: emptyPayload, message: payload?.message ?? "Game identity links are not available right now." };
  }
  return { status: "ready", data: payload, message: null };
}

function IdentityRow({
  title,
  subtitle,
  statusLabel,
  statusTone,
  href,
  meta,
}: {
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: "emerald" | "violet" | "red";
  href: string | null;
  meta: string;
}) {
  const body = (
    <>
      <span>
        <span className="block text-sm font-black uppercase text-white">{title}</span>
        <span className="mt-1 block text-xs font-semibold text-slate-400">{subtitle}</span>
        <span className="mt-2 block text-xs font-bold uppercase text-slate-500">{meta}</span>
      </span>
      <span className={`inline-flex w-fit shrink-0 rounded-md border px-2 py-1 text-[0.68rem] font-black uppercase ${statusToneClasses(statusTone)}`}>
        {statusLabel.replace(/_/g, " ")}
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-white/6 p-3 transition hover:border-cyan-200/45">
        {body}
      </Link>
    );
  }

  return <div className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-white/6 p-3">{body}</div>;
}

function IdentityNotice({ text, tone }: { text: string; tone: "amber" | "red" }) {
  return (
    <div className={`mt-5 flex items-start gap-3 rounded-md border p-4 text-sm font-semibold leading-6 ${tone === "red" ? "border-red-300/25 bg-red-400/10 text-red-50" : "border-amber-300/25 bg-amber-300/10 text-amber-50"}`}>
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      {text}
    </div>
  );
}

function ProofStep({ text }: { text: string }) {
  return (
    <span className="flex items-start gap-2 rounded-md border border-white/10 bg-slate-950/50 px-3 py-2 text-xs font-semibold leading-5 text-slate-300">
      <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-100" />
      {text}
    </span>
  );
}

function statusToneClasses(tone: "emerald" | "violet" | "red") {
  if (tone === "emerald") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (tone === "red") return "border-red-300/30 bg-red-400/10 text-red-50";
  return "border-violet-300/30 bg-violet-300/10 text-violet-100";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
