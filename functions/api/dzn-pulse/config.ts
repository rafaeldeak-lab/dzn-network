import { readDznFeatureFlags } from "../../_lib/feature-flags";
import { json } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = ({ env }) => {
  const flags = readDznFeatureFlags(env);
  return json({
    ok: true,
    dznPulseEnabled: flags.dznPulseEnabled,
    discordNotificationsEnabled: flags.discordNotificationsEnabled,
  }, {
    headers: {
      "cache-control": "private, no-store, no-cache, must-revalidate",
    },
  });
};
