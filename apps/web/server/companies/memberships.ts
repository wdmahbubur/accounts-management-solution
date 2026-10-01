import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOrganizationId, parseUuid } from "@ams/contracts";

export interface ActiveCompanyMembership {
  memberId: string;
  organizationId: string;
  organizationName: string;
  legalName: string;
  organizationStatus: string;
  roleNames: readonly string[];
}

type MembershipListRow = {
  member_id: string;
  organization_id: string;
  organization_name: string;
  legal_name: string;
  organization_status: string;
  role_names: unknown;
};

export async function listActiveMemberships(
  client: Pick<SupabaseClient, "rpc">
): Promise<ActiveCompanyMembership[]> {
  const { data, error } = await client.rpc("list_active_memberships");

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data.map((value) => {
    const row = value as MembershipListRow;
    return {
      memberId: parseUuid(row.member_id, "member_id"),
      organizationId: parseOrganizationId(row.organization_id),
      organizationName: row.organization_name,
      legalName: row.legal_name,
      organizationStatus: row.organization_status,
      roleNames: Array.isArray(row.role_names)
        ? row.role_names.filter(
            (role): role is string => typeof role === "string"
          )
        : []
    };
  });
}
