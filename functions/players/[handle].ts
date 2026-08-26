import {
  buildPublicPlayerProfileSharePreviewMetadata,
  getPublicPlayerProfilePayload,
  type PublicPlayerProfileResponse,
  type PublicPlayerProfileSharePreviewMetadata,
} from "../_lib/public-player-profile";
import { secureHeaders } from "../_lib/http";
import type { PagesFunction } from "../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env, next, params }) => {
  if (!env.ASSETS) return next();

  const url = new URL(request.url);
  const shellUrl = new URL("/players/preview.html", url.origin);
  const shellRequest = new Request(shellUrl.toString(), request);
  const shellResponse = await env.ASSETS.fetch(shellRequest);

  if (!shellResponse.ok) return next();

  const headers = secureHeaders(withoutContentLengthHeader(shellResponse.headers));
  headers.set("cache-control", "no-store");
  headers.set("content-type", "text/html; charset=utf-8");

  const profileResponse = await safePublicProfileResponse(env, params.handle);
  const metadata = buildPublicPlayerProfileSharePreviewMetadata({
    response: profileResponse,
    requestUrl: request.url,
  });
  const html = injectPublicPlayerProfileSharePreviewMetadata(await shellResponse.text(), metadata);

  return new Response(html, {
    status: 200,
    headers,
  });
};

async function safePublicProfileResponse(
  env: Parameters<PagesFunction>[0]["env"],
  handle: unknown,
): Promise<PublicPlayerProfileResponse | null> {
  try {
    return await getPublicPlayerProfilePayload(env, handle);
  } catch {
    return null;
  }
}

function withoutContentLengthHeader(headers: Headers) {
  const next = new Headers();
  headers.forEach((value, key) => {
    if (key.toLowerCase() !== "content-length") next.set(key, value);
  });
  return next;
}

function injectPublicPlayerProfileSharePreviewMetadata(
  html: string,
  metadata: PublicPlayerProfileSharePreviewMetadata,
) {
  const withoutManagedHeadTags = html
    .replace(/\s*<title>[\s\S]*?<\/title>/gi, "")
    .replace(/\s*<meta\s+(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+|dzn:share-preview-copy|dzn:share-preview-source)["'][^>]*>/gi, "")
    .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/gi, "");
  const headTags = publicPlayerProfileSharePreviewHeadTags(metadata);
  if (withoutManagedHeadTags.includes("</head>")) {
    return withoutManagedHeadTags.replace("</head>", `${headTags}\n</head>`);
  }
  return `${headTags}\n${withoutManagedHeadTags}`;
}

function publicPlayerProfileSharePreviewHeadTags(metadata: PublicPlayerProfileSharePreviewMetadata) {
  return [
    "<!-- DZN public profile share preview metadata: generated from public-safe profile payload only. -->",
    `<title>${escapeHtmlText(metadata.title)}</title>`,
    `<meta name="description" content="${escapeHtmlAttribute(metadata.description)}">`,
    `<link rel="canonical" href="${escapeHtmlAttribute(metadata.canonical_href)}">`,
    `<meta name="robots" content="${escapeHtmlAttribute(metadata.robots)}">`,
    `<meta property="og:type" content="${escapeHtmlAttribute(metadata.open_graph.type)}">`,
    `<meta property="og:site_name" content="${escapeHtmlAttribute(metadata.open_graph.site_name)}">`,
    `<meta property="og:title" content="${escapeHtmlAttribute(metadata.open_graph.title)}">`,
    `<meta property="og:description" content="${escapeHtmlAttribute(metadata.open_graph.description)}">`,
    `<meta property="og:url" content="${escapeHtmlAttribute(metadata.open_graph.url)}">`,
    `<meta property="og:image" content="${escapeHtmlAttribute(metadata.open_graph.image)}">`,
    `<meta property="og:image:alt" content="${escapeHtmlAttribute(metadata.open_graph.image_alt)}">`,
    `<meta name="twitter:card" content="${escapeHtmlAttribute(metadata.twitter.card)}">`,
    `<meta name="twitter:title" content="${escapeHtmlAttribute(metadata.twitter.title)}">`,
    `<meta name="twitter:description" content="${escapeHtmlAttribute(metadata.twitter.description)}">`,
    `<meta name="twitter:image" content="${escapeHtmlAttribute(metadata.twitter.image)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtmlAttribute(metadata.twitter.image_alt)}">`,
    `<meta name="dzn:share-preview-copy" content="${escapeHtmlAttribute(metadata.fallback_copy)}">`,
    `<meta name="dzn:share-preview-source" content="${escapeHtmlAttribute(metadata.source)}">`,
  ].join("\n");
}

function escapeHtmlAttribute(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const injectPublicPlayerProfileSharePreviewMetadataForTest = injectPublicPlayerProfileSharePreviewMetadata;
export const publicPlayerProfileSharePreviewHeadTagsForTest = publicPlayerProfileSharePreviewHeadTags;
