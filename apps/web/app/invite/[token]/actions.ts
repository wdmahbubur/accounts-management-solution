"use server";
import type { ApiResult } from "@ams/contracts";
import { createClient } from "../../../lib/supabase/server.ts";
import { commandErrorBody, normalizeCommandError, CommandError } from "../../../server/commands/errors.ts";
import { generateRequestId } from "../../../server/commands/request-context.ts";
import type { RecipientReceipt } from "../../../server/invitations/contracts.ts";
import { respondToInvitation } from "../../../server/invitations/service.ts";
export async function respondInvitationAction(_previous: ApiResult<RecipientReceipt> | null, form: FormData): Promise<ApiResult<RecipientReceipt>> {
  try {
    if (form.get("decision") === "accept" && form.get("confirmed") !== "yes") throw CommandError.validation({ confirmed: "Confirm the proposed company and role." });
    const data = await respondToInvitation(await createClient(), { token: form.get("token"), decision: form.get("decision") });
    return { data, meta: { request_id: generateRequestId(), replayed: false } };
  } catch (error) { return commandErrorBody(normalizeCommandError(error), generateRequestId()); }
}
