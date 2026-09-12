import type { Metadata } from "next";

import { PlayerHome } from "@/components/player/player-home";

export const metadata: Metadata = {
  title: "Player Hub | DZN Network",
  description:
    "A private DZN player entry point for Discord-verified players to reach servers, events, leaderboards, and profile tools without payment.",
};

export default function PlayerPage() {
  return <PlayerHome mode="home" />;
}
