import { DEMO_OPERATOR_STATE } from "./demo-data";
import { createOperatorEngagementState, normalizeOperatorEngagementState } from "./progress";
import type { OperatorEngagementState } from "./types";

export const DZN_OPERATORS_ENGAGEMENT_DEMO_STORAGE_KEY = "dzn:operators:engagement:demo:v1";

export function parseOperatorEngagementPreviewStorage(value: string | null): OperatorEngagementState {
  if (!value) return createOperatorEngagementState(DEMO_OPERATOR_STATE);
  try {
    const parsed = JSON.parse(value) as OperatorEngagementState;
    if (parsed.version !== 1 || parsed.note !== "preview_only_non_authoritative") {
      return createOperatorEngagementState(DEMO_OPERATOR_STATE);
    }
    return normalizeOperatorEngagementState(parsed);
  } catch {
    return createOperatorEngagementState(DEMO_OPERATOR_STATE);
  }
}

export function loadOperatorEngagementPreviewStorage(storage: Storage | null, demoMode: boolean): OperatorEngagementState {
  if (!demoMode || !storage) return createOperatorEngagementState(DEMO_OPERATOR_STATE);
  try {
    return parseOperatorEngagementPreviewStorage(storage.getItem(DZN_OPERATORS_ENGAGEMENT_DEMO_STORAGE_KEY));
  } catch {
    return createOperatorEngagementState(DEMO_OPERATOR_STATE);
  }
}

export function saveOperatorEngagementPreviewStorage(storage: Storage | null, demoMode: boolean, state: OperatorEngagementState): boolean {
  if (!demoMode || !storage) return false;
  try {
    const payload = JSON.stringify(normalizeOperatorEngagementState(state));
    if (payload.length > 32_000) return false;
    storage.setItem(DZN_OPERATORS_ENGAGEMENT_DEMO_STORAGE_KEY, payload);
    return true;
  } catch {
    return false;
  }
}

export function clearOperatorEngagementPreviewStorage(storage: Storage | null, demoMode: boolean): boolean {
  if (!demoMode || !storage) return false;
  try {
    storage.removeItem(DZN_OPERATORS_ENGAGEMENT_DEMO_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
