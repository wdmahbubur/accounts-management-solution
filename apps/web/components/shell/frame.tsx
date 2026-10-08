"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState, type ReactNode } from "react";
import { signOutAction } from "../../app/auth/actions.ts";
import { useOnline, ViewState, FinanceInteractionBoundary } from "../finance/components.tsx";
import { activeNavigationHref, workspaceBreadcrumbs, workspaceNavigation } from "./navigation.ts";
import styles from "./shell.module.css";

export function AppFrame({ organizationId, companyName, companyStatus, capabilities, email, children }: {
  organizationId: string; companyName: string; companyStatus: string; capabilities: readonly string[]; email: string; children: ReactNode;
}) {
  const path = usePathname();
  const online = useOnline();
  const root = `/o/${organizationId}`;
  const groups = workspaceNavigation(organizationId, capabilities);
  const activeHref = activeNavigationHref(groups, path);
  const breadcrumbs = workspaceBreadcrumbs(organizationId, path);
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState({ path, open: false });
  const menuOpen = menu.path === path && menu.open;
  const closeMenu = () => setMenu({ path, open: false });

  return <div className={styles.shell}>
    <a className={styles.skip} href="#workspace-content">Skip to workspace content</a>
    <aside className={styles.sidebar} aria-label="Workspace sidebar" onKeyDown={event => {
      if (event.key === "Escape" && menuOpen) {
        closeMenu();
        menuButton.current?.focus();
      }
    }}>
      <div className={styles.sidebarTop}>
        <Link className={styles.brand} href="/companies"><span className={styles.mark} aria-hidden="true">A</span><span>Accounts<span className={styles.brandSub}>Management Solution</span></span></Link>
        <button className={styles.menuToggle} ref={menuButton} type="button" aria-expanded={menuOpen} aria-controls={menuId}
          onClick={() => setMenu({ path, open: !menuOpen })}>
          {menuOpen ? "Close menu" : "Menu"}
        </button>
      </div>
      <div className={styles.workspace}><small>ACTIVE COMPANY</small><strong>{companyName}</strong><Link href="/companies">Change company</Link></div>
      <div id={menuId} className={styles.menu} data-open={menuOpen}>
        <nav className={styles.navigation} aria-label="Workspace navigation">
          {groups.map(group => <section className={styles.navGroup} key={group.id} aria-labelledby={`${menuId}-${group.id}`}>
            <h2 id={`${menuId}-${group.id}`}>{group.label}</h2>
            {group.items.map(item => <Link key={item.href} href={item.href} prefetch={false} onClick={closeMenu}
              aria-current={activeHref === item.href ? "page" : undefined}>{item.label}</Link>)}
          </section>)}
        </nav>
        <div className={styles.secondary}><Link href="/settings/profile" onClick={closeMenu}>Your profile</Link><Link href="/settings/security" onClick={closeMenu}>Session security</Link></div>
      </div>
    </aside>
    <div className={styles.body}>
      <header className={styles.header}>
        <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
          <Link href="/companies">Companies</Link><span aria-hidden="true">/</span><Link href={root}>{companyName}</Link>
          {breadcrumbs.map((crumb, index) => <span className={styles.crumb} key={`${crumb.label}-${index}`}>
            <span aria-hidden="true">/</span>{crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
          </span>)}
        </nav>
        <div className={styles.session}><span title={email}>{email}</span><form action={signOutAction}><input type="hidden" name="scope" value="local" /><button type="submit" className="secondary">Sign out</button></form></div>
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
