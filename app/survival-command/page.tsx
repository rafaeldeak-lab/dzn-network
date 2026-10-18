import type { Metadata } from "next";
import { SurvivalCommand } from "../../components/survival-command/survival-command";

export const metadata: Metadata = {
  title: "Survival Command | DZN Network",
  description: "Private DZN sector operations with server-backed expedition decisions.",
  robots: { index: false, follow: true },
};

export default function SurvivalCommandPage() {
  return <SurvivalCommand />;
}
