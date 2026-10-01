import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "../../../lib/supabase/server.ts";
import { createSupabaseMembershipResolver } from "../../../server/auth/supabase-membership.ts";
import { listActiveMemberships } from "../../../server/companies/memberships.ts";
import { readCompanyContext } from "../../../server/company-context.ts";
import {
  organizationCacheTag,
  organizationQueryKey
} from "../../../server/tenant-scope.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrganizationContextPage({
  params
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: rawOrganizationId } = await params;

  let organizationId;
  try {
    organizationId = parseOrganizationId(rawOrganizationId);
  } catch {
    redirect("/companies?error=not_found");
  }

  const cookieStore = await cookies();
  const current = readCompanyContext(cookieStore);

  if (!current || current.organizationId !== organizationId) {
    redirect("/companies?error=context_mismatch");
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/companies");
  }

  const resolver = createSupabaseMembershipResolver(supabase);
  const membership = await resolver.resolveActiveMembership({
    userId: parseUuid(user.id, "verified_user_id"),
    organizationId
  });

  if (!membership) {
    redirect("/companies?error=not_found");
  }

  const companies = await listActiveMemberships(supabase);
  const company = companies.find(
    (item) => item.organizationId === organizationId
  );

  if (!company) {
    redirect("/companies?error=not_found");
  }

  const queryKey = organizationQueryKey(organizationId, "context-shell");
  const cacheTag = organizationCacheTag(organizationId, "context-shell");

  return (
    <main className="auth-shell">
      <p className="eyebrow">Current company</p>
      <h1>{company.organizationName}</h1>
      <section className="panel">
        <p>
          <strong>Legal name:</strong> {company.legalName}
        </p>
        <p>
          <strong>Status:</strong> {company.organizationStatus}
        </p>
        <p>
          <strong>Roles:</strong>{" "}
          {company.roleNames.length ? company.roleNames.join(", ") : "—"}
        </p>
        <p className="muted">
          This tenant shell is dynamic and membership-validated on every request.
          Future company reads must use an organization-scoped query key and cache tag.
        </p>
        <p className="muted">
          Scope key: <code className="inline">{queryKey.join("/")}</code>
        </p>
        <p className="muted">
          Cache tag: <code className="inline">{cacheTag}</code>
        </p>
        <div className="link-row">
          <Link href="/companies">Switch company</Link>
          {membership.capabilities.includes("users.read") && <>
            <Link href={`/o/${organizationId}/settings/users`}>Users</Link>
            <Link href={`/o/${organizationId}/settings/roles`}>Roles</Link>
          </>}
        </div>
      </section>
    </main>
  );
}
