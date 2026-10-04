import type { Metadata } from "next";

import { DznCommsShell } from "@/components/comms/dzn-comms-shell";

export const metadata: Metadata = {
  title: "DZN Comms | DZN Network",
  description:
    "Open moderated DZN Global Chat and use DZN Assist for trusted website, player and server guidance.",
};

export default function CommunityPage() {
  return <DznCommsShell />;
}
