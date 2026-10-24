import type { Metadata } from "next";

import { DznLandingPage } from "@/components/dzn/dzn-landing-page";

export const metadata: Metadata = {
  title: "DZN Network | DayZ Server Competition Platform",
  description:
    "DZN Network connects DayZ servers, live ADM stats, server-vs-server leaderboards, factions, and community reputation in one premium competition hub.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "DZN Network | DayZ Server Competition Platform",
    description:
      "Discover verified DayZ server activity, player stats, community reputation, and fair competition at DZN Network.",
    url: "/",
    siteName: "DZN Network",
    type: "website",
  },
};

export default function Home() {
  return <DznLandingPage />;
}
