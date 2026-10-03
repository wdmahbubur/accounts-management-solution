import { redirect } from "next/navigation";

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
    <main className="auth-shell">
      <p className="eyebrow">Personal settings</p>
      <h1>Profile</h1>
      <section className="panel">
        {first(params.status) === "profile_updated" ? <p className="alert">Profile preferences updated.</p> : null}
        {first(params.error) ? <p className="alert" role="alert">Profile could not be updated.</p> : null}
        <form action={updateProfileAction} className="settings-form">
          <label className="field">
            <span>Display name</span>
            <input
              name="display_name"
              maxLength={120}
              defaultValue={displayName}
              required
            />
          </label>
          <label className="field">
            <span>Locale</span>
            <select name="locale" defaultValue={locale}>
              <option value="en-BD">English (Bangladesh)</option>
              <option value="bn-BD">Bangla (Bangladesh)</option>
            </select>
          </label>
          <label className="field">
            <span>Timezone</span>
            <select name="timezone" defaultValue={timezone}>
              <option value="Asia/Dhaka">Asia/Dhaka</option>
              <option value="UTC">UTC</option>
            </select>
          </label>
          <button type="submit">Save profile</button>
        </form>
        <p className="muted">
          Profile preferences are stored in the application profile. Roles and capabilities are resolved from live company membership, never editable Auth metadata.
        </p>
      </section>
    </main>
  );
}
