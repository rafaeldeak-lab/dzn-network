import { EventDetailPage } from "@/components/events/events-platform";

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    { slug: "dzn-season-1" },
    { slug: "weekly-warriors" },
    { slug: "pandora-showdown" },
    { slug: "spring-clash" },
    { slug: "legends-cup" },
  ];
}

export default async function EventSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <EventDetailPage slug={slug} />;
}
