import type { Metadata } from "next";

import { DznCommsShell } from "@/components/comms/dzn-comms-shell";

export const metadata: Metadata = {
  title: "DZN Comms | DZN Network",
  description:
    "A read-only DZN Comms preview for global player chat and future support surfaces, kept disabled from live sending and AI runtime.",
};

export default function CommunityPage() {
  return <DznCommsShell />;
}
