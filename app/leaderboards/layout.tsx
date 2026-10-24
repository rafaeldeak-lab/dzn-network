import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DayZ Leaderboards | DZN Network",
  description:
    "Explore DZN Network DayZ leaderboards for verified server activity, player performance, kills, deaths, K/D, and long-range records.",
  alternates: { canonical: "/leaderboards" },
  openGraph: {
    title: "DayZ Leaderboards | DZN Network",
    description:
      "Explore DZN Network DayZ leaderboards for verified server activity and player performance.",
    url: "/leaderboards",
    siteName: "DZN Network",
    type: "website",
  },
};

export default function LeaderboardsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
