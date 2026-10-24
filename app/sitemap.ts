import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://dayz-network.com";

  return [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/servers`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/leaderboards`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/community`, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/updates`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/pricing`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/store`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/player`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/refunds`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
