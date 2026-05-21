import { ServerEventsPage } from "@/components/events/events-platform";

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    { slug: "preview" },
    { slug: "pandora-dayz" },
    { slug: "nuketown-deathmatch" },
  ];
}

export default async function ServerEventsRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ServerEventsPage slug={slug} />;
}
