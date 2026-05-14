export function DznLogo({ compact = false, href = "/" }: { compact?: boolean; href?: string }) {
  return (
    <a
      href={href}
      aria-label="DZN Network home"
      className="group inline-flex items-center gap-3"
    >
      <span className="relative grid h-10 w-10 place-items-center rounded-lg border border-violet-300/25 bg-violet-500/10 shadow-[0_0_32px_rgba(139,92,246,0.35)]">
        <span className="absolute inset-1 rounded-md border border-cyan-300/20" />
        <span className="h-3 w-3 rounded-sm bg-violet-300 shadow-[0_0_22px_rgba(196,181,253,0.95)] transition-transform duration-300 group-hover:rotate-45" />
      </span>
      <span className={compact ? "hidden sm:block" : "block"}>
        <span className="block text-xl font-black uppercase leading-none text-white">
          DZN
        </span>
        <span className="block text-[0.68rem] font-semibold uppercase leading-none text-violet-200/80">
          Network
        </span>
      </span>
    </a>
  );
}
