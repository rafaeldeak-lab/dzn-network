import { handleSurvivalCommand } from "../../_lib/survival-command";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = ({ request, env }) => handleSurvivalCommand(request, env);
