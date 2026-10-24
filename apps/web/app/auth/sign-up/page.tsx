import Link from "next/link";
import { AccountShell } from "../../../components/shell/account-shell.tsx";
import type { RegistrationState } from "../../../server/auth/registration.ts";
import { SignupForms } from "./signup-forms.tsx";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = first(params.status);
  const error = first(params.error);
  const initialState: RegistrationState = error
    ? { error: error === "password_policy" ? "password_policy" : "invalid_input" }
    : status ? { status: status === "verification_requested" ? "verification_requested" : "check_email" } : {};

  return (
    <AccountShell title="Create account" eyebrow="Your account" description="Create your personal login, then verify your email.">
      <section className="panel">
        <SignupForms initialState={initialState} />
        <Link href="/auth/sign-in">Back to sign in</Link>
      </section>
    </AccountShell>
  );
}
