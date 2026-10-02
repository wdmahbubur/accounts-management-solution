import { parseOrganizationId, parseUuid } from "@ams/contracts";

import type { RequestClient } from "../request-client.ts";
import type { MembershipResolver } from "./types.ts";

type MembershipRow = {
  member_id: string;
  organization_id: string;
  capabilities: unknown;
};

export function createMembershipResolver(client: Pick<RequestClient, "rpc">): MembershipResolver {
  return {
    async resolveActiveMembership({ organizationId }) {
      const { data, error } = await client.rpc("resolve_active_membership", {
        p_organization_id: organizationId
      });
      if (error || !Array.isArray(data) || data.length !== 1) return null;
      const row = data[0] as MembershipRow;
      const capabilities = Array.isArray(row.capabilities)
        ? row.capabilities.filter((value): value is string => typeof value === "string")
        : [];
      return {
        memberId: parseUuid(row.member_id, "member_id"),
        organizationId: parseOrganizationId(row.organization_id),
        capabilities
      };
    }
  };
}
