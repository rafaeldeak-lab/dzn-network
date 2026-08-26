"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { DznPulseBell, DznPulseProvider } from "@/components/dzn-pulse/dzn-pulse-provider";
import { clearClientAuthState, logoutAndRedirect } from "@/components/onboarding/api";
import type { AuthNavigationSummary } from "@/components/onboarding/types";
import { DZN_PUBLIC_DISCORD_INVITE_URL } from "@/lib/public-discord";

type SiteHeaderActive = "features" | "player" | "leaderboards" | "servers" | "pricing" | "stats" | "events" | "community" | "dashboard";

type SiteHeaderProps = {
  active?: SiteHeaderActive;
  authenticated?: boolean;
  checkingAccount?: boolean;
  navigation?: AuthNavigationSummary | null;
  returnTo?: string;
  showLogout?: boolean;
};

type SiteHeaderAuthStateProps = Pick<SiteHeaderProps, "authenticated" | "checkingAccount" | "navigation" | "returnTo">;
type HeaderNavLink = {
  href: string;
  label: string;
  active?: SiteHeaderActive;
};
type HeaderAuthProbeState = {
  authenticated: boolean;
  navigation: AuthNavigationSummary | null;
};
type HeaderPlanTier = AuthNavigationSummary["plan_tier"];
type HeaderPrimaryAction = AuthNavigationSummary["primary_action"];
type AuthMeResponse = {
  authenticated?: boolean;
  navigation?: AuthNavigationSummary | null;
};

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

const loggedOutHeaderLinks: HeaderNavLink[] = [
  { href: "/#features", label: "Features", active: "features" },
  { href: "/pricing", label: "Pricing", active: "pricing" },
];

const starterHeaderLinks: HeaderNavLink[] = [
  { href: "/#features", label: "Features", active: "features" },
  { href: "/player", label: "Player Hub", active: "player" },
  { href: "/leaderboards", label: "Leaderboards", active: "leaderboards" },
  { href: "/servers", label: "Servers", active: "servers" },
  { href: "/events", label: "Events", active: "events" },
  { href: "/community", label: "Community", active: "community" },
];

const proHeaderLinks: HeaderNavLink[] = [
  { href: "/#features", label: "Features", active: "features" },
  { href: "/player", label: "Player Hub", active: "player" },
  { href: "/leaderboards", label: "Leaderboards", active: "leaderboards" },
  { href: "/servers", label: "Servers", active: "servers" },
  { href: "/#stats", label: "Stats", active: "stats" },
  { href: "/events", label: "Events", active: "events" },
  { href: "/community", label: "Community", active: "community" },
];

let pageHeaderAuthState: SiteHeaderAuthStateProps | null = null;
const pageHeaderAuthListeners = new Set<() => void>();

export function SiteHeaderAuthState({ authenticated, checkingAccount, navigation, returnTo }: SiteHeaderAuthStateProps) {
  useEffect(() => {
    pageHeaderAuthState = { authenticated, checkingAccount, navigation, returnTo };
    notifyPageHeaderAuthListeners();

    return () => {
      pageHeaderAuthState = null;
      notifyPageHeaderAuthListeners();
    };
  }, [authenticated, checkingAccount, navigation, returnTo]);

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
      navigation={authState?.navigation}
      returnTo={authState?.returnTo ?? pathname ?? "/"}
    />
  );
}

