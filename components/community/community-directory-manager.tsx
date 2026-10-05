"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { CommunitySourceQueue } from "./community-source-queue";

type ManagedMember = { id: string; handle: string; username: string | null; role_label: string | null; public_member_enabled: number; member_approved_at: string | null; updated_at: string };

export function CommunityDirectoryManager() {
  const serverId = useSearchParams().get("serverId")?.trim() ?? "";
  const [members, setMembers] = useState<ManagedMember[]>([]);
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState("");
  const [publish, setPublish] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);

  useEffect(() => { if (serverId) void loadMembers(serverId, setMembers, setMessage); }, [serverId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!serverId || !handle.trim() || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/community-members`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ handle: handle.trim(), role_label: role.trim(), publish }),
      });
      const payload = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "The member could not be added.");
      setHandle(""); setRole(""); setPublish(false); setMessage("Community member saved.");
      await loadMembers(serverId, setMembers, setMessage, true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The member could not be added."); }
    finally { setBusy(false); }
  }

  async function changeMember(member: ManagedMember, action: "publish" | "hide" | "remove") {
    if (memberBusy) return;
    setMemberBusy(member.id); setMessage("");
    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/community-members`, {
        method: action === "remove" ? "DELETE" : "PATCH",
        headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ id: member.id, publish: action === "publish" }),
      });
      const payload = await response.json() as { ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error("The directory change could not be saved.");
      setMessage(action === "remove" ? "Member removed from this server directory." : action === "publish" ? "Member published." : "Member moved back to private.");
      await loadMembers(serverId, setMembers, setMessage, true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The directory change could not be saved."); }
    finally { setMemberBusy(null); }
  }

  return (
    <main className="min-h-screen bg-[#030711] px-4 pb-12 pt-28 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-2 text-xs font-black uppercase text-zinc-300"><ArrowLeft size={15} /> Dashboard</Link>
        <div className="mt-5 border-b border-cyan-300/15 pb-6"><p className="text-xs font-black uppercase text-cyan-200">Owner controls</p><h1 className="mt-2 text-3xl font-black uppercase sm:text-5xl">Community Directory</h1><p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-zinc-300">Add an existing public DZN profile by handle. New entries stay private unless you explicitly publish them.</p></div>
        {!serverId ? <Notice text="Open this page from a server dashboard so DZN can keep the change server-scoped." /> : (<>
          <div className="mt-6 grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
            <form onSubmit={submit} className="self-start rounded-md border border-white/10 bg-[#08101d] p-4">
              <h2 className="flex items-center gap-2 font-black uppercase"><Plus size={18} className="text-cyan-300" /> Add published profile</h2>
              <label className="mt-4 block text-xs font-black uppercase text-zinc-300">Public profile handle<input value={handle} onChange={(event) => setHandle(event.target.value)} maxLength={48} placeholder="for example tara-w" className="mt-2 min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm font-semibold normal-case text-white outline-none focus:border-cyan-300/60" /></label>
              <label className="mt-4 block text-xs font-black uppercase text-zinc-300">Community role<input value={role} onChange={(event) => setRole(event.target.value)} maxLength={36} placeholder="Member, moderator, builder..." className="mt-2 min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm font-semibold normal-case text-white outline-none focus:border-cyan-300/60" /></label>
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-white/10 bg-black/20 p-3 text-sm font-semibold text-zinc-200"><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} className="mt-1" /><span><strong className="block text-white">Publish now</strong>Show this profile in the public server directory.</span></label>
              <button disabled={busy || !handle.trim()} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-cyan-300 px-4 text-sm font-black uppercase text-slate-950 disabled:opacity-50"><ShieldCheck size={17} />{busy ? "Saving..." : "Save member"}</button>
              {message ? <p className="mt-3 text-sm font-semibold text-cyan-100">{message}</p> : null}
            </form>
            <section className="min-w-0 rounded-md border border-white/10 bg-[#08101d] p-4"><h2 className="flex items-center gap-2 font-black uppercase"><Users size={18} className="text-cyan-300" /> Saved members</h2><div className="mt-4 grid gap-2">{members.length === 0 ? <Notice text="No community profiles have been added to this server yet." /> : members.map((member) => { const publicNow = member.public_member_enabled === 1 && Boolean(member.member_approved_at); const awaitingPlayer = member.public_member_enabled === 1 && !member.member_approved_at; return <div key={member.id} className="min-w-0 rounded-md border border-white/10 bg-black/20 p-3"><div className="flex min-w-0 items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-black">{member.username ?? member.handle}</p><p className="truncate text-xs font-bold text-zinc-400">/{member.handle} · {member.role_label ?? "Community member"}</p></div><span className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] font-black uppercase ${publicNow ? "bg-emerald-300/10 text-emerald-200" : awaitingPlayer ? "bg-amber-300/10 text-amber-200" : "bg-zinc-300/10 text-zinc-400"}`}><Eye size={13} />{publicNow ? "Public" : awaitingPlayer ? "Awaiting player" : "Private"}</span></div><div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">{member.public_member_enabled === 1 ? <button type="button" disabled={memberBusy === member.id} onClick={() => void changeMember(member, "hide")} className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-white/10 text-xs font-black uppercase text-zinc-200 disabled:opacity-50"><EyeOff size={14} /> Make private</button> : <button type="button" disabled={memberBusy === member.id} onClick={() => void changeMember(member, "publish")} className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-emerald-300/20 text-xs font-black uppercase text-emerald-200 disabled:opacity-50"><Eye size={14} /> Publish</button>}<button type="button" disabled={memberBusy === member.id} onClick={() => void changeMember(member, "remove")} className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-red-300/20 text-xs font-black uppercase text-red-200 disabled:opacity-50"><Trash2 size={14} /> Remove</button></div></div>; })}</div></section>
          </div>
          <CommunitySourceQueue serverId={serverId} onImported={() => loadMembers(serverId, setMembers, setMessage, true)} />
        </>)}
      </div>
    </main>
  );
}

async function loadMembers(serverId: string, setMembers: (members: ManagedMember[]) => void, setMessage: (message: string) => void, preserveMessage = false) {
  try { const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/community-members`, { credentials: "include", cache: "no-store" }); const payload = await response.json() as { ok?: boolean; members?: ManagedMember[] }; if (!response.ok || !payload.ok) throw new Error(); setMembers(payload.members ?? []); }
  catch { if (!preserveMessage) setMessage("The saved member list could not be loaded."); }
}

function Notice({ text }: { text: string }) { return <div className="rounded-md border border-white/10 bg-white/[0.03] p-5 text-sm font-semibold text-zinc-300">{text}</div>; }
