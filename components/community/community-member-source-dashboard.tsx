"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Filter,
  EyeOff,
  History,
  Import,
  RefreshCw,
  ShieldCheck,
  LockKeyhole,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";

type LoadState = "loading" | "ready" | "unauthorized" | "plan_required" | "forbidden" | "not_configured" | "error";
type CandidateStatus = "pending" | "imported" | "rejected" | "duplicate" | "ambiguous";
type MatchStatus = "pending" | "matched" | "no_match" | "duplicate" | "ambiguous";
type StatusFilter = CandidateStatus | "all";
type IssueFilter = "all" | "importable" | "repeated_no_match" | "repeated_duplicate";
type AuditAction =
  | "candidate_created"
  | "candidate_rejected"
  | "candidate_imported"
  | "candidate_preview_refreshed"
  | "candidate_importable"
  | "candidate_no_match"
  | "duplicate_rejected"
  | "ambiguous_rejected";
type AuditResult = "accepted" | "rejected" | "skipped" | "failed";
type AuditActionFilter = AuditAction | "all";
type AuditResultFilter = AuditResult | "all";
type ActionKind = "import" | "reject" | "refresh_preview";
type ImportPreview = {
  status: "ready" | "blocked_no_match" | "blocked_duplicate" | "blocked_ambiguous" | "already_imported" | "rejected";
  can_import: boolean;
  source_trust: "trusted_snapshot" | "manual_or_unknown";
  summary: string;
  warnings: string[];
  snapshot: {
    available: boolean;
    source: string | null;
    trust_status: string | null;
    captured_at: string | null;
    username: string | null;
    display_name: string | null;
    role_label: string | null;
  } | null;
};

type ServerOption = {
  id: string;
  server_name: string;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string;
};

type CandidateItem = {
  id: string;
  linked_server_id: string;
  owner_user_id: string | null;
  server_name: string;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string;
  candidate_discord_id_masked: string | null;
  candidate_username: string | null;
  candidate_display_name: string | null;
  role_label: string | null;
  source: string;
  status: CandidateStatus;
  match_status: MatchStatus;
  matched_user_id: string | null;
  matched_username: string | null;
  imported_member_id: string | null;
  existing_member_id: string | null;
  reason: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  public_profile_linkable: boolean;
  public_profile: {
    public_handle: string;
    public_href: string;
    public_api_href: string;
  } | null;
  import_preview: ImportPreview;
};

type AuditItem = {
  id: string;
  candidate_id: string | null;
  community_member_id: string | null;
  linked_server_id: string;
  server_name: string;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string;
  actor_user_id: string;
  actor_role: "owner" | "admin";
  action: AuditAction;
  result_status: AuditResult;
  reason: string | null;
  created_at: string | null;
};

type AuditGroup = {
  key: string;
  label: string;
  linked_server_ref: string;
  server_name: string;
  community_name: string;
  action: AuditAction;
  result_status: AuditResult;
  row_count: number;
  accepted_count: number;
  rejected_count: number;
  skipped_count: number;
  failed_count: number;
  first_at: string | null;
  last_at: string | null;
  export_safe: true;
};

type ExportSafeAuditItem = {
  id_ref: string;
  candidate_ref: string | null;
  community_member_ref: string | null;
  server_name: string;
  public_slug: string | null;
  community_name: string;
  actor_role: "owner" | "admin";
  action: AuditAction;
  result_status: AuditResult;
  reason: string | null;
  created_at: string | null;
  export_safe: true;
};

type RecentAuditExport = {
  id: string;
  generated_at: string;
  filename: string;
  row_count: number;
  limit: number;
  truncated: boolean;
  filters: string[];
  private_artifact: true;
  persisted_by_dzn: false;
  retention: "download_only";
  dashboard_history: "client_session_only";
};

type BulkExecutionSummary = {
  candidate_id: string;
  candidate_label: string;
  candidate_ref: string;
  server_name: string | null;
  community_name: string | null;
  action: "import" | "reject";
  outcome: "imported" | "rejected" | "blocked" | "failed";
  result_status: AuditResult;
  ok: boolean;
  status: number;
  error: string | null;
  message: string;
  imported_member_ref: string | null;
  public_profile_linkable: boolean | null;
  export_safe: true;
};

type Payload = {
  ok: true;
  role: "owner" | "admin";
  filters: {
    status: StatusFilter;
    issue: IssueFilter;
    linked_server_id: string | null;
    audit_action: AuditActionFilter;
    audit_result: AuditResultFilter;
  };
  counts: {
    total: number;
    pending: number;
    imported: number;
    rejected: number;
    duplicate: number;
    ambiguous: number;
  };
  notification_counts: {
    unread_total: number;
    community_member_importable: number;
  };
  servers: ServerOption[];
  candidates: CandidateItem[];
  audit: AuditItem[];
  audit_groups: AuditGroup[];
  export_safe_audit: ExportSafeAuditItem[];
  safeguards: {
    public_profile_link_requires_player_opt_in_handle: boolean;
    trusted_dzn_user_bridge_required: boolean;
    import_preview_requires_trusted_bridge: boolean;
    import_previews_from_trusted_snapshots_where_available: boolean;
    selected_row_bulk_actions: boolean;
    bulk_actions_recheck_server_side: boolean;
    bulk_partial_success_execution_summaries: boolean;
    filterable_bulk_action_audit_groups: boolean;
    export_safe_audit_views: boolean;
    bounded_export_downloads: boolean;
    export_download_private_owner_admin_only: boolean;
    export_filters_action_result_date: boolean;
    export_uses_export_safe_audit_rows: boolean;
    export_history_affordance_client_only: boolean;
    export_download_non_persistent_by_default: boolean;
    export_private_artifact_notice: boolean;
    export_retention_controls: boolean;
    admin_repeated_source_filters: boolean;
    owner_importable_notification_hook: boolean;
    notification_hook_dzn_pulse_only: boolean;
    notification_read_state_private_per_owner: boolean;
    community_import_alert_read_state_private_per_owner: boolean;
    rejects_duplicate_members: boolean;
    rejects_ambiguous_user_bridge: boolean;
    affects_ctf_scoring_rows: boolean;
    affects_owner_workflow_decisions: boolean;
    affects_approval_decisions: boolean;
    affects_bracket_outcomes: boolean;
    affects_billing: boolean;
    affects_rankings: boolean;
    affects_discovery_score: boolean;
    affects_reviews: boolean;
    affects_badges: boolean;
    affects_seasons: boolean;
    affects_server_wars_scoring: boolean;
    affects_xp_awards: boolean;
    affects_calling_card_awards: boolean;
    affects_competitive_eligibility: boolean;
  };
  generated_at: string;
};

type CandidateForm = {
  linkedServerId: string;
  discordId: string;
  dznUserId: string;
  username: string;
  displayName: string;
  roleLabel: string;
  reason: string;
};

