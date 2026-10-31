import type { Metadata } from "next";
import { ServerVaultPage } from "@/components/vault/server-vault-page";

export const metadata: Metadata = {
  title: "Server Vault | DZN Network",
  description: "Manage your server collection and choose the public showcase for your community.",
  robots: { index: false, follow: false },
};

export default function ServerVaultRoute() { return <ServerVaultPage />; }
