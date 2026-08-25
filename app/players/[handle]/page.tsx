import { PublicPlayerProfilePage } from "@/components/player/public-player-profile-page";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ handle: "preview" }];
}

export default async function PlayerPublicProfileRoute({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return <PublicPlayerProfilePage handle={handle} />;
}
