import type { Metadata } from "next";

import { Storefront } from "@/components/store/storefront";

export const metadata: Metadata = {
  title: "DZN Store | Account-bound cosmetics and supporter items",
  description: "Browse DZN supporter items and account-bound cosmetics. Store purchases never affect competitive results.",
  alternates: { canonical: "/store" },
};

export default function StorePage() {
  return <Storefront />;
}
