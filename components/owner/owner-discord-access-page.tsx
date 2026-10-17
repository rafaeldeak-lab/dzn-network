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
import { useCallback, useEffect, useRef, useState } from "react";

type Status = "pending" | "approved" | "rejected" | "revoked";
type Delivery = { operation: "invite" | "role_grant" | "role_revoke" | "diagnostic"; status: "started" | "succeeded" | "not_joined" | "retryable_failure" | "failed" | "not_configured"; message: string; createdAt: string; completedAt: string | null };
type DeliveryDiagnostic = { ok: boolean; status: string; message: string; checkedAt: string; checks: { botIdentity: boolean; botGuildMembership: boolean; inviteChannel: boolean; inviteChannelPrivate: boolean; canViewInviteChannel: boolean; canCreateInvite: boolean; canManageRoles: boolean; targetRole: boolean; targetRoleSafe: boolean; targetRoleBelowBot: boolean; botHasAdministrator: boolean; botHasUnexpectedGuildPermissions: boolean; botHasUnexpectedInviteChannelPermissions: boolean } };
type RejectedOwnerRoleReason = "invalid_role_id" | "server_default_role" | "managed_role" | "invalid_permissions" | "guild_permissions";
type DeliveryDiscovery = {
  ok: boolean;
  status: "not_configured" | "not_connected" | "discord_error" | "candidates_incomplete" | "ready_to_configure";
  message: string;
  checkedAt: string;
  checks: {
    botTokenConfigured: boolean;
    botIdentity: boolean;
    botGuildMembership: boolean;
    canManageRoles: boolean;
    botHasAdministrator: boolean;
    botHasUnexpectedGuildPermissions: boolean;
    verifiedOwnerRoleCandidates: number;
    privateInviteChannelCandidates: number;
  };
  verifiedOwnerRoleCandidates: Array<{ id: string; name: string; assignable: boolean }>;
  rejectedVerifiedOwnerRoles: Array<{ id: string; name: string; reason: RejectedOwnerRoleReason }>;
  privateInviteChannelCandidates: Array<{
    id: string;
    name: string;
    categoryName: string | null;
    canView: boolean;
    canCreateInvite: boolean;
    privateToEveryone: boolean;
  }>;
};

// The public DZN community guild is inspected read-only by this owner-only panel.
const DZN_CENTRAL_DISCORD_GUILD_ID = "1504922257481531402";

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
  delivery?: Delivery | null;
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
  discordAccessConfigured?: boolean;
  page?: { has_more?: boolean; next_cursor?: string | null };
  auditPage?: { has_more?: boolean; next_cursor?: string | null };
  message?: string;
};

type DeliveryReadinessItem = {
  label: string;
  detail: string;
  state: "ready" | "blocked" | "unchecked";
};

