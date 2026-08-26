import type { Metadata } from "next";

import { PublicPlayerProfilePage } from "@/components/player/public-player-profile-page";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ handle: "preview" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const safeHandle = staticPublicProfileHandle(handle);
  const title = "DZN Player Profile | DZN Network";
  const description = "View public DZN player profiles shared by their owners on DZN Network.";
  const url = `https://dzn-network.pages.dev/players/${encodeURIComponent(safeHandle)}`;
  const image = "https://dzn-network.pages.dev/media/dzn-cinematic-survivor.png";

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "website",
      siteName: "DZN Network",
      title,
      description,
      url,
      images: [
        {
          url: image,
          alt: "DZN public player profile preview",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [
        {
          url: image,
          alt: "DZN public player profile preview",
        },
      ],
    },
  };
}

export default async function PlayerPublicProfileRoute({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return <PublicPlayerProfilePage handle={handle} />;
}

function staticPublicProfileHandle(value: unknown) {
  if (typeof value !== "string") return "preview";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "preview";
}
