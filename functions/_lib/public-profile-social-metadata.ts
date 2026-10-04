import type { PublicPlayerProfilePayload } from "./player-public-profiles";

const shareImagePath = "/media/dzn-cinematic-survivor.png";
const publicSiteOrigin = "https://dayz-network.com";
const fallbackTitle = "DZN Player Profile | DZN Network";
const fallbackDescription = "View public DZN player profiles shared by their owners on DZN Network.";

export type PublicProfileSocialMetadata = {
  source: "public_profile" | "generic_fallback";
  title: string;
  description: string;
  canonical: string;
  image: string;
  imageAlt: string;
  robots: "index,follow" | "noindex,nofollow";
  openGraphType: "profile" | "website";
};

export function buildPublicProfileSocialMetadata(
  requestUrl: string | URL,
  profile: PublicPlayerProfilePayload | null,
): PublicProfileSocialMetadata {
  const request = new URL(requestUrl);
  const fallbackCanonical = new URL(request.pathname, publicSiteOrigin).toString();
  const image = new URL(shareImagePath, publicSiteOrigin).toString();

  if (!profile) {
    return {
      source: "generic_fallback",
      title: fallbackTitle,
      description: fallbackDescription,
      canonical: fallbackCanonical,
      image,
      imageAlt: "DZN Network public player profile preview",
      robots: "noindex,nofollow",
      openGraphType: "website",
    };
  }

  const displayName = cleanText(profile.display_name, "DZN Player", 80);
  const canonicalPath = safeProfilePath(profile.href) ?? fallbackCanonical;
  const signals = publicSignals(profile);
  const summary = signals.length
    ? `${displayName}'s public DZN profile: ${signals.join(", ")}.`
    : `${displayName}'s public DZN profile is published with their saved visibility choices.`;
  const description = cleanText(`${summary} Private account details stay hidden.`, fallbackDescription, 180);

  return {
    source: "public_profile",
    title: `${displayName} | DZN Player Profile`,
    description,
    canonical: new URL(canonicalPath, publicSiteOrigin).toString(),
    image,
    imageAlt: `${displayName} public DZN player profile preview`,
    robots: "index,follow",
    openGraphType: "profile",
  };
}

export function injectPublicProfileSocialMetadata(html: string, metadata: PublicProfileSocialMetadata) {
  const cleanHead = html
    .replace(/\s*<title>[\s\S]*?<\/title>/gi, "")
    .replace(/\s*<meta\b[^>]*(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+|dzn:profile-preview-source)["'][^>]*>/gi, "")
    .replace(/\s*<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "");
  const tags = socialHeadTags(metadata);
  return cleanHead.includes("</head>")
    ? cleanHead.replace("</head>", `${tags}\n</head>`)
    : `${tags}\n${cleanHead}`;
}

export function withoutStaticShellValidators(headers: Headers) {
  const result = new Headers();
  headers.forEach((value, key) => {
    if (!new Set(["content-length", "etag", "last-modified"]).has(key.toLowerCase())) result.set(key, value);
  });
  return result;
}

function socialHeadTags(metadata: PublicProfileSocialMetadata) {
  const tags = [
    "<!-- DZN public profile metadata uses only the public-safe profile projection. -->",
    `<title>${escapeText(metadata.title)}</title>`,
    `<meta name="description" content="${escapeAttribute(metadata.description)}">`,
    `<link rel="canonical" href="${escapeAttribute(metadata.canonical)}">`,
    `<meta name="robots" content="${metadata.robots}">`,
    `<meta property="og:type" content="${metadata.openGraphType}">`,
    '<meta property="og:site_name" content="DZN Network">',
    `<meta property="og:title" content="${escapeAttribute(metadata.title)}">`,
    `<meta property="og:description" content="${escapeAttribute(metadata.description)}">`,
    `<meta property="og:url" content="${escapeAttribute(metadata.canonical)}">`,
    `<meta property="og:image" content="${escapeAttribute(metadata.image)}">`,
    `<meta property="og:image:alt" content="${escapeAttribute(metadata.imageAlt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeAttribute(metadata.title)}">`,
    `<meta name="twitter:description" content="${escapeAttribute(metadata.description)}">`,
    `<meta name="twitter:image" content="${escapeAttribute(metadata.image)}">`,
    `<meta name="twitter:image:alt" content="${escapeAttribute(metadata.imageAlt)}">`,
    `<meta name="dzn:profile-preview-source" content="${metadata.source}">`,
  ];
  return tags.join("\n");
}

function publicSignals(profile: PublicPlayerProfilePayload) {
  const signals: string[] = [];
  const gameplay = profile.sections.gameplay_summary;
  if (gameplay.visible && gameplay.totals) signals.push(`${Math.max(0, Math.trunc(gameplay.totals.kills))} confirmed kills`);
  const featured = profile.sections.featured_server;
  if (featured.visible && featured.server) signals.push(`featured on ${cleanText(featured.server.server_name, "a DZN server", 60)}`);
  const cards = profile.sections.calling_cards;
  if (cards.visible && cards.items.length) signals.push(`${cards.items.length} Supporter Card${cards.items.length === 1 ? "" : "s"}`);
  if (profile.discord_profile.visible && profile.discord_profile.connected) signals.push("Discord identity connected");
  return signals.slice(0, 3);
}

function safeProfilePath(value: unknown) {
  if (typeof value !== "string") return null;
  return /^\/players\/[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/.test(value) && !value.includes("--") ? value : null;
}

function cleanText(value: unknown, fallback: string, limit: number) {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, limit);
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
