import { redirect } from "next/navigation";
import { AccountShell } from "../../../components/shell/account-shell.tsx";
import styles from "../../auth/account-pages.module.css";

import { createClient } from "../../../lib/database/server.ts";
import { updateProfileAction } from "../../auth/actions.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: { searchParams: SearchParams }) {
  const database = await createClient();
  const {
    data: { user }
  } = await database.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/settings/profile");
  }

  const params = await searchParams;
  const { data: rows } = await database.rpc("get_own_profile");
  const persisted =
    Array.isArray(rows) && rows.length === 1
      ? (rows[0] as {
          display_name?: string;
          locale?: string;
          timezone?: string;
        })
      : null;
  const displayName = persisted?.display_name ?? "";
  const locale = persisted?.locale === "bn-BD" ? "bn-BD" : "en-BD";
  const timezone = persisted?.timezone === "UTC" ? "UTC" : "Asia/Dhaka";

  return (
    <AccountShell title="Profile" eyebrow="Personal settings" description="Manage your name and personal preferences." settingsPage="profile" backHref="/companies" backLabel="Back to companies">
      <section className="panel">
        {first(params.status) === "profile_updated" ? <p className="alert" role="status">Profile preferences updated.</p> : null}
        {first(params.error) ? <p className="alert" role="alert">Profile could not be updated.</p> : null}
        <form action={updateProfileAction} className="settings-form">
          <label className="field">
            <span>Display name</span>
            <input
              name="display_name"
              autoComplete="name"
              maxLength={120}
              defaultValue={displayName}
              required
            />
          </label>
          <label className="field">
            <span>Language and region</span>
            <select name="locale" defaultValue={locale}>
              <option value="en-BD">English (Bangladesh)</option>
              <option value="bn-BD">Bangla (Bangladesh)</option>
            </select>
          </label>
          <label className="field">
            <span>Timezone</span>
            <select name="timezone" defaultValue={timezone}>
              <option value="Asia/Dhaka">Bangladesh time · Asia/Dhaka</option>
              <option value="UTC">UTC</option>
            </select>
          </label>
          <button type="submit">Save profile</button>
        </form>
        <p className={styles.help}>These are personal preferences. Company access and roles are managed separately by your company administrator.</p>
      </section>
    </AccountShell>
  );
}
