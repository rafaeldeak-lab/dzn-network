"use client";

import { ArrowLeft, ArrowRight, RefreshCw, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { PlayerSupportDetail, PlayerSupportList, PlayerSupportRequest } from "@/functions/_lib/player-request-support";

const stateLabels: Record<string, string> = { pending: "Awaiting review", approved: "Approved", rejected: "Declined", cancelled: "Cancelled" };
const actionLabels: Record<string, string> = { claim_requested: "Link requested", claim_approved: "Request approved", claim_rejected: "Request declined",
  claim_cancelled: "Request cancelled", link_created: "Account linked", link_revoked: "Link revoked" };

export function PlayerRequestSupportPanel() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [revision, setRevision] = useState(0);
  const [responseState, setResponseState] = useState<{
    key: string; data: PlayerSupportList | PlayerSupportDetail | null; error: string;
  } | null>(null);
  const requestKey = `${revision}:${query}`;
  const loading = responseState?.key !== requestKey;
  const data = loading ? null : responseState?.data;
  const error = loading ? "" : responseState?.error;

  useEffect(() => {
    const sync = () => {
      const url = new URL(location.href);
      const params = new URLSearchParams();
      for (const key of ["q", "status", "request", "cursor"]) {
        const value = url.searchParams.get(key); if (value) params.set(key, value);
      }
      setQuery(params.toString()); setSearch(params.get("q") ?? ""); setFilter(params.get("status") ?? "");
    };
    sync(); window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetch(`/api/owner/player-requests?${query}`, { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in to your platform-owner account."
          : response.status === 403 ? "Platform-owner access is required."
            : response.status === 404 ? "This request is no longer available."
              : response.status === 400 ? "These request filters are invalid. Clear them and try again."
                : "Request history could not be loaded. Please retry.");
        const result = await response.json() as PlayerSupportList | PlayerSupportDetail;
        if (!result.ok) throw new Error("Request history could not be loaded. Please retry.");
        if (active) setResponseState({ key: requestKey, data: result, error: "" });
      }).catch((reason: unknown) => {
        if (active) setResponseState({ key: requestKey, data: null,
          error: reason instanceof Error ? reason.message : "Request history could not be loaded." });
      });
    return () => { active = false; controller.abort(); };
  }, [query, requestKey]);

  const navigate = (params: URLSearchParams) => {
    const url = new URL(location.href);
    for (const key of ["q", "status", "request", "cursor"]) url.searchParams.delete(key);
    url.searchParams.set("view", "player-requests");
    params.forEach((value, key) => url.searchParams.set(key, value));
    window.history.pushState(null, "", url.pathname + url.search);
    setQuery(params.toString());
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim()); if (filter) params.set("status", filter);
    navigate(params);
  };
  const back = () => { const params = new URLSearchParams(query); params.delete("request"); params.delete("cursor"); navigate(params); };
  const details = data && "request" in data ? data : null;
  const list = data && "items" in data ? data : null;
  const isDetail = Boolean(new URLSearchParams(query).get("request"));

  return (
    <section className="h-full min-h-0 overflow-y-auto [overflow-wrap:anywhere]" aria-label="Player request support">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 py-4">
        <h2 className="text-xl font-bold text-white">Player Requests</h2>
        <button type="button" title="Refresh requests" aria-label="Refresh requests" disabled={loading}
          onClick={() => setRevision(value => value + 1)} className="inline-flex size-10 items-center justify-center rounded-md border border-white/20 hover:bg-white/10 disabled:opacity-40">
          <RefreshCw className="size-4" aria-hidden="true" />
        </button>
      </header>
      {isDetail ? (
        <button type="button" onClick={back} className="my-4 inline-flex items-center gap-2 text-sm font-bold text-cyan-200">
          <ArrowLeft className="size-4" aria-hidden="true" />Back to requests
        </button>
      ) : (
        <form onSubmit={submit} className="grid gap-3 border-b border-white/10 py-4 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
          <label className="grid gap-1 text-xs text-zinc-300">Find player, server or request
            <input type="search" value={search} maxLength={100} onChange={event => setSearch(event.target.value)}
              className="h-10 min-w-0 rounded-md border border-white/20 bg-black/30 px-3 text-sm text-white" />
          </label>
          <label className="grid gap-1 text-xs text-zinc-300">Status
            <select aria-label="Status" value={filter} onChange={event => setFilter(event.target.value)} className="h-10 min-w-0 rounded-md border border-white/20 bg-black px-3 text-sm text-white">
              <option value="">All requests</option>
              {Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button type="submit" className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md border border-cyan-300/30 bg-cyan-300/10 px-4 text-sm font-bold text-cyan-100">
            <Search className="size-4" aria-hidden="true" />Search
          </button>
        </form>
      )}
      {loading ? <p role="status" className="py-8 text-sm text-zinc-300">Loading request history...</p> : null}
      {error ? <div role="alert" className="border-l-2 border-rose-400 p-4 text-sm text-rose-100">{error}
        <button type="button" onClick={() => { setSearch(""); setFilter(""); navigate(new URLSearchParams()); setRevision(value => value + 1); }} className="ml-3 font-bold underline">Clear filters and retry</button>
      </div> : null}
      {list ? <>
        <div className="divide-y divide-white/10" aria-label="Requests list">
          {list.items.map(request => <button type="button" key={request.id} aria-label={`Open request ${request.id}`}
            onClick={() => { const params = new URLSearchParams(query); params.set("request", request.id); params.delete("cursor"); navigate(params); }}
            className="grid w-full min-w-0 gap-2 py-4 text-left hover:bg-white/5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]">
            <span className="min-w-0"><strong className="block text-sm text-white">{request.account_name ?? "Account unavailable"}</strong>
              <span className="text-xs text-zinc-400">{request.player_name ?? "Game name unavailable"}</span></span>
            <span className="min-w-0 text-sm text-zinc-200">{request.server_name ?? "Server unavailable"}<span className="block text-xs text-zinc-500">{request.id}</span></span>
            <span className="text-xs text-cyan-100">{stateLabels[request.status] ?? request.status}<span className="mt-1 block text-zinc-400">{formatTime(request.requested_at)}</span></span>
          </button>)}
        </div>
        {!list.items.length ? <p className="py-8 text-sm text-zinc-300">No requests match these filters.</p> : null}
      </> : null}
      {details ? <>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-4">
          <h3 className="text-lg font-bold text-white">{details.request.account_name ?? "Account unavailable"}</h3>
          <span className="text-sm font-semibold text-cyan-100">{stateLabels[details.request.status] ?? details.request.status}</span>
        </div>
        <RequestFacts request={details.request} />
        <h3 className="mt-6 border-b border-white/15 pb-3 text-base font-bold text-white">Recorded history</h3>
        <ol className="divide-y divide-white/10">
          {details.history.map(event => <li key={event.id} className="py-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><strong className="text-white">{actionLabels[event.action] ?? event.action.replaceAll("_", " ")}</strong>
              <time className="text-xs text-zinc-400">{formatTime(event.created_at)}</time></div>
            <p className="mt-1 text-zinc-300">{event.actor_name ?? "Actor not recorded"} - {event.result.replaceAll("_", " ")}</p>
            {event.actor_user_id ? <p className="text-xs text-zinc-500">Account: {event.actor_user_id}</p> : null}
            {event.note ? <p className="mt-2 text-zinc-200">{event.note}</p> : null}
          </li>)}
        </ol>
        {!details.history.length ? <p className="py-4 text-sm text-zinc-400">No audit events were recorded for this request.</p> : null}
      </> : null}
      {data?.nextCursor ? <button type="button" onClick={() => { const params = new URLSearchParams(query); params.set("cursor", data.nextCursor!); navigate(params); }}
        className="my-4 inline-flex items-center gap-2 rounded-md border border-white/20 px-4 py-2 text-sm font-bold">
        {details ? "Older events" : "Older requests"}<ArrowRight className="size-4" aria-hidden="true" />
      </button> : null}
    </section>
  );
}

