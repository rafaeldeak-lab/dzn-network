import { normalizePlanKey } from "./billing/plans";
import { resolveDznMapConfig } from "../functions/_lib/map-configs";

// Display labels only; stored plan keys and entitlement decisions stay unchanged.
export function showcasePlanLabel(value: unknown) {
  const plan = normalizePlanKey(value);
  return plan === "free" ? "Standard" : plan === "starter" ? "Starter" : "Pro";
}

export function publicListingPlanLabel(source: unknown) {
  return source === "complimentary_showcase" ? "Pro Listing (complimentary)" : "Pro Listing";
}

export function publicVisibilityTierLabel(tier: unknown, source: unknown) {
  if (tier === "premium") return source === "complimentary_showcase" ? publicListingPlanLabel(source) : "Pro";
  return tier === "enhanced" ? "Enhanced" : "Standard";
}

export function formatPublicVisibilitySummary(value: string | null | undefined, source: unknown) {
  if (!value) return null;
  return value.replace(/\b(?:Premium|Pro)\b/g, source === "complimentary_showcase" ? "Pro (complimentary)" : "Pro");
}

export function publicMapLabel(value: unknown) {
  const map = resolveDznMapConfig(value);
  if (map) return map.key === "chernarusplus" ? "Chernarus" : map.displayName;
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/^dayzoffline\./i, "").replaceAll("_", " ")
    : "Map not specified";
}

export function explorationPreviewCells(cells: { cellX: number; cellY: number; visits: number }[], gridSize: number) {
  if (!Number.isInteger(gridSize) || gridSize < 1 || gridSize > 512) return [];
  return cells.filter(cell => Number.isInteger(cell.cellX) && Number.isInteger(cell.cellY)
    && cell.cellX >= 0 && cell.cellX < gridSize && cell.cellY >= 0 && cell.cellY < gridSize)
    .slice(0, 120).map(cell => ({
      key: `${cell.cellX}:${cell.cellY}`,
      left: (cell.cellX + 0.5) / gridSize * 100,
      top: (cell.cellY + 0.5) / gridSize * 100,
      alpha: Number.isFinite(cell.visits) ? Math.min(0.9, Math.max(0.3, cell.visits / 12)) : 0.3,
    }));
}
