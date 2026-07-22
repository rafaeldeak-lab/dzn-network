"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Flag, Lightbulb, Loader2, MessageSquareWarning, ShieldCheck } from "lucide-react";

import { fetchJsonWithRetry, FetchJsonError } from "@/lib/client-fetch";

type Suggestion = {
  id: string;
  title: string;
  description: string;
  competitionFormat: string;
  platform: string;
  mapName: string | null;
  suggestedServerScope: string;
  status: string;
  creatorResponse: string | null;
  convertedEventSlug: string | null;
  upvotes: number;
  downvotes: number;
  netScore: number;
  votePercentage: number | null;
  reportCount: number;
  submittedAt: string;
};

type SuggestionsPayload = {
  ok: true;
  suggestions: Suggestion[];
  nextCursor: string | null;
  generatedAt: string;
  sort?: string;
};

type SubmitPayload = {
  ok: boolean;
  status?: number;
  suggestion?: { id: string; title: string; moderationStatus: string; publicStatus: string };
  message?: string;
  error?: string;
};

type VotePayload = {
  ok: boolean;
  upvoteCount: number;
  downvoteCount: number;
  netScore: number;
  userVote: number;
  message?: string;
};

type ReportPayload = {
  ok: boolean;
  reportCount: number;
  message?: string;
};

const FORMAT_OPTIONS = [
  ["server_vs_server", "Server vs Server"],
  ["player_vs_player", "Player vs Player"],
  ["clan_squad", "Clan / Squad"],
  ["stat_race", "Timed Stat Race"],
  ["community_challenge", "Community Challenge"],
  ["manual_referee", "Manual / Referee"],
] as const;

const PLATFORM_OPTIONS = [
  ["playstation", "PlayStation"],
  ["xbox", "Xbox"],
  ["pc", "PC"],
  ["cross_platform", "Cross Platform"],
  ["unsure", "Unsure"],
] as const;

const SORT_OPTIONS = [
  ["trending", "Trending"],
  ["newest", "Newest"],
  ["most_supported", "Most Supported"],
  ["most_discussed", "Most Discussed"],
] as const;

const initialForm = {
  title: "",
  description: "",
  competition_format: "server_vs_server",
  platform: "playstation",
  map_name: "",
  suggested_server_id: "",
  open_to_any_server: true,
  suggested_date_start: "",
  suggested_date_end: "",
  structure_notes: "",
  additional_notes: "",
};

