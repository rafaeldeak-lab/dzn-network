"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type ProgressState = "idle" | "loading" | "complete";

const START_DELAY_MS = 120;

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ProgressState>("idle");
  const [progress, setProgress] = useState(0);
  const startTimer = useRef<number | null>(null);
  const finishTimer = useRef<number | null>(null);
  const progressTimer = useRef<number | null>(null);
  const pendingNavigation = useRef(false);
  const visibleProgress = useRef(false);
  const currentLocation = `${pathname}?${searchParams.toString()}`;

  const clearTimers = useCallback(() => {
    if (startTimer.current) window.clearTimeout(startTimer.current);
    if (finishTimer.current) window.clearTimeout(finishTimer.current);
    if (progressTimer.current) window.clearInterval(progressTimer.current);
    startTimer.current = null;
    finishTimer.current = null;
    progressTimer.current = null;
    pendingNavigation.current = false;
    visibleProgress.current = false;
    setState("idle");
    setProgress(0);
  }, []);

  useEffect(() => {
    const start = () => {
      clearTimers();
      pendingNavigation.current = true;
      startTimer.current = window.setTimeout(() => {
        visibleProgress.current = true;
        setState("loading");
        setProgress(12);
        progressTimer.current = window.setInterval(() => {
          setProgress((value) => Math.min(86, value + Math.max(2, (90 - value) * 0.08)));
        }, 180);
      }, START_DELAY_MS);
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a") : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target && target.target !== "_self") return;
      if (target.hasAttribute("download")) return;
      const href = target.getAttribute("href");
      if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const next = new URL(target.href, window.location.href);
      if (next.origin !== window.location.origin) return;
      const current = new URL(window.location.href);
      if (next.pathname === current.pathname && next.search === current.search && next.hash !== current.hash) return;
      if (next.pathname === current.pathname && next.search === current.search) return;
      start();
    };

    const onPopState = () => start();
    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", clearTimers);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", clearTimers);
      clearTimers();
    };
  }, [clearTimers]);

  useEffect(() => {
    if (!pendingNavigation.current) return;
    if (startTimer.current) {
      window.clearTimeout(startTimer.current);
      startTimer.current = null;
    }
    if (!visibleProgress.current) {
      clearTimers();
      return;
    }
    if (progressTimer.current) {
      window.clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    pendingNavigation.current = false;
    setProgress(100);
    setState("complete");
    finishTimer.current = window.setTimeout(() => {
      visibleProgress.current = false;
      setState("idle");
      setProgress(0);
    }, 220);
  }, [clearTimers, currentLocation]);

  const visible = state !== "idle";
  return (
    <>
      <div
        aria-hidden="true"
        className="dzn-navigation-progress"
        data-state={state}
        style={{ transform: `scaleX(${visible ? progress / 100 : 0})` }}
      />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {visible ? "Loading page" : ""}
      </div>
    </>
  );
}
