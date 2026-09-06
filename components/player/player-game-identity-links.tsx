"use client";

import { AlertTriangle, CheckCircle2, Gamepad2, Loader2, Search, ShieldCheck } from "lucide-react";
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

type PublicServerOption = {
  linked_server_id?: string | null;
  public_slug?: string | null;
  slug?: string | null;
  server_name?: string | null;
  name?: string | null;
  server_type?: string | null;
  map_name?: string | null;
  platform?: string | null;
  current_players?: number | null;
  max_players?: number | null;
};

type PublicServersPayload = {
  ok?: boolean;
  servers?: PublicServerOption[];
  data?: { servers?: PublicServerOption[] };
};

type ServerChoice = {
  ref: string;
  name: string;
  meta: string;
  publicSlug: string | null;
  linkedServerId: string | null;
};

type ServerPickerState =
  | { status: "loading"; options: ServerChoice[] }
  | { status: "ready"; options: ServerChoice[] }
  | { status: "error"; options: ServerChoice[]; message: string };

const emptyPayload: IdentityPayload = {
  ok: true,
  source: "unavailable",
  private: true,
  presentation_only: true,
  active_links: [],
  claims: [],
  proof_flow: {
    player_step: "Choose the DayZ server from the list.",
    owner_step: "Paste the game ID or proof code the server owner gives you.",
    match_rule: "A server owner or DZN admin checks it before stats connect. DZN never links stats just from a display name.",
  },
  boundary:
    "Verified game links only decide which stats appear on your profile. They do not affect payment, ownership, scoring, rankings, discovery, reviews, events, XP, calling cards, Server Wars, CTF, or eligibility.",
};

