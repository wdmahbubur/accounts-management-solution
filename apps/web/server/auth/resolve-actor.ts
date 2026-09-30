import type { OrganizationId } from "@ams/contracts";

import { CommandError } from "../commands/errors";
import type {
  ActorContext,
  IdentityVerifier,
  MembershipResolver
} from "./types";

export async function resolveActorContext(
  organizationId: OrganizationId,
  dependencies: {
    identityVerifier: IdentityVerifier;
    membershipResolver: MembershipResolver;
  }
): Promise<ActorContext> {
  const identity = await dependencies.identityVerifier.verifyIdentity();

  if (!identity) {
    throw CommandError.unauthenticated();
  }

  const membership = await dependencies.membershipResolver.resolveActiveMembership({
    userId: identity.userId,
    organizationId
  });

  if (!membership || membership.organizationId !== organizationId) {
    // Mask inaccessible organizations as NOT_FOUND to avoid membership disclosure.
    throw CommandError.notFound();
  }

  return {
    userId: identity.userId,
    memberId: membership.memberId,
    organizationId,
    capabilities: membership.capabilities
  };
}
