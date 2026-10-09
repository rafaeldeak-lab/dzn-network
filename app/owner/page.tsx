import { OwnerConsole } from "@/components/owner/owner-console";

export default function OwnerPage() {
  return <OwnerConsole ownerDiscordAccessEnabled={process.env.DZN_OWNER_DISCORD_ACCESS_ENABLED === "true"} />;
}
