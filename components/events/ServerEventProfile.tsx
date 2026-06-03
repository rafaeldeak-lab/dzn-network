import { Medal, ShieldCheck, Trophy } from "lucide-react";

import type { ServerEventsPayload } from "./event-data";
import { formatNumber } from "./event-format";
import { ServerCategoryBadge } from "./ServerCategoryBadge";
import { TournamentCard } from "./TournamentCard";
import { PremiumLockedCard } from "./PremiumLockedCard";

export function ServerEventProfile({ profile }: { profile: ServerEventsPayload }) {
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-white/10 bg-[radial-gradient(circle_at_18%_0%,rgba(124,58,237,0.2),transparent_34%),rgba(3,7,18,0.9)] p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <ServerCategoryBadge category={profile.server.category} label={profile.server.category_label} />
              {profile.server.verified_server ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300/30 bg-emerald-500/12 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-100">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Verified
                </span>
              ) : null}
            </div>
            <h1 className="mt-4 text-4xl font-black uppercase text-white">{profile.server.server_name}</h1>
            <p className="mt-2 text-sm text-zinc-400">Server event profile, trophies, MMR, season points, and compatible upcoming events.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <ProfileStat label="MMR" value={formatNumber(profile.server.event_mmr)} />
            <ProfileStat label="Points" value={formatNumber(profile.server.season_points)} />
            <ProfileStat label="Record" value={`${profile.server.event_wins}-${profile.server.event_losses}-${profile.server.event_draws}`} />
          </div>
        </div>
      </section>

      {profile.premiumLocked ? <PremiumLockedCard message="Advanced score history and full event telemetry require DZN Pro or Premium." /> : null}

      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <h2 className="text-xl font-black uppercase text-white">Compatible Events</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {(profile.compatible_upcoming_events.length ? profile.compatible_upcoming_events : profile.current_events).map((event) => (
              <TournamentCard key={event.id} event={event} compact />
            ))}
          </div>
        </div>
        <aside className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <h3 className="flex items-center gap-2 text-sm font-black uppercase text-white"><Trophy className="h-4 w-4 text-amber-200" />Trophies</h3>
            <div className="mt-3 space-y-2">
              {profile.trophies.length ? profile.trophies.map((trophy) => (
                <div key={`${trophy.label}-${trophy.value}`} className="rounded-md border border-white/8 bg-black/24 p-3 text-xs">
                  <div className="font-black uppercase text-zinc-100">{trophy.label}</div>
                  <div className="mt-1 text-zinc-500">{trophy.value}</div>
                </div>
              )) : <p className="text-sm text-zinc-500">Trophies unlock after completed events.</p>}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <h3 className="flex items-center gap-2 text-sm font-black uppercase text-white"><Medal className="h-4 w-4 text-violet-200" />Recent Matches</h3>
            <div className="mt-3 space-y-2">
              {profile.recent_matches.slice(0, 5).map((match) => (
                <div key={match.id} className="rounded-md border border-white/8 bg-black/24 p-3 text-xs text-zinc-400">
                  {match.left_server.server_name} vs {match.right_server.server_name}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/28 px-4 py-3 text-center">
      <div className="text-[10px] font-black uppercase text-zinc-500">{label}</div>
      <div className="mt-1 font-mono text-lg font-black text-white">{value}</div>
    </div>
  );
}