function deliveryReadinessItems(
  diagnostic: DeliveryDiagnostic | null,
  discovery: DeliveryDiscovery | null,
): DeliveryReadinessItem[] {
  if (!diagnostic && !discovery) {
    return [
      {
        label: "Central Discord has not been checked",
        detail: "Run the read-only check before enabling owner delivery. It does not send an invite, change a role, or contact anyone.",
        state: "unchecked",
      },
    ];
  }

  const checks = diagnostic?.checks;
  const discoveryChecks = discovery?.checks;
  return [
    {
      label: "Bot identity and DZN server connection",
      detail: checks?.botIdentity && checks.botGuildMembership
        ? "The configured bot can identify itself and is connected to the central DZN server."
        : discoveryChecks?.botIdentity && discoveryChecks.botGuildMembership
          ? "The read-only discovery found the bot in the central DZN server; final configuration is still required."
          : "The bot must be connected to the central DZN server before delivery can be enabled.",
      state: checks?.botIdentity && checks.botGuildMembership ? "ready" : discoveryChecks?.botIdentity && discoveryChecks.botGuildMembership ? "unchecked" : "blocked",
    },
    {
      label: "Private one-use invite channel",
      detail: checks?.inviteChannel && checks.inviteChannelPrivate && checks.canViewInviteChannel && checks.canCreateInvite && !checks.botHasUnexpectedInviteChannelPermissions
        ? "The bot can create a one-use invite in the approved private channel with only the required channel permissions."
        : (discovery?.privateInviteChannelCandidates.length ?? 0) > 0
          ? "A private channel is available. It must be saved as the central invite channel before delivery can be enabled."
          : "Create or select a channel that is private to the DZN team and verified owners; do not use a public channel.",
      state: checks?.inviteChannel && checks.inviteChannelPrivate && checks.canViewInviteChannel && checks.canCreateInvite && !checks.botHasUnexpectedInviteChannelPermissions ? "ready" : (discovery?.privateInviteChannelCandidates.length ?? 0) > 0 ? "unchecked" : "blocked",
    },
    {
      label: "Verified Server Owner role",
      detail: checks?.targetRole && checks.targetRoleSafe && checks.targetRoleBelowBot
        ? "The dedicated zero-permission owner role exists, is safe to grant, and can be assigned below the bot role."
        : (discovery?.verifiedOwnerRoleCandidates.some((role) => role.assignable) ?? false)
          ? "A safe zero-permission owner role is available. It must be selected before delivery can be enabled."
          : "The owner role must be a zero-permission role below the bot. Channel access belongs in channel overwrites, not the role itself.",
      state: checks?.targetRole && checks.targetRoleSafe && checks.targetRoleBelowBot ? "ready" : (discovery?.verifiedOwnerRoleCandidates.some((role) => role.assignable) ?? false) ? "unchecked" : "blocked",
    },
    {
      label: "Least-privilege bot permissions",
      detail: checks
        ? checks.botHasAdministrator || checks.botHasUnexpectedGuildPermissions
          ? "Blocked: remove Administrator and any unrelated guild permissions before owner delivery is enabled."
          : checks.canManageRoles
            ? "The bot has the limited permissions required to assign or remove only the verified owner role."
            : "The bot still needs Manage Roles to deliver and revoke the verified owner role."
        : discoveryChecks
          ? discoveryChecks.botHasAdministrator || discoveryChecks.botHasUnexpectedGuildPermissions
            ? "Blocked: the read-only check found Administrator or unrelated guild permissions on the bot."
            : discoveryChecks.canManageRoles
              ? "The bot can manage roles without the high-risk guild permissions that block this workflow."
              : "The bot still needs Manage Roles before delivery can be configured."
          : "Run central Discord discovery to verify the bot permission boundary.",
      state: checks
        ? checks.botHasAdministrator || checks.botHasUnexpectedGuildPermissions || !checks.canManageRoles ? "blocked" : "ready"
        : discoveryChecks
          ? discoveryChecks.botHasAdministrator || discoveryChecks.botHasUnexpectedGuildPermissions || !discoveryChecks.canManageRoles ? "blocked" : "unchecked"
          : "unchecked",
    },
  ];
}

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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextAuditCursor, setNextAuditCursor] = useState<string | null>(null);
  const [loadingMoreAudit, setLoadingMoreAudit] = useState(false);
  const [deliveryBusyId, setDeliveryBusyId] = useState<string | null>(null);
  const [deliveryDiagnostic, setDeliveryDiagnostic] = useState<DeliveryDiagnostic | null>(null);
  const [checkingDelivery, setCheckingDelivery] = useState(false);
  const [deliveryDiscovery, setDeliveryDiscovery] = useState<DeliveryDiscovery | null>(null);
  const [discoveringDelivery, setDiscoveringDelivery] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const filterRevision = useRef(0);
  const hasAssignableVerifiedOwnerRole = deliveryDiscovery?.verifiedOwnerRoleCandidates.some((role) => role.assignable) ?? false;
  const hasPermissionedVerifiedOwnerRole = deliveryDiscovery?.rejectedVerifiedOwnerRoles.some((role) => role.reason === "guild_permissions") ?? false;
  const deliveryReadiness = deliveryReadinessItems(deliveryDiagnostic, deliveryDiscovery);

  function setQueueStatus(nextStatus: Status | "all") {
    if (nextStatus === status) return;
    filterRevision.current += 1;
    setStatus(nextStatus);
  }

  function applyQueueSearch(nextSearch: string) {
    if (nextSearch === appliedSearch) return;
    filterRevision.current += 1;
    setAppliedSearch(nextSearch);
  }

  const load = useCallback(async (options: { cursor?: string | null; appendRequests?: boolean; auditCursor?: string | null; appendAudit?: boolean } = {}) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setState("loading");
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (appliedSearch) params.set("q", appliedSearch);
      if (options.cursor) params.set("cursor", options.cursor);
      if (options.auditCursor) params.set("audit_cursor", options.auditCursor);
      const response = await fetch(
        `/api/owner/discord/owner-access-requests?${params}`,
        { credentials: "include", cache: "no-store", signal: controller.signal },
      );
      const next = (await response.json().catch(() => null)) as Payload | null;
      if (requestController.current !== controller) return;
      if (response.status === 401 || response.status === 403) {
        setState("blocked");
        return;
      }
      if (!response.ok || !next?.ok)
        throw new Error(
          next?.message ?? "Owner Discord requests are unavailable.",
        );
      setPayload((current) => {
        if (!current || (!options.appendRequests && !options.appendAudit)) return next;
        return {
          ...next,
          requests: options.appendRequests ? [...current.requests ?? [], ...next.requests ?? []] : current.requests,
          audit: options.appendAudit ? [...current.audit ?? [], ...next.audit ?? []] : current.audit,
        };
      });
      if (options.appendRequests || !options.appendAudit) setNextCursor(next.page?.next_cursor ?? null);
      if (options.appendAudit || !options.appendRequests) setNextAuditCursor(next.auditPage?.next_cursor ?? null);
      setState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestController.current !== controller) return;
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
    return () => {
      window.clearTimeout(timeout);
      requestController.current?.abort();
    };
  }, [load]);
  const requests = payload?.requests ?? [];
  const audit = payload?.audit ?? [];
  async function removeDeliveryRole(requestId: string) {
    const response = await fetch("/api/owner/discord/owner-access-delivery", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, action: "revoke_role" }),
    });
    const next = await response.json().catch(() => null) as {
      ok?: boolean;
      message?: string;
    } | null;
    if (!response.ok || !next?.ok)
      throw new Error(next?.message ?? "DZN could not remove the Discord owner role.");
    return next.message ?? "Verified Server Owner role removed.";
  }
  async function decide(
    request: RequestItem,
    action: "approved" | "rejected" | "revoked",
  ) {
    const reason = (reasonById[request.id] ?? "").trim();
    if (reason.length < 5) {
      setNotice("Enter a clear decision reason first.");
      return;
    }
    if (action === "revoked" && deliveryBusyId) {
      setNotice("Wait for the current Discord role cleanup to finish first.");
      return;
    }
    const decisionFilterRevision = filterRevision.current;
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
      if (action === "revoked") {
        if (!payload?.discordAccessConfigured) {
          setNotice(
            "Access revoked. Discord role cleanup cannot be verified until central delivery is configured.",
          );
          setQueueStatus("revoked");
          return;
        }
        setDeliveryBusyId(request.id);
        try {
          const deliveryMessage = await removeDeliveryRole(request.id);
          setNotice(`Access revoked. ${deliveryMessage}`);
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : "DZN could not remove the Discord owner role.";
          setNotice(`Access revoked, but Discord role cleanup needs retry: ${message}`);
          setQueueStatus("revoked");
          return;
        } finally {
          setDeliveryBusyId(null);
        }
      } else {
        setNotice(
          action === "approved"
            ? "Approval recorded. The owner can continue only after central Discord delivery is ready."
            : `${action[0].toUpperCase()}${action.slice(1)} decision recorded.`,
        );
      }
      if (filterRevision.current === decisionFilterRevision) await load();
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
  async function checkDelivery() {
    if (checkingDelivery || discoveringDelivery) return;
    setCheckingDelivery(true); setNotice(null);
    setDeliveryDiscovery(null);
    try {
      const response = await fetch("/api/owner/discord/owner-access-delivery", { credentials: "include", cache: "no-store" });
      const next = await response.json().catch(() => null) as DeliveryDiagnostic | null;
      if (!response.ok || !next) throw new Error("The central Discord delivery check is unavailable.");
      setDeliveryDiagnostic(next);
      setNotice(next.message);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The central Discord delivery check is unavailable."); }
    finally { setCheckingDelivery(false); }
  }
  async function discoverDeliveryCandidates() {
    if (discoveringDelivery || checkingDelivery) return;
    setDiscoveringDelivery(true);
    setDeliveryDiagnostic(null);
    setDeliveryDiscovery(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/owner/discord/owner-access-delivery-candidates?guild_id=${DZN_CENTRAL_DISCORD_GUILD_ID}`,
        { credentials: "include", cache: "no-store" },
      );
      const next = await response.json().catch(() => null) as DeliveryDiscovery | null;
      if (!response.ok || !next) throw new Error("The central Discord candidate check is unavailable.");
      setDeliveryDiscovery(next);
      setNotice(next.message);
    } catch (error) {
      setDeliveryDiscovery(null);
      setNotice(error instanceof Error ? error.message : "The central Discord candidate check is unavailable.");
    } finally {
      setDiscoveringDelivery(false);
    }
  }
  async function revokeDelivery(requestId: string) {
    if (deliveryBusyId) return;
    setDeliveryBusyId(requestId); setNotice(null);
    try {
      setNotice(await removeDeliveryRole(requestId));
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "DZN could not remove the Discord owner role."); }
    finally { setDeliveryBusyId(null); }
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
              <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void checkDelivery()} disabled={checkingDelivery || discoveringDelivery} className="min-h-10 rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] px-3 text-xs font-black text-cyan-100 disabled:opacity-50">{checkingDelivery ? "Checking central Discord..." : "Check central Discord delivery"}</button>{deliveryDiagnostic ? <span className={`text-xs font-black ${deliveryDiagnostic.ok ? "text-emerald-200" : "text-amber-100"}`}>{deliveryDiagnostic.status.replace(/_/g, " ")} - checked {formatTime(deliveryDiagnostic.checkedAt)}</span> : null}{deliveryDiagnostic?.checks.botHasAdministrator ? <span className="text-xs font-bold text-amber-100">Bot has Administrator. Remove it before owner delivery can be enabled.</span> : deliveryDiagnostic?.checks.botHasUnexpectedGuildPermissions ? <span className="text-xs font-bold text-amber-100">Bot has extra guild permissions. Restrict it to the owner-delivery allowlist before enabling delivery.</span> : null}</div>
            </section>
            <section className="mt-3 rounded-lg border border-white/10 bg-white/[0.025] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-black text-zinc-100">Central Discord setup</p>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
                    Read-only discovery for the DZN community server. It finds only a safe zero-permission owner role and a private invite channel; it does not invite, assign, message, or change Discord access.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void discoverDeliveryCandidates()}
                  disabled={discoveringDelivery || checkingDelivery}
                  className="min-h-10 rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] px-3 text-xs font-black text-cyan-100 disabled:opacity-50"
                >
                  {discoveringDelivery ? "Finding safe candidates..." : "Find safe DZN candidates"}
                </button>
              </div>
              {deliveryDiscovery ? (
                <div className="mt-4 border-t border-white/10 pt-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`text-xs font-black ${deliveryDiscovery.ok ? "text-emerald-200" : "text-amber-100"}`}>
                      {deliveryDiscovery.status.replace(/_/g, " ")} - checked {formatTime(deliveryDiscovery.checkedAt)}
                    </span>
                    {deliveryDiscovery.checks.botHasAdministrator ? (
                      <span className="text-xs font-bold text-amber-100">
                        Bot has Administrator. Remove it before owner delivery can be enabled.
                      </span>
                    ) : deliveryDiscovery.checks.botHasUnexpectedGuildPermissions ? (
                      <span className="text-xs font-bold text-amber-100">
                        Bot has extra guild permissions. Restrict it to the owner-delivery allowlist before enabling delivery.
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">{deliveryDiscovery.message}</p>
                  {hasPermissionedVerifiedOwnerRole && !hasAssignableVerifiedOwnerRole ? (
                    <p className="mt-3 rounded-md border border-amber-300/25 bg-amber-300/[0.06] p-3 text-sm font-bold leading-6 text-amber-100">
                      Delivery remains blocked because the existing Verified Server Owner role has global Discord permissions. It must have no role-level permissions; restricted owner-channel overwrites provide the access instead.
                    </p>
                  ) : null}
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="border-t border-white/10 pt-3 lg:border-t-0 lg:border-r lg:border-white/10 lg:pr-4 lg:pt-0">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">Verified Server Owner role</p>
                      {deliveryDiscovery.verifiedOwnerRoleCandidates.length ? (
                        <ul className="mt-3 space-y-2">
                          {deliveryDiscovery.verifiedOwnerRoleCandidates.map((role) => (
                            <li key={role.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-200">
                              <span className="font-bold">{role.name}</span>
                              <span className="font-mono text-xs text-zinc-500">{role.id}</span>
                              <span className={role.assignable ? "text-xs font-black text-emerald-200" : "text-xs font-black text-amber-100"}>
                                {role.assignable ? "Assignable" : "Not assignable"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-zinc-500">No safe role candidate was found.</p>
                      )}
                      {deliveryDiscovery.rejectedVerifiedOwnerRoles.length ? (
                        <div className="mt-4 rounded-md border border-amber-300/25 bg-amber-300/[0.06] p-3">
                          <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-100">Needs adjustment</p>
                          <ul className="mt-2 space-y-3">
                            {deliveryDiscovery.rejectedVerifiedOwnerRoles.map((role) => (
                              <li key={`${role.id}:${role.reason}`} className="text-sm text-zinc-200">
                                <p className="font-bold">{role.name}</p>
                                {role.id ? <p className="mt-1 font-mono text-xs text-zinc-500">{role.id}</p> : null}
                                <p className="mt-1 leading-5 text-amber-100">{ownerRoleAdjustment(role.reason)}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    <div className="border-t border-white/10 pt-3 lg:border-t-0 lg:pl-0 lg:pt-0">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">Private invite channel</p>
                      {deliveryDiscovery.privateInviteChannelCandidates.length ? (
                        <ul className="mt-3 space-y-2">
                          {deliveryDiscovery.privateInviteChannelCandidates.map((channel) => (
                            <li key={channel.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-200">
                              <span className="font-bold">{channel.categoryName ? `${channel.categoryName} / ` : ""}#{channel.name}</span>
                              <span className="font-mono text-xs text-zinc-500">{channel.id}</span>
                              <span className="text-xs font-black text-emerald-200">Private and invite-ready</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-zinc-500">No private invite channel is ready yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
            <section className="mt-3 rounded-lg border border-violet-300/15 bg-violet-300/[0.035] p-4">
              <div className="flex items-center gap-2 text-violet-100">
                <ShieldCheck size={18} />
                <span className="font-black">Owner delivery readiness</span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                This checklist is read-only. Keep private delivery disabled until every item is ready; then run one real approved-owner delivery before relying on automation.
              </p>
              <ul className="mt-4 grid gap-2 lg:grid-cols-2">
                {deliveryReadiness.map((item) => (
                  <li
                    key={item.label}
                    className={`rounded-md border p-3 ${item.state === "ready" ? "border-emerald-300/20 bg-emerald-300/[0.04]" : item.state === "blocked" ? "border-amber-300/20 bg-amber-300/[0.045]" : "border-white/10 bg-black/15"}`}
                  >
                    <div className="flex items-start gap-2">
                      {item.state === "ready" ? (
                        <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-200" size={16} />
                      ) : item.state === "blocked" ? (
                        <CircleAlert className="mt-0.5 shrink-0 text-amber-100" size={16} />
                      ) : (
                        <RefreshCw className="mt-0.5 shrink-0 text-zinc-500" size={16} />
                      )}
                      <div>
                        <p className="text-sm font-black text-zinc-100">{item.label}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-400">{item.detail}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <section className="mt-5 flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-4 md:flex-row">
              <div className="flex flex-wrap gap-2">
                {(
                  ["all", "pending", "approved", "rejected", "revoked"] as const
                ).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setQueueStatus(item)}
                    className={`rounded-md border px-3 py-2 text-xs font-black uppercase ${status === item ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-zinc-400"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  applyQueueSearch(search.trim());
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
                      {request.delivery ? <p className="mt-2 rounded-md border border-violet-300/15 bg-violet-300/[0.05] p-2 text-xs leading-5 text-violet-100">Discord delivery: {request.delivery.message}</p> : null}
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
                      {request.status === "revoked" ? (
                        <div className="mt-4">
                          {payload?.discordAccessConfigured ? (
                            <button type="button" disabled={deliveryBusyId === request.id} onClick={() => void revokeDelivery(request.id)} className="inline-flex items-center gap-2 rounded-md border border-amber-300/30 bg-amber-300/[0.08] px-3 py-2 text-xs font-black text-amber-100 disabled:opacity-50"><CircleAlert size={14} />{deliveryBusyId === request.id ? "Removing Discord role..." : "Remove Discord owner role"}</button>
                          ) : (
                            <p className="text-xs font-bold text-amber-100">Discord role cleanup cannot be verified until central delivery is configured.</p>
                          )}
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="rounded-lg border border-white/10 p-5 text-sm text-zinc-400">
                    No matching owner-access requests.
                  </p>
                )}
                {nextCursor ? (
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => {
                      setLoadingMore(true);
                      void load({ cursor: nextCursor, appendRequests: true }).finally(() => setLoadingMore(false));
                    }}
                    className="min-h-10 rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] px-3 text-xs font-black text-cyan-100 disabled:opacity-50"
                  >
                    {loadingMore ? "Loading older requests" : "Load older requests"}
                  </button>
                ) : null}
              </div>
              <aside className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                <h2 className="font-black">Recent decisions</h2>
                <div className="mt-4 grid gap-3">
                  {audit.length ? (
                    audit.map((entry) => (
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
                {nextAuditCursor ? (
                  <button
                    type="button"
                    disabled={loadingMoreAudit}
                    onClick={() => {
                      setLoadingMoreAudit(true);
                      void load({ auditCursor: nextAuditCursor, appendAudit: true }).finally(() => setLoadingMoreAudit(false));
                    }}
                    className="mt-4 min-h-10 w-full rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] px-3 text-xs font-black text-cyan-100 disabled:opacity-50"
                  >
                    {loadingMoreAudit ? "Loading older decisions" : "Load older decisions"}
                  </button>
                ) : null}
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

function ownerRoleAdjustment(reason: RejectedOwnerRoleReason) {
  switch (reason) {
    case "guild_permissions":
      return "Has guild-wide permissions. Remove every role permission; private channel overwrites provide access.";
    case "managed_role":
      return "Managed by an integration. Use a normal server role instead.";
    case "server_default_role":
      return "This is the server default role and cannot be assigned.";
    case "invalid_permissions":
      return "Discord did not return verifiable permissions. Use a normal zero-permission role.";
    case "invalid_role_id":
      return "Discord did not return a usable role ID. Create or select a normal server role.";
  }
}
