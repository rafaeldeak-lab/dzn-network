import { OwnerDiscordAccessPage } from "@/components/owner/owner-discord-access-page";
import { notFound } from "next/navigation";

export default function OwnerDiscordAccessRoute() {
  if (process.env.DZN_OWNER_DISCORD_ACCESS_ENABLED !== "true") notFound();
  return <OwnerDiscordAccessPage />;
}
