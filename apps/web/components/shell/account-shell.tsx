import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./account-shell.module.css";

export function AccountShell({ title, eyebrow, description, children, wide = false, backHref = "/", backLabel = "Back to home", settingsPage }: {
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  backHref?: string;
  backLabel?: string;
  settingsPage?: "profile" | "security";
}) {
  return <main className={styles.shell} data-wide={wide}>
    <div className={styles.topline}>
      <Link href="/" className={styles.brand}><span aria-hidden="true">A</span>Accounts</Link>
      <Link href={backHref} className={styles.back}>{backLabel}</Link>
    </div>
    <header className={styles.heading}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
    {settingsPage && <nav className={styles.tabs} aria-label="Personal settings">
      <Link href="/settings/profile" aria-current={settingsPage === "profile" ? "page" : undefined}>Profile</Link>
      <Link href="/settings/security" aria-current={settingsPage === "security" ? "page" : undefined}>Security</Link>
    </nav>}
    {children}
  </main>;
}
