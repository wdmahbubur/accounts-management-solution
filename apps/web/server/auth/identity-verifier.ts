import { parseUuid } from "@ams/contracts";

import type { RequestClient } from "../request-client.ts";
import type { IdentityVerifier } from "./types.ts";

export function createIdentityVerifier(client: Pick<RequestClient, "auth">): IdentityVerifier {
  return {
    async verifyIdentity() {
      const { data: { user }, error } = await client.auth.getUser();
      if (error || !user) return null;
      return { userId: parseUuid(user.id, "verified_user_id") };
    }
  };
}
