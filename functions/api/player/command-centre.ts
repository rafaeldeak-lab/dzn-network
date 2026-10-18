import { handleCommandCentre } from "../../_lib/command-centre";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleCommandCentre(request, env);
