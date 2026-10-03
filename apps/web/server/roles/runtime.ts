import { cookies } from "next/headers";
import { createClient } from "../../lib/database/server.ts";
import { createIdentityVerifier } from "../auth/identity-verifier.ts";
import { createMembershipResolver } from "../auth/membership-resolver.ts";
import { defaultRequestDependencies } from "../commands/request-context.ts";
import { readCompanyContext } from "../company-context.ts";

export async function roleRuntime() {
  const client = await createClient();
  return { client, current: readCompanyContext(await cookies()), dependencies: {
    ...defaultRequestDependencies, identityVerifier: createIdentityVerifier(client),
    membershipResolver: createMembershipResolver(client)
  } };
}
