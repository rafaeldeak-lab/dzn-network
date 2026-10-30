/* eslint-disable @next/next/no-img-element -- connected Discord icons are external, runtime-provided URLs. */
import { useState } from "react";

type ServerMarkProps = {
  name: string;
  iconUrl?: string | null;
  className?: string;
};

function initials(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((part) => part.slice(0, 1))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return letters || "DZ";
}

function safeIconUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Uses the connected Discord guild icon when the real public API supplies one.
 * A deterministic initials mark makes absence of a Discord image explicit
 * without manufacturing a second logo for a community.
 */
export function ServerMark({ name, iconUrl, className = "h-9 w-9" }: ServerMarkProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const src = safeIconUrl(iconUrl);
  if (src && !imageFailed) {
    return (
      <img
        src={src}
        alt={`${name} server icon`}
        className={`${className} shrink-0 rounded-lg border border-cyan-200/24 object-cover shadow-[0_0_18px_rgba(34,211,238,0.12)]`}
        onError={() => setImageFailed(true)}
      />
    );
  }
  return (
    <span
      aria-label={`${name} initials mark`}
      className={`${className} inline-flex shrink-0 items-center justify-center rounded-lg border border-violet-300/24 bg-[linear-gradient(145deg,rgba(124,58,237,0.28),rgba(6,182,212,0.12))] text-[10px] font-black uppercase text-violet-50 shadow-[0_0_18px_rgba(124,58,237,0.12)]`}
    >
      {initials(name)}
    </span>
  );
}
