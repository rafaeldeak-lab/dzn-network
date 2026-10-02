"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";

type DirectoryPayload = {
  ok: true;
  server: { public_slug: string; name: string; href: string };
  community: { name: string; icon_url: string | null };
  members: Array<{
    id: string;
    display_name: string;
    role_label: string | null;
    member_since: string | null;
    profile: { handle: string; href: string; avatar_url: string | null };
  }>;
};

export function PublicCommunityDirectory({ slug }: { slug: string }) {
  const routeSlug = currentCommunitySlug(slug);
  const [data, setData] = useState<DirectoryPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/public/servers/${encodeURIComponent(routeSlug)}/community-members`, {
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as DirectoryPayload;
        if (!response.ok || !payload?.ok) throw new Error(response.status === 404 ? "missing" : "unavailable");
        setData(payload);
        setStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setStatus(error instanceof Error && error.message === "missing" ? "missing" : "error");
      });
    return () => controller.abort();
  }, [routeSlug]);

  const title = data?.community.name ?? "DZN Community";
  return (
    <main className="min-h-screen bg-[#030711] text-white">
      <header className="border-b border-cyan-300/15 bg-[linear-gradient(120deg,#071322_0%,#0a1020_55%,#140c25_100%)]">
        <div className="mx-auto max-w-6xl px-4 pb-8 pt-28 sm:px-6">
          <Link href={data?.server.href ?? "/servers"} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/15 bg-black/25 px-3 text-xs font-black uppercase text-zinc-100">
            <ArrowLeft size={15} /> Server profile
          </Link>
          <div className="mt-7 flex min-w-0 items-center gap-4">
            {data?.community.icon_url ? <Image src={data.community.icon_url} alt="" width={64} height={64} unoptimized className="h-16 w-16 rounded-md border border-cyan-300/25 object-cover" /> : <div className="grid h-16 w-16 place-items-center rounded-md border border-cyan-300/25 bg-cyan-300/10"><Users /></div>}
            <div className="min-w-0"><p className="text-xs font-black uppercase text-cyan-200">Public community directory</p><h1 className="mt-1 break-words text-3xl font-black uppercase sm:text-5xl">{title}</h1></div>
          </div>
          <p className="mt-5 max-w-2xl text-sm font-semibold leading-6 text-zinc-300">Only members explicitly added by this server owner and using an active public DZN profile appear here.</p>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <h2 className="flex items-center gap-2 text-lg font-black uppercase"><Users className="text-cyan-300" size={20} /> Community members</h2>
          <span className="inline-flex items-center gap-2 text-xs font-black uppercase text-emerald-200"><ShieldCheck size={16} /> Opt-in profiles only</span>
        </div>
        {status === "loading" ? <DirectoryNotice text="Loading public members..." /> : null}
        {status === "missing" ? <DirectoryNotice text="This public community could not be found." /> : null}
        {status === "error" ? <DirectoryNotice text="The community directory is temporarily unavailable." /> : null}
        {status === "ready" && data?.members.length === 0 ? <DirectoryNotice text="No members have been published by this server yet." /> : null}
        {status === "ready" && data && data.members.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.members.map((member) => <MemberCard key={member.id} member={member} />)}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function currentCommunitySlug(fallback: string) {
  if (typeof window !== "undefined") {
    const match = window.location.pathname.match(/^\/servers\/([^/]+)\/community\/?$/);
    if (match?.[1]) {
      try { return decodeURIComponent(match[1]); } catch { return match[1]; }
    }
  }
  return fallback;
}

function MemberCard({ member }: { member: DirectoryPayload["members"][number] }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  return (
    <Link href={member.profile.href} className="group min-w-0 rounded-md border border-white/10 bg-[#08101d] p-4 transition hover:border-cyan-300/40 hover:bg-[#0b1727]">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-cyan-300/25 bg-cyan-300/10 font-black text-cyan-100">
          {member.profile.avatar_url && !avatarFailed ? <Image src={member.profile.avatar_url} alt={`${member.display_name} profile`} width={48} height={48} unoptimized onError={() => setAvatarFailed(true)} className="h-full w-full object-cover" /> : member.display_name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0"><h3 className="truncate font-black text-white">{member.display_name}</h3><p className="truncate text-xs font-bold uppercase text-cyan-200">{member.role_label ?? "Community member"}</p></div>
      </div>
      <div className="mt-4 border-t border-white/10 pt-3 text-xs font-bold text-zinc-400 group-hover:text-cyan-100">View public profile</div>
    </Link>
  );
}

function DirectoryNotice({ text }: { text: string }) {
  return <div className="rounded-md border border-white/10 bg-white/[0.03] p-8 text-center text-sm font-bold text-zinc-300">{text}</div>;
}
