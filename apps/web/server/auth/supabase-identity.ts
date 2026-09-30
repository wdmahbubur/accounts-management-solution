import type { SupabaseClient } from "@supabase/supabase-js";
import { parseUuid } from "@ams/contracts";

import type { IdentityVerifier } from "./types";

export function createSupabaseIdentityVerifier(
  client: Pick<SupabaseClient, "auth">
): IdentityVerifier {
  return {
    async verifyIdentity() {
      const {
        data: { user },
        error
      } = await client.auth.getUser();

      if (error || !user) {
        return null;
      }

      // Deliberately ignore user_metadata/app-provided role claims here. Authorization
      // comes from live organization membership and capability rows.
      return { userId: parseUuid(user.id, "verified_user_id") };
    }
  };
}
