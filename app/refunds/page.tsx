import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/components/site/policy-page";
import { DZN_SUPPORT_EMAIL, DZN_SUPPORT_EMAIL_HREF } from "@/lib/support";

export const metadata: Metadata = {
  title: "Cancellations and Refunds | DZN Network",
  description: "How to cancel a DZN Starter or Pro subscription and request billing support or a refund review.",
  alternates: { canonical: "/refunds" },
};

export default function RefundsPage() {
  return (
    <PolicyPage eyebrow="DZN Network policies" title="Cancellations and Refunds" updated="7 September 2026">
      <PolicySection title="Cancel a subscription">
        <p>Open <strong className="text-white">Dashboard &gt; Billing &amp; Plan &gt; Manage Billing</strong> and use Stripe&apos;s customer portal to turn off renewal. You can do this at any time.</p>
        <p>For an eligible Starter trial, cancel before the trial deadline shown by Stripe to avoid the first GBP 2 payment. Pro has no trial and its first GBP 10 payment is due when you confirm Checkout. Both plans otherwise renew monthly.</p>
      </PolicySection>

      <PolicySection title="When cancellation takes effect">
        <p>Turning off renewal normally keeps the subscription available until the end of its current trial or paid billing period, then prevents the next scheduled renewal. Cancellation does not automatically refund a payment already completed.</p>
        <p>If Manage Billing is unavailable, contact DZN support before the next renewal and include the email address used for the DZN account. Do not send card details or passwords.</p>
      </PolicySection>

      <PolicySection title="Refund requests and billing errors">
        <p>Refund requests are reviewed individually under these terms and applicable law. DZN will correct confirmed duplicate charges or billing errors and will provide a refund where required by law. This policy does not limit statutory consumer rights.</p>
        <p>For an unauthorised payment, duplicate charge, service failure, or other billing problem, contact <a className="font-bold text-cyan-200 underline underline-offset-4" href={DZN_SUPPORT_EMAIL_HREF}>{DZN_SUPPORT_EMAIL}</a> promptly with the DZN account email, date, amount, and a short description. Do not include full card details.</p>
        <p>Approved refunds are returned through Stripe to the original payment method. Bank processing times are outside DZN&apos;s control.</p>
      </PolicySection>

      <PolicySection title="Failed payments, disputes, and access">
        <p>A failed payment does not start a new trial or grant paid access. DZN may restrict paid owner tools until Stripe confirms recovery. A refund, reversal, or chargeback may end the related paid entitlement; free player access and fair competition results remain separate.</p>
      </PolicySection>
    </PolicyPage>
  );
}
