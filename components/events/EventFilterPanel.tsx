import { RotateCcw } from "lucide-react";

import { categoryLabel } from "./event-data";

const statusOptions = ["all", "live", "registration_open", "upcoming", "ended"];
const typeOptions = ["all", "capture_the_flag", "community_cup", "bot_tournament", "faction_wars", "seasonal_wars", "kill_race", "survival_challenge"];
const categoryOptions = ["all", "deathmatch", "pvp", "pve", "pvp_pve", "hardcore", "roleplay", "faction_wars", "vanilla", "modded"];

export function EventFilterPanel({
  status,
  type,
  category,
  onStatus,
  onType,
  onCategory,
  onReset,
}: {
  status: string;
  type: string;
  category: string;
  onStatus: (value: string) => void;
  onType: (value: string) => void;
  onCategory: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <aside className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-[#050915]/90 p-4">
        <h2 className="text-sm font-black uppercase text-white">Filter Events</h2>
        <div className="mt-4 space-y-3">
          <Select label="Status" value={status} options={statusOptions} onChange={onStatus} />
          <Select label="Type" value={type} options={typeOptions} onChange={onType} />
          <Select label="Category" value={category} options={categoryOptions} onChange={onCategory} />
          <button type="button" onClick={onReset} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300/30 bg-violet-500/12 px-3 py-2.5 text-xs font-black uppercase text-violet-100 transition hover:bg-violet-500/20">
            <RotateCcw className="h-4 w-4" />
            Reset filters
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
        <h3 className="text-sm font-black uppercase text-white">Event Types</h3>
        <div className="mt-3 space-y-2 text-xs text-zinc-400">
          <p>Capture The Flag</p>
          <p>Community Cup</p>
          <p>Bot Tournament</p>
          <p>Kill Race</p>
        </div>
      </div>
      <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/8 p-4">
        <h3 className="text-sm font-black uppercase text-white">My Registrations</h3>
        <p className="mt-2 text-xs leading-5 text-zinc-400">Join controls only show compatible servers. Incompatible servers are disabled by category mismatch.</p>
      </div>
    </aside>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase text-zinc-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/36 px-3 py-2 text-xs font-bold text-zinc-100 outline-none transition focus:border-violet-300/45">
        {options.map((option) => (
          <option key={option} value={option}>{option === "all" ? `All ${label}` : categoryLabel(option)}</option>
        ))}
      </select>
    </label>
  );
}
