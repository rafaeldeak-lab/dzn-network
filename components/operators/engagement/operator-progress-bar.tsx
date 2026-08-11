type OperatorProgressBarProps = {
  value: number;
  max: number;
  label: string;
  accent?: "cyan" | "emerald" | "orange" | "violet";
};

const accentClass = {
  cyan: "from-cyan-300 to-cyan-500",
  emerald: "from-emerald-300 to-emerald-500",
  orange: "from-orange-300 to-orange-500",
  violet: "from-violet-300 to-violet-500",
};

export function OperatorProgressBar({ value, max, label, accent = "cyan" }: OperatorProgressBarProps) {
  const safeMax = Math.max(1, max);
  const safeValue = Math.min(safeMax, Math.max(0, value));
  const percent = Math.round((safeValue / safeMax) * 100);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-black uppercase text-zinc-400">
        <span>{label}</span>
        <span>{safeValue.toLocaleString()} / {safeMax.toLocaleString()}</span>
      </div>
      <div
        className="h-3 overflow-hidden rounded-full border border-white/10 bg-black/40"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
      >
        <div className={`h-full rounded-full bg-gradient-to-r ${accentClass[accent]}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
