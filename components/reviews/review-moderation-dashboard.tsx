"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, CheckCircle2, Clock3, Flag, History, Layers3, MessageSquareReply, RefreshCcw, ShieldAlert, Star, Trash2, XCircle } from "lucide-react";

type QueueFilter = "needs_review" | "pending" | "reported" | "approved" | "replied" | "all";
type ModerationAction = "approve" | "hold" | "remove" | "dismiss_reports" | "reply" | "remove_reply";
type BulkModerationAction = "hold" | "remove" | "dismiss_reports";
type LoadState = "loading" | "ready" | "unauthorized" | "plan_required" | "forbidden" | "error";

type ReviewModerationHistoryItem = {
  action: string;
  actor_role: string;
  reason: string | null;
  created_at: string;
};

type ReviewModerationItem = {
  id: string;
  linked_server_id: string;
  server_name: string;
  public_slug: string | null;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  moderation_reason: string | null;
  report_count: number;
  latest_report_reason: string | null;
  latest_report_at: string | null;
  owner_reply_body: string | null;
  owner_reply_author_name: string | null;
  owner_reply_created_at: string | null;
  owner_reply_updated_at: string | null;
  created_at: string;
  updated_at: string;
  last_edited_at: string | null;
  status_history: ReviewModerationHistoryItem[];
};

type ReviewReportPattern = {
  pattern_key: string;
  reason: string;
  review_count: number;
  total_reports: number;
  latest_report_at: string | null;
};

type QueuePayload = {
  ok: true;
  role: "owner" | "admin";
  status: QueueFilter;
  counts: {
    total: number;
    needs_review: number;
    pending: number;
    reported: number;
    approved: number;
    replied: number;
  };
  notification_counts: {
    unread_total: number;
    review_notifications: number;
    review_queue: number;
  };
  report_patterns: ReviewReportPattern[];
  items: ReviewModerationItem[];
  generated_at: string;
};

type DraftState = Record<string, { reason: string; reply: string }>;

const FILTERS: Array<{ value: QueueFilter; label: string }> = [
  { value: "needs_review", label: "Needs review" },
  { value: "pending", label: "Pending" },
  { value: "reported", label: "Reported" },
  { value: "approved", label: "Approved" },
  { value: "replied", label: "Replied" },
  { value: "all", label: "All" },
];

const DEFAULT_PRICING_URL = "/pricing?intent=owner_setup&returnTo=%2Fdashboard%2Freviews";

