import { readDznFeatureFlags } from "../../_lib/feature-flags";
import { json } from "../../_lib/http";
import { hasPrivateRequestSignal, privateNoStoreHeaders, publicCacheHeaders } from "../../_lib/performance";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = ({ env, request }) => {
  const flags = readDznFeatureFlags(env);
  return json({
    ok: true,
    dznPulseEnabled: flags.dznPulseEnabled,
    discordNotificationsEnabled: flags.discordNotificationsEnabled,
  }, {
    headers: hasPrivateRequestSignal(request)
      ? privateNoStoreHeaders()
      : publicCacheHeaders({ maxAge: 120, staleWhileRevalidate: 600 }),
  });
};
