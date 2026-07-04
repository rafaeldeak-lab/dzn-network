"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

const STORAGE_KEY = "dzn:beta-ticker:hidden:v1";
const TICKER_HEIGHT = "48px";
const TICKER_COPY =
  "DZN Network is live and actively being improved - Basic server listings are free during beta - Some features may change as the platform grows - Found a bug or have an idea? Send feedback";

export function BetaTicker() {
  const pathname = usePathname() ?? "";
  const isOwnerRoute = pathname === "/owner" || pathname.startsWith("/owner/");
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isOwnerRoute) {
      document.documentElement.style.removeProperty("--dzn-beta-ticker-height");
      return;
    }

    const timer = window.setTimeout(() => {
      setHidden(window.localStorage.getItem(STORAGE_KEY) === "1");
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOwnerRoute]);

  useEffect(() => {
    if (isOwnerRoute || !mounted || hidden) {
      document.documentElement.style.removeProperty("--dzn-beta-ticker-height");
      return;
    }
    document.documentElement.style.setProperty("--dzn-beta-ticker-height", TICKER_HEIGHT);
    return () => {
      document.documentElement.style.removeProperty("--dzn-beta-ticker-height");
    };
  }, [hidden, mounted, isOwnerRoute]);

  if (isOwnerRoute || !mounted || hidden) return null;

  function closeTicker() {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setHidden(true);
  }

  return (
    <aside className="dzn-beta-ticker" aria-label="DZN Network beta notice">
      <div className="dzn-beta-ticker__badge">BETA</div>
      <div className="dzn-beta-ticker__marquee" tabIndex={0}>
        <div className="dzn-beta-ticker__track">
          <span>{TICKER_COPY}</span>
          <span aria-hidden="true">{TICKER_COPY}</span>
        </div>
      </div>
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
