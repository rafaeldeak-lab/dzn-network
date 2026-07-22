"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

type OwnerEvent = {
  id: string;
  name: string;
  slug: string;
  status: string;
  visibility: string | null;
  category: string | null;
  eventType: string | null;
  startsAt: string | null;
  endsAt: string | null;
  registeredServers: number;
};

type OwnerLinkedServer = {
  id: string;
  label: string;
  category: string | null;
  status: string | null;
};

type OwnerEventsPayload = {
  ok: true;
  creatorEventGovernanceConfigured: boolean;
  creatorEventAdmin: boolean;
  events: OwnerEvent[];
  linkedServers: OwnerLinkedServer[];
  warnings: string[];
};

type OwnerSuggestion = {
  id: string;
  title: string;
  description: string;
  competitionFormat: string;
  platform: string;
  mapName: string | null;
  suggestedServerScope: string;
  moderationStatus: string;
  publicStatus: string;
  creatorDecision: string | null;
  creatorResponse: string | null;
  convertedEventSlug: string | null;
  upvotes: number;
  downvotes: number;
  netScore: number;
  reportCount: number;
  submittedAt: string;
  submittedBy: string;
};

type OwnerSuggestionsPayload = {
  ok: boolean;
  status?: number;
  creatorEventAdmin: boolean;
  suggestions: OwnerSuggestion[];
  generatedAt?: string;
  error?: string;
  message?: string;
};

type LoadState = "loading" | "ready" | "unauthorized" | "forbidden" | "error";

const EVENT_TYPES = [
  ["capture_the_flag", "Capture The Flag"],
  ["community_cup", "Community Cup"],
  ["bot_tournament", "Bot Tournament"],
  ["faction_wars", "Faction Wars"],
  ["seasonal_wars", "Seasonal Wars"],
  ["kill_race", "Kill Race"],
  ["survival_challenge", "Survival Challenge"],
] as const;

export function OwnerEventsPage({ mode = "index" }: { mode?: "index" | "create" }) {
  const [state, setState] = useState<LoadState>("loading");
  const [payload, setPayload] = useState<OwnerEventsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/owner/events", { cache: "no-store", credentials: "include", headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          setState("unauthorized");
          return;
        }
        if (response.status === 403) {
          setState("forbidden");
          return;
        }
        if (!response.ok) throw new Error("Event Control could not be loaded.");
        setPayload(await response.json() as OwnerEventsPayload);
        setState("ready");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Event Control could not be loaded.");
        setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  if (state === "loading") return <OwnerEventsShell><LoadingBlock /></OwnerEventsShell>;
  if (state === "unauthorized") {
    return (
      <OwnerEventsShell>
        <AccessBlock title="Sign in required" message="Sign in with a platform-owner Discord account to view Event Control." actionHref="/login?returnTo=%2Fowner%2Fevents" actionLabel="Sign in with Discord" />
      </OwnerEventsShell>
    );
  }
  if (state === "forbidden") {
    return (
      <OwnerEventsShell>
        <AccessBlock title="403 - platform owner only" message="Event Control is available only inside the DZN Owner Console." />
      </OwnerEventsShell>
    );
  }
  if (state === "error" || !payload) {
    return (
      <OwnerEventsShell>
        <AccessBlock title="Event Control unavailable" message={error ?? "Event Control could not be loaded."} />
      </OwnerEventsShell>
    );
  }

  return (
    <OwnerEventsShell>
      <Header payload={payload} />
      {mode === "create" ? <CreateOfficialEventPanel payload={payload} /> : <EventInventoryPanel payload={payload} />}
    </OwnerEventsShell>
  );
}

function OwnerEventsShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#02030a] px-4 py-6 text-zinc-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/owner" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
            Owner Console
          </Link>
          <Link href="/events" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
            Public Events
          </Link>
        </div>
        {children}
      </div>
    </main>
  );
}

function Header({ payload }: { payload: OwnerEventsPayload }) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/35 p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">Event Control</p>
      <h1 className="mt-1 text-3xl font-black text-white">Creator-governed official events</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
        Official DZN event creation and mutation require the single creator event capability. Public participation remains separate from official administration.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <StatusCard title="Creator event governance configured" value={payload.creatorEventGovernanceConfigured ? "Yes" : "No"} tone={payload.creatorEventGovernanceConfigured ? "good" : "warn"} />
        <StatusCard title="Current session creator capability" value={payload.creatorEventAdmin ? "Yes" : "No"} tone={payload.creatorEventAdmin ? "good" : "warn"} />
      </div>
    </section>
  );
}

