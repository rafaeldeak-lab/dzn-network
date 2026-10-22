import type { Metadata } from "next";
import { GamesHubMaintenance } from "@/components/games/games-hub-maintenance";

export const metadata: Metadata = {
  title: "DZN Games Hub Maintenance | DZN Network",
  description: "DZN Games Hub is temporarily closed while DZN rebuilds the arcade into deeper, more polished releases.",
  robots: { index: false, follow: true },
};

export default function GamesPage() { return <GamesHubMaintenance />; }
