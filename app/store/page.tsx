import type { Metadata } from "next";

import { Storefront } from "@/components/store/storefront";

export const metadata: Metadata = {
  title: "DZN Store | Reward collections, cosmetics, and fair competition",
  description: "Explore DZN server awards, Pro visual presentation unlocks, and account-bound cosmetics. Store purchases never affect competitive results.",
  alternates: { canonical: "/store" },
};

export default function StorePage() {
  return <Storefront />;
}
