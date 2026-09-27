"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

const STORAGE_KEY = "dzn:beta-ticker:hidden:v1";
const TICKER_COPY =
  "DZN Network is live and improving. Player access stays free.";

export function BetaTicker() {
  const pathname = usePathname() ?? "";
  const isOwnerRoute = pathname === "/owner" || pathname.startsWith("/owner/");
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isOwnerRoute) {
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        setHidden(window.localStorage.getItem(STORAGE_KEY) === "1");
      } catch {
        setHidden(false);
      }
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOwnerRoute]);

  if (isOwnerRoute || !mounted || hidden) return null;

  function closeTicker() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Still dismiss for this visit when browser storage is unavailable.
    }
    setHidden(true);
  }

  return (
    <aside className="dzn-beta-ticker" aria-label="DZN Network beta notice">
      <div className="dzn-beta-ticker__badge">BETA</div>
      <p className="dzn-beta-ticker__copy">{TICKER_COPY}</p>
      <div className="dzn-beta-ticker__actions">
        <a href="mailto:feedback@dzn-network.com" className="dzn-beta-ticker__feedback">
          Send feedback
        </a>
        <button type="button" className="dzn-beta-ticker__close" onClick={closeTicker} aria-label="Hide beta notice">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
