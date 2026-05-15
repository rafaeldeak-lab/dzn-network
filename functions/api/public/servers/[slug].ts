import { redirect } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, params }) => {
  const slug = params.slug;
  const url = new URL(request.url);

  url.pathname = "/api/public/servers";
  url.search = "";
  if (slug) url.searchParams.set("slug", slug);

  return redirect(url.toString());
};
