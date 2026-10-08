"use client";
/* eslint-disable @next/next/no-img-element -- Discord avatar URLs are user-specific and rendered at a fixed small size. */

import {
  CheckCircle2,
  CircleAlert,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Status = "pending" | "approved" | "rejected" | "revoked";
type RequestItem = {
  id: string;
  linkedServerId: string;
  serverName: string;
  note: string | null;
  status: Status;
  decisionReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  requester: {
    username: string;
    discordId: string | null;
    avatarUrl: string | null;
  };
  reviewedBy: string | null;
};
type Audit = {
  id: string;
  requestId: string;
  serverName: string;
  action: string | null;
  previousStatus: Status | null;
  nextStatus: Status;
  reason: string | null;
  actorUsername: string | null;
  createdAt: string | null;
};
type Payload = {
  ok?: boolean;
  requests?: RequestItem[];
  audit?: Audit[];
  delivery?: string;
  message?: string;
};

export function OwnerDiscordAccessPage() {
  const [status, setStatus] = useState<Status | "all">("pending");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "blocked" | "error">(
    "loading",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setState("loading");
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (appliedSearch) params.set("q", appliedSearch);
      const response = await fetch(
        `/api/owner/discord/owner-access-requests?${params}`,
        { credentials: "include", cache: "no-store" },
      );
      const next = (await response.json().catch(() => null)) as Payload | null;
      if (response.status === 401 || response.status === 403) {
        setState("blocked");
        return;
      }
      if (!response.ok || !next?.ok)
        throw new Error(
          next?.message ?? "Owner Discord requests are unavailable.",
        );
      setPayload(next);
      setState("ready");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Owner Discord requests are unavailable.",
      );
      setState("error");
    }
  }, [appliedSearch, status]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  const requests = payload?.requests ?? [];
  const audit = payload?.audit ?? [];
  async function decide(
    request: RequestItem,
    action: "approved" | "rejected" | "revoked",
  ) {
    const reason = (reasonById[request.id] ?? "").trim();
    if (reason.length < 5) {
      setNotice("Enter a clear decision reason first.");
      return;
    }
    setBusyId(request.id);
    setNotice(null);
    try {
      const response = await fetch("/api/owner/discord/owner-access-requests", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: request.id,
          action,
          reason,
          decisionNonce: crypto.randomUUID(),
        }),
      });
      const next = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
      } | null;
      if (!response.ok || !next?.ok)
        throw new Error(next?.message ?? "The decision could not be saved.");
      setReasonById((current) => ({ ...current, [request.id]: "" }));
      setNotice(
        action === "approved"
          ? "Approval recorded. Discord delivery is still deliberately unconfigured."
          : `${action[0].toUpperCase()}${action.slice(1)} decision recorded.`,
      );
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The decision could not be saved.",
      );
    } finally {
      setBusyId(null);
    }
  }
  return (
    <main className="min-h-screen bg-[#02050b] px-3 py-4 text-zinc-100 sm:px-5 lg:px-8">
      <div className="mx-auto max-w-[1480px]">
        <nav className="flex flex-wrap gap-2">
          <Link
            href="/owner"
            className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200"
          >
            Owner console
          </Link>
          <Link
            href="/"
            className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200"
          >
            Home
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] px-3 py-2 text-xs font-black text-cyan-100"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </nav>
        <header className="mt-6 border-b border-cyan-300/20 pb-6">
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">
            Private platform-owner workspace
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">
            DZN Discord owner access
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
            Approve access only after checking the exact linked server. Every
            request and decision stays in the private audit history. This screen
            cannot send an invite or alter a Discord role until central-server
            delivery is configured separately.
          </p>
        </header>
        {notice ? (
          <p className="mt-5 rounded-md border border-amber-300/25 bg-amber-300/[0.08] px-4 py-3 text-sm font-bold text-amber-100">
            {notice}
          </p>
        ) : null}
        {state === "blocked" ? (
          <p className="mt-8 text-sm text-amber-100">
            Platform-owner access is required.
          </p>
        ) : null}
        {state === "ready" ? (
          <>
            <section className="mt-5 rounded-lg border border-cyan-300/20 bg-[#07111d] p-4">
              <div className="flex items-center gap-2 text-cyan-100">
                <ShieldCheck size={18} />
                <span className="font-black">Decision queue only</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {payload?.delivery}
              </p>
            </section>
            <section className="mt-5 flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-4 md:flex-row">
              <div className="flex flex-wrap gap-2">
                {(
                  ["all", "pending", "approved", "rejected", "revoked"] as const
                ).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setStatus(item)}
                    className={`rounded-md border px-3 py-2 text-xs font-black uppercase ${status === item ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-zinc-400"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setAppliedSearch(search.trim());
                }}
                className="flex min-w-0 flex-1 gap-2 md:justify-end"
              >
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find owner or server"
                  className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#02050b] px-3 text-sm text-white md:max-w-sm"
                />
                <button className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 text-xs font-black">
                  <Search size={14} />
                  Search
                </button>
              </form>
            </section>
            <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="grid gap-3">
                {requests.length ? (
                  requests.map((request) => (
                    <article
                      key={request.id}
                      className="rounded-lg border border-white/10 bg-white/[0.025] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          {request.requester.avatarUrl ? (
                            <img
                              src={request.requester.avatarUrl}
                              alt=""
                              className="h-10 w-10 rounded-full border border-cyan-300/30"
                            />
                          ) : (
                            <div className="grid h-10 w-10 place-items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-sm font-black text-cyan-100">
                              {request.requester.username
                                .slice(0, 1)
                                .toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-black">
                              {request.requester.username}
                            </p>
                            <p className="text-xs text-zinc-400">
                              {request.serverName}
                            </p>
                          </div>
                        </div>
                        <Badge status={request.status} />
                      </div>
                      <p className="mt-3 text-sm leading-6 text-zinc-400">
                        {request.note ||
                          "No additional verification note was supplied."}
                      </p>
                       <dl className="mt-3 grid gap-2 rounded-md border border-cyan-300/15 bg-black/20 p-3 text-xs sm:grid-cols-2">
                         <div className="min-w-0">
                           <dt className="font-black uppercase tracking-[0.08em] text-zinc-500">
                             Linked server ID
                           </dt>
                           <dd className="mt-1 break-all font-mono text-cyan-100">
                             {request.linkedServerId}
                           </dd>
                         </div>
                         <div className="min-w-0">
                           <dt className="font-black uppercase tracking-[0.08em] text-zinc-500">
                             Discord ID
                           </dt>
                           <dd className="mt-1 break-all font-mono text-cyan-100">
                             {request.requester.discordId || "Not available"}
                           </dd>
                         </div>
                       </dl>
                      <p className="mt-2 text-xs text-zinc-500">
                        Requested {formatTime(request.createdAt)}
                        {request.reviewedBy
                          ? ` - reviewed by ${request.reviewedBy}`
                          : ""}
                      </p>
                      {request.decisionReason ? (
                        <p className="mt-2 rounded-md border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
                          Latest decision: {request.decisionReason}
                        </p>
                      ) : null}
                      {request.status === "pending" ||
                      request.status === "approved" ? (
                        <div className="mt-4 grid gap-2">
                          <textarea
                            value={reasonById[request.id] ?? ""}
                            onChange={(event) =>
                              setReasonById((current) => ({
                                ...current,
                                [request.id]: event.target.value,
                              }))
                            }
                            maxLength={400}
                            placeholder="Required decision reason"
                            className="min-h-20 rounded-md border border-white/10 bg-[#02050b] px-3 py-2 text-sm text-white"
                          />
                          <div className="flex flex-wrap gap-2">
                            {request.status === "pending" ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busyId === request.id}
                                  onClick={() =>
                                    void decide(request, "approved")
                                  }
                                  className="inline-flex items-center gap-2 rounded-md border border-emerald-300/30 bg-emerald-300/[0.08] px-3 py-2 text-xs font-black text-emerald-100"
                                >
                                  <CheckCircle2 size={14} />
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={busyId === request.id}
                                  onClick={() =>
                                    void decide(request, "rejected")
                                  }
                                  className="inline-flex items-center gap-2 rounded-md border border-rose-300/30 bg-rose-300/[0.08] px-3 py-2 text-xs font-black text-rose-100"
                                >
                                  <XCircle size={14} />
                                  Reject
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={busyId === request.id}
                                onClick={() => void decide(request, "revoked")}
                                className="inline-flex items-center gap-2 rounded-md border border-amber-300/30 bg-amber-300/[0.08] px-3 py-2 text-xs font-black text-amber-100"
                              >
                                <CircleAlert size={14} />
                                Revoke access
                              </button>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="rounded-lg border border-white/10 p-5 text-sm text-zinc-400">
                    No matching owner-access requests.
                  </p>
                )}
              </div>
              <aside className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                <h2 className="font-black">Recent decisions</h2>
                <div className="mt-4 grid gap-3">
                  {audit.length ? (
                    audit.slice(0, 20).map((entry) => (
                      <article
                        key={entry.id}
                        className="border-b border-white/10 pb-3 text-xs"
                      >
                        <p className="font-black text-zinc-200">
                          {entry.serverName}
                        </p>
                        <p className="mt-1 text-cyan-100">
                          {entry.action}{" "}
                          {entry.previousStatus
                            ? `${entry.previousStatus} to ${entry.nextStatus}`
                            : entry.nextStatus}
                        </p>
                        <p className="mt-1 leading-5 text-zinc-400">
                          {entry.reason || "No reason"}
                        </p>
                        <p className="mt-1 text-zinc-500">
                          {entry.actorUsername || "DZN"} -{" "}
                          {formatTime(entry.createdAt)}
                        </p>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-400">
                      No decisions recorded.
                    </p>
                  )}
                </div>
              </aside>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
function Badge({ status }: { status: Status }) {
  const colors = {
    pending: "border-amber-300/30 text-amber-100",
    approved: "border-emerald-300/30 text-emerald-100",
    rejected: "border-rose-300/30 text-rose-100",
    revoked: "border-zinc-500/40 text-zinc-300",
  };
  return (
    <span
      className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${colors[status]}`}
    >
      {status}
    </span>
  );
}
function formatTime(value: string | null) {
  const time = value ? new Date(value) : null;
  return time && Number.isFinite(time.getTime())
    ? time.toLocaleString()
    : "recently";
}
