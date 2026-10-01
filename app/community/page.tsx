import type { Metadata } from "next";

import { DznCommsShell } from "@/components/comms/dzn-comms-shell";

export const metadata: Metadata = {
  title: "DZN Comms | DZN Network",
  description:
    "Preview moderated DZN Global Chat and check the current availability of DZN Assist.",
};

export default function CommunityPage() {
  return <DznCommsShell />;
}
