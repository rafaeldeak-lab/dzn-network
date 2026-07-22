"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
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
  suggestedServerSlug: string | null;
  suggestedServerName: string | null;
  status: string;
  creatorResponse: string | null;
  convertedEventSlug: string | null;
  upvotes: number;
  downvotes: number;
  netScore: number;
  totalVotes: number;
  votePercentage: number | null;
  submittedAt: string;
};

type SuggestionsPayload = {
  ok: true;
  suggestions: Suggestion[];
  nextCursor: string | null;
  generatedAt: string;
  sort?: string;
  statusFilter?: string;
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
  suggestionId: string;
  idempotent?: boolean;
  message?: string;
};

type PublicServerOption = {
  public_slug?: string | null;
  slug?: string | null;
  server_name?: string | null;
  name?: string | null;
  platform?: string | null;
  map_name?: string | null;
};

type PublicServersPayload = {
  ok: boolean;
  servers?: PublicServerOption[];
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
  ["most_active", "Most Active"],
] as const;

const STATUS_OPTIONS = [
  ["all_public", "All Public"],
  ["shortlisted", "Shortlisted"],
  ["accepted", "Accepted"],
  ["converted_to_event", "Converted"],
] as const;

const REPORT_REASONS = [
  ["spam", "Spam"],
  ["abuse", "Abuse or harassment"],
  ["duplicate", "Duplicate"],
  ["unsafe_content", "Unsafe content"],
  ["personal_information", "Personal information"],
  ["other", "Other"],
] as const;

const MAX_ACCUMULATED_SUGGESTIONS = 100;

const initialForm = {
  title: "",
  description: "",
  competition_format: "server_vs_server",
  platform: "playstation",
  map_name: "",
  suggested_server_slug: "",
  open_to_any_server: true,
  suggested_date_start: "",
  suggested_date_end: "",
  structure_notes: "",
  additional_notes: "",
};

