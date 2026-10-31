/**
 * Private production manifest for future DZN Vault editions.
 *
 * These entries are art directions, not owned rewards, Store products, or
 * grants. An entry may only move into VAULT_CATALOG after its original source
 * artwork, accessibility review, reward rule and presentation QA are complete.
 */
import type { VaultEffect, VaultRarity } from "./vault";

export type VaultRewardType = "calling-card" | "wildcard" | "banner" | "emblem" | "trophy" | "frame";
export type VaultRewardBlueprint = {
  id: string;
  name: string;
  collection: string;
  rewardType: VaultRewardType;
  rarity: Exclude<VaultRarity, "origin">;
  effect: VaultEffect;
  artStatus: "briefed";
};

const COLLECTIONS = [
  ["voidfront", "Voidfront", "void"], ["cinderline", "Cinderline", "ember"],
  ["frostwake", "Frostwake", "frost"], ["signalborn", "Signalborn", "signal"],
  ["verdant-quarantine", "Verdant Quarantine", "toxic"], ["gilded-outpost", "Gilded Outpost", "gold"],
  ["ashen-pact", "Ashen Pact", "ember"], ["nightwatch", "Nightwatch", "void"],
  ["winter-relic", "Winter Relic", "frost"], ["relay-ghost", "Relay Ghost", "signal"],
  ["blacksite-zero", "Blacksite Zero", "toxic"], ["sovereign-road", "Sovereign Road", "gold"],
] as const satisfies readonly (readonly [string, string, VaultEffect])[];

const EDITION_FORMS = [
  "Beacon", "Cipher", "Warden", "Echo", "Omen", "Relay", "Crest", "Signal", "Watch", "Vanguard", "Shroud", "Cairn",
  "Atlas", "Ember", "Rift", "Standard", "Nightfall", "Crown",
] as const;

const REWARD_TYPES: readonly VaultRewardType[] = ["calling-card", "wildcard", "banner", "emblem", "trophy", "frame"];
const RARITIES: readonly Exclude<VaultRarity, "origin">[] = ["rare", "rare", "epic", "rare", "epic", "legendary", "rare", "epic", "rare", "legendary", "epic", "mythic"];

export const VAULT_REWARD_ART_ROADMAP: readonly VaultRewardBlueprint[] = COLLECTIONS.flatMap(([collectionId, collection, effect], collectionIndex) =>
  EDITION_FORMS.map((form, formIndex) => ({
    id: `${collectionId}-${form.toLowerCase()}`,
    name: `${collection} ${form}`,
    collection,
    rewardType: REWARD_TYPES[(collectionIndex + formIndex) % REWARD_TYPES.length],
    rarity: RARITIES[(collectionIndex + formIndex) % RARITIES.length],
    effect,
    artStatus: "briefed",
  })),
);

export const VAULT_REWARD_ART_ROADMAP_SUMMARY = Object.freeze({
  collections: COLLECTIONS.length,
  plannedEditions: VAULT_REWARD_ART_ROADMAP.length,
  producedOpeningCaches: 3,
  availability: "art_direction_only" as const,
});
