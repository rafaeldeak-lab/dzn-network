import type { Metadata } from "next";
import Link from "next/link";
import { Check, X, Crown, Shield } from "lucide-react";
import { getSubscriptionPlanPublicContracts } from "../../lib/billing/plans";
import { PAYMENT_COPY, PAYMENT_FAQS } from "../../lib/billing/payment-copy";
import { PricingCheckout } from "../../components/onboarding/pricing-checkout";
import { DZN_PUBLIC_DISCORD_INVITE_URL } from "../../lib/public-discord";
import { DZN_SUPPORT_EMAIL, DZN_SUPPORT_EMAIL_HREF } from "../../lib/support";

export const metadata: Metadata = {
  title: "DZN Pricing | Starter and Pro owner plans",
  description: `${PAYMENT_COPY.player} ${PAYMENT_COPY.starterOffer}. Pro: ${PAYMENT_COPY.proPrice}, no trial. Payment method required; monthly renewal until cancelled.`,
  alternates: { canonical: "/pricing" },
};

const plans = getSubscriptionPlanPublicContracts();
const rows = [
  { label: "Linked DayZ servers", values: plans.map(p => String(p.linkedServerAllowance)) },
  { label: "Public server profile", values: ["Included", "Included"] },
  { label: "Profile description", values: plans.map(p => `${p.descriptionCharacterLimit.toLocaleString("en-GB")} characters`) },
  { label: "Custom banner", values: [null, "Included"] },
  { label: "Gallery", values: [null, "Up to 4 JPEG images"] },
  { label: "Owner announcements", values: [null, "Included"] },
  { label: "Organic bump cooldown", values: plans.map(p => `${p.organicBumpCooldownDays} days`) },
  { label: "Public advert publication", values: plans.map(p => p.publicPublishingLabel) },
  { label: "Promotion credits", values: [null, "2 per billing period"] },
  { label: "Featured and spotlight rotation", values: [null, "Eligible, not guaranteed"] },
  { label: "Earned badge showcase", values: plans.map(p => `Up to ${p.badgeShowcaseLimit} earned badges`) },
  { label: "Paid competitive advantage", values: [null, null] },
];

export default function PricingPage() {
  return <main className="min-h-screen bg-[#05070d] px-4 py-8 text-white sm:px-6 sm:py-12">
    <div className="mx-auto max-w-6xl">
      <header className="border-b border-white/15 pb-6">
        <p className="text-xs font-bold uppercase text-cyan-200">DZN Network</p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">Starter and Pro owner plans</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-300">{PAYMENT_COPY.player}</p>
        <Link href="/player" className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-cyan-200 underline underline-offset-4">Open free Player Hub</Link>
      </header>
      <section aria-label="Owner subscriptions" className="grid gap-5 py-8 md:grid-cols-2">
        {plans.map(plan => <article key={plan.key} className={`flex min-w-0 flex-col rounded-lg border p-5 sm:p-7 ${plan.key === "pro" ? "border-amber-300/50 bg-[#101018]" : "border-cyan-200/30 bg-[#0b1119]"}`}>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-2xl font-black uppercase">{plan.name}</h2><p className="mt-2 text-3xl font-black">{plan.key === "starter" ? PAYMENT_COPY.starterPrice : PAYMENT_COPY.proPrice}</p></div>
            {plan.key === "pro" ? <Crown aria-hidden="true" className="h-8 w-8 shrink-0 text-amber-200" /> : <Shield aria-hidden="true" className="h-8 w-8 shrink-0 text-cyan-200" />}
          </div>
          <p className="mt-4 text-sm font-bold text-cyan-100">{plan.key === "starter" ? PAYMENT_COPY.starterOffer : "Paid owner subscription. No free trial."}</p>
          <p className="mt-3 text-sm leading-6 text-zinc-300">{plan.key === "starter" ? PAYMENT_COPY.starterTerms : PAYMENT_COPY.proTerms}</p>
          <ul className="my-6 space-y-3 text-sm leading-6">
            {[`${plan.linkedServerAllowance === 1 ? "1" : "Up to 3"} linked DayZ servers`, ...plan.profileBenefits,
              plan.publicPublishingLabel, `One organic bump every ${plan.organicBumpCooldownDays} days`,
              ...(plan.key === "pro" ? ["Owner announcements", "More Discord post types", "2 promotion credits per billing period", "Up to 8 earned badges in your showcase"] : [])].map(feature =>
              <li key={feature} className="flex items-start gap-3"><Check aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-green-400" /><span>{feature}</span></li>)}
          </ul>
          <div className="mt-auto"><PricingCheckout planKey={plan.key} /></div>
        </article>)}
      </section>
      <p className="border-y border-white/15 py-5 text-sm leading-6 text-zinc-300">{PAYMENT_COPY.consent} {PAYMENT_COPY.returningStarter}</p>
      <section aria-labelledby="comparison-title" className="py-8">
        <h2 id="comparison-title" className="mb-4 text-xl font-black">Compare owner tools</h2>
        <table className="w-full table-fixed border-collapse text-left text-xs leading-5 sm:text-sm">
          <thead><tr className="border-b border-white/20"><th scope="col" className="w-[36%] px-2 py-3">Feature</th><th scope="col" className="px-2 py-3 text-cyan-100">Starter</th><th scope="col" className="px-2 py-3 text-amber-200">Pro</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.label} className="border-b border-white/10"><th scope="row" className="break-words px-2 py-4 font-semibold">{row.label}</th>{row.values.map((value, index) => <td key={index} className="break-words px-2 py-4 align-top"><div className="flex flex-col items-start gap-2 sm:flex-row">{value ? <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-green-400" /> : <X aria-hidden="true" className="h-5 w-5 shrink-0 text-red-400" />}<span>{value ?? "Not included"}</span></div></td>)}</tr>)}</tbody>
        </table>
      </section>
      <section aria-labelledby="billing-answers" className="border-t border-white/15 py-8">
        <h2 id="billing-answers" className="text-xl font-black">Payment and trial questions</h2>
        <div className="mt-4 divide-y divide-white/15">{PAYMENT_FAQS.map(faq => <details key={faq.question} className="py-4"><summary className="cursor-pointer text-sm font-bold">{faq.question}</summary><p className="mt-3 max-w-4xl text-sm leading-6 text-zinc-300">{faq.answer}</p></details>)}</div>
        <p className="mt-5 text-sm leading-6 text-zinc-400">Review the amount, currency and billing schedule shown in Stripe before agreeing to pay. For a private billing problem, email DZN support. Do not post card details or invoices in public channels.</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3 text-sm font-bold text-cyan-200">
          <a href={DZN_SUPPORT_EMAIL_HREF} className="inline-flex min-h-11 items-center underline underline-offset-4">Email {DZN_SUPPORT_EMAIL}</a>
          <a href={DZN_PUBLIC_DISCORD_INVITE_URL} className="inline-flex min-h-11 items-center underline underline-offset-4">DZN community Discord</a>
          <Link href="/terms" className="inline-flex min-h-11 items-center underline underline-offset-4">Terms</Link>
          <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4">Privacy</Link>
          <Link href="/refunds" className="inline-flex min-h-11 items-center underline underline-offset-4">Cancellations and refunds</Link>
        </div>
      </section>
    </div>
  </main>;
}
