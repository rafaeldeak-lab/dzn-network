import { Lock, Sparkles } from "lucide-react";

export function PremiumLockedCard({ title = "PRO / PREMIUM FEATURE", message = "Unlock full event analytics with Pro or Premium." }: { title?: string; message?: string }) {
  return (
    <div className="rounded-lg border border-violet-300/24 bg-[linear-gradient(135deg,rgba(124,58,237,0.14),rgba(14,165,233,0.08)),rgba(2,6,23,0.82)] p-4 shadow-[0_0_34px_rgba(124,58,237,0.16)]">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-violet-300/30 bg-violet-500/16 text-violet-100">
          <Lock className="h-4 w-4" />
        </span>
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase text-violet-100">
            <Sparkles className="h-3.5 w-3.5" />
            {title}
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-300">{message}</p>
        </div>
      </div>
    </div>
  );
}
