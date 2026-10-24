import type { Metadata } from "next";

import { PublicNetwork } from "@/components/network/public-network";

export const metadata: Metadata = {
  title: "DayZ Server Directory | DZN Network",
  description:
    "Browse verified DayZ server listings, current player counts, activity, reputation, server details, and community links on DZN Network.",
  alternates: { canonical: "/servers" },
  openGraph: {
    title: "DayZ Server Directory | DZN Network",
    description:
      "Browse verified DayZ server listings, activity, player counts, reputation, and community links.",
    url: "/servers",
    siteName: "DZN Network",
    type: "website",
  },
};

export default function ServersPage() {
  return <PublicNetwork />;
}