export function ReviewModerationDashboard({ homeHref = "/dashboard" }: { homeHref?: string }) {
  const [state, setState] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<QueueFilter>("needs_review");
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  const [drafts, setDrafts] = useState<DraftState>({});
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bulkBusyAction, setBulkBusyAction] = useState<string | null>(null);
  const [bulkReason, setBulkReason] = useState("Repeated report pattern reviewed by DZN moderation.");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pricingUrl, setPricingUrl] = useState(DEFAULT_PRICING_URL);
  const [focusedReviewId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("review");
  });

  useEffect(() => {
    let active = true;

    fetch(`/api/reviews/moderation?status=${encodeURIComponent(filter)}&limit=60`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!active) return;
        const result = await safeJson(response);
        if (response.status === 401) {
          setState("unauthorized");
          return;
        }
        if (response.status === 402) {
          setPricingUrl(typeof result?.pricing_url === "string" ? result.pricing_url : DEFAULT_PRICING_URL);
          setState("plan_required");
          return;
        }
        if (response.status === 403) {
          setState("forbidden");
          return;
        }
        if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Review moderation could not be loaded."));
        const nextPayload = result as QueuePayload;
        setPayload(nextPayload);
        setDrafts((current) => seedDrafts(current, nextPayload.items));
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Review moderation could not be loaded." });
        setState("error");
      });

    return () => {
      active = false;
    };
  }, [filter, refreshKey]);

  const summary = useMemo(() => payload?.counts ?? { total: 0, needs_review: 0, pending: 0, reported: 0, approved: 0, replied: 0 }, [payload]);

  function updateDraft(reviewId: string, key: "reason" | "reply", value: string) {
    setDrafts((current) => ({
      ...current,
      [reviewId]: {
        reason: current[reviewId]?.reason ?? "",
        reply: current[reviewId]?.reply ?? "",
        [key]: value,
      },
    }));
  }

  async function runAction(review: ReviewModerationItem, action: ModerationAction) {
    const busyKey = `${review.id}:${action}`;
    setBusyAction(busyKey);
    setMessage({ tone: "info", text: "Saving review moderation action." });
    const draft = drafts[review.id] ?? { reason: "", reply: review.owner_reply_body ?? "" };
    try {
      const response = await fetch(`/api/reviews/moderation/${encodeURIComponent(review.id)}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action,
          reason: draft.reason,
          body: draft.reply,
        }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Review moderation action failed."));
      setMessage({ tone: "success", text: actionSuccessLabel(action) });
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Review moderation action failed." });
    } finally {
      setBusyAction(null);
    }
  }

  async function runBulkAction(pattern: ReviewReportPattern, action: BulkModerationAction) {
    const busyKey = `${pattern.pattern_key}:${action}`;
    setBulkBusyAction(busyKey);
    setMessage({ tone: "info", text: "Running admin bulk triage." });
    try {
      const response = await fetch("/api/reviews/moderation/bulk", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action,
          pattern_key: pattern.pattern_key,
          reason: bulkReason,
          min_report_count: 1,
          limit: 25,
        }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Bulk review moderation failed."));
      const updatedCount = Number(result.updated_count ?? 0);
      setMessage({ tone: "success", text: `Bulk triage updated ${updatedCount} ${updatedCount === 1 ? "review" : "reviews"}.` });
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Bulk review moderation failed." });
    } finally {
      setBulkBusyAction(null);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#02030a] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.12),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.12),transparent_34%),linear-gradient(180deg,rgba(2,3,10,0),#02030a_76%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-5 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={homeHref} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
            Back
          </Link>
          <Link href="/servers" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
            Public Servers
          </Link>
        </div>

        <header className="rounded-lg border border-white/10 bg-black/45 p-4 shadow-[0_0_40px_rgba(34,211,238,0.08)]">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">Reviews Moderation</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black leading-tight text-white md:text-4xl">Owner review queue</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-400">
                Reported and pending reviews stay in a private owner/admin queue. Review ratings remain player feedback only and never become ranking, discovery, badge, event, season, or billing inputs.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-xs font-black uppercase text-cyan-50 hover:bg-cyan-300/20"
            >
              <RefreshCcw className="h-4 w-4" aria-hidden />
              Refresh
            </button>
          </div>
          {payload ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Needs review" value={summary.needs_review} tone="amber" />
              <Metric label="Pending" value={summary.pending} tone="violet" />
              <Metric label="Reported" value={summary.reported} tone="red" />
              <Metric label="Approved" value={summary.approved} tone="emerald" />
              <Metric label="Replied" value={summary.replied} tone="cyan" />
              <Metric label={payload.role === "admin" ? "Admin view" : "Owner view"} value={summary.total} tone="zinc" />
            </div>
          ) : null}
          {payload ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <BadgeMetric icon={<Bell />} label="Unread Pulse" value={payload.notification_counts.unread_total} tone="violet" />
              <BadgeMetric icon={<Flag />} label="Review alerts" value={payload.notification_counts.review_notifications} tone="red" />
              <BadgeMetric icon={<ShieldAlert />} label="Queue badge" value={payload.notification_counts.review_queue} tone="amber" />
            </div>
          ) : null}
        </header>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`rounded-lg border px-3 py-2 text-xs font-black uppercase ${
                filter === item.value
                  ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                  : "border-white/10 bg-white/[0.035] text-zinc-400 hover:text-white"
              }`}
            >
              <span>{item.label}</span>
              {payload ? <span className="ml-2 rounded border border-white/10 bg-black/28 px-1.5 py-0.5 text-[10px] text-white">{filterCount(payload, item.value)}</span> : null}
            </button>
          ))}
        </div>

        {message ? <MessagePanel message={message} /> : null}
        {state === "ready" && payload?.role === "admin" ? (
          <AdminBulkTriagePanel
            patterns={payload.report_patterns}
            reason={bulkReason}
            busyAction={bulkBusyAction}
            onReasonChange={setBulkReason}
            onBulkAction={runBulkAction}
          />
        ) : null}
        {state === "loading" ? <LoadingPanel /> : null}
        {state === "unauthorized" ? <AccessPanel title="Sign in required" body="Log in with Discord before opening the review moderation queue." actionHref="/login?returnTo=%2Fdashboard%2Freviews" actionLabel="Sign in with Discord" /> : null}
        {state === "plan_required" ? <AccessPanel title="Owner plan required" body="Review moderation is an owner server-management surface. Choose Starter or Pro before using owner tools." actionHref={pricingUrl} actionLabel="Open pricing" /> : null}
        {state === "forbidden" ? <AccessPanel title="Access denied" body="This session cannot moderate reviews for those linked servers." /> : null}
        {state === "error" ? <AccessPanel title="Queue unavailable" body="Review moderation could not be loaded right now." /> : null}

        {state === "ready" && payload ? (
          <section className="grid gap-3">
            {payload.items.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.035] p-8 text-center">
                <ShieldAlert className="mx-auto h-8 w-8 text-cyan-200" aria-hidden />
                <h2 className="mt-3 text-xl font-black text-white">No reviews match this filter</h2>
                <p className="mt-2 text-sm text-zinc-500">The queue is clear for the selected view.</p>
              </div>
            ) : null}
            {payload.items.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                draft={drafts[review.id] ?? { reason: "", reply: review.owner_reply_body ?? "" }}
                focused={focusedReviewId === review.id}
                busyAction={busyAction}
                onDraftChange={updateDraft}
                onAction={runAction}
              />
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function ReviewCard({
  review,
  draft,
  focused,
  busyAction,
  onDraftChange,
  onAction,
}: {
  review: ReviewModerationItem;
  draft: { reason: string; reply: string };
  focused: boolean;
  busyAction: string | null;
  onDraftChange: (reviewId: string, key: "reason" | "reply", value: string) => void;
  onAction: (review: ReviewModerationItem, action: ModerationAction) => void;
}) {
  const publicHref = review.public_slug ? `/servers/profile?slug=${encodeURIComponent(review.public_slug)}` : "/servers";
  return (
    <article className={`rounded-lg border bg-white/[0.035] p-4 ${focused ? "border-cyan-300/45 shadow-[0_0_42px_rgba(34,211,238,0.16)]" : "border-white/10"}`}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">
                <span>{review.server_name}</span>
                <span>/</span>
                <span>{formatDate(review.created_at)}</span>
              </div>
              <h2 className="mt-2 text-xl font-black leading-tight text-white">{review.title || "Untitled review"}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Rating value={review.rating} />
                <StatusPill status={review.status} />
                {review.report_count > 0 ? <ReportPill count={review.report_count} /> : null}
              </div>
            </div>
            <Link href={publicHref} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:text-white">
              Profile
            </Link>
          </div>

          <p className="mt-4 whitespace-pre-line text-sm leading-6 text-zinc-200">{review.body}</p>
          <div className="mt-4 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
            <InfoRow label="Reviewer" value={review.reviewer_name ?? "DZN player"} />
            <InfoRow label="Review ID" value={review.id} />
            <InfoRow label="Updated" value={formatDate(review.updated_at)} />
            <InfoRow label="Latest report" value={review.latest_report_at ? formatDate(review.latest_report_at) : "none"} />
          </div>
          {review.latest_report_reason ? <p className="mt-3 rounded border border-amber-300/20 bg-amber-300/[0.04] p-3 text-sm text-amber-50">{review.latest_report_reason}</p> : null}
          {review.moderation_reason ? <p className="mt-3 rounded border border-white/10 bg-black/25 p-3 text-sm text-zinc-300">{review.moderation_reason}</p> : null}
          <ReviewStatusHistory history={review.status_history} createdAt={review.created_at} updatedAt={review.updated_at} />
        </div>

        <div className="grid gap-3">
          <Field label="Moderation reason">
            <textarea
              value={draft.reason}
              onChange={(event) => onDraftChange(review.id, "reason", event.target.value)}
              maxLength={220}
              className={`${inputClass()} min-h-20 resize-y`}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <QueueButton action="approve" icon={<CheckCircle2 />} label="Approve" tone="good" review={review} busyAction={busyAction} onAction={onAction} />
            <QueueButton action="hold" icon={<Clock3 />} label="Hold" tone="warn" review={review} busyAction={busyAction} onAction={onAction} />
            <QueueButton action="dismiss_reports" icon={<Flag />} label="Dismiss" tone="neutral" review={review} busyAction={busyAction} onAction={onAction} />
            <QueueButton action="remove" icon={<Trash2 />} label="Remove" tone="danger" review={review} busyAction={busyAction} onAction={onAction} />
          </div>

          <div className="rounded-lg border border-white/10 bg-black/25 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-white">Owner reply</h3>
              {review.owner_reply_updated_at ? <span className="text-[10px] font-black uppercase text-zinc-500">{formatDate(review.owner_reply_updated_at)}</span> : null}
            </div>
            <textarea
              value={draft.reply}
              onChange={(event) => onDraftChange(review.id, "reply", event.target.value)}
              maxLength={900}
              className={`${inputClass()} mt-3 min-h-28 resize-y`}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <QueueButton action="reply" icon={<MessageSquareReply />} label="Save reply" tone="good" review={review} busyAction={busyAction} onAction={onAction} />
              <QueueButton action="remove_reply" icon={<XCircle />} label="Remove reply" tone="neutral" review={review} busyAction={busyAction} onAction={onAction} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function AdminBulkTriagePanel({
  patterns,
  reason,
  busyAction,
  onReasonChange,
  onBulkAction,
}: {
  patterns: ReviewReportPattern[];
  reason: string;
  busyAction: string | null;
  onReasonChange: (value: string) => void;
  onBulkAction: (pattern: ReviewReportPattern, action: BulkModerationAction) => void;
}) {
  return (
    <section className="rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/[0.045] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-fuchsia-200">
            <Layers3 className="h-4 w-4" aria-hidden />
            Admin bulk triage
          </div>
          <h2 className="mt-2 text-xl font-black text-white">Repeated report patterns</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
            Bulk actions are available only to DZN admins and only for repeated report reasons. They update review moderation state, audit history, and internal owner notifications only.
          </p>
        </div>
        <label className="grid w-full gap-2 lg:max-w-md">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Bulk reason</span>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            maxLength={220}
            className={`${inputClass()} min-h-20 resize-y`}
          />
        </label>
      </div>

      {patterns.length === 0 ? (
        <p className="mt-4 rounded-lg border border-white/10 bg-black/25 p-3 text-sm font-bold text-zinc-400">No repeated report patterns need bulk triage.</p>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {patterns.map((pattern) => (
            <article key={pattern.pattern_key} className="rounded-lg border border-white/10 bg-black/25 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-black text-white">{pattern.reason}</h3>
                  <p className="mt-1 text-xs font-bold text-zinc-500">
                    {pattern.review_count} {pattern.review_count === 1 ? "review" : "reviews"} / {pattern.total_reports} reports
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">Latest {formatDate(pattern.latest_report_at)}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <BulkButton action="dismiss_reports" label="Dismiss" tone="neutral" pattern={pattern} busyAction={busyAction} onBulkAction={onBulkAction} />
                <BulkButton action="hold" label="Hold" tone="warn" pattern={pattern} busyAction={busyAction} onBulkAction={onBulkAction} />
                <BulkButton action="remove" label="Remove" tone="danger" pattern={pattern} busyAction={busyAction} onBulkAction={onBulkAction} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function BulkButton({ action, label, tone, pattern, busyAction, onBulkAction }: {
  action: BulkModerationAction;
  label: string;
  tone: "warn" | "danger" | "neutral";
  pattern: ReviewReportPattern;
  busyAction: string | null;
  onBulkAction: (pattern: ReviewReportPattern, action: BulkModerationAction) => void;
}) {
  const busy = busyAction === `${pattern.pattern_key}:${action}`;
  const classes = {
    warn: "border-amber-300/25 bg-amber-300/[0.08] text-amber-50 hover:bg-amber-300/[0.14]",
    danger: "border-red-300/25 bg-red-300/[0.08] text-red-50 hover:bg-red-300/[0.14]",
    neutral: "border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white",
  }[tone];
  return (
    <button
      type="button"
      disabled={Boolean(busyAction)}
      onClick={() => onBulkAction(pattern, action)}
      className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-2 py-2 text-[10px] font-black uppercase disabled:cursor-not-allowed disabled:opacity-45 ${classes}`}
    >
      {busy ? "Running" : label}
    </button>
  );
}