function RequestFacts({ request }: { request: PlayerSupportRequest }) {
  const facts = [
    ["Request reference", request.id], ["Purpose", "Connect game statistics to this DZN account"],
    ["DZN account reference", request.user_id], ["Requesting Discord account", request.discord_id],
    ["Game server", request.server_name], ["Game server reference", request.linked_server_id],
    ["Server owner", request.owner_name], ["Owner account reference", request.owner_user_id],
    ["Discord community reference", request.guild_id], ["Server status", request.server_status],
    ["Submitted game name", request.player_name], ["Submitted game ID", request.player_id],
    ["Imported profile reference", request.player_profile_id], ["Imported account", request.imported_profile_present ? "Present" : "No longer found"],
    ["Active verified link", request.active_link_id ?? "None"], ["Requested", formatTime(request.requested_at)],
    ["Reviewed by", request.reviewer_name], ["Reviewed", request.reviewed_at ? formatTime(request.reviewed_at) : "Not reviewed"],
    ["Player-visible review note", request.review_note ?? "Not recorded"],
  ];
  return <dl className="grid min-w-0 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
    {facts.map(([label, value]) => <div key={label} className="min-w-0 border-b border-white/10 py-3">
      <dt className="text-xs text-zinc-400">{label}</dt><dd className="mt-1 text-sm text-zinc-100">{value || "Not recorded"}</dd>
    </div>)}
  </dl>;
}

function formatTime(value: string) {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (!Number.isFinite(date.getTime())) return "Time not recorded";
  return date.toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC";
}
