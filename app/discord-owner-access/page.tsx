import { OwnerDiscordAccessPage } from "@/components/discord/owner-discord-access-page";
import { notFound } from "next/navigation";

export default function DiscordOwnerAccessRoute() {
  if (process.env.DZN_OWNER_DISCORD_ACCESS_ENABLED !== "true") notFound();
  return <OwnerDiscordAccessPage />;
}
