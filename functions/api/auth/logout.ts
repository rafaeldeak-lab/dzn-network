import { clearCookie, json } from "../../_lib/http";
import { destroySession } from "../../_lib/db";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  await destroySession(env, request);
  return json(
    { ok: true, redirect: "/" },
    {
      headers: {
        "set-cookie": clearCookie("dzn_session"),
      },
    },
  );
};
