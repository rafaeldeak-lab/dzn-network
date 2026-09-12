import type { Metadata } from "next";
import { GamesHub } from "@/components/games/games-hub";

export const metadata: Metadata = {
  title: "DZN Games Hub | DZN Network",
  description: "DZN Minesweeper, website missions, collectible insignia and the field relay workshop.",
  robots: { index: false, follow: true },
};

export default function GamesPage() { return <GamesHub />; }
