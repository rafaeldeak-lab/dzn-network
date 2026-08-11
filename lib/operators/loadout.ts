import {
  DEFAULT_OPERATOR_ID,
  DZN_OPERATOR_CATALOG,
  STARTER_ITEM_IDS_BY_SLOT,
  getCatalogItem,
} from "./catalog";
import {
  OPERATOR_COSMETIC_SLOTS,
  PROHIBITED_OPERATOR_COMPETITIVE_FIELDS,
  type OperatorCardPresentation,
  type OperatorCatalog,
  type OperatorCosmeticItem,
  type OperatorCosmeticSlot,
  type OperatorEntitlement,
  type OperatorLoadout,
  type OperatorPlanTier,
  type OperatorValidationIssue,
  type OperatorValidationResult,
} from "./types";

export const DEFAULT_OPERATOR_LOADOUT_ID = "dzn-standard-loadout";
export const DEFAULT_OPERATOR_LOADOUT_UPDATED_AT = "2026-01-01T00:00:00.000Z";

export function getDefaultOperatorLoadout(): OperatorLoadout {
  return {
    id: DEFAULT_OPERATOR_LOADOUT_ID,
    operatorId: DEFAULT_OPERATOR_ID,
    displayName: "Standard DZN Operator",
    selections: { ...STARTER_ITEM_IDS_BY_SLOT },
    updatedAt: DEFAULT_OPERATOR_LOADOUT_UPDATED_AT,
  };
}

export function getOperatorEntitlements(planTier: OperatorPlanTier): OperatorEntitlement[] {
  return planTier === "premium" ? ["free", "premium"] : ["free"];
}

export function canUseOperatorItem(planTier: OperatorPlanTier, item: OperatorCosmeticItem): boolean {
  return getOperatorEntitlements(planTier).includes(item.entitlement);
}

export function canSaveOperatorLoadout(planTier: OperatorPlanTier, loadout: OperatorLoadout): boolean {
  return planTier === "premium" && validateOperatorLoadout(planTier, loadout).valid;
}

