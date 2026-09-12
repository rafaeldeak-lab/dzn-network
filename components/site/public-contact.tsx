import { DZN_PUBLIC_CONTACT, DZN_SUPPORT_EMAIL, DZN_SUPPORT_EMAIL_HREF } from "@/lib/support";

export function PublicContact() {
  return (
    <section aria-label="DZN Network contact" className="border-t border-white/15 py-6 text-sm leading-6 text-zinc-300">
      <h2 className="text-lg font-black text-white">Contact DZN Network</h2>
      <address className="mt-3 not-italic">
        <p className="font-bold text-white">{DZN_PUBLIC_CONTACT.name}</p>
        <p className="mt-2 text-zinc-400">Business correspondence address</p>
        {DZN_PUBLIC_CONTACT.addressLines.map((line) => <p key={line}>{line}</p>)}
        <a href={DZN_SUPPORT_EMAIL_HREF} className="mt-2 inline-flex min-h-11 max-w-full items-center break-all font-bold text-cyan-200 underline underline-offset-4">{DZN_SUPPORT_EMAIL}</a>
      </address>
    </section>
  );
}
