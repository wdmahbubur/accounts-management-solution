import Link from "next/link";
import { AccountShell } from "../components/shell/account-shell.tsx";

export default function NotFound() {
  return <AccountShell title="Page not found" backHref="/companies" backLabel="Your companies">
    <section className="panel">
      <p>The page may have moved, or the link may be incomplete.</p>
      <div className="actions"><Link href="/companies" className="primary">Your companies</Link><Link href="/auth/sign-in" className="secondary">Sign in</Link></div>
    </section>
  </AccountShell>;
}
