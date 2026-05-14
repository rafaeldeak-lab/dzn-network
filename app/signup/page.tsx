import { AuthShell } from "@/components/onboarding/auth-shell";

export default function SignupPage() {
  return (
    <AuthShell
      title="Join DZN Network"
      description="Start the owner verification flow for your Discord community and Nitrado-hosted DayZ server."
      actionLabel="Start with Discord"
      authStartHref="/api/auth/mock/start"
      resolveAuthMode
    />
  );
}
