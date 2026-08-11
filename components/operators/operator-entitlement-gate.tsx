import { Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import type { OperatorPlanTier } from "@/lib/operators/types";

type OperatorEntitlementGateProps = {
  planTier: OperatorPlanTier;
  premiumRequired?: boolean;
  children: ReactNode;
};

export function OperatorEntitlementGate({ planTier, premiumRequired = true, children }: OperatorEntitlementGateProps) {
  const locked = premiumRequired && planTier !== "premium";

  return (
    <div className={`relative rounded-lg border ${locked ? "border-amber-300/24 bg-amber-300/[0.055]" : "border-cyan-300/18 bg-cyan-300/[0.045]"}`}>
      {locked ? (
        <div className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded border border-amber-300/24 bg-black/40 px-2 py-1 text-[10px] font-black uppercase text-amber-100">
          <Lock size={12} aria-hidden="true" />
          Locked
        </div>
      ) : (
        <div className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded border border-cyan-300/24 bg-black/40 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">
          <Sparkles size={12} aria-hidden="true" />
          Preview
        </div>
      )}
      <div aria-describedby={locked ? "operator-premium-lock" : undefined} className={locked ? "opacity-70" : undefined}>
        {children}
      </div>
      {locked ? (
        <p id="operator-premium-lock" className="border-t border-amber-300/16 px-3 py-2 text-xs font-bold leading-5 text-amber-100">
          Premium cosmetic item. Competition access remains fully available on the free plan.
        </p>
      ) : null}
    </div>
  );
}
