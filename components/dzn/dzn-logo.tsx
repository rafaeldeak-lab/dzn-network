"use client";

import { useState } from "react";

export function DznLogo({
  compact = false,
  href = "/",
  size = "default",
  className = "",
}: {
  compact?: boolean;
  href?: string;
  size?: "default" | "hero";
  className?: string;
}) {
  const [logoLoaded, setLogoLoaded] = useState(true);
  const imageClasses = size === "hero" ? "h-24 w-auto sm:h-32" : compact ? "h-9 w-auto sm:h-10" : "h-12 w-auto";
  const fallbackMarkSize = size === "hero" ? "h-20 w-20" : "h-10 w-10";
  const fallbackTextClass = size === "hero" ? "text-4xl sm:text-5xl" : "text-xl";

  return (
    <a
      href={href}
      aria-label="DZN Network home"
      className={`group inline-flex items-center gap-3 ${className}`}
    >
      {logoLoaded ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/media/dzn-logo.png"
          alt="DZN Network"
          className={`${imageClasses} object-contain drop-shadow-[0_0_24px_rgba(139,92,246,0.55)] transition duration-300 group-hover:drop-shadow-[0_0_34px_rgba(167,139,250,0.75)]`}
          onError={() => setLogoLoaded(false)}
        />
      ) : (
        <>
          <span className={`relative grid ${fallbackMarkSize} place-items-center rounded-lg border border-violet-300/25 bg-violet-500/10 shadow-[0_0_32px_rgba(139,92,246,0.35)]`}>
            <span className="absolute inset-1 rounded-md border border-cyan-300/20" />
            <span className="h-3 w-3 rounded-sm bg-violet-300 shadow-[0_0_22px_rgba(196,181,253,0.95)] transition-transform duration-300 group-hover:rotate-45" />
          </span>
          <span className={compact ? "hidden sm:block" : "block"}>
            <span className={`block ${fallbackTextClass} font-black uppercase leading-none text-white`}>
              DZN
            </span>
            <span className="block text-[0.68rem] font-semibold uppercase leading-none text-violet-200/80">
              Network
            </span>
          </span>
        </>
      )}
      <span className="sr-only">
        DZN Network
      </span>
    </a>
  );
}
