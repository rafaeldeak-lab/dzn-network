import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/components/site/policy-page";
import { DZN_SUPPORT_EMAIL, DZN_SUPPORT_EMAIL_HREF } from "@/lib/support";

export const metadata: Metadata = {
  title: "Privacy Policy | DZN Network",
  description: "How DZN Network handles account, server, gameplay, profile, community, and billing information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PolicyPage eyebrow="DZN Network policies" title="Privacy Policy" updated="7 September 2026">
      <PolicySection title="Who is responsible for your data">
        <p>DZN Network is responsible for the personal data used to operate this website and its DZN services. Privacy questions and rights requests can be sent to <a className="font-bold text-cyan-200 underline underline-offset-4" href={DZN_SUPPORT_EMAIL_HREF}>{DZN_SUPPORT_EMAIL}</a>.</p>
      </PolicySection>

      <PolicySection title="Information DZN handles">
        <p>DZN may handle Discord account identifiers and profile details used for sign-in, relevant Discord community membership data, linked-server and Nitrado service information, imported DayZ ADM gameplay facts, server and player statistics, reviews, reports, notifications, profile preferences, and records needed to secure and support the service.</p>
        <p>For paid owner plans, Stripe handles payment-card information. DZN receives limited customer, Checkout, subscription, invoice, payment-status, and webhook identifiers needed to verify access, prevent duplicate fulfilment, support recovery, and keep an audit trail. DZN does not store full card numbers or card security codes.</p>
        <p>Cloudflare and DZN may process technical request information such as IP address, browser details, timestamps, and security signals to deliver and protect the service.</p>
      </PolicySection>

      <PolicySection title="How information is used">
        <p>Information is used to authenticate accounts, connect authorised servers, import and display stats, operate private and public profile choices, provide community features, prevent fraud and abuse, deliver account notices, provide support, fulfil owner subscriptions, and comply with legal obligations.</p>
        <p>Subscription status does not alter competitive formulas, player rank, scoring, reviews, XP, badges, awards, Server Wars, CTF outcomes, or competitive eligibility.</p>
      </PolicySection>

      <PolicySection title="Public and private information">
        <p>Public server pages and leaderboards can display server and gameplay information. A player public profile is shown only through the saved publishing and section-visibility controls. Private account identifiers, raw award evidence, payment details, and owner-only setup information are not part of the public profile contract.</p>
      </PolicySection>

      <PolicySection title="Service providers">
        <p>DZN uses service providers needed to run the platform, including Cloudflare for hosting and security, Discord for sign-in and community connections, Nitrado for authorised server connections, and Stripe for payments and billing. Each provider also processes information under its own terms and privacy policy.</p>
      </PolicySection>

      <PolicySection title="Cookies and similar storage">
        <p>DZN uses essential cookies and related browser storage where needed for sign-in, session security, request protection, and user-requested interface state. DZN does not sell personal data. Any future non-essential analytics or advertising use must be introduced with an appropriate notice and consent control.</p>
      </PolicySection>

      <PolicySection title="Retention and security">
        <p>DZN keeps information only for as long as reasonably needed for the service, account security, dispute handling, fraud prevention, billing and tax records, legal obligations, and the purposes described here. Account deletion removes data covered by DZN&apos;s deletion flow, but limited billing, payment, security, or legal records may need to be retained.</p>
        <p>DZN applies access controls, private no-store responses, signed provider messages, encrypted or secret-bound credentials, and audit records where appropriate. No online service can guarantee absolute security.</p>
      </PolicySection>

      <PolicySection title="Your choices and rights">
        <p>You can manage public-profile visibility in Player Profile settings, manage a paid subscription through Stripe, and request access, correction, deletion, restriction, objection, or portability where applicable. DZN may need to verify the account before completing a request.</p>
        <p>You may also have the right to complain to the UK Information Commissioner&apos;s Office or another competent data-protection authority.</p>
      </PolicySection>

      <PolicySection title="Changes">
        <p>This policy may be updated when DZN features, providers, or legal obligations change. Material changes will be presented through the website or another appropriate account notice.</p>
      </PolicySection>
    </PolicyPage>
  );
}
