import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "../../lib/database/server.ts";
import { readCompanyContext } from "../../server/company-context.ts";
import { listActiveMemberships } from "../../server/companies/memberships.ts";
import { switchCompanyAction } from "./actions.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CompaniesPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const database = await createClient();
  const {
    data: { user }
  } = await database.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/companies");
  }

  const memberships = await listActiveMemberships(database);
  const cookieStore = await cookies();
  const preferred = readCompanyContext(cookieStore);
  const current =
    preferred &&
    memberships.some(
      (membership) => membership.organizationId === preferred.organizationId
    )
      ? preferred
      : null;

  const params = await searchParams;
  const error = first(params.error);

  return (
    <main className="auth-shell">
      <p className="eyebrow">Company context</p>
      <h1>Your companies</h1>

      {error ? (
        <p className="alert" role="alert">
          {error === "context_mismatch"
            ? "Your active company changed. Open the company again before continuing."
            : "That company is not available to your current active membership."}
        </p>
      ) : null}

      {memberships.length === 0 ? (
        <section className="panel">
          <h2>No active company membership</h2>
          <p>Create a company to start a separate set of books.</p>
          <Link href="/onboarding/company">Create company</Link>
        </section>
      ) : (
        <section className="company-grid" aria-label="Active company memberships">
          {memberships.map((membership) => {
            const isCurrent =
              current?.organizationId === membership.organizationId;

            return (
              <article
                className="company-card"
                key={membership.organizationId}
                data-current={isCurrent ? "true" : "false"}
              >
                <div className="company-card-heading">
                  <div>
                    <h2>{membership.organizationName}</h2>
                    <p className="muted">{membership.legalName}</p>
                  </div>
                  {isCurrent ? (
                    <strong className="current-badge">Current</strong>
                  ) : null}
                </div>
                <dl className="review-list">
                  <div>
                    <dt>Status</dt>
                    <dd>{membership.organizationStatus}</dd>
                  </div>
                  <div>
                    <dt>Roles</dt>
                    <dd>
                      {membership.roleNames.length
                        ? membership.roleNames.join(", ")
                        : "Role template pending capability setup"}
                    </dd>
                  </div>
                </dl>
                <form action={switchCompanyAction}>
                  {membership.organizationStatus === "onboarding" && membership.roleNames.includes("Owner") && <input type="hidden" name="destination" value="setup" />}
                  <input
                    type="hidden"
                    name="organization_id"
                    value={membership.organizationId}
                  />
                  <button type="submit">
                    {membership.organizationStatus === "onboarding" && membership.roleNames.includes("Owner") ? "Finish company setup" : isCurrent ? "Open current company" : `Open ${membership.organizationName}`}
                  </button>
                </form>
              </article>
            );
          })}
        </section>
      )}

      <p className="muted">
        Choose the company whose books you want to work on. Each company keeps its own accounts, transactions, and reports.
      </p>
      <Link href="/onboarding/company">Create another company</Link>
    </main>
  );
}
