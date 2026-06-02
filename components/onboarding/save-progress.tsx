"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

export type SaveProgressStatus = "idle" | "validating" | "saving" | "refreshing" | "saved" | "failed";

export type SaveProgressState = {
  status: SaveProgressStatus;
  progress: number;
  label: string;
  error: string | null;
};

const IDLE_PROGRESS: SaveProgressState = {
  status: "idle",
  progress: 0,
  label: "Waiting",
  error: null,
};

export function useSaveProgress(resetDelayMs = 1800) {
  const [state, setState] = useState<SaveProgressState>(IDLE_PROGRESS);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  function clearResetTimer() {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }

  function reset() {
    clearResetTimer();
    setState(IDLE_PROGRESS);
  }

  function setStage(status: Exclude<SaveProgressStatus, "idle" | "saved" | "failed">, label: string, progress: number) {
    clearResetTimer();
    setState({
      status,
      progress: clampProgress(progress),
      label,
      error: null,
    });
  }

  function start(label = "Validating", progress = 15) {
    setStage("validating", label, progress);
  }

  function complete(label = "Saved") {
    clearResetTimer();
    setState({
      status: "saved",
      progress: 100,
      label,
      error: null,
    });
    resetTimerRef.current = setTimeout(() => {
      setState(IDLE_PROGRESS);
      resetTimerRef.current = null;
    }, resetDelayMs);
  }

  function fail(message: string) {
    clearResetTimer();
    setState({
      status: "failed",
      progress: 100,
      label: "Save failed",
      error: message,
    });
  }

  return {
    state,
    isBusy: state.status === "validating" || state.status === "saving" || state.status === "refreshing",
    reset,
    start,
    setStage,
    complete,
    fail,
  };
}

export function SaveProgressButton({
  idleLabel,
  savingLabel = "Saving...",
  refreshingLabel = "Refreshing...",
  successLabel = "Saved",
  errorLabel = "Retry Save",
  state,
  disabled = false,
  onClick,
  icon,
  className = "",
  buttonClassName = "",
  fullWidth = false,
}: {
  idleLabel: string;
  savingLabel?: string;
  refreshingLabel?: string;
  successLabel?: string;
  errorLabel?: string;
  state: SaveProgressState;
  disabled?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  className?: string;
  buttonClassName?: string;
  fullWidth?: boolean;
}) {
  const busy = state.status === "validating" || state.status === "saving" || state.status === "refreshing";
  const active = busy || state.status === "saved" || state.status === "failed";
  const label = buttonLabel(state.status, {
    idleLabel,
    savingLabel,
    refreshingLabel,
    successLabel,
    errorLabel,
  });
  const tone = state.status === "failed"
    ? "text-red-50"
    : state.status === "saved"
      ? "text-emerald-50"
      : "text-zinc-300";

  return (
    <div className={`grid gap-2 ${fullWidth ? "w-full" : "w-fit max-w-full"} ${className}`}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={onClick}
        aria-busy={busy}
        className={`${buttonClassName} ${fullWidth ? "w-full justify-center" : ""}`}
      >
        {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : icon}
        {label}
      </button>
      {active ? (
        <div aria-live="polite" className={`grid gap-1 text-[11px] font-bold ${tone}`}>
          <div className="flex items-center justify-between gap-3">
            <span>{state.error ?? state.label}</span>
            <span>{Math.round(state.progress)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-sm bg-white/10">
            <div
              className={`h-full rounded-sm transition-all duration-300 ${
                state.status === "failed"
                  ? "bg-red-300"
                  : state.status === "saved"
                    ? "bg-emerald-300"
                    : "bg-gradient-to-r from-cyan-300 to-violet-300"
              }`}
              style={{ width: `${clampProgress(state.progress)}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buttonLabel(
  status: SaveProgressStatus,
  labels: {
    idleLabel: string;
    savingLabel: string;
    refreshingLabel: string;
    successLabel: string;
    errorLabel: string;
  },
) {
  switch (status) {
    case "validating":
    case "saving":
      return labels.savingLabel;
    case "refreshing":
      return labels.refreshingLabel;
    case "saved":
      return labels.successLabel;
    case "failed":
      return labels.errorLabel;
    default:
      return labels.idleLabel;
  }
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