export function EventSuggestionsPage() {
  const [sort, setSort] = useState("trending");
  const [statusFilter, setStatusFilter] = useState("all_public");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [voteState, setVoteState] = useState<Record<string, number>>({});
  const [pendingVotes, setPendingVotes] = useState<Record<string, boolean>>({});
  const [serverOptions, setServerOptions] = useState<PublicServerOption[]>([]);
  const [reportDraft, setReportDraft] = useState<{ suggestion: Suggestion; reason: string; note: string } | null>(null);
  const [pendingReports, setPendingReports] = useState<Record<string, boolean>>({});
  const [reportMessage, setReportMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetchJsonWithRetry<PublicServersPayload>("/api/public/servers?limit=60", {
      headers: { accept: "application/json" },
      timeoutMs: 10_000,
      retries: 1,
    })
      .then((payload) => {
        if (!active) return;
        setServerOptions((payload.servers ?? []).filter((server) => Boolean(server.public_slug ?? server.slug)).slice(0, 80));
      })
      .catch(() => {
        if (active) setServerOptions([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const wordCount = form.description.split(/\s+/).filter(Boolean).length;
  const canLoadMore = Boolean(nextCursor && suggestions.length < MAX_ACCUMULATED_SUGGESTIONS && !loadingMore);

  function updateField(key: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeSort(value: string) {
    if (value === sort) return;
    setSort(value);
  }

  function changeStatus(value: string) {
    if (value === statusFilter) return;
    setStatusFilter(value);
  }

  const loadSuggestions = useCallback(async (options: { append: boolean; cursor: string | null }) => {
    const params = new URLSearchParams({
      sort,
      status: statusFilter,
      limit: "20",
    });
    if (options.cursor) params.set("cursor", options.cursor);
    const nextPayload = await fetchJsonWithRetry<SuggestionsPayload>(`/api/events/suggestions?${params.toString()}`, {
      headers: { accept: "application/json" },
      timeoutMs: 10_000,
      retries: 1,
    });
    setLoadError(null);
    setNextCursor(nextPayload.nextCursor);
    setSuggestions((current) => {
      const merged = options.append ? mergeSuggestions(current, nextPayload.suggestions) : dedupeSuggestions(nextPayload.suggestions);
      return merged.slice(0, MAX_ACCUMULATED_SUGGESTIONS);
    });
  }, [sort, statusFilter]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setLoadingInitial(true);
      setLoadError(null);
      loadSuggestions({ append: false, cursor: null })
        .catch((error) => {
          if (!active) return;
          setLoadError(error instanceof Error ? error.message : "Suggestions could not be loaded.");
          setSuggestions([]);
          setNextCursor(null);
        })
        .finally(() => {
          if (active) setLoadingInitial(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [loadSuggestions]);

  async function loadMore() {
    if (!canLoadMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      await loadSuggestions({ append: true, cursor: nextCursor });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "More suggestions could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function retryCurrentList() {
    setLoadingInitial(true);
    setLoadError(null);
    try {
      await loadSuggestions({ append: false, cursor: null });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Suggestions could not be loaded.");
    } finally {
      setLoadingInitial(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.open_to_any_server && !form.suggested_server_slug) {
      setSubmitMessage({ tone: "error", text: "Choose a public server or keep the suggestion open to any server." });
      return;
    }
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
    if (pendingVotes[suggestion.id]) return;
    const previousVote = voteState[suggestion.id] ?? 0;
    const nextVote = previousVote === value ? 0 : value;
    const previousSuggestion = suggestions.find((item) => item.id === suggestion.id) ?? suggestion;
    setPendingVotes((current) => ({ ...current, [suggestion.id]: true }));
    setVoteState((current) => ({ ...current, [suggestion.id]: nextVote }));
    setSuggestions((current) => current.map((item) => item.id === suggestion.id ? applyOptimisticVote(item, previousVote, nextVote) : item));
    try {
      const result = await fetchJsonWithRetry<VotePayload>(`/api/events/suggestions/${encodeURIComponent(suggestion.id)}/vote`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ vote_value: nextVote }),
        timeoutMs: 8_000,
        retries: 0,
      });
      setSuggestions((current) => current.map((item) => item.id === suggestion.id ? {
        ...item,
        upvotes: result.upvoteCount,
        downvotes: result.downvoteCount,
        netScore: result.netScore,
        totalVotes: result.upvoteCount + result.downvoteCount,
        votePercentage: result.upvoteCount + result.downvoteCount ? Math.round((result.upvoteCount / (result.upvoteCount + result.downvoteCount)) * 100) : null,
      } : item));
      setVoteState((current) => ({ ...current, [suggestion.id]: result.userVote }));
    } catch (error) {
      setSuggestions((current) => current.map((item) => item.id === suggestion.id ? previousSuggestion : item));
      setVoteState((current) => ({ ...current, [suggestion.id]: previousVote }));
      if (error instanceof FetchJsonError && error.status === 401) {
        window.location.href = `/login?returnTo=${encodeURIComponent("/events/suggest")}`;
      }
    } finally {
      setPendingVotes((current) => ({ ...current, [suggestion.id]: false }));
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportDraft || pendingReports[reportDraft.suggestion.id]) return;
    setPendingReports((current) => ({ ...current, [reportDraft.suggestion.id]: true }));
    setReportMessage(null);
    try {
      const result = await fetchJsonWithRetry<ReportPayload>(`/api/events/suggestions/${encodeURIComponent(reportDraft.suggestion.id)}/report`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ reason: reportDraft.reason, note: reportDraft.note }),
        timeoutMs: 8_000,
        retries: 0,
      });
      if (!result.ok) throw new Error(result.message ?? "Report could not be submitted.");
      setReportMessage({ tone: "success", text: result.message ?? "Report received for moderator review." });
      setReportDraft(null);
    } catch (error) {
      if (error instanceof FetchJsonError && error.status === 401) {
        window.location.href = `/login?returnTo=${encodeURIComponent("/events/suggest")}`;
        return;
      }
      setReportMessage({ tone: "error", text: error instanceof Error ? error.message : "Report could not be submitted." });
    } finally {
      setPendingReports((current) => reportDraft ? { ...current, [reportDraft.suggestion.id]: false } : current);
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
            <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-black uppercase text-zinc-300">
                  <Lightbulb className="h-4 w-4 text-cyan-200" />
                  Public voting board
                </div>
                <SegmentedOptions options={SORT_OPTIONS} value={sort} onChange={changeSort} />
              </div>
              <div className="mt-3 border-t border-white/10 pt-3">
                <SegmentedOptions options={STATUS_OPTIONS} value={statusFilter} onChange={changeStatus} />
              </div>
            </div>

            {loadingInitial ? <InlineLoading label="Loading suggestions" /> : null}
            {loadError ? (
              <div className="grid gap-3">
                <Message tone="error" text={loadError} />
                <button type="button" onClick={retryCurrentList} className="w-fit rounded-lg border border-white/10 bg-black/30 px-4 py-2 text-xs font-black uppercase text-zinc-300 hover:text-white">
                  Retry
                </button>
              </div>
            ) : null}
            {!loadingInitial && suggestions.length === 0 ? <EmptyState /> : null}
            {reportMessage ? <Message tone={reportMessage.tone} text={reportMessage.text} /> : null}

            <div className="grid gap-3" aria-busy={loadingInitial || loadingMore}>
              {suggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  onVote={vote}
                  onOpenReport={(next) => {
                    setReportMessage(null);
                    setReportDraft({ suggestion: next, reason: "unsafe_content", note: "" });
                  }}
                  vote={voteState[suggestion.id] ?? 0}
                  votePending={Boolean(pendingVotes[suggestion.id])}
                  reportPending={Boolean(pendingReports[suggestion.id])}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {canLoadMore ? (
                <button type="button" onClick={loadMore} disabled={loadingMore} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-black uppercase text-cyan-50 disabled:cursor-not-allowed disabled:opacity-60">
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {loadingMore ? "Loading more" : "Load more"}
                </button>
              ) : null}
              {!loadingInitial && suggestions.length > 0 && !nextCursor ? <span className="text-xs font-bold uppercase text-zinc-500">End of results</span> : null}
              {suggestions.length >= MAX_ACCUMULATED_SUGGESTIONS ? <span className="text-xs font-bold uppercase text-zinc-500">Showing latest {MAX_ACCUMULATED_SUGGESTIONS}</span> : null}
            </div>
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
                <Field label="Suggested public server">
                  <select value={form.suggested_server_slug} onChange={(event) => updateField("suggested_server_slug", event.target.value)} className={inputClass()}>
                    <option value="">Choose a public server</option>
                    {serverOptions.map((server) => {
                      const slug = server.public_slug ?? server.slug ?? "";
                      return <option key={slug} value={slug}>{server.server_name ?? server.name ?? slug}</option>;
                    })}
                  </select>
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

      {reportDraft ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4">
          <form onSubmit={submitReport} className="w-full max-w-lg rounded-lg border border-white/10 bg-[#080b14] p-5 shadow-2xl">
            <div className="flex items-center gap-2">
              <Flag className="h-5 w-5 text-rose-200" />
              <h2 className="text-lg font-black text-white">Report suggestion</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{reportDraft.suggestion.title}</p>
            <div className="mt-4 grid gap-4">
              <Field label="Reason">
                <select value={reportDraft.reason} onChange={(event) => setReportDraft((current) => current ? { ...current, reason: event.target.value } : current)} className={inputClass()}>
                  {REPORT_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Optional note">
                <textarea value={reportDraft.note} onChange={(event) => setReportDraft((current) => current ? { ...current, note: event.target.value } : current)} maxLength={280} className={`${inputClass()} min-h-24 resize-y`} />
              </Field>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setReportDraft(null)} className="rounded-lg border border-white/10 bg-black/30 px-4 py-2 text-xs font-black uppercase text-zinc-300 hover:text-white">
                Cancel
              </button>
              <button type="submit" disabled={Boolean(pendingReports[reportDraft.suggestion.id])} className="inline-flex items-center gap-2 rounded-lg border border-rose-300/25 bg-rose-300/10 px-4 py-2 text-xs font-black uppercase text-rose-100 disabled:cursor-not-allowed disabled:opacity-60">
                {pendingReports[reportDraft.suggestion.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
                {pendingReports[reportDraft.suggestion.id] ? "Submitting" : "Submit report"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function SegmentedOptions({ options, value, onChange }: { options: readonly (readonly [string, string])[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([nextValue, label]) => (
        <button
          key={nextValue}
          type="button"
          onClick={() => onChange(nextValue)}
          className={`rounded-lg border px-3 py-2 text-[11px] font-black uppercase ${value === nextValue ? "border-cyan-300/40 bg-cyan-300/12 text-cyan-50" : "border-white/10 bg-black/30 text-zinc-400 hover:text-white"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onVote,
  onOpenReport,
  vote,
  votePending,
  reportPending,
}: {
  suggestion: Suggestion;
  onVote: (suggestion: Suggestion, value: 1 | -1) => void;
  onOpenReport: (suggestion: Suggestion) => void;
  vote: number;
  votePending: boolean;
  reportPending: boolean;
}) {
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
        <span>{suggestion.suggestedServerName ?? formatLabel(suggestion.suggestedServerScope)}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <VoteButton active={vote === 1} disabled={votePending} label={`${suggestion.upvotes} upvotes`} onClick={() => onVote(suggestion, 1)} icon="up" />
          <VoteButton active={vote === -1} disabled={votePending} label={`${suggestion.downvotes} downvotes`} onClick={() => onVote(suggestion, -1)} icon="down" />
          <span className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-zinc-300">Net {suggestion.netScore}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <button type="button" disabled={reportPending} onClick={() => onOpenReport(suggestion)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-zinc-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
            {reportPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flag className="h-3.5 w-3.5" />}
            {reportPending ? "Reporting" : "Report"}
          </button>
          {suggestion.votePercentage !== null ? <span>{suggestion.votePercentage}% support</span> : null}
          <span>{suggestion.totalVotes} votes</span>
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

function VoteButton({ active, label, icon, onClick, disabled }: { active: boolean; label: string; icon: "up" | "down"; onClick: () => void; disabled: boolean }) {
  const Icon = icon === "up" ? ArrowUp : ArrowDown;
  return (
    <button type="button" disabled={disabled} aria-busy={disabled} onClick={onClick} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-cyan-300/40 bg-cyan-300/12 text-cyan-50" : "border-white/10 bg-black/25 text-zinc-300 hover:text-white"}`}>
      <Icon className="h-3.5 w-3.5" />
      {disabled ? "Saving" : label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
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
      No public suggestions match this view.
    </div>
  );
}

function inputClass() {
  return "min-h-11 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/45 focus:ring-2 focus:ring-cyan-300/10";
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function mergeSuggestions(current: Suggestion[], incoming: Suggestion[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function dedupeSuggestions(incoming: Suggestion[]) {
  return mergeSuggestions([], incoming);
}

function applyOptimisticVote(suggestion: Suggestion, previousVote: number, nextVote: number): Suggestion {
  let upvotes = suggestion.upvotes;
  let downvotes = suggestion.downvotes;
  if (previousVote === 1) upvotes -= 1;
  if (previousVote === -1) downvotes -= 1;
  if (nextVote === 1) upvotes += 1;
  if (nextVote === -1) downvotes += 1;
  upvotes = Math.max(0, upvotes);
  downvotes = Math.max(0, downvotes);
  const totalVotes = upvotes + downvotes;
  return {
    ...suggestion,
    upvotes,
    downvotes,
    netScore: upvotes - downvotes,
    totalVotes,
    votePercentage: totalVotes ? Math.round((upvotes / totalVotes) * 100) : null,
  };
}
