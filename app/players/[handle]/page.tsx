import type { Metadata } from "next";

import { PublicPlayerProfile } from "@/components/player/public-player-profile";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ handle: "preview" }];
}

export const metadata: Metadata = {
  title: "Public Player Profile | DZN Network",
  description:
    "A public-safe DZN player profile that respects saved profile visibility preferences.",
};

export default async function PlayerHandlePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return <PublicPlayerProfile handle={handle} />;
}
