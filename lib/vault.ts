/** Public-safe, versioned presentation metadata. This catalogue never grants ownership. */
export type VaultScope = "player" | "server";
export type VaultKind = "card" | "weapon" | "trophy" | "scene";
export type VaultRarity = "origin" | "rare" | "epic" | "legendary" | "mythic";
export type VaultEffect = "none" | "void" | "ember" | "toxic" | "frost" | "signal" | "gold";

export type VaultCatalogItem = {
  id: string;
  name: string;
  edition: string;
  description: string;
  kind: VaultKind;
  rarity: VaultRarity;
  artIndex: number | null;
  /** Internal, curated artwork only; never populated from a purchase record. */
  artUrl?: string;
  effect: VaultEffect;
  availability: "welcome" | "preview" | "legacy";
  scopes: readonly VaultScope[];
};

export type VaultSlots = {
  hero: string | null;
  supporting: [string | null, string | null, string | null, string | null];
  scene: string | null;
};

export type VaultOwnedItem = {
  id: string;
  catalog: VaultCatalogItem;
  acquiredAt: string;
  source: "welcome" | "earned" | "purchase";
};

export type VaultShowcase = {
  version: number;
  published: boolean;
  slots: VaultSlots;
  updatedAt: string | null;
};

export type VaultCabinetResponse = {
  ok: true;
  scope: VaultScope;
  displayName: string;
  items: VaultOwnedItem[];
  showcase: VaultShowcase;
  welcomeAvailable: boolean;
  purchaseSource: "ready" | "unavailable" | "not_applicable";
  publicProfileEnabled: boolean;
  publicProfilePath: string | null;
};

/** Published projection intentionally excludes grant IDs, owners, receipts and inventory counts. */
export type PublicVaultShowcase = {
  slots: {
    hero: VaultCatalogItem | null;
    supporting: [VaultCatalogItem | null, VaultCatalogItem | null, VaultCatalogItem | null, VaultCatalogItem | null];
    scene: VaultCatalogItem | null;
  };
};

export type PublicVaultResponse = { ok: true; showcase: PublicVaultShowcase | null };

export function emptyVaultSlots(): VaultSlots {
  return { hero: null, supporting: [null, null, null, null], scene: null };
}

export const VAULT_CATALOG: readonly VaultCatalogItem[] = [
  {
    id: "void-revenant-origin", name: "Void Revenant", edition: "Origin",
    description: "Your first DZN original. A masked survivor framed by drifting violet mist.",
    kind: "card", rarity: "origin", artIndex: 0, effect: "void", availability: "welcome", scopes: ["player"],
  },
  {
    id: "citadel-core-foundation", name: "Citadel Core", edition: "Foundation",
    description: "A golden fortress for the community you are building. Owned by your server.",
    kind: "trophy", rarity: "origin", artIndex: 5, effect: "gold", availability: "welcome", scopes: ["server"],
  },
  {
    id: "nebula-chamber", name: "Nebula Chamber", edition: "Welcome scene",
    description: "A violet atmosphere for your showcase. Included in your free welcome set.",
    kind: "scene", rarity: "origin", artIndex: null, effect: "void", availability: "welcome", scopes: ["player", "server"],
  },
  {
    id: "void-revenant-ascendant", name: "Void Revenant", edition: "Ascendant concept",
    description: "Black armour, violet smoke and a holographic frame. A future collectible edition.",
    kind: "card", rarity: "legendary", artIndex: 0, effect: "void", availability: "preview", scopes: ["player", "server"],
  },
  {
    id: "ember-warden-inferno", name: "Ember Warden", edition: "Inferno concept",
    description: "Molten armour surrounded by sparks and rising embers. A future collectible edition.",
    kind: "card", rarity: "epic", artIndex: 1, effect: "ember", availability: "preview", scopes: ["player", "server"],
  },
  {
    id: "biohazard-containment", name: "Biohazard", edition: "Containment concept",
    description: "A gas-masked survivor emerging from a toxic green haze. A future collectible edition.",
    kind: "card", rarity: "epic", artIndex: 2, effect: "toxic", availability: "preview", scopes: ["player", "server"],
  },
  {
    id: "frostbite-glacier", name: "Frostbite", edition: "Glacier concept",
    description: "An original rifle display suspended in ice and cold light. A future cosmetic edition.",
    kind: "weapon", rarity: "legendary", artIndex: 3, effect: "frost", availability: "preview", scopes: ["player", "server"],
  },
  {
    id: "ghost-signal-spectral", name: "Ghost Signal", edition: "Spectral concept",
    description: "An original violet rifle display with spectral interference. A future cosmetic edition.",
    kind: "weapon", rarity: "epic", artIndex: 4, effect: "signal", availability: "preview", scopes: ["player", "server"],
  },
  {
    id: "citadel-core-sovereign", name: "Citadel Core", edition: "Sovereign concept",
    description: "A floating fortress crowned in golden light. A future trophy edition.",
    kind: "trophy", rarity: "mythic", artIndex: 5, effect: "gold", availability: "preview", scopes: ["player", "server"],
  },
];

export const VAULT_WELCOME_ITEMS: Record<VaultScope, readonly string[]> = {
  player: ["void-revenant-origin", "nebula-chamber"],
  server: ["citadel-core-foundation", "nebula-chamber"],
};

export function getVaultCatalogItem(id: string): VaultCatalogItem | undefined {
  return VAULT_CATALOG.find((item) => item.id === id);
}

const SUPPORTER_CARD_ARTWORK: Readonly<Record<string, string>> = {
  "dzn-first-edition-supporter-card": "/store/cards/first-edition-supporter-insignia-v1.png",
};

export function supporterCardArtworkUrl(productKey: string): string | null {
  return SUPPORTER_CARD_ARTWORK[productKey] ?? null;
}

export function legacySupporterCatalog(productKey: string, name: string): VaultCatalogItem {
  const artUrl = supporterCardArtworkUrl(productKey);
  return {
    id: `supporter:${productKey}`, name,
    edition: artUrl ? "First Edition Supporter" : "Supporter card",
    description: artUrl
      ? "A permanent First Edition supporter collectible, available to showcase only when its Store entitlement is active."
      : "An existing supporter collectible from your DZN account.",
    kind: "card", rarity: artUrl ? "epic" : "rare", artIndex: null, artUrl: artUrl ?? undefined,
    effect: artUrl ? "gold" : "none", availability: "legacy", scopes: ["player"],
  };
}
