"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { DznPulseBell, DznPulseProvider } from "@/components/dzn-pulse/dzn-pulse-provider";
import { clearClientAuthState, logoutAndRedirect } from "@/components/onboarding/api";
import { DZN_PUBLIC_DISCORD_INVITE_URL } from "@/lib/public-discord";

type SiteHeaderActive = "features" | "leaderboards" | "servers" | "pricing" | "stats" | "events" | "dashboard";

type SiteHeaderProps = {
  active?: SiteHeaderActive;
  authenticated?: boolean;
  checkingAccount?: boolean;
  returnTo?: string;
  showLogout?: boolean;
};

type SiteHeaderAuthStateProps = Pick<SiteHeaderProps, "authenticated" | "checkingAccount" | "returnTo">;

const logoSources = {
  webm: "/media/server-wars-logo/dzn-server-wars-logo-loop-v2.webm",
  mp4: "/media/server-wars-logo/dzn-server-wars-logo-loop-v2.mp4",
  poster: "/media/server-wars-logo/dzn-server-wars-logo-poster-v2.jpg",
};

const rootHeaderHiddenPrefixes = [
  "/dashboard",
  "/dzn-pulse",
  "/login",
  "/owner",
  "/seasons",
  "/setup",
  "/signup",
  "/test",
];

let pageHeaderAuthState: SiteHeaderAuthStateProps | null = null;
const pageHeaderAuthListeners = new Set<() => void>();

export function SiteHeaderAuthState({ authenticated, checkingAccount, returnTo }: SiteHeaderAuthStateProps) {
  useEffect(() => {
    pageHeaderAuthState = { authenticated, checkingAccount, returnTo };
    notifyPageHeaderAuthListeners();

    return () => {
      pageHeaderAuthState = null;
      notifyPageHeaderAuthListeners();
    };
  }, [authenticated, checkingAccount, returnTo]);

  return null;
}

export function SiteHeaderRoot() {
  const pathname = usePathname();
  const [authState, setAuthState] = useState(pageHeaderAuthState);

  useEffect(() => {
    const listener = () => setAuthState(pageHeaderAuthState);
    pageHeaderAuthListeners.add(listener);

    return () => {
      pageHeaderAuthListeners.delete(listener);
    };
  }, []);

  if (rootHeaderHiddenPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return null;
  }

  return (
    <SiteHeader
      active={activeFromPathname(pathname)}
      authenticated={authState?.authenticated}
      checkingAccount={authState?.checkingAccount}
      returnTo={authState?.returnTo ?? pathname ?? "/"}
    />
  );
}

export function SiteHeader({
  active,
  authenticated,
  checkingAccount = false,
  returnTo = "/",
  showLogout = true,
}: SiteHeaderProps) {
  const [fetchedAuthenticated, setFetchedAuthenticated] = useState(false);
  const [checking, setChecking] = useState(authenticated === undefined);

  useEffect(() => {
    if (authenticated !== undefined) return;

    let activeRequest = true;
    fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
      .then((response) => {
        if (activeRequest) setFetchedAuthenticated(response.ok);
      })
      .catch(() => {
        if (activeRequest) setFetchedAuthenticated(false);
      })
      .finally(() => {
        if (activeRequest) setChecking(false);
      });

    return () => {
      activeRequest = false;
    };
  }, [authenticated]);

  async function signOut() {
    clearClientAuthState();
    setFetchedAuthenticated(false);
    await logoutAndRedirect();
  }

  const authLoading = checkingAccount || checking;
  const resolvedAuthenticated = authenticated ?? fetchedAuthenticated;

  return (
    <DznPulseProvider>
      <header className="dzn-header-shell">
      <nav className="dzn-header-nav" aria-label="Main navigation">
        <Link href="/" className="dzn-header-logo" aria-label="DZN Network home">
          <span className="dzn-header-logo-frame">
            <HeaderLogoVideo />
          </span>
        </Link>

        <div className="dzn-header-links">
          <Link href="/#features" aria-current={active === "features" ? "page" : undefined}>
            Features
          </Link>
          <Link href="/leaderboards" aria-current={active === "leaderboards" ? "page" : undefined}>
            Leaderboards
          </Link>
          <Link href="/servers" aria-current={active === "servers" ? "page" : undefined}>
            Servers
          </Link>
          <Link href="/#pricing" aria-current={active === "pricing" ? "page" : undefined}>
            Pricing
          </Link>
          <Link href="/#stats" aria-current={active === "stats" ? "page" : undefined}>
            Stats
          </Link>
          <Link href="/events" aria-current={active === "events" ? "page" : undefined}>
            Events
          </Link>
        </div>

        <div className="dzn-header-actions">
          {resolvedAuthenticated ? <DznPulseBell className="dzn-header-pulse-bell" /> : null}
          <a href={DZN_PUBLIC_DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" className="dzn-header-action dzn-header-action--discord">
            Discord
          </a>
          <Link href="/dashboard" className="dzn-header-action">
            Dashboard
          </Link>
          <Link href="/setup" className="dzn-header-action dzn-header-action--primary">
            Add Your Server
          </Link>
          {authLoading ? (
            <span className="dzn-header-action dzn-header-action--logout" aria-live="polite">
              Checking
            </span>
          ) : resolvedAuthenticated && showLogout ? (
            <button type="button" onClick={signOut} className="dzn-header-action dzn-header-action--logout">
              Logout
            </button>
          ) : (
            <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="dzn-header-action dzn-header-action--logout">
              Login
            </Link>
          )}
        </div>
      </nav>
      </header>
    </DznPulseProvider>
  );
}

function HeaderLogoVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [useVideo, setUseVideo] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotionPreference = () => setUseVideo(!media.matches);

    syncMotionPreference();
    media.addEventListener("change", syncMotionPreference);

    return () => {
      media.removeEventListener("change", syncMotionPreference);
    };
  }, []);

  useEffect(() => {
    if (!useVideo) return;

    const video = videoRef.current;
    if (!video) return;

    const play = () => {
      video.play().catch(() => {
        video.pause();
        setUseVideo(false);
      });
    };
    const syncVisibility = () => {
      if (document.hidden) {
        video.pause();
        return;
      }

      play();
    };

    play();
    document.addEventListener("visibilitychange", syncVisibility);

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [useVideo]);

  if (!useVideo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoSources.poster}
        alt=""
        aria-hidden="true"
        className="dzn-header-logo-media dzn-header-logo-poster"
        draggable={false}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      className="dzn-header-logo-media dzn-header-logo-video"
      autoPlay
      muted
      loop
      playsInline
      disablePictureInPicture
      preload="metadata"
      poster={logoSources.poster}
      aria-hidden="true"
      tabIndex={-1}
    >
      <source src={logoSources.webm} type="video/webm" />
      <source src={logoSources.mp4} type="video/mp4" />
    </video>
  );
}

function activeFromPathname(pathname: string): SiteHeaderActive | undefined {
  if (pathname.startsWith("/leaderboards")) return "leaderboards";
  if (pathname.startsWith("/servers")) return "servers";
  if (pathname.startsWith("/events")) return "events";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  return undefined;
}

function notifyPageHeaderAuthListeners() {
  for (const listener of pageHeaderAuthListeners) {
    listener();
  }
}