export function SiteHeader({
  active,
  authenticated,
  checkingAccount = false,
  navigation,
  returnTo = "/",
  showLogout = true,
}: SiteHeaderProps) {
  const [fetchedAuthState, setFetchedAuthState] = useState<HeaderAuthProbeState>({ authenticated: false, navigation: null });
  const [checking, setChecking] = useState(authenticated === undefined);

  useEffect(() => {
    if (authenticated !== undefined) return;

    let activeRequest = true;
    fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (!activeRequest) return;
        if (!response.ok) {
          setFetchedAuthState({ authenticated: false, navigation: null });
          return;
        }

        const payload = await response.json().catch(() => null) as AuthMeResponse | null;
        setFetchedAuthState({
          authenticated: Boolean(payload?.authenticated),
          navigation: normalizeHeaderNavigation(payload?.navigation),
        });
      })
      .catch(() => {
        if (activeRequest) setFetchedAuthState({ authenticated: false, navigation: null });
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
    setFetchedAuthState({ authenticated: false, navigation: null });
    await logoutAndRedirect();
  }

  const authProbePending = checkingAccount || checking;
  const resolvedAuthenticated = authenticated ?? fetchedAuthState.authenticated;
  const resolvedNavigation = resolvedAuthenticated
    ? normalizeHeaderNavigation(authenticated === undefined ? fetchedAuthState.navigation : navigation)
    : null;
  const planTier = resolvedNavigation?.plan_tier ?? "free";
  const navLinks = resolvedAuthenticated ? authenticatedHeaderLinksForTier(planTier) : loggedOutHeaderLinks;
  const primaryAction = resolvedNavigation?.primary_action ?? defaultPrimaryActionForTier(planTier);
  const canUseOwnerTools = Boolean(resolvedNavigation?.can_use_owner_tools);
  const showOwnerDashboard = resolvedAuthenticated && canUseOwnerTools && primaryAction.href !== "/dashboard";
  const showAddServer = resolvedAuthenticated && canUseOwnerTools && Boolean(resolvedNavigation?.can_link_more_servers);

  return (
    <DznPulseProvider>
      <header className="dzn-header-shell">
      <nav
        className={`dzn-header-nav ${resolvedAuthenticated ? "dzn-header-nav--authenticated" : "dzn-header-nav--logged-out"}`}
        aria-label="Main navigation"
        aria-busy={authProbePending}
        data-auth-state={resolvedAuthenticated ? "authenticated" : authProbePending ? "checking-public" : "anonymous"}
      >
        <Link href="/" className="dzn-header-logo" aria-label="DZN Network home">
          <span className="dzn-header-logo-frame">
            <HeaderLogoVideo />
          </span>
        </Link>

        <div className="dzn-header-links">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} aria-current={active === link.active ? "page" : undefined}>
              {link.label}
            </Link>
          ))}
        </div>

        <div className="dzn-header-actions">
          {resolvedAuthenticated ? <DznPulseBell className="dzn-header-pulse-bell" /> : null}
          <a href={DZN_PUBLIC_DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" className="dzn-header-action dzn-header-action--discord">
            Discord
          </a>
          {resolvedAuthenticated ? (
            <>
              <span className={`dzn-header-plan dzn-header-plan--${planTier}`} title={headerPlanTitle(resolvedNavigation)}>
                <span>{resolvedNavigation?.plan_label ?? "Free"}</span>
                <small>{headerPlanDetail(resolvedNavigation)}</small>
              </span>
              {showOwnerDashboard ? (
                <Link href="/dashboard" className="dzn-header-action">
                  Dashboard
                </Link>
              ) : null}
              {showAddServer ? (
                <Link href="/setup" className="dzn-header-action dzn-header-action--primary">
                  Add Your Server
                </Link>
              ) : null}
              <Link href={primaryAction.href} className={`dzn-header-action dzn-header-action--package dzn-header-action--package-${primaryAction.tone}`}>
                {primaryAction.label}
              </Link>
            </>
          ) : null}
          {resolvedAuthenticated && showLogout ? (
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
  if (pathname.startsWith("/player")) return "player";
  if (pathname.startsWith("/leaderboards")) return "leaderboards";
  if (pathname.startsWith("/servers")) return "servers";
  if (pathname.startsWith("/pricing")) return "pricing";
  if (pathname.startsWith("/events")) return "events";
  if (pathname.startsWith("/community")) return "community";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  return undefined;
}

function notifyPageHeaderAuthListeners() {
  for (const listener of pageHeaderAuthListeners) {
    listener();
  }
}

function authenticatedHeaderLinksForTier(tier: HeaderPlanTier) {
  if (tier === "pro") return proHeaderLinks;
  return starterHeaderLinks;
}

function normalizeHeaderNavigation(value: unknown): AuthNavigationSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<AuthNavigationSummary>;
  if (record.plan_tier !== "free" && record.plan_tier !== "starter" && record.plan_tier !== "pro") return null;
  if (!record.primary_action || typeof record.primary_action !== "object") return null;
  return record as AuthNavigationSummary;
}

function defaultPrimaryActionForTier(tier: HeaderPlanTier): HeaderPrimaryAction {
  if (tier === "pro") return { label: "Owner Dashboard", href: "/dashboard", tone: "pro" };
  if (tier === "starter") return { label: "Upgrade to Pro", href: "/pricing?intent=pro&returnTo=%2Fdashboard", tone: "upgrade" };
  return { label: "Owner Plans", href: "/pricing?intent=owner_setup&returnTo=%2Fsetup", tone: "trial" };
}

function headerPlanTitle(navigation: AuthNavigationSummary | null) {
  if (!navigation) return "DZN account plan loading";
  if (!navigation.can_use_owner_tools) return `${navigation.plan_label} player account - owner plan required for setup`;
  return `${navigation.plan_label} account - ${navigation.linked_server_count}/${navigation.linked_server_limit} server slots used`;
}

function headerPlanDetail(navigation: AuthNavigationSummary | null) {
  if (!navigation) return "Account";
  if (navigation.plan_tier === "pro") return "Pro tools";
  if (navigation.plan_tier === "starter") return navigation.plan_status.toLowerCase() === "trialing" ? "Trial access" : "Starter access";
  return "Player access";
}
