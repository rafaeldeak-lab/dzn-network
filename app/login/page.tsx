import type { Metadata } from "next";

import { AuthShell } from "@/components/onboarding/auth-shell";

export const metadata: Metadata = {
  title: "Sign In | DZN Network",
  description: "Sign in with Discord to access DZN Network player and server-owner tools.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Login to DZN Network"
      description="Connect Discord so DZN can verify that you own or administer the community you want to list."
      actionLabel="Login with Discord"
      authStartHref="/api/auth/mock/start"
      hideNavActions
      resolveAuthMode
    />
  );
}
