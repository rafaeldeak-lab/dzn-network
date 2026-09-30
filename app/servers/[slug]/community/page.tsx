import type { Metadata } from "next";
import { PublicCommunityDirectory } from "@/components/community/public-community-directory";

export const dynamicParams = false;
export function generateStaticParams() { return [{ slug: "preview" }]; }
export const metadata: Metadata = { title: "Community Directory | DZN Network", description: "Opt-in public member profiles for a DZN server community." };

export default async function CommunityDirectoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicCommunityDirectory slug={slug} />;
}
