export function stripPublicUrl(value: string) {
  return value
    .replace(/\b(?:https?:\/\/|www\.)?dayz[-\s]*network\.com(?:\/[^\s<]+)?/gi, "")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<]+/gi, "")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]+)?/gi, "")
    .replace(/(?:\s*[-|:]\s*)+$/, "")
    .trim();
}

export function formatPublicServerName(value: string | null | undefined, fallback = "DZN Server") {
  const cleaned = stripPublicUrl(String(value ?? "").replace(/\s+/g, " ").trim());
  if (!cleaned) return fallback;

  return cleaned
    .replace(/\bDay\s*Z\b/gi, "DayZ")
    .replace(/\bDzn\b/gi, "DZN")
    .replace(/\bNuketown\b/gi, "NukeTown")
    .replace(/\bDeathmatch\b/gi, "Deathmatch")
    .replace(/\bPvp\b/gi, "PvP")
    .replace(/\bPve\b/gi, "PvE")
    .replace(/\bEu\b/gi, "EU")
    .replace(/\bUk\b/gi, "UK")
    .replace(/\bUsa\b/gi, "USA")
    .replace(/\s+/g, " ")
    .trim();
}