function EventInventoryPanel({ payload }: { payload: OwnerEventsPayload }) {
  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white">Official event inventory</h2>
            <p className="mt-1 text-sm text-zinc-400">Read-only list of existing official competitive events.</p>
          </div>
          {payload.creatorEventAdmin ? (
            <Link href="/owner/events/create" className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-xs font-black uppercase text-cyan-50 hover:bg-cyan-300/20">
              Create official event
            </Link>
          ) : null}
        </div>
        <EventList events={payload.events} />
      </section>
      <OwnerSuggestionModerationPanel creatorEventAdmin={payload.creatorEventAdmin} />
    </div>
  );
}

function CreateOfficialEventPanel({ payload }: { payload: OwnerEventsPayload }) {
  const [selectedServerId, setSelectedServerId] = useState(payload.linkedServers[0]?.id ?? "");
  const [form, setForm] = useState({
    name: "",
    description: "",
    event_type: "community_cup",
    starts_at: "",
    ends_at: "",
    server_limit: "16",
    team_limit: "16",
    status: "registration_open",
    rules: "",
    rewards: "",
    visibility: "public",
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string; href?: string } | null>(null);

  const selectedServer = useMemo(
    () => payload.linkedServers.find((server) => server.id === selectedServerId) ?? payload.linkedServers[0] ?? null,
    [payload.linkedServers, selectedServerId],
  );
  const canSubmit = Boolean(payload.creatorEventAdmin && selectedServer && form.name.trim().length >= 3 && !submitting);
  const updateField = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !selectedServer) return;
    setSubmitting(true);
    setMessage({ tone: "info", text: "Creating official event..." });
    try {
      const response = await fetch("/api/owner/events", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          ...form,
          hosting_server_id: selectedServer.id,
          server_limit: Number(form.server_limit),
          team_limit: Number(form.team_limit),
        }),
      });
      const result = await response.json() as { ok?: boolean; event_slug?: string; message?: string; error?: string };
      if (!response.ok || !result.ok || !result.event_slug) {
        throw new Error(result.message ?? result.error ?? "Official event could not be created.");
      }
      setMessage({
        tone: "success",
        text: result.message ?? "Official event created.",
        href: `/events/${result.event_slug}`,
      });
    } catch (submitError) {
      setMessage({ tone: "error", text: submitError instanceof Error ? submitError.message : "Official event could not be created." });
    } finally {
      setSubmitting(false);
    }
  }

  if (!payload.creatorEventAdmin) {
    return (
      <section className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-5">
        <h2 className="text-xl font-black text-white">Creator capability required</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
          This session can inspect Event Control, but official event creation is reserved for the configured DZN platform creator.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-white">Create official event</h2>
          <p className="mt-1 text-sm text-zinc-400">Phase 1 reuses the existing category-locked event creation path under creator-only authorization.</p>
        </div>
        <Link href="/owner/events" className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:text-white">
          Back to inventory
        </Link>
      </div>
      <form onSubmit={submit} className="mt-4 grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Event name">
            <input value={form.name} onChange={(event) => updateField("name", event.target.value)} maxLength={90} className={inputClass()} />
          </Field>
          <Field label="Event type">
            <select value={form.event_type} onChange={(event) => updateField("event_type", event.target.value)} className={inputClass()}>
              {EVENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Hosting server">
          <select value={selectedServer?.id ?? ""} onChange={(event) => setSelectedServerId(event.target.value)} className={inputClass()}>
            {payload.linkedServers.length ? payload.linkedServers.map((server) => (
              <option key={server.id} value={server.id}>{server.label}{server.category ? ` / ${server.category}` : ""}</option>
            )) : <option value="">No linked servers available for this creator session</option>}
          </select>
        </Field>
        <Field label="Description">
          <textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} maxLength={500} className={`${inputClass()} min-h-24 resize-y`} />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Starts at">
            <input type="datetime-local" value={form.starts_at} onChange={(event) => updateField("starts_at", event.target.value)} className={inputClass()} />
          </Field>
          <Field label="Ends at">
            <input type="datetime-local" value={form.ends_at} onChange={(event) => updateField("ends_at", event.target.value)} className={inputClass()} />
          </Field>
          <Field label="Server limit">
            <input type="number" min={2} max={128} value={form.server_limit} onChange={(event) => updateField("server_limit", event.target.value)} className={inputClass()} />
          </Field>
          <Field label="Team limit">
            <input type="number" min={2} max={128} value={form.team_limit} onChange={(event) => updateField("team_limit", event.target.value)} className={inputClass()} />
          </Field>
          <Field label="Initial status">
            <select value={form.status} onChange={(event) => updateField("status", event.target.value)} className={inputClass()}>
              <option value="registration_open">Registration open</option>
              <option value="upcoming">Upcoming</option>
              <option value="standby">Standby</option>
            </select>
          </Field>
          <Field label="Visibility">
            <select value={form.visibility} onChange={(event) => updateField("visibility", event.target.value)} className={inputClass()}>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </Field>
        </div>
        <Field label="Rules">
          <textarea value={form.rules} onChange={(event) => updateField("rules", event.target.value)} maxLength={4000} className={`${inputClass()} min-h-28 resize-y`} />
        </Field>
        <Field label="Rewards">
          <textarea value={form.rewards} onChange={(event) => updateField("rewards", event.target.value)} maxLength={2000} className={`${inputClass()} min-h-20 resize-y`} />
        </Field>
        {message ? <MessagePanel message={message} /> : null}
        <button disabled={!canSubmit} className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-xs font-black uppercase text-cyan-50 disabled:cursor-not-allowed disabled:opacity-45">
          {submitting ? "Creating..." : "Create official event"}
        </button>
      </form>
    </section>
  );
}

