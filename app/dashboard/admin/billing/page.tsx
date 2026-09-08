import type { Metadata } from "next";
import { BillingProviderCheck } from "@/components/billing/billing-provider-check";

export const metadata: Metadata = { title: "Billing checks | DZN Network", robots: { index: false, follow: false } };

export default function AdminBillingPage() {
  return <BillingProviderCheck />;
}
