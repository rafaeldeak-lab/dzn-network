import type { Metadata } from "next";

import { DznStoreAccountPurchasesPage } from "@/components/store/dzn-store-account-purchases-page";

export const metadata: Metadata = {
  title: "DZN Account Purchases",
  description: "Private read-only DZN Store purchase and entitlement status for the signed-in account.",
};

export default function AccountPurchasesPage() {
  return <DznStoreAccountPurchasesPage />;
}
