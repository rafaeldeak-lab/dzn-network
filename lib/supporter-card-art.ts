const supporterCardArtwork: Record<string, string> = {
  "dzn-first-edition-supporter-card": "/store/cards/first-edition-supporter-insignia-v1.png",
};

export function supporterCardArtworkUrl(productKey: string) {
  return supporterCardArtwork[productKey] ?? null;
}
