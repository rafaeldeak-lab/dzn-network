import type { Metadata } from "next";

import { SetupWizard } from "@/components/onboarding/setup-wizard";

export const metadata: Metadata = {
  title: "Server Setup | DZN Network",
  description: "Connect and configure a DayZ server with DZN Network.",
  robots: { index: false, follow: false },
};

export default function SetupPage() {
  return <SetupWizard />;
}
