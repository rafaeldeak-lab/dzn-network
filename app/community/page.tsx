import type { Metadata } from "next";

import { DznCommsShell } from "@/components/comms/dzn-comms-shell";

export const metadata: Metadata = {
  title: "DZN Comms | DZN Network",
  description:
    "Open moderated DZN Global Chat, browse official DZN updates, and use DZN Assist for trusted website, player and server guidance.",
  alternates: { canonical: "/community" },
  openGraph: {
    title: "DZN Comms | DZN Network",
    description:
      "Join moderated DZN Global Chat, follow official DZN updates, and find trusted player and server guidance.",
    url: "/community",
    siteName: "DZN Network",
    type: "website",
  },
};

export default function CommunityPage() {
  return <DznCommsShell />;
}
