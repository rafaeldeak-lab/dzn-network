import { deleteOwnedAccountData, isDeletionRateLimited, releaseAccountDeletionOperation, reserveAccountDeletionOperation } from "../../_lib/deletion";
import { ensureMockUser, getSessionUser, SESSION_COOKIE } from "../../_lib/db";
import { clearCookie, json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type DeleteAccountBody = {
  confirmation_text?: string;
  final_confirmed?: boolean;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  if (env.DZN_ACCOUNT_DELETE_ENABLED === "false") {
    return json({ error: "Account closure is temporarily unavailable during protected maintenance." }, { status: 503 });
  }
  const accountDeletionOperation = await reserveAccountDeletionOperation(env, user.id);
  if (!accountDeletionOperation) return json({ error: "DZN is already closing this account. Retry shortly." }, { status: 409 });
  let deletionOperationHandedOff = false;
  try {
    if (isDeletionRateLimited(`account-delete:${user.id}`)) {
      return json({ error: "Too many deletion attempts. Wait a minute and try again." }, { status: 429 });
    }

    const body = await readJson<DeleteAccountBody>(request);
    if (body.final_confirmed !== true) return json({ error: "Final confirmation is required" }, { status: 400 });
    if (body.confirmation_text !== "DELETE MY DZN ACCOUNT") {
      return json({ error: "Confirmation text must be DELETE MY DZN ACCOUNT." }, { status: 400 });
    }

    deletionOperationHandedOff = true;
    const result = await deleteOwnedAccountData(env, user.id, accountDeletionOperation);
    if (!result.ok) return json({ ok: false, error: result.message }, { status: result.status });
    return json(
      {
        ok: true,
        deleted: result.deleted,
        redirectTarget: "/",
        message: "Your DZN account has been closed.",
      },
      {
        headers: {
          "set-cookie": clearCookie(SESSION_COOKIE),
        },
      },
    );
  } finally {
    if (!deletionOperationHandedOff) await releaseAccountDeletionOperation(env, user.id, accountDeletionOperation);
  }
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}
