import { isManagedPagesPreviewHost } from "../functions/_middleware";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

expect(isManagedPagesPreviewHost("codex-checkout-sandbox-20261.dzn-network.pages.dev"), "Branch-preview hosts must be detected.");
expect(isManagedPagesPreviewHost("QA.DZN-NETWORK.PAGES.DEV."), "Preview-host detection must be case-insensitive.");
expect(!isManagedPagesPreviewHost("dzn-network.pages.dev"), "The canonical Pages host must remain available.");
expect(!isManagedPagesPreviewHost("dzn-network-checkout-sandbox.pages.dev"), "The separate checkout sandbox host must remain available.");
expect(!isManagedPagesPreviewHost("dayz-network.com"), "The public custom domain must remain available.");

console.log("Pages branch-preview host guard checks passed.");