export function PlayerGameIdentityLinks() {
  const [identityState, setIdentityState] = useState<IdentityState>({ status: "loading", data: null, message: null });
  const [serverPickerState, setServerPickerState] = useState<ServerPickerState>({ status: "loading", options: [] });
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle", message: null });
  const [selectedServerRef, setSelectedServerRef] = useState("");
  const [manualServerRef, setManualServerRef] = useState("");
  const [serverSearch, setServerSearch] = useState("");
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
          setIdentityState({ status: "error", data: null, message: "Game stat linking is not available right now." });
        }
      });

    return () => {
      activeRequest = false;
    };
  }, []);

  useEffect(() => {
    let activeRequest = true;
    loadServerChoices()
      .then((result) => {
        if (!activeRequest) return;
        setServerPickerState(result);
      })
      .catch(() => {
        if (activeRequest) {
          setServerPickerState({ status: "error", options: [], message: "The server list could not load right now." });
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
  const serverOptions = serverPickerState.options;
  const hasServerOptions = serverOptions.length > 0;
  const normalizedManualServerRef = useMemo(() => manualServerRef.trim(), [manualServerRef]);
  const normalizedPlayerId = useMemo(() => playerId.trim(), [playerId]);
  const resolvedServerRef = hasServerOptions ? selectedServerRef : normalizedManualServerRef;
  const selectedServer = useMemo(() => serverOptions.find((server) => server.ref === selectedServerRef) ?? null, [selectedServerRef, serverOptions]);
  const filteredServerOptions = useMemo(() => {
    const query = serverSearch.trim().toLowerCase();
    const options = query
      ? serverOptions.filter((server) => `${server.name} ${server.meta}`.toLowerCase().includes(query))
      : serverOptions;
    return options.slice(0, 30);
  }, [serverOptions, serverSearch]);
  const canSubmit = resolvedServerRef.length > 0 && normalizedPlayerId.length > 0 && submitState.status !== "submitting";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitState({ status: "submitting", message: "Sending your game ID for owner/admin approval." });
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
          server_slug: resolvedServerRef,
          player_id: normalizedPlayerId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !payload?.ok) {
        setSubmitState({ status: "error", message: friendlyIdentityMessage(payload?.message ?? "This link request could not be created.") });
        return;
      }

      setSubmitState({ status: "success", message: friendlyIdentityMessage(payload.message ?? "Request sent. A server owner or DZN admin will check it.") });
      setSelectedServerRef("");
      setManualServerRef("");
      setServerSearch("");
      setPlayerId("");
      const nextState = await loadIdentityLinks();
      setIdentityState(nextState);
    } catch {
      setSubmitState({ status: "error", message: "This link request could not be created right now." });
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
            <h2 className="text-lg font-black uppercase text-white">Link My Game Stats</h2>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">
              Pick the server you play on, add the game ID the owner gives you, and DZN will check it before linking stats to your Discord account.
            </p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-black uppercase text-cyan-100">
          <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          Owner Checked
        </span>
      </div>

      {identityState.status === "loading" ? (
        <div className="mt-5 flex items-center gap-3 rounded-md border border-white/10 bg-white/6 p-4 text-sm font-semibold text-slate-300">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-cyan-100" />
          Checking your linked stats...
        </div>
      ) : null}

      {identityState.status === "error" ? (
        <IdentityNotice tone="amber" text={identityState.message} />
      ) : null}

      {data?.source === "unavailable" ? (
        <IdentityNotice tone="amber" text="Game stat linking is not available in this environment yet. Older directly linked profiles still work." />
      ) : null}

      {data ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
          <div className="space-y-3">
            {hasRows ? (
              <>
                {activeLinks.map((link) => (
                  <IdentityRow
                    key={link.id}
                    title={link.server_name ?? "DZN Server"}
                    subtitle={`${link.player_name ?? "Game profile"} - ${link.player_id}`}
                    statusLabel={link.verified_source === "dzn_admin_approved" ? "DZN checked" : "Owner checked"}
                    statusTone="emerald"
                    href={link.public_slug ? `/servers/profile?slug=${encodeURIComponent(link.public_slug)}` : null}
                    meta={link.verified_at ? `Linked ${formatDate(link.verified_at)}` : "Linked"}
                  />
                ))}
                {claims.map((claim) => (
                  <IdentityRow
                    key={claim.id}
                    title={claim.server_name ?? "DZN Server"}
                    subtitle={`${claim.player_name ?? "Game profile"} - ${claim.player_id}`}
                    statusLabel={friendlyStatusLabel(claim.status)}
                    statusTone={claim.status === "approved" ? "emerald" : claim.status === "rejected" ? "red" : "violet"}
                    href={claim.public_slug ? `/servers/profile?slug=${encodeURIComponent(claim.public_slug)}` : null}
                    meta={claim.reviewed_at ? `Checked ${formatDate(claim.reviewed_at)}` : claim.requested_at ? `Sent ${formatDate(claim.requested_at)}` : "Request recorded"}
                  />
                ))}
              </>
            ) : (
              <div className="rounded-md border border-white/10 bg-white/6 p-4">
                <p className="text-sm font-black uppercase text-white">Stats Not Linked Yet</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
                  Your public profile can show real leaderboard stats after the right server owner or a DZN admin approves your game ID.
                </p>
              </div>
            )}

            <div className="rounded-md border border-amber-300/20 bg-amber-300/8 p-3 text-sm font-semibold leading-6 text-amber-50">
              {friendlyBoundary(data.boundary)}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="rounded-md border border-cyan-300/20 bg-cyan-300/8 p-4">
            <p className="text-sm font-black uppercase text-white">Ask To Link Stats</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
              You only need two things: the server you play on and the game ID or proof code the owner gives you.
            </p>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <label className="block text-xs font-black uppercase text-cyan-100" htmlFor={hasServerOptions ? "game-identity-server-search" : "game-identity-server-fallback"}>
                  Choose server
                </label>
                {serverPickerState.status === "loading" ? (
                  <span className="inline-flex items-center gap-1 text-[0.68rem] font-black uppercase text-slate-400">
                    <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                    Loading
                  </span>
                ) : null}
              </div>

              {hasServerOptions ? (
                <div className="mt-2 space-y-2">
                  <div className="relative">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      id="game-identity-server-search"
                      value={serverSearch}
                      onChange={(event) => setServerSearch(event.target.value)}
                      autoComplete="off"
                      className="min-h-11 w-full rounded-md border border-white/12 bg-slate-950/80 py-2 pl-9 pr-3 text-sm font-semibold text-white outline-none transition focus:border-cyan-200"
                      placeholder="Search for your server"
                    />
                  </div>
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-white/10 bg-slate-950/50 p-2">
                    {filteredServerOptions.length > 0 ? (
                      filteredServerOptions.map((server) => (
                        <button
                          key={server.ref}
                          type="button"
                          aria-pressed={selectedServerRef === server.ref}
                          onClick={() => setSelectedServerRef(server.ref)}
                          className={`flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left transition ${
                            selectedServerRef === server.ref
                              ? "border-cyan-200/70 bg-cyan-300/16 text-white"
                              : "border-white/10 bg-white/5 text-slate-200 hover:border-cyan-200/35 hover:bg-cyan-300/10"
                          }`}
                        >
                          <span>
                            <span className="block text-sm font-black uppercase">{server.name}</span>
                            <span className="mt-1 block text-xs font-semibold text-slate-400">{server.meta}</span>
                          </span>
                          {selectedServerRef === server.ref ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-cyan-100" /> : null}
                        </button>
                      ))
                    ) : (
                      <p className="rounded-md border border-white/10 bg-white/5 p-3 text-sm font-semibold text-slate-300">
                        No servers match that search. Clear the search and try the server&apos;s public name.
                      </p>
                    )}
                  </div>
                  {selectedServer ? (
                    <p className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-black uppercase text-emerald-100">
                      Selected: {selectedServer.name}
                    </p>
                  ) : (
                    <p className="text-xs font-semibold leading-5 text-slate-400">Pick one server before sending the request.</p>
                  )}
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <input
                    id="game-identity-server-fallback"
                    value={manualServerRef}
                    onChange={(event) => setManualServerRef(event.target.value)}
                    autoComplete="off"
                    className="min-h-11 w-full rounded-md border border-white/12 bg-slate-950/80 px-3 text-sm font-semibold text-white outline-none transition focus:border-cyan-200"
                    placeholder="Server code from owner"
                  />
                  <p className="text-xs font-semibold leading-5 text-amber-100">
                    The server list could not load. Ask the owner for the server code, or refresh and choose from the list.
                  </p>
                </div>
              )}
            </div>

            <label className="mt-4 block text-xs font-black uppercase text-cyan-100" htmlFor="game-identity-player-id">
              Game ID or proof code from owner
            </label>
            <input
              id="game-identity-player-id"
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
              autoComplete="off"
              className="mt-2 min-h-11 w-full rounded-md border border-white/12 bg-slate-950/80 px-3 text-sm font-semibold text-white outline-none transition focus:border-cyan-200"
              placeholder="Paste the code here"
            />
            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-cyan-200/60 bg-cyan-300 px-4 text-sm font-black uppercase text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:border-slate-500 disabled:bg-slate-700 disabled:text-slate-300"
            >
              {submitState.status === "submitting" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <CheckCircle2 aria-hidden="true" className="h-4 w-4" />}
              Send For Check
            </button>
            {submitState.message ? (
              <p className={`mt-3 rounded-md border px-3 py-2 text-sm font-semibold leading-6 ${submitState.status === "error" ? "border-red-300/25 bg-red-400/10 text-red-50" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"}`}>
                {submitState.message}
              </p>
            ) : null}
            <div className="mt-4 grid gap-2">
              <ProofStep text="Choose the server you play on." />
              <ProofStep text="Paste the game ID or proof code the owner gives you." />
              <ProofStep text="A server owner or DZN admin checks it before your profile stats connect." />
              <ProofStep text="This only changes profile display. It never changes rankings, payments, or eligibility." />
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
    return { status: "error", data: null, message: payload?.message ?? "Log in with Discord to view linked game stats." };
  }
  if (!response.ok || !payload?.ok) {
    return { status: "ready", data: emptyPayload, message: payload?.message ?? "Linked game stats are not available right now." };
  }
  return { status: "ready", data: payload, message: null };
}

async function loadServerChoices(): Promise<ServerPickerState> {
  const response = await fetch("/api/public/servers?limit=120", {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as PublicServersPayload | null;
  if (!response.ok || !payload?.ok) {
    return { status: "error", options: [], message: "The server list could not load right now." };
  }

  const rows = payload.servers ?? payload.data?.servers ?? [];
  return { status: "ready", options: toServerChoices(rows) };
}

function toServerChoices(rows: PublicServerOption[]) {
  const choices = new Map<string, ServerChoice>();
  for (const row of rows) {
    const publicSlug = safeText(row.public_slug ?? row.slug);
    const linkedServerId = safeText(row.linked_server_id);
    const ref = publicSlug ?? linkedServerId;
    if (!ref || choices.has(ref)) continue;

    const name = safeText(row.server_name ?? row.name) ?? "DZN Server";
    const details = [
      safeText(row.server_type),
      safeText(row.map_name),
      safeText(row.platform),
      formatPlayerCount(row.current_players, row.max_players),
    ].filter(Boolean);
    choices.set(ref, {
      ref,
      name,
      meta: details.length > 0 ? details.join(" / ") : "Public DZN server",
      publicSlug,
      linkedServerId,
    });
  }
  return Array.from(choices.values()).sort((a, b) => a.name.localeCompare(b.name));
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

function friendlyStatusLabel(status: IdentityClaimRow["status"]) {
  if (status === "pending") return "Waiting for check";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Not approved";
  return "Cancelled";
}

function friendlyBoundary(value: string) {
  return value
    .replace("Verified game identity links are private account bridges for stats display only.", "Verified game links only decide which stats appear on your profile.")
    .replace("They do not affect billing, ownership, scoring, rankings, discovery, reviews, events, XP, calling cards, Server Wars, CTF, or competitive eligibility.", "They do not affect payment, ownership, scoring, rankings, discovery, reviews, events, XP, calling cards, Server Wars, CTF, or eligibility.");
}

function friendlyIdentityMessage(value: string) {
  return value
    .replaceAll("ADM player profile", "game profile")
    .replaceAll("ADM player ID", "game ID")
    .replaceAll("Identity claim", "Link request")
    .replaceAll("identity claim", "link request")
    .replaceAll("owner/admin", "owner or admin")
    .replaceAll("DZN will not match by player name.", "DZN will not guess from a player name.");
}

function safeText(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function formatPlayerCount(current: unknown, max: unknown) {
  const currentNumber = typeof current === "number" && Number.isFinite(current) ? current : null;
  const maxNumber = typeof max === "number" && Number.isFinite(max) ? max : null;
  if (currentNumber === null && maxNumber === null) return null;
  if (currentNumber !== null && maxNumber !== null) return `${currentNumber}/${maxNumber} online`;
  if (currentNumber !== null) return `${currentNumber} online`;
  return `${maxNumber} slots`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
