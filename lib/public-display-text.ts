export function stripPublicUrl(value: string) {
  return value
    .replace(/\b(?:https?:\/\/|www\.)?dayz[-\s]*network\.com(?:\/[^\s<]+)?/gi, "")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<]+/gi, "")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]+)?/gi, "")
    .replace(/(?:\s*[-|:]\s*)+$/, "")
    .trim();
}
