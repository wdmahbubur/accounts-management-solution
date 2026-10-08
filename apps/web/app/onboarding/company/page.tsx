import { randomBytes } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "../../../lib/database/server.ts";
import { CompanyOnboardingWizard } from "./wizard.tsx";
import { switchCompanyAction } from "../../companies/actions.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";

export default async function CompanyOnboardingPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const database = await createClient();
  const {
    data: { user }
  } = await database.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/onboarding/company");
  }

  const params = await searchParams;
  const status = first(params.status);
  const error = first(params.error);
  const organization = first(params.organization);

  return (
    <main className="auth-shell">
      <p className="eyebrow">Company onboarding</p>
      <h1>Start your books</h1>

      {status === "created" && organization ? (
        <section className="panel">
          <h2>Your company is ready for its opening setup</h2>
          <p>
            Your starter accounts and fiscal periods are saved. Choose whether these books begin
            with zero balances or bring forward balances from earlier records.
          </p>
          <form action={switchCompanyAction}>
            <input type="hidden" name="organization_id" value={organization} />
            <input type="hidden" name="destination" value="setup" />
            <button type="submit">Continue company setup</button>
          </form>
          <p><Link href="/companies">Open company list</Link></p>
        </section>
      ) : (
        <>
          {error ? (
            <p className="alert" role="alert">
              {error === "retry_conflict"
                ? "This saved setup key was already used with different company details. Reload the form to start a new setup."
                : "Company setup could not be completed. Review the fields and try again."}
            </p>
          ) : null}
          <CompanyOnboardingWizard initialIdempotencyKey={randomBytes(16).toString("base64url")} />
        </>
      )}
    </main>
  );
}