function EventList({ events }: { events: OwnerEvent[] }) {
  if (!events.length) return <p className="mt-4 rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">No stored official events found.</p>;
  return (
    <div className="mt-4 grid gap-2">
      {events.map((event) => (
        <Link key={event.id} href={`/events/${event.slug}`} className="rounded-lg border border-white/10 bg-black/25 p-3 hover:border-cyan-300/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-black text-white">{event.name}</h3>
            <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase text-zinc-300">{event.status}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{event.eventType ?? "event"} / {event.category ?? "uncategorized"} / {event.registeredServers} registered</p>
        </Link>
      ))}
    </div>
  );
}

function OwnerSuggestionModerationPanel({ creatorEventAdmin }: { creatorEventAdmin: boolean }) {
  const [payload, setPayload] = useState<OwnerSuggestionsPayload | null>(null);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    fetch(`/api/owner/events/suggestions?status=${encodeURIComponent(status)}&limit=40`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!active) return;
        const result = await response.json() as OwnerSuggestionsPayload;
        if (!response.ok || !result.ok) {
          throw new Error(result.message ?? result.error ?? "Suggestion moderation could not be loaded.");
        }
        setPayload(result);
        setMessage(null);
      })
      .catch((loadError) => {
        if (!active) return;
        setMessage({ tone: "error", text: loadError instanceof Error ? loadError.message : "Suggestion moderation could not be loaded." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status]);

  function changeStatus(value: string) {
    if (value === status) return;
    setLoading(true);
    setStatus(value);
  }

  async function runModeration(suggestion: OwnerSuggestion, action: string) {
    const reason = reasons[suggestion.id] ?? "";
    setMessage({ tone: "info", text: action === "convert" ? "Saving draft" : "Updating moderation state" });
    const path = action === "convert"
      ? `/api/owner/events/suggestions/${encodeURIComponent(suggestion.id)}/convert`
      : `/api/owner/events/suggestions/${encodeURIComponent(suggestion.id)}/moderate`;
    const body = action === "convert"
      ? { reason }
      : { action, reason, creator_response: reason };
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.message ?? result.error ?? "Suggestion action failed.");
      setMessage({ tone: "success", text: result.message ?? "Suggestion updated." });
      const refresh = await fetch(`/api/owner/events/suggestions?status=${encodeURIComponent(status)}&limit=40`, {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (refresh.ok) setPayload(await refresh.json() as OwnerSuggestionsPayload);
    } catch (actionError) {
      setMessage({ tone: "error", text: actionError instanceof Error ? actionError.message : "Suggestion action failed." });
    }
  }

  const suggestions = payload?.suggestions ?? [];

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-white">Suggestions overview</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Community ideas are moderated here. Only the configured platform creator can change status or convert an accepted idea into a private draft.
          </p>
        </div>
        <select value={status} onChange={(event) => changeStatus(event.target.value)} className={inputClass()}>
          <option value="all">All suggestions</option>
          <option value="pending_moderation">Pending moderation</option>
          <option value="public_voting">Public voting</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="accepted">Accepted</option>
          <option value="revision_requested">Revision requested</option>
          <option value="rejected">Rejected</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      {!creatorEventAdmin ? (
        <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-3 text-sm text-amber-50">
          This session can view safe suggestion summaries only. Creator capability is required for moderation and draft conversion.
        </p>
      ) : null}
      {message ? <MessagePanel message={message} /> : null}
      {loading ? <LoadingBlock /> : null}
      {!loading && !suggestions.length ? <p className="mt-4 rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">No suggestions match this filter.</p> : null}
      <div className="mt-4 grid gap-3">
        {suggestions.map((suggestion) => (
          <article key={suggestion.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase text-zinc-500">
                  <span>{suggestion.publicStatus}</span>
                  <span>/</span>
                  <span>{suggestion.moderationStatus}</span>
                  <span>/</span>
                  <span>{suggestion.submittedBy}</span>
                </div>
                <h3 className="mt-2 text-base font-black text-white">{suggestion.title}</h3>
              </div>
              <div className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase text-zinc-300">
                Net {suggestion.netScore} / Reports {suggestion.reportCount}
              </div>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{suggestion.description}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase text-zinc-500">
              <span>{suggestion.competitionFormat}</span>
              <span>{suggestion.platform}</span>
              {suggestion.mapName ? <span>{suggestion.mapName}</span> : null}
              <span>{suggestion.suggestedServerScope}</span>
            </div>
            {suggestion.convertedEventSlug ? (
              <Link href={`/events/${suggestion.convertedEventSlug}`} className="mt-3 inline-flex rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-100">
                View converted draft
              </Link>
            ) : null}
            {creatorEventAdmin ? (
              <div className="mt-3 grid gap-3">
                <textarea
                  value={reasons[suggestion.id] ?? ""}
                  onChange={(event) => setReasons((current) => ({ ...current, [suggestion.id]: event.target.value }))}
                  maxLength={500}
                  className={`${inputClass()} min-h-20 resize-y`}
                  placeholder="Creator reason or public response"
                />
                <div className="flex flex-wrap gap-2">
                  <ActionButton label="Approve voting" onClick={() => runModeration(suggestion, "approve_public_voting")} />
                  <ActionButton label="Shortlist" onClick={() => runModeration(suggestion, "shortlist")} />
                  <ActionButton label="Accept" onClick={() => runModeration(suggestion, "accept")} />
                  <ActionButton label="Revision" onClick={() => runModeration(suggestion, "request_revision")} />
                  <ActionButton label="Reject" onClick={() => runModeration(suggestion, "reject")} />
                  <ActionButton label="Archive" onClick={() => runModeration(suggestion, "archive")} />
                  <ActionButton label="Restore" onClick={() => runModeration(suggestion, "restore")} />
                  <ActionButton label="Convert to draft" onClick={() => runModeration(suggestion, "convert")} accent />
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function ActionButton({ label, onClick, accent = false }: { label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-[11px] font-black uppercase ${
        accent ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function inputClass() {
  return "w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/45";
}

function StatusCard({ title, value, tone }: { title: string; value: string; tone: "good" | "warn" }) {
  return (
    <section className={`rounded-lg border p-3 ${tone === "good" ? "border-emerald-300/20 bg-emerald-300/[0.04]" : "border-amber-300/20 bg-amber-300/[0.04]"}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{title}</div>
      <div className="mt-1 text-base font-black text-white">{value}</div>
    </section>
  );
}

function MessagePanel({ message }: { message: { tone: "error" | "success" | "info"; text: string; href?: string } }) {
  const color = message.tone === "success" ? "border-emerald-300/25 bg-emerald-300/[0.05] text-emerald-100" : message.tone === "error" ? "border-red-300/25 bg-red-300/[0.05] text-red-100" : "border-cyan-300/25 bg-cyan-300/[0.05] text-cyan-100";
  return (
    <div className={`rounded-lg border p-3 text-sm font-bold ${color}`}>
      {message.text}
      {message.href ? <Link href={message.href} className="ml-3 underline">View event</Link> : null}
    </div>
  );
}

function LoadingBlock() {
  return <section className="h-48 animate-pulse rounded-lg border border-white/10 bg-white/[0.035]" />;
}

function AccessBlock({ title, message, actionHref, actionLabel }: { title: string; message: string; actionHref?: string; actionLabel?: string }) {
  return (
    <section className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-5">
      <h1 className="text-2xl font-black text-white">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">{message}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="mt-4 inline-flex rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-xs font-black uppercase text-cyan-50">
          {actionLabel}
        </Link>
      ) : null}
    </section>
  );
}
