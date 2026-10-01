import { cookies } from "next/headers";
import { createClient } from "../../lib/supabase/server.ts";
import { createSupabaseIdentityVerifier } from "../auth/supabase-identity.ts";
import { createSupabaseMembershipResolver } from "../auth/supabase-membership.ts";
import { defaultRequestDependencies } from "../commands/request-context.ts";
import { readCompanyContext } from "../company-context.ts";

export async function roleRuntime() {
  const client = await createClient();
  return { client, current: readCompanyContext(await cookies()), dependencies: {
    ...defaultRequestDependencies, identityVerifier: createSupabaseIdentityVerifier(client),
    membershipResolver: createSupabaseMembershipResolver(client)
  } };
}
