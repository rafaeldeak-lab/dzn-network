import type { Metadata } from "next";

import { PlayerHome } from "@/components/player/player-home";

export const metadata: Metadata = {
  title: "Personal Player Profile | DZN Network",
  description:
    "A private DZN profile entry point for logged-in players, keeping profile visibility and competitive systems separate.",
};

export default function PlayerProfilePage() {
  return <PlayerHome mode="profile" />;
}
