import { AuthShell } from "@/components/onboarding/auth-shell";

export default function LoginPage() {
  return (
    <AuthShell
      title="Login to DZN Network"
      description="Connect Discord so DZN can verify that you own or administer the community you want to list."
      actionLabel="Login with Discord"
      authStartHref="/api/auth/mock/start"
      resolveAuthMode
    />
  );
}
