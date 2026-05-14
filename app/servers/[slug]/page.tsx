import { PublicNetwork } from "@/components/network/public-network";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ slug: "preview" }];
}

export default function ServerProfilePage() {
  return <PublicNetwork />;
}
