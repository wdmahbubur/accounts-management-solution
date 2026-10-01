import { settingsGet, settingsPatch } from "../../../../../../server/settings/http.ts";
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(_request: Request, context: Context) { return settingsGet((await context.params).organizationId); }
export async function PATCH(request: Request, context: Context) { return settingsPatch(request, (await context.params).organizationId); }
