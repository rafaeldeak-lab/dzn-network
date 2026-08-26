import type { Metadata } from "next";

import { DznStorePreviewPage } from "@/components/store/dzn-store-preview-page";

export const metadata: Metadata = {
  title: "DZN Store Preview",
  description: "Read-only DZN Store preview contract for guaranteed account-bound cosmetics with no competitive advantage.",
};

export default function StorePage() {
  return <DznStorePreviewPage />;
}
