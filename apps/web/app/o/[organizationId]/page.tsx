import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "./workspace.module.css";

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
    <main className="management-shell" data-scope-key={queryKey.join("/")} data-cache-tag={cacheTag}>
      <p className="eyebrow">Current company</p>
      <h1>{company.organizationName}</h1>
      <p className="muted">Your company workspace. Choose an authorized tool below.</p>
      <div className={styles.grid}>
        <section className={`panel ${styles.card}`} aria-label="Company details">
          <h2>Company details</h2>
          <dl><div><dt>Legal name</dt><dd>{company.legalName}</dd></div>
            <div><dt>Workspace status</dt><dd>{company.organizationStatus === "onboarding" ? "Setup in progress" : company.organizationStatus === "read_only" ? "Read-only" : "Active"}</dd></div>
            <div><dt>Your roles</dt><dd>{company.roleNames.length ? company.roleNames.join(", ") : "No roles assigned"}</dd></div>
          </dl>
          <Link href="/companies">Switch company</Link>
        </section>
        <section className={`panel ${styles.card}`} aria-label="Workspace tools">
          <h2>Workspace tools</h2>
          <p>Access is checked for this company each time you open a protected tool or make a change.</p>
          <nav className={styles.tools} aria-label="Quick actions">
            {membership.capabilities.includes("users.read") && <>
              <Link href={`/o/${organizationId}/settings/users`}>Users</Link>
              <Link href={`/o/${organizationId}/settings/roles`}>Roles</Link>
            </>}
            {membership.capabilities.includes("accounting.read") && <Link href={`/o/${organizationId}/accounting/accounts`}>Chart of accounts</Link>}
            {membership.capabilities.includes("approvals.manage") && <Link href={`/o/${organizationId}/settings/approvals`}>Approval policies</Link>}
            <Link href="/settings/profile">Profile preferences</Link>
            <Link href="/settings/security">Review session security</Link>
          </nav>
          <p className="muted">Switching companies opens a separate workspace. Financial changes are never queued offline.</p>
        </section>
      </div>
    </main>
  );
}
