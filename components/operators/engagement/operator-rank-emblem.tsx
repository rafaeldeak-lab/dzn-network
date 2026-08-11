type OperatorRankEmblemProps = {
  label: string;
  level: number;
  active?: boolean;
};

export function OperatorRankEmblem({ label, level, active = false }: OperatorRankEmblemProps) {
  return (
    <div
      className={`grid h-14 w-14 shrink-0 place-items-center rounded-lg border ${
        active ? "border-cyan-200 bg-cyan-300/18 text-cyan-50" : "border-white/10 bg-white/[0.04] text-zinc-300"
      }`}
      aria-label={`${label}, level ${level}`}
    >
      <svg viewBox="0 0 64 64" className="h-10 w-10" role="img" aria-label={`${label} rank emblem`}>
        <path d="M32 5 55 18v28L32 59 9 46V18z" fill="none" stroke="currentColor" strokeWidth="4" />
        <path d="M20 36h24L32 17z" fill="currentColor" opacity=".28" />
        <path d="M22 42h20" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
}
