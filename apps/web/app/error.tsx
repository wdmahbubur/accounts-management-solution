"use client";

import Link from "next/link";
import { AccountShell } from "../components/shell/account-shell.tsx";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AccountShell title="This page could not be loaded" backHref="/companies" backLabel="Your companies">
    <section className="panel" role="alert">
      <p>Try loading the page again, or return to your company list.</p>
      <div className="actions"><button type="button" onClick={reset}>Try again</button><Link href="/companies" className="secondary">Your companies</Link></div>
    </section>
  </AccountShell>;
}
