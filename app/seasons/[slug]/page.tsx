import { SeasonDetailPage } from "@/components/seasons/public-seasons";

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    { slug: "preview" },
    { slug: "dzn-season-1" },
    { slug: "deathmatch-season" },
    { slug: "pvp-season" },
    { slug: "pve-season" },
    { slug: "survival-season" },
  ];
}

export default async function SeasonSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <SeasonDetailPage slug={slug} />;
}
