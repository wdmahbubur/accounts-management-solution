import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "../../lib/supabase/server.ts";
import { CompanyOnboardingWizard } from "./company/wizard.tsx";

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
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

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
          <h2>Company setup created</h2>
          <p>
            The company, owner membership, starter accounts, mappings and initial periods were
            committed atomically.
          </p>
          <p className="muted">
            Organization ID: <code className="inline">{organization}</code>
          </p>
          <p className="muted">
            Company switching and the full permission matrix are completed by the next foundation stories.
          </p>
          <Link href="/">Return home</Link>
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
          <CompanyOnboardingWizard />
        </>
      )}
    </main>
  );
}
