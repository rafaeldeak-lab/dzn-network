import type { Metadata } from "next";

import { PublicPlayerProfile } from "@/components/player/public-player-profile";

export const metadata: Metadata = {
  title: "Public Player Profile | DZN Network",
  description:
    "A public-safe DZN player profile shell that only shows sections the player has opted in to publish.",
};

export default function PlayersPage() {
  return <PublicPlayerProfile />;
}
