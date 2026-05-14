import { getCurrentLinkedServer, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockNitrado } from "../../_lib/mock";
import { runNitradoLogAccessDiagnostics, type NitradoLogAccessDiagnostics } from "../../_lib/nitrado";
import { getLatestNitradoToken } from "../../_lib/onboarding";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServer = await getCurrentLinkedServer(env, user.id, { includePrivateAdmPath: true });
  const serviceId = typeof linkedServer?.nitrado_service_id === "string" ? linkedServer.nitrado_service_id : null;
  if (!serviceId) return json({ error: "No linked Nitrado service found" }, { status: 400 });

  if (isMockNitrado(env.MOCK_NITRADO)) {
    return json({ diagnostics: mockDiagnostics(serviceId) });
  }

  const token = await getLatestNitradoToken(env, user.id);
  if (!token) return json({ error: "No Nitrado token found" }, { status: 400 });

  try {
    const diagnostics = await runNitradoLogAccessDiagnostics(token, serviceId);
    return json({ diagnostics });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Log access diagnostics failed" }, { status: 400 });
  }
};

function mockDiagnostics(serviceId: string): NitradoLogAccessDiagnostics {
  const newestAdmFileName = "DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM";
  return {
    serviceId,
    lastCheckedAt: new Date().toISOString(),
    gameserverUsernameFound: true,
    gameSpecificLogFilesFound: true,
    gameSpecificLogFilesReturned: 1,
    admFilesFromGameSpecific: 1,
    newestAdmFileName,
    testedPathVariants: [
      newestAdmFileName,
      `dayzps/config/${newestAdmFileName}`,
      `/games/{gameserver-username}/noftp/${newestAdmFileName}`,
    ],
    readable: {
      found: true,
      sourceLabel: "MOCK_NITRADO",
      method: "mock",
      lineCount: 14,
      routeRecommendation: "Mock mode only",
      message: "Mock ADM lines are readable through the parser sync path.",
    },
    attempts: [
      {
        label: "MOCK_NITRADO",
        method: "GET",
        requestUrlPathOnly: "/mock/nitrado/log-access",
        httpStatusCode: 200,
        status: "OK",
        responseContentType: "application/json",
        topLevelJsonKeys: ["data"],
        dataKeys: ["log_files"],
        arrayLengths: [{ path: "$.data.log_files", length: 1 }],
        containsLogLikeText: true,
        containsAdmFilenames: true,
        hasDownloadTokenFields: false,
        sampleFetchAttempted: true,
        sampleReadSucceeded: true,
        safeErrorMessage: null,
      },
    ],
  };
}
