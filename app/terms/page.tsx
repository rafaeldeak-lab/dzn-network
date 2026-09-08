import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/components/site/policy-page";
import { getPublicLegalSellerDisclosure } from "@/lib/legal-seller";
import { DZN_SUPPORT_EMAIL, DZN_SUPPORT_EMAIL_HREF } from "@/lib/support";

export const metadata: Metadata = {
  title: "Terms of Service | DZN Network",
  description: "Terms for DZN Network player access and Starter and Pro server-owner subscriptions.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  const seller = getPublicLegalSellerDisclosure({
    DZN_PUBLIC_LEGAL_SELLER_NAME: process.env.DZN_PUBLIC_LEGAL_SELLER_NAME,
    DZN_PUBLIC_LEGAL_CONTACT_ADDRESS: process.env.DZN_PUBLIC_LEGAL_CONTACT_ADDRESS,
  });

  return (
    <PolicyPage eyebrow="DZN Network policies" title="Terms of Service" updated="7 September 2026">
      <PolicySection title="About DZN">
        <p>DZN Network is a UK-operated online platform for DayZ players, communities, and server owners. These terms apply when you use the website, connect an account or server, or buy a DZN owner subscription.</p>
        <p>Player access, including Discord sign-in, Player Hub, and personal profiles, is free. Starter and Pro are optional subscriptions for server-owner tools and presentation features.</p>
      </PolicySection>

      <PolicySection title="Seller details">
        {seller.complete ? (
          <>
            <p><strong className="text-white">Legal seller:</strong> {seller.legalSellerName}, trading as DZN Network.</p>
            <address className="not-italic">
              <strong className="text-white">Business correspondence address:</strong><br />
              {seller.contactAddressLines.map((line) => <span key={line}>{line}<br /></span>)}
            </address>
          </>
        ) : (
          <p>Live subscription checkout remains unavailable while DZN confirms and publishes the legal seller and business correspondence address. Viewing this page, signing in, or choosing a plan does not start a trial or take payment.</p>
        )}
      </PolicySection>

      <PolicySection title="Owner subscriptions">
        <p><strong className="text-white">Starter:</strong> eligible accounts pay GBP 0 for a two-day trial, then GBP 2 per month until cancelled. A payment method is required. The trial starts only after the account owner completes Stripe Checkout and DZN verifies the subscription. Starter trial eligibility is limited and a previous trial is not repeated.</p>
        <p><strong className="text-white">Pro:</strong> GBP 10 is due when the account owner confirms payment in Stripe. Pro has no free trial and renews at GBP 10 per month until cancelled.</p>
        <p>Stripe shows the exact plan, currency, amount, billing schedule, and any applicable tax before confirmation. Prices and completed orders are not changed retrospectively. Opening a DZN page, returning from Stripe, or seeing a success message does not itself create paid access.</p>
      </PolicySection>

      <PolicySection title="Renewal and cancellation">
        <p>Subscriptions renew monthly until cancelled. The account owner can open <strong className="text-white">Dashboard &gt; Billing &amp; Plan &gt; Manage Billing</strong> to review the subscription, update a payment method, or turn off renewal through Stripe.</p>
        <p>Cancel Starter before the trial deadline shown by Stripe to avoid the first GBP 2 payment. A scheduled cancellation normally leaves access available until the end of the current trial or paid billing period. Contact DZN support if the self-service portal is unavailable or an immediate account review is needed.</p>
      </PolicySection>

      <PolicySection title="Access and payment status">
        <p>DZN grants subscription access only from verified Stripe payment and subscription events. Failed, reversed, disputed, unpaid, expired, or cancelled payment states may restrict owner tools. DZN never stores full card details.</p>
        <p>Plans do not buy XP, rank, review score, event results, badges, season wins, Server Wars or CTF scoring, calling-card awards, or competitive eligibility.</p>
      </PolicySection>

      <PolicySection title="Acceptable use">
        <p>You must use an account you are authorised to control, provide accurate setup information, and avoid abuse, fraud, harassment, unauthorised access, service disruption, or attempts to manipulate stats and competition systems. DZN may restrict or remove access needed to protect users, the service, or comply with law.</p>
      </PolicySection>

      <PolicySection title="Service changes and availability">
        <p>DZN is an actively developed service. Features may change, be corrected, or be temporarily unavailable for maintenance, security, provider outages, or safety. We will not use a feature change to alter a completed billing period retrospectively.</p>
      </PolicySection>

      <PolicySection title="Consumer rights and liability">
        <p>Nothing in these terms excludes or limits rights or remedies that cannot lawfully be excluded, including applicable consumer cancellation and refund rights. The separate cancellations and refunds policy explains how to request help.</p>
        <p>To the extent permitted by law, DZN is not responsible for losses caused by third-party DayZ, Discord, Nitrado, Stripe, hosting, or network services outside DZN&apos;s reasonable control.</p>
      </PolicySection>

      <PolicySection title="Contact and governing law">
        <p>Questions, cancellation problems, and billing disputes can be sent to <a className="font-bold text-cyan-200 underline underline-offset-4" href={DZN_SUPPORT_EMAIL_HREF}>{DZN_SUPPORT_EMAIL}</a>. Do not send card details, passwords, tokens, or invoices in public channels.</p>
        <p>These terms are governed by the laws of England and Wales, without limiting any mandatory rights that apply where you live.</p>
      </PolicySection>
    </PolicyPage>
  );
}