const DEFAULT_PRICING_URL = "/pricing?intent=owner_setup&returnTo=%2Fdashboard%2Fcommunity-members";
const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "ambiguous", label: "Ambiguous" },
  { value: "duplicate", label: "Duplicate" },
  { value: "imported", label: "Imported" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];
const ISSUE_FILTERS: Array<{ value: IssueFilter; label: string }> = [
  { value: "all", label: "All source rows" },
  { value: "importable", label: "Importable" },
  { value: "repeated_no_match", label: "Repeated no-match" },
  { value: "repeated_duplicate", label: "Repeated duplicate" },
];
const AUDIT_ACTION_FILTERS: Array<{ value: AuditActionFilter; label: string }> = [
  { value: "all", label: "All actions" },
  { value: "candidate_imported", label: "Imported" },
  { value: "candidate_rejected", label: "Rejected" },
  { value: "candidate_importable", label: "Importable" },
  { value: "candidate_preview_refreshed", label: "Preview refreshed" },
  { value: "candidate_no_match", label: "No match" },
  { value: "duplicate_rejected", label: "Duplicate rejected" },
  { value: "ambiguous_rejected", label: "Ambiguous rejected" },
  { value: "candidate_created", label: "Created" },
];
const AUDIT_RESULT_FILTERS: Array<{ value: AuditResultFilter; label: string }> = [
  { value: "all", label: "All results" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
];

const EMPTY_FORM: CandidateForm = {
  linkedServerId: "",
  discordId: "",
  dznUserId: "",
  username: "",
  displayName: "",
  roleLabel: "",
  reason: "",
};

export function CommunityMemberSourceDashboard({ homeHref = "/dashboard", embedded = false }: { homeHref?: string; embedded?: boolean }) {
  const [state, setState] = useState<LoadState>("loading");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const [auditActionFilter, setAuditActionFilter] = useState<AuditActionFilter>("all");
  const [auditResultFilter, setAuditResultFilter] = useState<AuditResultFilter>("all");
  const [linkedServerFilter, setLinkedServerFilter] = useState("all");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [form, setForm] = useState<CandidateForm>(EMPTY_FORM);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bulkBusyAction, setBulkBusyAction] = useState<"import" | "reject" | null>(null);
  const [importAlertsBusy, setImportAlertsBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [exportLimit, setExportLimit] = useState("250");
  const [recentAuditExports, setRecentAuditExports] = useState<RecentAuditExport[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [bulkExecutionSummaries, setBulkExecutionSummaries] = useState<BulkExecutionSummary[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pricingUrl, setPricingUrl] = useState(DEFAULT_PRICING_URL);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ status: statusFilter, issue: issueFilter, limit: "120" });
    if (linkedServerFilter !== "all") params.set("linked_server_id", linkedServerFilter);
    if (auditActionFilter !== "all") params.set("audit_action", auditActionFilter);
    if (auditResultFilter !== "all") params.set("audit_result", auditResultFilter);

    fetch(`/api/owner/community-members?${params.toString()}`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const result = await safeJson(response);
        if (!active) return;
        if (response.status === 401) {
          setState("unauthorized");
          setPayload(null);
          return;
        }
        if (response.status === 402) {
          setPricingUrl(typeof result?.pricing_url === "string" ? result.pricing_url : DEFAULT_PRICING_URL);
          setState("plan_required");
          setPayload(null);
          return;
        }
        if (response.status === 403) {
          setState("forbidden");
          setPayload(null);
          return;
        }
        if (response.status === 503 && result?.error === "COMMUNITY_MEMBER_SOURCE_MANAGEMENT_NOT_CONFIGURED") {
          setState("not_configured");
          setPayload(null);
          return;
        }
        if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Community member source management could not be loaded."));
        const nextPayload = result as Payload;
        setPayload(nextPayload);
        setState("ready");
        setForm((current) => ({
          ...current,
          linkedServerId: current.linkedServerId || nextPayload.servers[0]?.id || "",
        }));
      })
      .catch((error) => {
        if (!active) return;
        setPayload(null);
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Community member source management could not be loaded." });
        setState("error");
      });

    return () => {
      active = false;
    };
  }, [statusFilter, issueFilter, auditActionFilter, auditResultFilter, linkedServerFilter, refreshKey]);

  const counts = payload?.counts ?? { total: 0, pending: 0, imported: 0, rejected: 0, duplicate: 0, ambiguous: 0 };
  const notificationCounts = payload?.notification_counts ?? { unread_total: 0, community_member_importable: 0 };
  const candidates = payload?.candidates ?? [];
  const audit = payload?.audit ?? [];
  const auditGroups = payload?.audit_groups ?? [];
  const exportSafeAudit = payload?.export_safe_audit ?? [];
  const servers = payload?.servers ?? [];
  const selectableCandidateIds = candidates.filter((candidate) => candidate.status === "pending").map((candidate) => candidate.id);
  const selectedCandidateSet = new Set(selectedCandidateIds);
  const selectedPendingCandidateIds = selectableCandidateIds.filter((id) => selectedCandidateSet.has(id));
  const allVisibleSelected = selectableCandidateIds.length > 0 && selectableCandidateIds.every((id) => selectedCandidateSet.has(id));
  const filteredServerName = linkedServerFilter === "all"
    ? "All linked communities"
    : servers.find((server) => server.id === linkedServerFilter)?.server_name ?? "Selected community";

  function toggleCandidateSelection(candidateId: string, selected: boolean) {
    setSelectedCandidateIds((current) => {
      if (selected) return Array.from(new Set([...current, candidateId]));
      return current.filter((id) => id !== candidateId);
    });
  }

  function toggleVisibleCandidateSelection(selected: boolean) {
    setSelectedCandidateIds((current) => {
      const visible = new Set(selectableCandidateIds);
      if (!selected) return current.filter((id) => !visible.has(id));
      return Array.from(new Set([...current, ...selectableCandidateIds]));
    });
  }

  async function submitCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("create");
    setBulkExecutionSummaries([]);
    setMessage({ tone: "info", text: "Saving community member candidate." });
    try {
      const response = await fetch("/api/owner/community-members", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          linked_server_id: form.linkedServerId,
          candidate_discord_id: form.discordId,
          dzn_user_id: form.dznUserId,
          candidate_username: form.username,
          candidate_display_name: form.displayName,
          role_label: form.roleLabel,
          reason: form.reason,
          source: payload?.role === "admin" ? "admin_import" : "owner_import",
        }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Community member candidate could not be saved."));
      setMessage({ tone: "success", text: apiMessage(result, "Community member candidate saved.") });
      setForm((current) => ({ ...EMPTY_FORM, linkedServerId: current.linkedServerId || servers[0]?.id || "" }));
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Community member candidate could not be saved." });
    } finally {
      setBusyAction(null);
    }
  }

  async function runCandidateAction(candidate: CandidateItem, action: ActionKind) {
    const busyKey = `${candidate.id}:${action}`;
    setBusyAction(busyKey);
    setBulkExecutionSummaries([]);
    setMessage({
      tone: "info",
      text: action === "import"
        ? "Checking trusted bridge before import."
        : action === "refresh_preview"
          ? "Refreshing trusted source preview."
          : "Rejecting community member candidate.",
    });
    try {
      const response = await fetch(`/api/owner/community-members/${encodeURIComponent(candidate.id)}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action,
          reason: action === "import"
            ? "Owner/admin approved unique DZN user bridge."
            : action === "refresh_preview"
              ? "Owner/admin refreshed trusted source preview."
              : "Rejected by owner/admin review.",
          role_label: candidate.role_label,
        }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Community member action failed."));
      setMessage({
        tone: "success",
        text: apiMessage(
          result,
          action === "import"
            ? "Community member imported."
            : action === "refresh_preview"
              ? "Import preview refreshed."
              : "Candidate rejected.",
        ),
      });
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Community member action failed." });
      setRefreshKey((value) => value + 1);
    } finally {
      setBusyAction(null);
    }
  }

  async function runBulkCandidateAction(action: "import" | "reject") {
    const candidateIds = selectedPendingCandidateIds;
    if (!candidateIds.length) {
      setMessage({ tone: "error", text: "Choose at least one pending community member candidate." });
      return;
    }

    setBulkBusyAction(action);
    setMessage({
      tone: "info",
      text: action === "import"
        ? "Rechecking every selected row before import."
        : "Rechecking every selected row before rejection.",
    });
    try {
      const response = await fetch("/api/owner/community-members/bulk", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action,
          candidate_ids: candidateIds,
          reason: action === "import"
            ? "Selected rows approved after server-side bridge recheck."
            : "Selected rows rejected from owner/admin review.",
        }),
      });
      const result = await safeJson(response);
      if (!response.ok) throw new Error(apiMessage(result, "Selected community member candidates could not be processed."));
      const executionSummaries = Array.isArray(result?.execution_summaries)
        ? result.execution_summaries as BulkExecutionSummary[]
        : [];
      setBulkExecutionSummaries(executionSummaries);
      setMessage({
        tone: result?.ok === true ? "success" : "error",
        text: apiMessage(result, "Some selected community member candidates could not be processed after server-side recheck."),
      });
      setSelectedCandidateIds([]);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Selected community member candidates could not be processed." });
      setRefreshKey((value) => value + 1);
    } finally {
      setBulkBusyAction(null);
    }
  }

  async function markCommunityImportAlertsRead() {
    setImportAlertsBusy(true);
    setMessage({ tone: "info", text: "Marking community member import alerts read." });
    try {
      const response = await fetch("/api/owner/community-members/notifications/read", {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.ok) throw new Error(apiMessage(result, "Community member import alerts could not be marked read."));
      const marked = Number(result.marked ?? 0) || 0;
      const totalUnread = Number(result.unreadCount ?? Math.max(0, notificationCounts.unread_total - marked)) || 0;
      const importUnread = Number(result.communityMemberImportUnreadCount ?? 0) || 0;
      setPayload((current) => current ? {
        ...current,
        notification_counts: {
          unread_total: Math.max(0, totalUnread),
          community_member_importable: Math.max(0, importUnread),
        },
      } : current);
      setMessage({ tone: "success", text: apiMessage(result, marked ? "Community member import alerts marked read." : "No unread community member import alerts found.") });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Community member import alerts could not be marked read." });
    } finally {
      setImportAlertsBusy(false);
    }
  }

  async function downloadAuditExport() {
    setExportBusy(true);
    setMessage({ tone: "info", text: "Preparing export-safe community member audit CSV." });
    const params = new URLSearchParams({ limit: exportLimit });
    if (linkedServerFilter !== "all") params.set("linked_server_id", linkedServerFilter);
    if (auditActionFilter !== "all") params.set("audit_action", auditActionFilter);
    if (auditResultFilter !== "all") params.set("audit_result", auditResultFilter);
    if (exportDateFrom) params.set("date_from", exportDateFrom);
    if (exportDateTo) params.set("date_to", exportDateTo);
    const requestedFilters = buildExportFilterSummary({
      servers,
      linkedServerFilter,
      auditActionFilter,
      auditResultFilter,
      exportDateFrom,
      exportDateTo,
      exportLimit,
    });

    try {
      const response = await fetch(`/api/owner/community-members/export?${params.toString()}`, {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "text/csv" },
      });
      if (!response.ok) {
        const result = await safeJson(response);
        throw new Error(apiMessage(result, "Community member audit export could not be downloaded."));
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const filename = filenameFromContentDisposition(response.headers.get("content-disposition")) ?? "dzn-community-member-import-audit.csv";
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      const generatedAt = response.headers.get("x-dzn-export-generated-at") ?? new Date().toISOString();
      const rowCount = parseHeaderNumber(response.headers.get("x-dzn-export-row-count"), 0);
      const rowLimit = parseHeaderNumber(response.headers.get("x-dzn-export-limit"), Number(exportLimit));
      const truncated = response.headers.get("x-dzn-export-truncated") === "true";
      const nextExport: RecentAuditExport = {
        id: `${generatedAt}:${filename}`,
        generated_at: generatedAt,
        filename,
        row_count: rowCount,
        limit: rowLimit,
        truncated,
        filters: requestedFilters,
        private_artifact: true,
        persisted_by_dzn: false,
        retention: "download_only",
        dashboard_history: "client_session_only",
      };
      setRecentAuditExports((current) => [
        nextExport,
        ...current,
      ].slice(0, 5));
      setMessage({
        tone: "success",
        text: `Downloaded private export-safe audit CSV with ${rowCount} rows${truncated ? " after applying the server-side row limit" : ""}. DZN does not persist this export by default.`,
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Community member audit export could not be downloaded." });
    } finally {
      setExportBusy(false);
    }
  }

  const wrapperClassName = embedded ? "grid gap-5" : "min-h-screen bg-[#02030a] px-4 py-5 text-zinc-100 sm:px-6";
  const contentClassName = embedded ? "grid gap-5" : "mx-auto grid max-w-7xl gap-5";
  const loading = state === "loading";

  const content = (
    <div className={contentClassName}>
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={homeHref} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-300 hover:border-cyan-300/30 hover:text-white">
            Back to dashboard
          </Link>
          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/24 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 hover:bg-cyan-400/16"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      ) : null}

      <section className="rounded-lg border border-cyan-300/18 bg-[linear-gradient(135deg,rgba(34,211,238,0.08),rgba(139,92,246,0.08)_45%,rgba(0,0,0,0.36))] p-4 shadow-[0_0_36px_rgba(34,211,238,0.08)]">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">
                <ShieldCheck className="h-3.5 w-3.5" />
                Owner/admin source controls
              </span>
              {payload?.role ? (
                <span className="rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">
                  {payload.role}
                </span>
              ) : null}
            </div>
            <h1 className="mt-4 text-2xl font-black uppercase text-white sm:text-3xl">Trusted community member sources</h1>
            <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-zinc-300">
              Candidate Source Queue imports into the presentation-only community_members bridge after safer import previews, Duplicate/ambiguous-user rejection, and unique DZN user bridge checks.
            </p>
          </div>
          <div className="grid gap-2 rounded-lg border border-white/10 bg-black/28 p-3 text-xs font-bold text-zinc-400">
            <StatusLine label="public profile opt-in handle" ok={payload?.safeguards.public_profile_link_requires_player_opt_in_handle ?? true} />
            <StatusLine label="trusted snapshot previews" ok={payload?.safeguards.import_previews_from_trusted_snapshots_where_available ?? true} />
            <StatusLine label="owner Pulse hook only" ok={payload?.safeguards.owner_importable_notification_hook ?? true} />
            <StatusLine label="bulk row server recheck" ok={payload?.safeguards.bulk_actions_recheck_server_side ?? true} />
            <StatusLine label="bulk execution summaries" ok={payload?.safeguards.bulk_partial_success_execution_summaries ?? true} />
            <StatusLine label="export-safe audit views" ok={payload?.safeguards.export_safe_audit_views ?? true} />
            <StatusLine label="bounded export downloads" ok={payload?.safeguards.bounded_export_downloads ?? true} />
            <StatusLine label="export action/result/date filters" ok={payload?.safeguards.export_filters_action_result_date ?? true} />
            <StatusLine label="client-only export history" ok={payload?.safeguards.export_history_affordance_client_only ?? true} />
            <StatusLine label="non-persistent exports" ok={payload?.safeguards.export_download_non_persistent_by_default ?? true} />
            <StatusLine label="private import alert reads" ok={payload?.safeguards.community_import_alert_read_state_private_per_owner ?? true} />
            <StatusLine label="CTF scoring rows" ok={!(payload?.safeguards.affects_ctf_scoring_rows ?? false)} />
            <StatusLine label="Billing and rankings" ok={!((payload?.safeguards.affects_billing ?? false) || (payload?.safeguards.affects_rankings ?? false))} />
            <StatusLine label="XP and calling cards" ok={!((payload?.safeguards.affects_xp_awards ?? false) || (payload?.safeguards.affects_calling_card_awards ?? false))} />
          </div>
        </div>
      </section>

      {message ? <MessageBanner tone={message.tone}>{message.text}</MessageBanner> : null}
      {bulkExecutionSummaries.length ? <BulkExecutionSummaryPanel summaries={bulkExecutionSummaries} /> : null}

      {state === "unauthorized" ? <AccessPanel title="Sign in required" body="Log in with Discord before managing community member sources." actionHref="/login?returnTo=%2Fdashboard%2Fcommunity-members" actionLabel="Log in with Discord" /> : null}
      {state === "plan_required" ? <AccessPanel title="Owner access required" body="Community member source controls sit behind the owner entitlement gate." actionHref={pricingUrl} actionLabel="View owner plans" /> : null}
      {state === "forbidden" ? <AccessPanel title="Not available" body="This Discord account cannot manage community member sources for the selected scope." /> : null}
      {state === "not_configured" ? <AccessPanel title="Source tables not configured" body="The additive community member source management migration has not been applied in this environment." /> : null}
      {state === "error" ? <AccessPanel title="Could not load source controls" body={message?.text ?? "Community member source management is temporarily unavailable."} /> : null}

      {state === "ready" || loading ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
            <MetricCard label="Total candidates" value={counts.total} loading={loading} tone="cyan" />
            <MetricCard label="Pending review" value={counts.pending} loading={loading} tone="amber" />
            <MetricCard label="Imported bridge" value={counts.imported} loading={loading} tone="emerald" />
            <MetricCard label="Rejected" value={counts.rejected} loading={loading} tone="rose" />
            <MetricCard label="Duplicates" value={counts.duplicate} loading={loading} tone="violet" />
            <MetricCard label="Ambiguous" value={counts.ambiguous} loading={loading} tone="red" />
            <MetricCard label="Import alerts" value={notificationCounts.community_member_importable} loading={loading} tone="cyan" />
          </div>

          <section className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
            <form onSubmit={submitCandidate} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center justify-between gap-3">
                <PanelTitle icon={<UserPlus className="h-4 w-4" />} title="Add candidate" />
                <span className="rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">Private</span>
              </div>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                  Linked community
                  <select
                    value={form.linkedServerId}
                    onChange={(event) => setForm((current) => ({ ...current, linkedServerId: event.target.value }))}
                    className="rounded border border-white/10 bg-black/40 px-3 py-3 text-xs font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40"
                  >
                    {servers.length ? servers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {server.server_name} / {server.community_name}
                      </option>
                    )) : <option value="">No linked community found</option>}
                  </select>
                </label>
                <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                  Discord ID
                  <input value={form.discordId} onChange={(event) => setForm((current) => ({ ...current, discordId: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" placeholder="Numeric Discord user ID" />
                </label>
                <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                  DZN user ID
                  <input value={form.dznUserId} onChange={(event) => setForm((current) => ({ ...current, dznUserId: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" placeholder="Optional exact DZN user ID" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                    Username
                    <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                  </label>
                  <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                    Role
                    <input value={form.roleLabel} onChange={(event) => setForm((current) => ({ ...current, roleLabel: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" placeholder="Raid Lead" />
                  </label>
                </div>
                <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                  Display name
                  <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                </label>
                <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">
                  Audit note
                  <textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} rows={3} className="resize-none rounded border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                </label>
                <button
                  type="submit"
                  disabled={busyAction === "create" || !form.linkedServerId || (!form.discordId.trim() && !form.dznUserId.trim())}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/12 px-4 py-3 text-xs font-black uppercase text-cyan-50 transition hover:bg-cyan-400/18 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <UserPlus className="h-4 w-4" />
                  {busyAction === "create" ? "Saving" : "Save candidate"}
                </button>
              </div>
            </form>

            <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <PanelTitle icon={<Users className="h-4 w-4" />} title="Candidate Source Queue" />
                  <p className="mt-2 text-sm font-bold text-zinc-400">{filteredServerName}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={importAlertsBusy || notificationCounts.community_member_importable <= 0}
                    onClick={markCommunityImportAlertsRead}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-cyan-300/24 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50 transition hover:bg-cyan-400/16 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {notificationCounts.community_member_importable > 0 ? <Bell className="h-3.5 w-3.5" /> : <CheckCheck className="h-3.5 w-3.5" />}
                    {importAlertsBusy ? "Marking alerts" : "Mark import alerts read"}
                    {notificationCounts.community_member_importable > 0 ? (
                      <span className="rounded bg-cyan-200 px-1.5 py-0.5 text-[9px] text-cyan-950">{notificationCounts.community_member_importable}</span>
                    ) : null}
                  </button>
                  <select value={statusFilter} onChange={(event) => {
                    setSelectedCandidateIds([]);
                    setStatusFilter(event.target.value as StatusFilter);
                  }} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none focus:border-cyan-300/40">
                    {STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <select value={issueFilter} onChange={(event) => {
                    setSelectedCandidateIds([]);
                    setIssueFilter(event.target.value as IssueFilter);
                  }} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none focus:border-cyan-300/40">
                    {ISSUE_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <select value={linkedServerFilter} onChange={(event) => {
                    setSelectedCandidateIds([]);
                    setLinkedServerFilter(event.target.value);
                  }} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none focus:border-cyan-300/40">
                    <option value="all">All communities</option>
                    {servers.map((server) => <option key={server.id} value={server.id}>{server.server_name}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-cyan-300/16 bg-cyan-400/8 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <label className="inline-flex min-h-10 items-center gap-3 text-xs font-black uppercase text-zinc-200">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      disabled={!selectableCandidateIds.length || Boolean(busyAction) || Boolean(bulkBusyAction)}
                      onChange={(event) => toggleVisibleCandidateSelection(event.target.checked)}
                      className="h-4 w-4 rounded border-cyan-300/30 bg-black/40 accent-cyan-300"
                    />
                    Select pending rows
                    <span className="rounded border border-white/10 bg-black/28 px-2 py-1 text-[10px] text-zinc-400">{selectedPendingCandidateIds.length} selected</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!selectedPendingCandidateIds.length || Boolean(busyAction) || Boolean(bulkBusyAction)}
                      onClick={() => runBulkCandidateAction("import")}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300/24 bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-50 transition hover:bg-emerald-400/16 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Import className="h-3.5 w-3.5" />
                      {bulkBusyAction === "import" ? "Bulk importing" : "Bulk import selected"}
                    </button>
                    <button
                      type="button"
                      disabled={!selectedPendingCandidateIds.length || Boolean(busyAction) || Boolean(bulkBusyAction)}
                      onClick={() => runBulkCandidateAction("reject")}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-300/24 bg-rose-400/10 px-3 py-2 text-[10px] font-black uppercase text-rose-50 transition hover:bg-rose-400/16 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {bulkBusyAction === "reject" ? "Bulk rejecting" : "Bulk reject selected"}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs font-bold leading-5 text-cyan-100/70">
                  Each selected row is rechecked server-side before DZN imports or rejects it.
                </p>
              </div>

              <div className="mt-4 grid gap-3">
                {loading ? <SkeletonRows /> : null}
                {!loading && !candidates.length ? (
                  <EmptyState icon={<Users className="h-5 w-5" />} title="No candidates in this view" body="Candidate imports and rejections will appear here with their audit history." />
                ) : null}
                {candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    busyAction={busyAction}
                    selected={selectedCandidateSet.has(candidate.id)}
                    selectionDisabled={candidate.status !== "pending" || Boolean(busyAction) || Boolean(bulkBusyAction)}
                    actionDisabled={Boolean(bulkBusyAction)}
                    onSelectionChange={toggleCandidateSelection}
                    onAction={runCandidateAction}
                  />
                ))}
              </div>
            </section>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PanelTitle icon={<History className="h-4 w-4" />} title="Source audit history" />
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{audit.length} rows</span>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-[11px] font-black uppercase text-zinc-500">
                Audit action
                <select
                  value={auditActionFilter}
                  onChange={(event) => setAuditActionFilter(event.target.value as AuditActionFilter)}
                  className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none focus:border-cyan-300/40"
                >
                  {AUDIT_ACTION_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-black uppercase text-zinc-500">
                Audit result
                <select
                  value={auditResultFilter}
                  onChange={(event) => setAuditResultFilter(event.target.value as AuditResultFilter)}
                  className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none focus:border-cyan-300/40"
                >
                  {AUDIT_RESULT_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-black uppercase text-zinc-500">
                Export from
                <span className="relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="date"
                    value={exportDateFrom}
                    onChange={(event) => setExportDateFrom(event.target.value)}
                    className="min-h-9 rounded border border-white/10 bg-black/40 py-2 pl-8 pr-3 text-xs font-black uppercase text-zinc-100 outline-none focus:border-cyan-300/40"
                  />
                </span>
              </label>
              <label className="grid gap-1 text-[11px] font-black uppercase text-zinc-500">
                Export to
                <span className="relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="date"
                    value={exportDateTo}
                    onChange={(event) => setExportDateTo(event.target.value)}
                    className="min-h-9 rounded border border-white/10 bg-black/40 py-2 pl-8 pr-3 text-xs font-black uppercase text-zinc-100 outline-none focus:border-cyan-300/40"
                  />
                </span>
              </label>
              <label className="grid gap-1 text-[11px] font-black uppercase text-zinc-500">
                Export rows
                <select
                  value={exportLimit}
                  onChange={(event) => setExportLimit(event.target.value)}
                  className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none focus:border-cyan-300/40"
                >
                  <option value="100">100 rows</option>
                  <option value="250">250 rows</option>
                  <option value="500">500 rows</option>
                </select>
              </label>
              <button
                type="button"
                disabled={exportBusy || loading}
                onClick={downloadAuditExport}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-emerald-300/24 bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-50 transition hover:bg-emerald-400/16 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Download className="h-3.5 w-3.5" />
                {exportBusy ? "Preparing CSV" : "Download audit CSV"}
              </button>
              <span className="inline-flex min-h-9 items-center gap-2 rounded border border-cyan-300/18 bg-cyan-400/8 px-3 py-2 text-[10px] font-black uppercase text-cyan-100">
                <Filter className="h-3.5 w-3.5" />
                Filterable bulk action audit grouping
              </span>
            </div>
            <p className="mt-3 text-xs font-bold leading-5 text-zinc-500">
              Audit CSV exports use the selected community, action, result, date filters, and server-side row limit, then download only export-safe owner/admin rows.
            </p>
            <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="rounded-lg border border-amber-300/16 bg-amber-400/8 p-4">
                <PanelTitle icon={<LockKeyhole className="h-4 w-4" />} title="Private export" />
                <div className="mt-3 grid gap-2 text-xs font-bold text-amber-50 sm:grid-cols-2">
                  <span className="rounded border border-amber-200/18 bg-black/24 px-3 py-2">Owner/admin artifact</span>
                  <span className="rounded border border-amber-200/18 bg-black/24 px-3 py-2">Download-only by default</span>
                  <span className="rounded border border-amber-200/18 bg-black/24 px-3 py-2">Not stored as a DZN export log</span>
                  <span className="rounded border border-amber-200/18 bg-black/24 px-3 py-2">Clear local history anytime</span>
                </div>
                <p className="mt-3 text-xs font-bold leading-5 text-amber-100/80">
                  The downloaded CSV is for the signed-in owner/admin view. DZN keeps the source audit rows, but does not persist a separate export file or export history record by default.
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/24 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <PanelTitle icon={<Clock3 className="h-4 w-4" />} title="Recent exports" />
                  {recentAuditExports.length ? (
                    <button
                      type="button"
                      onClick={() => setRecentAuditExports([])}
                      className="inline-flex min-h-8 items-center gap-2 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-zinc-300 transition hover:border-red-300/24 hover:text-red-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear local history
                    </button>
                  ) : null}
                </div>
                {recentAuditExports.length ? (
                  <div className="mt-3 grid gap-2">
                    {recentAuditExports.map((item) => (
                      <div key={item.id} className="rounded border border-cyan-300/14 bg-cyan-400/6 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black uppercase text-white">{item.filename}</p>
                            <p className="mt-1 text-[11px] font-bold text-zinc-500">Generated {formatDate(item.generated_at)}</p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase">
                            <span className="rounded border border-emerald-300/18 bg-emerald-400/10 px-2 py-1 text-emerald-100">{item.row_count} rows</span>
                            <span className="rounded border border-cyan-300/18 bg-cyan-400/10 px-2 py-1 text-cyan-100">Limit {item.limit}</span>
                            <span className="rounded border border-amber-300/18 bg-amber-400/10 px-2 py-1 text-amber-100">{item.truncated ? "Truncated" : "Complete"}</span>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.filters.map((filter) => (
                            <span key={`${item.id}:${filter}`} className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-black uppercase text-zinc-400">
                              {filter}
                            </span>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase">
                          <span className="inline-flex items-center gap-1 rounded border border-amber-200/18 bg-amber-300/10 px-2 py-1 text-amber-100">
                            <LockKeyhole className="h-3 w-3" />
                            Private file
                          </span>
                          <span className="rounded border border-zinc-400/18 bg-white/[0.03] px-2 py-1 text-zinc-400">Client-session history only</span>
                          <span className="rounded border border-zinc-400/18 bg-white/[0.03] px-2 py-1 text-zinc-400">Not persisted by DZN</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<Download className="h-5 w-5" />} title="No export downloads yet" body="Successful downloads will appear here until this dashboard is refreshed or the local history is cleared." />
                )}
              </div>
            </div>
            {!loading && auditGroups.length ? (
              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {auditGroups.map((group) => (
                  <div key={group.key} className="rounded-lg border border-cyan-300/14 bg-black/26 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase text-white">{titleCaseToken(group.action)}</p>
                        <p className="mt-1 text-[11px] font-bold text-zinc-500">{group.server_name} / {group.community_name}</p>
                      </div>
                      <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${auditTone(group.result_status)}`}>{group.result_status}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-[11px] font-bold text-zinc-400 sm:grid-cols-2">
                      <span>{group.row_count} rows</span>
                      <span>{formatDate(group.first_at)} - {formatDate(group.last_at)}</span>
                      <span>{group.accepted_count} accepted</span>
                      <span>{group.rejected_count} rejected</span>
                      <span>{group.skipped_count} skipped</span>
                      <span>{group.failed_count} failed</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-4 grid gap-2">
              {!loading && !audit.length ? <EmptyState icon={<History className="h-5 w-5" />} title="No audit entries yet" body="Candidate creation, import, duplicate rejection, ambiguous rejection, and manual rejection entries will appear here." /> : null}
              {loading ? <SkeletonRows /> : null}
              {audit.map((item) => (
                <div key={item.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-white">{titleCaseToken(item.action)}</p>
                      <p className="mt-1 text-xs font-bold text-zinc-500">{item.server_name} / {item.community_name}</p>
                    </div>
                    <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${auditTone(item.result_status)}`}>{item.result_status}</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs font-bold text-zinc-500 sm:grid-cols-4">
                    <span>Actor: {item.actor_role}</span>
                    <span>Candidate: {compactId(item.candidate_id)}</span>
                    <span>Bridge: {compactId(item.community_member_id)}</span>
                    <span>{formatDate(item.created_at)}</span>
                  </div>
                  {item.reason ? <p className="mt-3 text-xs leading-5 text-zinc-400">{item.reason}</p> : null}
                </div>
              ))}
            </div>
            {!loading && exportSafeAudit.length ? (
              <div className="mt-5 rounded-lg border border-emerald-300/16 bg-emerald-400/8 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <PanelTitle icon={<FileText className="h-4 w-4" />} title="Export-safe audit view" />
                  <span className="rounded border border-emerald-300/18 bg-black/24 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">Owner/admin only</span>
                </div>
                <div className="mt-3 grid gap-2">
                  {exportSafeAudit.slice(0, 12).map((item) => (
                    <div key={`${item.id_ref}:${item.created_at ?? "unknown"}`} className="grid gap-2 rounded border border-white/10 bg-black/24 p-3 text-xs font-bold text-zinc-400 lg:grid-cols-[1fr_auto]">
                      <div>
                        <p className="font-black uppercase text-white">{titleCaseToken(item.action)} / {item.result_status}</p>
                        <p className="mt-1">{item.server_name} / {item.community_name}</p>
                      </div>
                      <div className="grid gap-1 text-[11px] lg:min-w-72 lg:text-right">
                        <span>Actor: {item.actor_role}</span>
                        <span>Candidate: {item.candidate_ref ?? "none"} / Bridge: {item.community_member_ref ?? "none"}</span>
                        <span>{formatDate(item.created_at)}</span>
                      </div>
                      {item.reason ? <p className="lg:col-span-2">{item.reason}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );

  return <main className={wrapperClassName}>{content}</main>;
}

function filenameFromContentDisposition(value: string | null) {
  if (!value) return null;
  const match = /filename="([^"]+)"/i.exec(value) ?? /filename=([^;]+)/i.exec(value);
  const filename = match?.[1]?.trim();
  return filename ? filename.replace(/[\\/:*?"<>|]/g, "-") : null;
}

function buildExportFilterSummary({
  servers,
  linkedServerFilter,
  auditActionFilter,
  auditResultFilter,
  exportDateFrom,
  exportDateTo,
  exportLimit,
}: {
  servers: ServerOption[];
  linkedServerFilter: string;
  auditActionFilter: AuditActionFilter;
  auditResultFilter: AuditResultFilter;
  exportDateFrom: string;
  exportDateTo: string;
  exportLimit: string;
}) {
  const selectedServer = linkedServerFilter === "all"
    ? "All scoped communities"
    : servers.find((server) => server.id === linkedServerFilter)?.server_name ?? "Selected community";
  return [
    `Community: ${selectedServer}`,
    `Action: ${filterLabel(AUDIT_ACTION_FILTERS, auditActionFilter)}`,
    `Result: ${filterLabel(AUDIT_RESULT_FILTERS, auditResultFilter)}`,
    `From: ${exportDateFrom || "Start"}`,
    `To: ${exportDateTo || "Now"}`,
    `Rows: ${exportLimit}`,
  ];
}

function filterLabel<T extends string>(options: Array<{ value: T; label: string }>, value: T) {
  return options.find((item) => item.value === value)?.label ?? titleCaseToken(value);
}

function parseHeaderNumber(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function BulkExecutionSummaryPanel({ summaries }: { summaries: BulkExecutionSummary[] }) {
  const imported = summaries.filter((item) => item.outcome === "imported").length;
  const rejected = summaries.filter((item) => item.outcome === "rejected").length;
  const blocked = summaries.filter((item) => item.outcome === "blocked").length;
  const failed = summaries.filter((item) => item.outcome === "failed").length;
  return (
    <section className="rounded-lg border border-cyan-300/18 bg-cyan-400/8 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PanelTitle icon={<CheckCheck className="h-4 w-4" />} title="Bulk action summaries" />
        <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase">
          <span className="rounded border border-emerald-300/18 bg-emerald-400/10 px-2 py-1 text-emerald-100">{imported} imported</span>
          <span className="rounded border border-rose-300/18 bg-rose-400/10 px-2 py-1 text-rose-100">{rejected} rejected</span>
          <span className="rounded border border-amber-300/18 bg-amber-400/10 px-2 py-1 text-amber-100">{blocked} blocked</span>
          <span className="rounded border border-zinc-400/18 bg-white/[0.03] px-2 py-1 text-zinc-300">{failed} failed</span>
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {summaries.map((item) => (
          <div key={`${item.candidate_id}:${item.action}:${item.status}`} className="rounded border border-white/10 bg-black/24 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-white">{item.candidate_label}</p>
                <p className="mt-1 text-xs font-bold text-zinc-500">{item.server_name ?? "DZN Server"} / {item.community_name ?? "DZN Community"}</p>
              </div>
              <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${outcomeTone(item.outcome)}`}>{item.outcome}</span>
            </div>
            <div className="mt-3 grid gap-2 text-xs font-bold text-zinc-500 sm:grid-cols-3">
              <span>Candidate: {item.candidate_ref}</span>
              <span>Bridge: {item.imported_member_ref ?? "none"}</span>
              <span>Profile link: {item.public_profile_linkable ? "player opted in" : "hidden"}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{item.message}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CandidateCard({
  candidate,
  busyAction,
  selected,
  selectionDisabled,
  actionDisabled,
  onSelectionChange,
  onAction,
}: {
  candidate: CandidateItem;
  busyAction: string | null;
  selected: boolean;
  selectionDisabled: boolean;
  actionDisabled: boolean;
  onSelectionChange: (candidateId: string, selected: boolean) => void;
  onAction: (candidate: CandidateItem, action: ActionKind) => void;
}) {
  const canImport = candidate.import_preview.can_import;
  const canReject = candidate.status === "pending";
  const canRefresh = candidate.status !== "imported" && candidate.status !== "rejected";
  const importBusy = busyAction === `${candidate.id}:import`;
  const rejectBusy = busyAction === `${candidate.id}:reject`;
  const refreshBusy = busyAction === `${candidate.id}:refresh_preview`;
  return (
    <article className={`rounded-lg border p-4 ${selected ? "border-cyan-300/35 bg-cyan-400/8" : "border-white/10 bg-black/28"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <label className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-white/10 bg-black/32">
            <input
              type="checkbox"
              checked={selected}
              disabled={selectionDisabled}
              onChange={(event) => onSelectionChange(candidate.id, event.target.checked)}
              className="h-4 w-4 rounded border-cyan-300/30 bg-black/40 accent-cyan-300 disabled:cursor-not-allowed"
              aria-label={`Select ${candidate.candidate_display_name ?? candidate.candidate_username ?? candidate.matched_username ?? "community member candidate"}`}
            />
          </label>
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={candidate.status} />
            <MatchPill status={candidate.match_status} />
            {candidate.public_profile_linkable ? (
              <span className="rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">Published profile ready</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded border border-zinc-400/16 bg-white/[0.03] px-2 py-1 text-[10px] font-black uppercase text-zinc-400">
                <EyeOff className="h-3 w-3" />
                Hidden until player opt-in
              </span>
            )}
          </div>
          <h2 className="mt-3 truncate text-lg font-black text-white">
            {candidate.candidate_display_name ?? candidate.candidate_username ?? candidate.matched_username ?? "Community member candidate"}
          </h2>
          <p className="mt-1 text-xs font-bold text-zinc-500">{candidate.server_name} / {candidate.community_name}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={actionDisabled || !canRefresh || refreshBusy}
            onClick={() => onAction(candidate, "refresh_preview")}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/24 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50 transition hover:bg-cyan-400/16 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshBusy ? "animate-spin" : ""}`} />
            {refreshBusy ? "Refreshing" : "Refresh preview"}
          </button>
          <button
            type="button"
            disabled={actionDisabled || !canImport || importBusy}
            onClick={() => onAction(candidate, "import")}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300/24 bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-50 transition hover:bg-emerald-400/16 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Import className="h-3.5 w-3.5" />
            {importBusy ? "Importing" : "Import"}
          </button>
          <button
            type="button"
            disabled={actionDisabled || !canReject || rejectBusy}
            onClick={() => onAction(candidate, "reject")}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-300/24 bg-rose-400/10 px-3 py-2 text-[10px] font-black uppercase text-rose-50 transition hover:bg-rose-400/16 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <XCircle className="h-3.5 w-3.5" />
            {rejectBusy ? "Rejecting" : "Reject"}
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-xs font-bold text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
        <span>Discord: {candidate.candidate_discord_id_masked ?? "not stored"}</span>
        <span>DZN user: {compactId(candidate.matched_user_id)}</span>
        <span>Role: {candidate.role_label ?? "Community member"}</span>
        <span>Source: {titleCaseToken(candidate.source)}</span>
      </div>
      <ImportPreviewPanel preview={candidate.import_preview} />
      {candidate.reason ? <p className="mt-3 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-5 text-zinc-400">{candidate.reason}</p> : null}
      {candidate.public_profile ? (
        <Link href={candidate.public_profile.public_href} className="mt-3 inline-flex items-center gap-2 rounded border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50">
          View public profile
          <ArrowRight className="h-3 w-3" />
        </Link>
      ) : null}
    </article>
  );
}

function ImportPreviewPanel({ preview }: { preview: ImportPreview }) {
  const tone = importPreviewTone(preview.status);
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {preview.can_import ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />}
          <p className="text-xs font-black uppercase tracking-[0.14em] text-zinc-300">Import preview</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${tone}`}>{preview.status.replaceAll("_", " ")}</span>
          <span className="rounded border border-cyan-300/18 bg-cyan-400/8 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">
            {preview.source_trust === "trusted_snapshot" ? "Trusted snapshot" : "Manual source"}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs font-bold leading-5 text-zinc-400">{preview.summary}</p>
      {preview.snapshot ? (
        <div className="mt-3 grid gap-2 text-xs font-bold text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
          <span>Snapshot: {titleCaseToken(preview.snapshot.source)}</span>
          <span>Captured: {formatDate(preview.snapshot.captured_at)}</span>
          <span>Name: {preview.snapshot.display_name ?? preview.snapshot.username ?? "not supplied"}</span>
          <span>Role: {preview.snapshot.role_label ?? "not supplied"}</span>
        </div>
      ) : null}
      {preview.warnings.length ? (
        <div className="mt-3 grid gap-1 text-xs font-bold text-amber-100/85">
          {preview.warnings.map((warning) => (
            <span key={warning} className="inline-flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {warning}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: CandidateStatus }) {
  const tone = {
    pending: "border-amber-300/24 bg-amber-400/10 text-amber-100",
    imported: "border-emerald-300/24 bg-emerald-400/10 text-emerald-100",
    rejected: "border-rose-300/24 bg-rose-400/10 text-rose-100",
    duplicate: "border-violet-300/24 bg-violet-400/10 text-violet-100",
    ambiguous: "border-red-300/24 bg-red-400/10 text-red-100",
  }[status];
  return <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${tone}`}>{status}</span>;
}

function MatchPill({ status }: { status: MatchStatus }) {
  const tone = {
    pending: "border-zinc-400/18 bg-white/[0.03] text-zinc-400",
    matched: "border-emerald-300/24 bg-emerald-400/10 text-emerald-100",
    no_match: "border-amber-300/24 bg-amber-400/10 text-amber-100",
    duplicate: "border-violet-300/24 bg-violet-400/10 text-violet-100",
    ambiguous: "border-red-300/24 bg-red-400/10 text-red-100",
  }[status];
  return <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${tone}`}>{status.replace("_", " ")}</span>;
}

function importPreviewTone(status: ImportPreview["status"]) {
  if (status === "ready") return "border-emerald-300/24 bg-emerald-400/10 text-emerald-100";
  if (status === "blocked_duplicate") return "border-violet-300/24 bg-violet-400/10 text-violet-100";
  if (status === "blocked_ambiguous") return "border-red-300/24 bg-red-400/10 text-red-100";
  if (status === "already_imported") return "border-cyan-300/24 bg-cyan-400/10 text-cyan-100";
  if (status === "rejected") return "border-rose-300/24 bg-rose-400/10 text-rose-100";
  return "border-amber-300/24 bg-amber-400/10 text-amber-100";
}

function MetricCard({ label, value, loading, tone }: { label: string; value: number; loading: boolean; tone: "cyan" | "amber" | "emerald" | "rose" | "violet" | "red" }) {
  const color = {
    cyan: "border-cyan-300/22 bg-cyan-400/10 text-cyan-100",
    amber: "border-amber-300/22 bg-amber-400/10 text-amber-100",
    emerald: "border-emerald-300/22 bg-emerald-400/10 text-emerald-100",
    rose: "border-rose-300/22 bg-rose-400/10 text-rose-100",
    violet: "border-violet-300/22 bg-violet-400/10 text-violet-100",
    red: "border-red-300/22 bg-red-400/10 text-red-100",
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <p className="text-3xl font-black leading-none">{loading ? "..." : value}</p>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">{label}</p>
    </div>
  );
}

function StatusLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-black/22 px-3 py-2">
      <span>{label}</span>
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-red-300" />}
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">{icon}</span>
      <h2 className="text-sm font-black uppercase text-white">{title}</h2>
    </div>
  );
}

function AccessPanel({ title, body, actionHref, actionLabel }: { title: string; body: string; actionHref?: string; actionLabel?: string }) {
  return (
    <section className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-5">
      <AlertTriangle className="h-6 w-6 text-amber-200" />
      <h2 className="mt-3 text-xl font-black text-white">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-zinc-300">{body}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-200/25 bg-amber-300/10 px-4 py-3 text-xs font-black uppercase text-amber-50">
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </section>
  );
}

function MessageBanner({ tone, children }: { tone: "success" | "error" | "info"; children: ReactNode }) {
  const color = {
    success: "border-emerald-300/20 bg-emerald-400/10 text-emerald-50",
    error: "border-red-300/20 bg-red-400/10 text-red-50",
    info: "border-cyan-300/20 bg-cyan-400/10 text-cyan-50",
  }[tone];
  return <p className={`rounded-lg border px-4 py-3 text-sm font-bold ${color}`}>{children}</p>;
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <div className="text-zinc-400">{icon}</div>
      <h3 className="mt-3 text-sm font-black uppercase text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{body}</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-28 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
      ))}
    </>
  );
}

function auditTone(status: string) {
  if (status === "accepted") return "border-emerald-300/24 bg-emerald-400/10 text-emerald-100";
  if (status === "rejected") return "border-red-300/24 bg-red-400/10 text-red-100";
  if (status === "skipped") return "border-amber-300/24 bg-amber-400/10 text-amber-100";
  return "border-zinc-400/18 bg-white/[0.03] text-zinc-400";
}

function outcomeTone(outcome: BulkExecutionSummary["outcome"]) {
  if (outcome === "imported") return "border-emerald-300/24 bg-emerald-400/10 text-emerald-100";
  if (outcome === "rejected") return "border-rose-300/24 bg-rose-400/10 text-rose-100";
  if (outcome === "blocked") return "border-amber-300/24 bg-amber-400/10 text-amber-100";
  return "border-zinc-400/18 bg-white/[0.03] text-zinc-300";
}

function titleCaseToken(value: string | null | undefined) {
  const text = String(value ?? "").replace(/[_-]+/g, " ").trim();
  if (!text) return "Unknown";
  return text.replace(/\b\w/g, (match) => match.toUpperCase());
}

function compactId(value: string | null | undefined) {
  if (!value) return "none";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function apiMessage(value: Record<string, unknown> | null, fallback: string) {
  return typeof value?.message === "string" && value.message.trim() ? value.message : fallback;
}
