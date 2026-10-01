"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { signOutAction } from "../../app/auth/actions.ts";
import { useOnline, ViewState, FinanceInteractionBoundary } from "../finance/components.tsx";
import styles from "./shell.module.css";
export function AppFrame({ organizationId, companyName, companyStatus, capabilities, email, children }: {
  organizationId: string; companyName: string; companyStatus: string; capabilities: readonly string[]; email: string; children: ReactNode;
}) {
  const path = usePathname(); const online = useOnline(); const root = `/o/${organizationId}`;
  const current = path.endsWith("/settings/users") ? "Users and invitations" : path.endsWith("/settings/roles") ? "Roles and permissions" : path.endsWith("/accounting/accounts") ? "Chart of accounts" : "Workspace overview";
  const nav = [{ href: root, label: "Workspace overview" }, ...(capabilities.includes("users.read") ? [
    { href: `${root}/settings/users`, label: "Manage users" }, { href: `${root}/settings/roles`, label: "Manage roles" }
  ] : []), ...(capabilities.includes("accounting.read") ? [{ href: `${root}/accounting/accounts`, label: "Chart of accounts" }] : [])];
  return <div className={styles.shell}>
    <a className={styles.skip} href="#workspace-content">Skip to workspace content</a>
    <aside className={styles.sidebar} aria-label="Workspace sidebar">
      <Link className={styles.brand} href="/companies"><span className={styles.mark} aria-hidden="true">A</span><span>Accounts<span className={styles.brandSub}>Management Solution</span></span></Link>
      <div className={styles.workspace}><small>ACTIVE COMPANY</small><strong>{companyName}</strong><Link href="/companies">Change workspace</Link></div>
      <nav className={styles.navigation} aria-label="Workspace navigation">{nav.map((item) => <Link key={item.href} href={item.href} prefetch={false} aria-current={path === item.href ? "page" : undefined}>{item.label}</Link>)}</nav>
      <div className={styles.secondary}><Link href="/settings/profile">Your profile</Link><Link href="/settings/security">Session security</Link><p>Separate company books.<br />Live permissions on every operation.</p></div>
    </aside>
    <div className={styles.body}>
      <header className={styles.header}><nav aria-label="Breadcrumb"><Link href="/companies">Companies</Link><span aria-hidden="true"> / </span><Link href={root}>{companyName}</Link><span aria-hidden="true"> / </span><span aria-current="page">{current}</span></nav>
        <div className={styles.session}><span title={email}>Signed in · {email}</span><form action={signOutAction}><input type="hidden" name="scope" value="local" /><button type="submit" className="secondary">Sign out</button></form></div>
      </header>
      <div className={styles.content} id="workspace-content" tabIndex={-1}>
        {!online && <ViewState kind="offline" />}
        {companyStatus === "read_only" && <ViewState kind="read_only" />}
        <FinanceInteractionBoundary readOnly={companyStatus === "read_only"}>{children}</FinanceInteractionBoundary>
      </div>
      <footer className={styles.footer}>BDT books · No financial changes are queued offline.</footer>
    </div>
  </div>;
}
