import { redirect } from "next/navigation";

import { createClient } from "../../../lib/supabase/server.ts";
import { updateProfileAction } from "../../auth/actions.ts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/settings/profile");
  }

  const params = await searchParams;
  const metadata = user.user_metadata ?? {};

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
              defaultValue={typeof metadata.display_name === "string" ? metadata.display_name : ""}
              required
            />
          </label>
          <label className="field">
            <span>Locale</span>
            <select name="locale" defaultValue={metadata.locale === "bn-BD" ? "bn-BD" : "en-BD"}>
              <option value="en-BD">English (Bangladesh)</option>
              <option value="bn-BD">Bangla (Bangladesh)</option>
            </select>
          </label>
          <label className="field">
            <span>Timezone</span>
            <select name="timezone" defaultValue={metadata.timezone === "UTC" ? "UTC" : "Asia/Dhaka"}>
              <option value="Asia/Dhaka">Asia/Dhaka</option>
              <option value="UTC">UTC</option>
            </select>
          </label>
          <button type="submit">Save profile</button>
        </form>
        <p className="muted">
          These values are presentation preferences only. Roles and capabilities are resolved from live company membership, never editable profile metadata.
        </p>
      </section>
    </main>
  );
}