export function validateOperatorLoadout(
  planTier: OperatorPlanTier,
  loadout: OperatorLoadout,
  catalog: OperatorCatalog = DZN_OPERATOR_CATALOG,
): OperatorValidationResult {
  const issues: OperatorValidationIssue[] = [];
  const operator = catalog.operators.find((entry) => entry.id === loadout.operatorId);

  if (!operator) {
    issues.push({
      code: "operator_unknown",
      message: "Unknown operator identity.",
    });
  }

  if (planTier === "free" && !isDefaultOperatorLoadout(loadout)) {
    issues.push({
      code: "free_custom_loadout",
      message: "Free accounts keep the standard DZN operator identity.",
    });
  }

  for (const slot of OPERATOR_COSMETIC_SLOTS) {
    const selectedItemId = loadout.selections[slot];
    if (!selectedItemId) {
      issues.push({
        code: "missing_required_slot",
        message: "Missing cosmetic slot falls back to the starter item.",
        slot,
        itemId: STARTER_ITEM_IDS_BY_SLOT[slot],
      });
      continue;
    }

    const item = getCatalogItem(selectedItemId, catalog);
    if (!item) {
      issues.push({
        code: "item_unknown",
        message: "Unknown cosmetic item.",
        slot,
        itemId: selectedItemId,
      });
      continue;
    }

    if (item.slot !== slot) {
      issues.push({
        code: "item_slot_mismatch",
        message: "Cosmetic item cannot be assigned to this slot.",
        slot,
        itemId: selectedItemId,
      });
    }

    if (!item.compatibleOperatorIds.includes(loadout.operatorId)) {
      issues.push({
        code: "item_incompatible",
        message: "Cosmetic item is not compatible with this operator identity.",
        slot,
        itemId: selectedItemId,
      });
    }

    if (!canUseOperatorItem(planTier, item)) {
      issues.push({
        code: "premium_required",
        message: "Premium cosmetic entitlement is required.",
        slot,
        itemId: selectedItemId,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    loadout: sanitizeOperatorLoadout(planTier, loadout, catalog),
  };
}

export function sanitizeOperatorLoadout(
  planTier: OperatorPlanTier,
  loadout: OperatorLoadout,
  catalog: OperatorCatalog = DZN_OPERATOR_CATALOG,
): OperatorLoadout {
  if (planTier === "free") return getDefaultOperatorLoadout();

  const operator = catalog.operators.find((entry) => entry.id === loadout.operatorId) ?? catalog.operators.find((entry) => entry.default);
  const operatorId = operator?.id ?? DEFAULT_OPERATOR_ID;
  const selections: Partial<Record<OperatorCosmeticSlot, string>> = {};

  for (const slot of OPERATOR_COSMETIC_SLOTS) {
    const selectedItemId = loadout.selections[slot];
    const selectedItem = selectedItemId ? getCatalogItem(selectedItemId, catalog) : null;
    const starterItemId = STARTER_ITEM_IDS_BY_SLOT[slot];
    selections[slot] =
      selectedItem
      && selectedItem.slot === slot
      && selectedItem.compatibleOperatorIds.includes(operatorId)
        ? selectedItem.id
        : starterItemId;
  }

  return {
    id: cleanLoadoutId(loadout.id),
    operatorId,
    displayName: cleanDisplayName(loadout.displayName),
    selections,
    updatedAt: cleanTimestamp(loadout.updatedAt),
  };
}

export function buildOperatorCardPresentation(
  loadout: OperatorLoadout,
  catalog: OperatorCatalog = DZN_OPERATOR_CATALOG,
): OperatorCardPresentation {
  const safeLoadout = sanitizeOperatorLoadout("premium", loadout, catalog);
  const operator = catalog.operators.find((entry) => entry.id === safeLoadout.operatorId) ?? catalog.operators[0];
  const selectedItems = Object.fromEntries(
    OPERATOR_COSMETIC_SLOTS.map((slot) => {
      const item = getCatalogItem(safeLoadout.selections[slot] ?? STARTER_ITEM_IDS_BY_SLOT[slot], catalog)
        ?? getCatalogItem(STARTER_ITEM_IDS_BY_SLOT[slot], catalog);
      if (!item) throw new Error(`Missing starter item for operator slot: ${slot}`);
      return [slot, item];
    }),
  ) as Record<OperatorCosmeticSlot, OperatorCosmeticItem>;

  const presentation = {
    operatorId: operator?.id ?? DEFAULT_OPERATOR_ID,
    displayName: safeLoadout.displayName,
    callSign: operator?.callSign ?? "Signal One",
    frameItemId: selectedItems.frame.id,
    backgroundItemId: selectedItems.background.id,
    poseItemId: selectedItems.pose.id,
    selectedItems,
    palette: {
      primary: selectedItems.upper_body.preview.swatch,
      secondary: selectedItems.background.preview.swatch,
      trim: selectedItems.accessories.preview.swatch,
    },
    showcaseSlots: selectedItems.frame.entitlement === "premium" ? 4 : 1,
    fairnessNotice: "Cosmetic only - no competitive advantage.",
  } satisfies OperatorCardPresentation;

  assertNoCompetitiveOperatorFields(presentation);
  return presentation;
}

export function isDefaultOperatorLoadout(loadout: OperatorLoadout): boolean {
  const defaultLoadout = getDefaultOperatorLoadout();
  if (loadout.operatorId !== defaultLoadout.operatorId) return false;
  for (const slot of OPERATOR_COSMETIC_SLOTS) {
    if (loadout.selections[slot] !== defaultLoadout.selections[slot]) return false;
  }
  return true;
}

export function freeCompetitionParticipation() {
  return {
    competitions: true,
    publicStatistics: true,
    leaderboards: true,
    votingRights: true,
    progression: true,
    badgesAndTrophies: true,
    contracts: true,
  };
}

export function assertNoCompetitiveOperatorFields(value: unknown): void {
  const seen = new Set<unknown>();

  function visit(node: unknown, path: string) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if ((PROHIBITED_OPERATOR_COMPETITIVE_FIELDS as readonly string[]).includes(key)) {
        throw new Error(`Prohibited competitive operator field detected at ${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  }

  visit(value, "operator");
}

function cleanLoadoutId(value: string): string {
  const cleaned = value.trim();
  return cleaned && cleaned.length <= 80 ? cleaned : `preview-${DEFAULT_OPERATOR_LOADOUT_ID}`;
}

function cleanDisplayName(value: string): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned && cleaned.length <= 40 ? cleaned : "DZN Operator Loadout";
}

function cleanTimestamp(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : DEFAULT_OPERATOR_LOADOUT_UPDATED_AT;
}
