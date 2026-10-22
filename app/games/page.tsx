import type { Metadata } from "next";
import { GamesHub } from "@/components/games/games-hub";

export const metadata: Metadata = {
  title: "DZN Games Hub Development | DZN Network",
  description: "DZN Games Hub field-game prototypes are under active development while deeper releases are prepared.",
  robots: { index: false, follow: true },
};

export default function GamesPage() { return <GamesHub />; }
