import type { Metadata } from "next";

import { DznUpdatesFeed } from "@/components/comms/dzn-updates-feed";

export const metadata: Metadata = {
  title: "DZN Updates | DZN Network",
  description: "Verified DZN Network updates for players and server owners.",
  alternates: { canonical: "/updates" },
  openGraph: {
    title: "DZN Updates | DZN Network",
    description: "Verified DZN Network updates for players and server owners.",
    url: "/updates",
    siteName: "DZN Network",
    type: "website",
  },
};

export default function DznUpdatesPage() {
  return (
    <main className="min-h-screen bg-[#03050d] pb-24 pt-6 text-zinc-100 sm:pt-10">
      <DznUpdatesFeed standalone />
    </main>
  );
}
