import { PublicCommunityMembersPage } from "@/components/community/public-community-members-page";

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    { slug: "preview" },
    { slug: "pandora-dayz" },
    { slug: "nuketown-deathmatch" },
  ];
}

export default async function ServerCommunityMembersRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicCommunityMembersPage slug={slug} />;
}
