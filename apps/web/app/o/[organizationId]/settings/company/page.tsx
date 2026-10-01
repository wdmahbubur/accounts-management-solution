import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { readCompanySettings } from "../../../../../server/settings/service.ts";
import { SettingsForm } from "./settings-form.tsx";
import styles from "./settings.module.css";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function CompanySettingsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId: raw } = await params;
  let organizationId;
  try { organizationId = parseOrganizationId(raw); } catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let actor, settings;
  try {
    actor = await resolveActorContext(organizationId, runtime.dependencies);
    settings = await readCompanySettings(runtime.client, actor);
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (!(error instanceof CommandError && error.code === "FORBIDDEN")) throw error;
    return <main><h1>Access denied</h1><p>You need company.read to view company settings.</p><Link href={`/o/${organizationId}`}>Back to company</Link></main>;
  }
  return <main className="management-shell"><p className="eyebrow">Company configuration</p><h1>Company settings</h1>
    <p>Manage the company profile and protect the accounting calendar. Version {settings.settingsVersion}.</p>
    <SettingsForm settings={settings} nonce={runtime.current.nonce} canUpdate={actor.capabilities.includes("company.update")} />
    <section className="panel" aria-labelledby="calendar-heading"><h2 id="calendar-heading">Current accounting calendar</h2>
      {settings.calendar.length === 0 ? <p>No accounting periods are available.</p> : <div className={styles.calendar}><table>
        <caption>Opening cutover and regular periods, using company accounting dates.</caption>
        <thead><tr><th scope="col">Period</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Status</th></tr></thead>
        <tbody>{settings.calendar.map(period => <tr key={`${period.kind}:${period.startsOn}`}><th scope="row">{period.label}</th>
          <td><time dateTime={period.startsOn}>{period.startsOn}</time></td><td><time dateTime={period.endsOn}>{period.endsOn}</time></td><td>{period.status}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </main>;
}
