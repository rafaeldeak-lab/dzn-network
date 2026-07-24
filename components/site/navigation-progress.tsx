"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type ProgressState = "idle" | "loading" | "complete";

const START_DELAY_MS = 120;
const RECOVERY_TIMEOUT_MS = 15_000;

type NavigationTarget = {
  href: string | null;
  target?: string | null;
  download?: boolean;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

export function shouldStartNavigationProgress(target: NavigationTarget, currentHref: string) {
  if (target.button !== undefined && target.button !== 0) return false;
  if (target.metaKey || target.ctrlKey || target.shiftKey || target.altKey) return false;
  if (target.target && target.target !== "_self") return false;
  if (target.download) return false;
  const href = target.href;
  if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) return false;
  let next: URL;
  let current: URL;
  try {
    next = new URL(href, currentHref);
    current = new URL(currentHref);
  } catch {
    return false;
  }
  if (next.origin !== current.origin) return false;
  if (next.pathname === current.pathname && next.search === current.search) return false;
  return true;
}

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ProgressState>("idle");
  const [progress, setProgress] = useState(0);
  const startTimer = useRef<number | null>(null);
  const finishTimer = useRef<number | null>(null);
  const progressTimer = useRef<number | null>(null);
  const recoveryTimer = useRef<number | null>(null);
  const pendingNavigation = useRef(false);
  const visibleProgress = useRef(false);
  const currentLocation = `${pathname}?${searchParams.toString()}`;

  const clearTimers = useCallback(() => {
    if (startTimer.current) window.clearTimeout(startTimer.current);
    if (finishTimer.current) window.clearTimeout(finishTimer.current);
    if (progressTimer.current) window.clearInterval(progressTimer.current);
    if (recoveryTimer.current) window.clearTimeout(recoveryTimer.current);
    startTimer.current = null;
    finishTimer.current = null;
    progressTimer.current = null;
    recoveryTimer.current = null;
    pendingNavigation.current = false;
    visibleProgress.current = false;
    setState("idle");
    setProgress(0);
  }, []);

  useEffect(() => {
    const start = () => {
      clearTimers();
      pendingNavigation.current = true;
      recoveryTimer.current = window.setTimeout(clearTimers, RECOVERY_TIMEOUT_MS);
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
      const target = event.target instanceof Element ? event.target.closest("a") : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      window.setTimeout(() => {
        if (event.defaultPrevented) return;
        const shouldStart = shouldStartNavigationProgress({
          href: target.href,
          target: target.target,
          download: target.hasAttribute("download"),
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        }, window.location.href);
        if (shouldStart) start();
      }, 0);
    };

    const onPopState = () => start();
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", clearTimers);
    window.addEventListener("error", clearTimers);
    window.addEventListener("unhandledrejection", clearTimers);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", clearTimers);
      window.removeEventListener("error", clearTimers);
      window.removeEventListener("unhandledrejection", clearTimers);
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
    if (recoveryTimer.current) {
      window.clearTimeout(recoveryTimer.current);
      recoveryTimer.current = null;
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