export function EventSuggestionsPage() {
  const [sort, setSort] = useState("trending");
  const [payload, setPayload] = useState<SuggestionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [voteState, setVoteState] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    fetchJsonWithRetry<SuggestionsPayload>(`/api/events/suggestions?sort=${encodeURIComponent(sort)}&limit=20`, {
      headers: { accept: "application/json" },
      timeoutMs: 10_000,
      retries: 1,
    })
      .then((nextPayload) => {
        if (!active) return;
        setPayload(nextPayload);
        setLoadError(null);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Suggestions could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sort]);

  const suggestions = useMemo(() => payload?.suggestions ?? [], [payload]);
  const grouped = useMemo(() => ({
    trending: suggestions.slice(0, 4),
    new: suggestions.filter((suggestion) => suggestion.status === "public_voting").slice(0, 4),
    shortlisted: suggestions.filter((suggestion) => suggestion.status === "shortlisted"),
    accepted: suggestions.filter((suggestion) => suggestion.status === "accepted"),
    converted: suggestions.filter((suggestion) => suggestion.status === "converted_to_event"),
  }), [suggestions]);
  const wordCount = form.description.split(/\s+/).filter(Boolean).length;

  function updateField(key: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeSort(value: string) {
    if (value === sort) return;
    setLoading(true);
    setSort(value);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitMessage({ tone: "info", text: "Validating suggestion" });
    try {
      const result = await fetchJsonWithRetry<SubmitPayload>("/api/events/suggestions", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(form),
        timeoutMs: 12_000,
        retries: 0,
      });
      if (!result.ok) throw new Error(result.message ?? result.error ?? "Suggestion could not be submitted.");
      setSubmitMessage({ tone: "success", text: result.message ?? "Suggestion submitted for moderation." });
      setForm(initialForm);
    } catch (error) {
      if (error instanceof FetchJsonError && error.status === 401) {
        window.location.href = `/login?returnTo=${encodeURIComponent("/events/suggest")}`;
        return;
      }
      setSubmitMessage({ tone: "error", text: error instanceof Error ? error.message : "Suggestion could not be submitted." });
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(suggestion: Suggestion, value: 1 | -1) {
    const previous = payload;
    const previousVote = voteState[suggestion.id] ?? 0;
    const nextVote = previousVote === value ? 0 : value;
    setVoteState((current) => ({ ...current, [suggestion.id]: nextVote }));
    setPayload((current) => current ? {
      ...current,
      suggestions: current.suggestions.map((item) => item.id === suggestion.id ? applyOptimisticVote(item, previousVote, nextVote) : item),
    } : current);
    try {
      const result = await fetchJsonWithRetry<VotePayload>(`/api/events/suggestions/${encodeURIComponent(suggestion.id)}/vote`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ vote_value: value }),
        timeoutMs: 8_000,
        retries: 0,
      });
      setPayload((current) => current ? {
        ...current,
        suggestions: current.suggestions.map((item) => item.id === suggestion.id ? {
          ...item,
          upvotes: result.upvoteCount,
          downvotes: result.downvoteCount,
          netScore: result.netScore,
        } : item),
      } : current);
      setVoteState((current) => ({ ...current, [suggestion.id]: result.userVote }));
    } catch (error) {
      setPayload(previous);
      setVoteState((current) => ({ ...current, [suggestion.id]: previousVote }));
      if (error instanceof FetchJsonError && error.status === 401) {
        window.location.href = `/login?returnTo=${encodeURIComponent("/events/suggest")}`;
      }
    }
  }

  async function reportSuggestion(suggestion: Suggestion) {
    const previous = payload;
    setPayload((current) => current ? {
      ...current,
      suggestions: current.suggestions.map((item) => item.id === suggestion.id ? { ...item, reportCount: item.reportCount + 1 } : item),
    } : current);
    try {
      const result = await fetchJsonWithRetry<ReportPayload>(`/api/events/suggestions/${encodeURIComponent(suggestion.id)}/report`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ reason: "other" }),
        timeoutMs: 8_000,
        retries: 0,
      });
      setPayload((current) => current ? {
        ...current,
        suggestions: current.suggestions.map((item) => item.id === suggestion.id ? { ...item, reportCount: result.reportCount } : item),
      } : current);
    } catch (error) {
      setPayload(previous);
      if (error instanceof FetchJsonError && error.status === 401) {
        window.location.href = `/login?returnTo=${encodeURIComponent("/events/suggest")}`;
      }
    }
  }

  return (
    <main className="min-h-screen bg-[#02030a] px-4 py-8 text-zinc-100">
      <div className="mx-auto grid max-w-7xl gap-6">
        <section className="rounded-lg border border-cyan-300/18 bg-white/[0.035] p-5 shadow-[0_30px_110px_rgba(0,0,0,0.34)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">Community Suggestions</p>
              <h1 className="mt-2 text-3xl font-black uppercase text-white">Shape future DZN competitions</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">
                Community ideas enter moderation first. Only the DZN platform creator can convert an accepted suggestion into an official private draft.
              </p>
            </div>
            <Link href="/events" className="rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-xs font-black uppercase text-zinc-300 hover:text-white">
              Events Hub
            </Link>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3">
              <div className="flex items-center gap-2 text-xs font-black uppercase text-zinc-300">
                <Lightbulb className="h-4 w-4 text-cyan-200" />
                Public voting board
              </div>
              <div className="flex flex-wrap gap-2">
                {SORT_OPTIONS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changeSort(value)}
                    className={`rounded-lg border px-3 py-2 text-[11px] font-black uppercase ${sort === value ? "border-cyan-300/40 bg-cyan-300/12 text-cyan-50" : "border-white/10 bg-black/30 text-zinc-400 hover:text-white"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {loading ? <InlineLoading label="Loading suggestions" /> : null}
            {loadError ? <Message tone="error" text={loadError} /> : null}
            {!loading && suggestions.length === 0 ? <EmptyState /> : null}
            <SuggestionSection title="Trending" suggestions={grouped.trending} onVote={vote} onReport={reportSuggestion} voteState={voteState} />
            <SuggestionSection title="New" suggestions={grouped.new} onVote={vote} onReport={reportSuggestion} voteState={voteState} />
            <SuggestionSection title="Shortlisted" suggestions={grouped.shortlisted} onVote={vote} onReport={reportSuggestion} voteState={voteState} />
            <SuggestionSection title="Accepted" suggestions={grouped.accepted} onVote={vote} onReport={reportSuggestion} voteState={voteState} />
            <SuggestionSection title="Converted into Events" suggestions={grouped.converted} onVote={vote} onReport={reportSuggestion} voteState={voteState} />
          </section>

          <aside className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-cyan-200" />
              <h2 className="text-lg font-black text-white">Submit a suggestion</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Login is required. Suggestions are moderated before public voting and never become official events automatically.
            </p>
            <form onSubmit={submit} className="mt-5 grid gap-4">
              <Field label="Title">
                <input value={form.title} onChange={(event) => updateField("title", event.target.value)} maxLength={90} className={inputClass()} placeholder="Weekend server-vs-server cup" />
              </Field>
              <Field label={`Description (${wordCount}/40-250 words)`}>
                <textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} maxLength={2400} className={`${inputClass()} min-h-36 resize-y`} placeholder="Describe the event idea, fair rules, expected participants, and why it fits DZN." />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Format">
                  <select value={form.competition_format} onChange={(event) => updateField("competition_format", event.target.value)} className={inputClass()}>
                    {FORMAT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Platform">
                  <select value={form.platform} onChange={(event) => updateField("platform", event.target.value)} className={inputClass()}>
                    {PLATFORM_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Map or preference">
                <input value={form.map_name} onChange={(event) => updateField("map_name", event.target.value)} maxLength={80} className={inputClass()} placeholder="Chernarus, Livonia, any" />
              </Field>
              <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
                <input type="checkbox" checked={form.open_to_any_server} onChange={(event) => updateField("open_to_any_server", event.target.checked)} className="mt-1" />
                Open to any eligible server
              </label>
              {!form.open_to_any_server ? (
                <Field label="Suggested server">
                  <input value={form.suggested_server_id} onChange={(event) => updateField("suggested_server_id", event.target.value)} maxLength={96} className={inputClass()} placeholder="Optional server slug or linked server ID" />
                </Field>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Preferred start">
                  <input type="date" value={form.suggested_date_start} onChange={(event) => updateField("suggested_date_start", event.target.value)} className={inputClass()} />
                </Field>
                <Field label="Preferred end">
                  <input type="date" value={form.suggested_date_end} onChange={(event) => updateField("suggested_date_end", event.target.value)} className={inputClass()} />
                </Field>
              </div>
              <Field label="Proposed structure">
                <textarea value={form.structure_notes} onChange={(event) => updateField("structure_notes", event.target.value)} maxLength={1000} className={`${inputClass()} min-h-24 resize-y`} placeholder="Round robin, best-of-three, timed kill race, manual referee..." />
              </Field>
              <Field label="Additional notes">
                <textarea value={form.additional_notes} onChange={(event) => updateField("additional_notes", event.target.value)} maxLength={1000} className={`${inputClass()} min-h-20 resize-y`} placeholder="Scheduling constraints, referee needs, or moderation context." />
              </Field>
              <button type="submit" disabled={submitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/12 px-4 py-3 text-xs font-black uppercase text-cyan-50 hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-55">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                {submitting ? "Validating" : "Submit for moderation"}
              </button>
              {submitMessage ? <Message tone={submitMessage.tone} text={submitMessage.text} /> : null}
            </form>
          </aside>
        </div>
      </div>
    </main>
  );
}

function SuggestionSection({ title, suggestions, onVote, onReport, voteState }: { title: string; suggestions: Suggestion[]; onVote: (suggestion: Suggestion, value: 1 | -1) => void; onReport: (suggestion: Suggestion) => void; voteState: Record<string, number> }) {
  if (suggestions.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-black uppercase tracking-[0.18em] text-zinc-400">{title}</h2>
      <div className="grid gap-3">
        {suggestions.map((suggestion) => <SuggestionCard key={suggestion.id} suggestion={suggestion} onVote={onVote} onReport={onReport} vote={voteState[suggestion.id] ?? 0} />)}
      </div>
    </section>
  );
}

function SuggestionCard({ suggestion, onVote, onReport, vote }: { suggestion: Suggestion; onVote: (suggestion: Suggestion, value: 1 | -1) => void; onReport: (suggestion: Suggestion) => void; vote: number }) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">{formatLabel(suggestion.status)}</span>
            <span className="text-xs font-bold text-zinc-500">{new Date(suggestion.submittedAt).toLocaleDateString()}</span>
          </div>
          <h3 className="mt-2 text-xl font-black text-white">{suggestion.title}</h3>
        </div>
        {suggestion.convertedEventSlug ? (
          <Link href={`/events/${suggestion.convertedEventSlug}`} className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-[11px] font-black uppercase text-emerald-100">
            Converted to Event
          </Link>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-300">{suggestion.description}</p>
      <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold uppercase text-zinc-400">
        <span>{formatLabel(suggestion.competitionFormat)}</span>
        <span>/</span>
        <span>{formatLabel(suggestion.platform)}</span>
        {suggestion.mapName ? <><span>/</span><span>{suggestion.mapName}</span></> : null}
        <span>/</span>
        <span>{formatLabel(suggestion.suggestedServerScope)}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <VoteButton active={vote === 1} label={`${suggestion.upvotes} upvotes`} onClick={() => onVote(suggestion, 1)} icon="up" />
          <VoteButton active={vote === -1} label={`${suggestion.downvotes} downvotes`} onClick={() => onVote(suggestion, -1)} icon="down" />
          <span className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-zinc-300">Net {suggestion.netScore}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <button type="button" onClick={() => onReport(suggestion)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-zinc-300 hover:text-white">
            <Flag className="h-3.5 w-3.5" />
            Report
          </button>
          <span>{suggestion.reportCount} reports</span>
          {suggestion.votePercentage !== null ? <span>/ {suggestion.votePercentage}% support</span> : null}
        </div>
      </div>
      {suggestion.creatorResponse ? (
        <div className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-300/[0.06] p-3 text-sm text-emerald-50">
          <CheckCircle2 className="mr-2 inline h-4 w-4" />
          {suggestion.creatorResponse}
        </div>
      ) : null}
    </article>
  );
}

function VoteButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: "up" | "down"; onClick: () => void }) {
  const Icon = icon === "up" ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-black ${active ? "border-cyan-300/40 bg-cyan-300/12 text-cyan-50" : "border-white/10 bg-black/25 text-zinc-300 hover:text-white"}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function Message({ tone, text }: { tone: "success" | "error" | "info"; text: string }) {
  const classes = tone === "success"
    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
    : tone === "error"
      ? "border-rose-300/25 bg-rose-300/10 text-rose-100"
      : "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  return <div className={`rounded-lg border p-3 text-sm ${classes}`}>{text}</div>;
}

function InlineLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] p-3 text-sm text-zinc-300" aria-busy="true">
      <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
      {label}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5 text-sm text-zinc-300">
      <MessageSquareWarning className="mb-3 h-5 w-5 text-cyan-200" />
      No public suggestions are open for voting yet.
    </div>
  );
}

function inputClass() {
  return "min-h-11 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/45 focus:ring-2 focus:ring-cyan-300/10";
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function applyOptimisticVote(suggestion: Suggestion, previousVote: number, nextVote: number): Suggestion {
  let upvotes = suggestion.upvotes;
  let downvotes = suggestion.downvotes;
  if (previousVote === 1) upvotes -= 1;
  if (previousVote === -1) downvotes -= 1;
  if (nextVote === 1) upvotes += 1;
  if (nextVote === -1) downvotes += 1;
  const total = Math.max(0, upvotes + downvotes);
  return {
    ...suggestion,
    upvotes,
    downvotes,
    netScore: upvotes - downvotes,
    votePercentage: total ? Math.round((upvotes / total) * 100) : null,
  };
}
