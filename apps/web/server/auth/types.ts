import type { OrganizationId, Uuid } from "@ams/contracts";

export interface VerifiedIdentity {
  userId: Uuid;
}

export interface ActiveMembership {
  memberId: Uuid;
  organizationId: OrganizationId;
  capabilities: readonly string[];
}

export interface IdentityVerifier {
  verifyIdentity(): Promise<VerifiedIdentity | null>;
}

export interface MembershipResolver {
  resolveActiveMembership(input: {
    userId: Uuid;
    organizationId: OrganizationId;
  }): Promise<ActiveMembership | null>;
}

export interface ActorContext {
  userId: Uuid;
  memberId: Uuid;
  organizationId: OrganizationId;
  capabilities: readonly string[];
}