function ReviewStatusHistory({ history, createdAt, updatedAt }: { history: ReviewModerationHistoryItem[]; createdAt: string; updatedAt: string }) {
  return (
    <section className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 text-sm font-black text-white">
          <History className="h-4 w-4 text-cyan-200" aria-hidden />
          Status history
        </h3>
        <span className="text-[10px] font-black uppercase text-zinc-600">Updated {formatDate(updatedAt)}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {history.length ? history.map((entry, index) => (
          <div key={`${entry.action}-${entry.created_at}-${index}`} className="rounded border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-black uppercase text-zinc-100">{formatHistoryAction(entry.action)}</span>
              <span className="text-[10px] font-black uppercase text-zinc-500">{entry.actor_role} / {formatDate(entry.created_at)}</span>
            </div>
            {entry.reason ? <p className="mt-1 text-xs leading-5 text-zinc-400">{entry.reason}</p> : null}
          </div>
        )) : (
          <div className="rounded border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-black uppercase text-zinc-100">Review created</span>
              <span className="text-[10px] font-black uppercase text-zinc-500">{formatDate(createdAt)}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function QueueButton({ action, icon, label, tone, review, busyAction, onAction }: {
  action: ModerationAction;
  icon: ReactNode;
  label: string;
  tone: "good" | "warn" | "danger" | "neutral";
  review: ReviewModerationItem;
  busyAction: string | null;
  onAction: (review: ReviewModerationItem, action: ModerationAction) => void;
}) {
  const busy = busyAction === `${review.id}:${action}`;
  const classes = {
    good: "border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-50 hover:bg-emerald-300/[0.14]",
    warn: "border-amber-300/25 bg-amber-300/[0.08] text-amber-50 hover:bg-amber-300/[0.14]",
    danger: "border-red-300/25 bg-red-300/[0.08] text-red-50 hover:bg-red-300/[0.14]",
    neutral: "border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white",
  }[tone];
  return (
    <button
      type="button"
      disabled={Boolean(busyAction)}
      onClick={() => onAction(review, action)}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-black uppercase disabled:cursor-not-allowed disabled:opacity-45 ${classes}`}
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4" aria-hidden>{icon}</span>
      {busy ? "Saving" : label}
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "amber" | "violet" | "red" | "emerald" | "cyan" | "zinc" }) {
  const color = {
    amber: "border-amber-300/25 text-amber-100",
    violet: "border-violet-300/25 text-violet-100",
    red: "border-red-300/25 text-red-100",
    emerald: "border-emerald-300/25 text-emerald-100",
    cyan: "border-cyan-300/25 text-cyan-100",
    zinc: "border-white/10 text-zinc-100",
  }[tone];
  return (
    <div className={`rounded-lg border bg-white/[0.035] p-3 ${color}`}>
      <div className="text-2xl font-black leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">{label}</div>
    </div>
  );
}

function BadgeMetric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: "amber" | "violet" | "red" }) {
  const color = {
    amber: "border-amber-300/25 bg-amber-300/[0.08] text-amber-50",
    violet: "border-violet-300/25 bg-violet-300/[0.08] text-violet-50",
    red: "border-red-300/25 bg-red-300/[0.08] text-red-50",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black uppercase ${color}`}>
      <span className="[&>svg]:h-4 [&>svg]:w-4" aria-hidden>{icon}</span>
      {label}
      <span className="rounded bg-black/35 px-1.5 py-0.5 text-white">{formatBadgeCount(value)}</span>
    </span>
  );
}

function Rating({ value }: { value: number }) {
  const rating = Math.min(5, Math.max(1, Math.round(Number(value) || 1)));
  return (
    <div className="flex items-center gap-1 text-amber-200" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} className={`h-4 w-4 ${index < rating ? "fill-amber-200" : "opacity-25"}`} aria-hidden />
      ))}
      <span className="ml-1 text-xs font-black text-zinc-300">{rating}/5</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === "approved"
    ? "border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-100"
    : status === "pending"
      ? "border-amber-300/25 bg-amber-300/[0.08] text-amber-100"
      : "border-white/10 bg-white/[0.04] text-zinc-300";
  return <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${color}`}>{status}</span>;
}

function ReportPill({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-red-300/25 bg-red-300/[0.08] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-100">
      <Flag className="h-3 w-3" aria-hidden />
      {count} reports
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-black/20 px-3 py-2">
      <div className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-600">{label}</div>
      <div className="mt-1 truncate text-xs font-bold text-zinc-300">{value}</div>
    </div>
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

function MessagePanel({ message }: { message: { tone: "success" | "error" | "info"; text: string } }) {
  const color = message.tone === "success"
    ? "border-emerald-300/25 bg-emerald-300/[0.06] text-emerald-100"
    : message.tone === "error"
      ? "border-red-300/25 bg-red-300/[0.06] text-red-100"
      : "border-cyan-300/25 bg-cyan-300/[0.06] text-cyan-100";
  return <div className={`rounded-lg border p-3 text-sm font-bold ${color}`}>{message.text}</div>;
}

function AccessPanel({ title, body, actionHref, actionLabel }: { title: string; body: string; actionHref?: string; actionLabel?: string }) {
  return (
    <section className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-5">
      <h2 className="text-2xl font-black text-white">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">{body}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="mt-4 inline-flex rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-xs font-black uppercase text-cyan-50">
          {actionLabel}
        </Link>
      ) : null}
    </section>
  );
}

function LoadingPanel() {
  return (
    <section className="grid gap-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-56 animate-pulse rounded-lg border border-white/10 bg-white/[0.035]" />
      ))}
    </section>
  );
}

function inputClass() {
  return "w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/45";
}

function seedDrafts(current: DraftState, items: ReviewModerationItem[]) {
  const next = { ...current };
  for (const item of items) {
    if (!next[item.id]) next[item.id] = { reason: "", reply: item.owner_reply_body ?? "" };
  }
  return next;
}

async function safeJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

function apiMessage(result: Record<string, unknown> | null, fallback: string) {
  return typeof result?.message === "string" && result.message.trim() ? result.message : fallback;
}

function actionSuccessLabel(action: ModerationAction) {
  if (action === "approve") return "Review approved and reports cleared.";
  if (action === "hold") return "Review moved to pending moderation.";
  if (action === "remove") return "Review removed from public surfaces.";
  if (action === "dismiss_reports") return "Reports dismissed and review approved.";
  if (action === "reply") return "Owner reply saved.";
  return "Owner reply removed.";
}

function filterCount(payload: QueuePayload, filter: QueueFilter) {
  if (filter === "all") return formatBadgeCount(payload.counts.total);
  return formatBadgeCount(payload.counts[filter]);
}

function formatBadgeCount(value: number) {
  const count = Math.max(0, Math.trunc(Number(value) || 0));
  return count > 99 ? "99+" : String(count);
}

function formatHistoryAction(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value?: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
