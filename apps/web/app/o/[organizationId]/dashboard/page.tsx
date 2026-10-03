import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../workspace.module.css";

import { createClient } from "../../../../lib/database/server.ts";
import { createMembershipResolver } from "../../../../server/auth/membership-resolver.ts";
import { listActiveMemberships } from "../../../../server/companies/memberships.ts";
import { readCompanyContext } from "../../../../server/company-context.ts";
import {
  organizationCacheTag,
  organizationQueryKey
} from "../../../../server/tenant-scope.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrganizationDashboardPage({
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

  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=/companies");

  const resolver = createMembershipResolver(database);
  const membership = await resolver.resolveActiveMembership({
    userId: parseUuid(user.id, "verified_user_id"),
    organizationId
  });
  if (!membership) redirect("/companies?error=not_found");

  const companies = await listActiveMemberships(database);
  const company = companies.find(item => item.organizationId === organizationId);
  if (!company) redirect("/companies?error=not_found");

  const queryKey = organizationQueryKey(organizationId, "dashboard");
  const cacheTag = organizationCacheTag(organizationId, "dashboard");
  return (
    <main className="management-shell" data-scope-key={queryKey.join("/")} data-cache-tag={cacheTag}>
      <p className="eyebrow">Company dashboard</p>
      <h1>{company.organizationName}</h1>
      <p className="muted">A separate workspace for this company’s books, team access and accounting setup.</p>
      <div className={styles.grid}>
        <section className={`panel ${styles.card}`} aria-label="Company details">
          <h2>Company details</h2>
          <dl><div><dt>Legal name</dt><dd>{company.legalName}</dd></div>
            <div><dt>Workspace status</dt><dd>{company.organizationStatus === "onboarding" ? "Setup in progress" : company.organizationStatus === "read_only" ? "Read-only" : "Active"}</dd></div>
            <div><dt>Your roles</dt><dd>{company.roleNames.length ? company.roleNames.join(", ") : "No roles assigned"}</dd></div>
          </dl>
          <Link href="/companies">Switch company</Link>
        </section>
        <section className={`panel ${styles.card}`} aria-label="Available modules">
          <h2>Available modules</h2>
          <p>Each module checks your live company membership and permissions.</p>
          <nav className={styles.tools} aria-label="Company modules">
            {membership.capabilities.includes("users.read") && <>
              <Link href={`/o/${organizationId}/settings/users`}>Users and invitations</Link>
              <Link href={`/o/${organizationId}/settings/roles`}>Roles and permissions</Link>
            </>}
            {membership.capabilities.includes("accounting.read") && <Link href={`/o/${organizationId}/accounting/periods`}>Fiscal periods</Link>}
            {membership.capabilities.includes("accounting.read") && <Link href={`/o/${organizationId}/accounting/year-close`}>Fiscal year close</Link>}
            {membership.capabilities.includes("accounting.read") && <Link href={`/o/${organizationId}/accounting/accounts`}>Chart of accounts</Link>}
            {membership.capabilities.includes("journal.write") && <Link href={`/o/${organizationId}/settings/opening-balances`}>Opening balance cutover</Link>}
            {membership.capabilities.includes("tax.read") && <Link href={`/o/${organizationId}/settings/taxes`}>Tax configuration</Link>}
            {membership.capabilities.includes("documents.read") && <Link href={`/o/${organizationId}/accounting/documents`}>Financial documents</Link>}
            {(membership.capabilities.includes("reports.read") || membership.capabilities.includes("ledger.read") || membership.capabilities.includes("banking.read")) && <Link href={`/o/${organizationId}/reports`}>Reports</Link>}
            <Link href="/settings/profile">Profile preferences</Link>
            <Link href="/settings/security">Session security</Link>
          </nav>
        </section>
      </div>
    </main>
  );
}
