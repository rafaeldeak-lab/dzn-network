"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

type Opponent = { id: string; name: string; category: string };

export function OpponentPicker({ serverId, rulesetKey, value, onChange, disabled = false }: {
  serverId: string; rulesetKey: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; servers: Opponent[]; nextOffset: number | null }>({ key: "", servers: [], nextOffset: null });
  const [error, setError] = useState("");
  const queryKey = JSON.stringify([serverId, rulesetKey, search, offset, retry]);
  const ready = result.key === queryKey;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ search, ruleset: rulesetKey, offset: String(offset) });
        const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/wars/opponents?${query}`, { signal: controller.signal, credentials: "include", cache: "no-store" });
        const body = await response.json() as { ok: boolean; servers?: Opponent[]; nextOffset?: number | null };
        if (!response.ok || !body.ok || !Array.isArray(body.servers)) throw new Error("Server choices unavailable");
        if (controller.signal.aborted) return;
        setResult({ key: queryKey, servers: body.servers, nextOffset: body.nextOffset ?? null });
        setError("");
      } catch {
        if (!controller.signal.aborted) {
          setError("Could not load server choices. Please try again.");
          setResult({ key: queryKey, servers: [], nextOffset: null });
        }
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [serverId, rulesetKey, search, offset, retry, queryKey]);

  return <fieldset className="min-w-0 space-y-2" disabled={disabled}>
    <legend className="mb-2 text-xs font-bold text-emerald-100">Choose opponent server</legend>
    <label className="flex items-center gap-2 rounded border border-white/20 bg-black/30 px-3 py-2">
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <input aria-label="Search opponent servers by name" type="search" maxLength={80} value={search} onChange={event => { setSearch(event.target.value); setOffset(0); onChange(""); }} placeholder="Search by server name" className="min-w-0 w-full bg-transparent text-sm text-white outline-none" />
    </label>
    <div className="max-h-64 overflow-y-auto" aria-busy={!ready}>
      {!ready ? <p role="status" className="py-2 text-sm text-zinc-400">Loading server choices...</p> : error ?
        <div role="alert" className="flex items-center gap-2 text-sm text-amber-100">{error}<button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center" title="Retry server search" aria-label="Retry server search" onClick={() => { onChange(""); setRetry(number => number + 1); }}><RefreshCw className="h-5 w-5" /></button></div> : result.servers.length ?
        result.servers.map(server => <label key={server.id} className="flex min-w-0 cursor-pointer items-start gap-3 border-b border-white/10 py-3 text-sm">
          <input type="radio" name="war-opponent" value={server.id} checked={value === server.id} onChange={() => onChange(server.id)} className="mt-1" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]"><strong>{server.name}</strong><span className="block text-xs text-zinc-400">{server.category}</span></span>
        </label>) : <p role="status" className="py-2 text-sm text-zinc-400">No eligible servers found{search ? " for this name" : " on this page"}. Both servers must be live, public and in the same category.</p>}
    </div>
    {ready && <div className="flex gap-3 text-sm">
      {offset > 0 && <button type="button" onClick={() => { onChange(""); setOffset(Math.max(0, offset - 100)); }}>Previous servers</button>}
      {result.nextOffset !== null && <button type="button" onClick={() => { onChange(""); setOffset(result.nextOffset!); }}>More servers</button>}
    </div>}
  </fieldset>;
}
