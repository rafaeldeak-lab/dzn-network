"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { clearClientAuthState, logoutAndRedirect } from "@/components/onboarding/api";

const DZN_DISCORD_INVITE_URL =
  process.env.NEXT_PUBLIC_DZN_DISCORD_INVITE_URL ||
  "https://discord.gg/T2cgcTYPFV";

type SiteHeaderActive = "features" | "leaderboards" | "servers" | "pricing" | "stats" | "events" | "dashboard";

type SiteHeaderProps = {
  active?: SiteHeaderActive;
  authenticated?: boolean;
  checkingAccount?: boolean;
  returnTo?: string;
  showLogout?: boolean;
};

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
    <header className="dzn-header-shell">
      <nav className="dzn-header-nav" aria-label="Main navigation">
        <Link href="/" className="dzn-header-logo" aria-label="DZN Network home">
          <span className="dzn-header-logo-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/media/dzn-logo.png" alt="DZN Network" />
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
          <a href={DZN_DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" className="dzn-header-action dzn-header-action--discord">
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
  );
}
