"use client";
import { useActionState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApiResult } from "@ams/contracts";
import { useOnline } from "../../../../../components/finance/components.tsx";
import type { CompanySettings, SettingsReceipt } from "../../../../../server/settings/contracts.ts";
import { saveCompanySettings } from "./actions.ts";
import styles from "./settings.module.css";
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function SettingsForm({ settings, nonce, canUpdate }: { settings: CompanySettings; nonce: string; canUpdate: boolean }) {
  const [state, action, pending] = useActionState<ApiResult<SettingsReceipt> | null, FormData>(saveCompanySettings, null);
  const router = useRouter(), id = useId(), online = useOnline();
  useEffect(() => { if (state && "data" in state) router.refresh(); }, [state, router]);
  const field = (name: string, label: string, value: string, maxLength: number, type = "text", required = false) => <div className="field">
    <label htmlFor={`${id}-${name}`}>{label}</label><input id={`${id}-${name}`} name={name} type={type} defaultValue={value} maxLength={maxLength} required={required} />
  </div>;
  return <form action={action} aria-label="Company settings" className="settings-form">
    <input type="hidden" name="company" value={settings.organizationId} /><input type="hidden" name="company_context" value={nonce} />
    <input type="hidden" name="expected_version" value={settings.settingsVersion} />
    {!canUpdate && <p className="alert">Read-only access. You need company.update to change these settings.</p>}
    <fieldset className="mutation-fields" disabled={pending || !canUpdate || !online} key={settings.settingsVersion}>
      <section className="panel" aria-labelledby={`${id}-identity`}><h2 id={`${id}-identity`}>Company profile</h2>
        <div className={styles.fields}>
          {field("name", "Display name", settings.name, 160, "text", true)}
          {field("legal_name", "Legal name", settings.legalName, 240, "text", true)}
          {field("country_code", "Country code", settings.countryCode, 2, "text", true)}
          {field("timezone", "Timezone", settings.timezone, 64, "text", true)}
          {field("contact_email", "Contact email", settings.contactEmail, 254, "email")}
          {field("contact_phone", "Contact phone", settings.contactPhone, 32, "tel")}
        </div><p className="muted">Use an IANA timezone, for example Asia/Dhaka. A timezone change does not alter stored accounting dates.</p>
      </section>
      <section className="panel" aria-labelledby={`${id}-address`}><h2 id={`${id}-address`}>Company address</h2>
        <div className={styles.fields}>
          {field("address.line1", "Address line 1", settings.address.line1, 240)}
          {field("address.line2", "Address line 2", settings.address.line2, 240)}
          {field("address.city", "City", settings.address.city, 240)}
          {field("address.postal_code", "Postal code", settings.address.postal_code, 240)}
        </div>
      </section>
      <section className="panel" aria-labelledby={`${id}-foundation`}><h2 id={`${id}-foundation`}>Accounting setup</h2>
        <p><strong>Base currency: BDT</strong> · Accrual books</p>
        <p className="alert">{settings.foundationLocked ? "Accounting setup is locked because company activity has started. Historical dates and fiscal policy are protected." : "Before the first activity, changing these dates rebuilds only the unused onboarding calendar. Review the cutover carefully."}</p>
        <fieldset disabled={settings.foundationLocked} className="mutation-fields"><div className={styles.fields}>
          <div className="field"><label htmlFor={`${id}-books`}>Books start date</label><input id={`${id}-books`} type="date" name="books_start_date" defaultValue={settings.booksStartDate} min="1900-01-02" max="9998-12-31" required /></div>
          <div className="field"><label htmlFor={`${id}-month`}>Fiscal year starts in</label><select id={`${id}-month`} name="fiscal_year_start_month" defaultValue={settings.fiscalYearStartMonth}>{months.map((month, i) => <option key={month} value={i + 1}>{month}</option>)}</select></div>
        </div></fieldset>
      </section>
      {canUpdate && <section className="panel"><h2>Save changes</h2>
        {field("reason", "Reason for change", "", 500, "text", true)}
        <p className="muted">Your identity, reason and time are recorded in the audit history. Changes require a recent sign-in.</p>
        <button type="submit">{pending ? "Saving…" : "Save company settings"}</button>
        <Link href="/auth/sign-in?next=/companies">Sign in again</Link>
      </section>}
    </fieldset>
    {state && "error" in state && <div role="alert" className="alert"><p>{state.error.message} {state.error.fields && Object.values(state.error.fields).join(" ")}</p>
      <button className="secondary" type="button" onClick={() => window.location.reload()}>Reload latest settings</button>
      <p className="muted">Reloading discards unsaved edits. Request: {state.meta.request_id}</p></div>}
    {state && "data" in state && <p role="status" className="alert">{state.data.message}</p>}
  </form>;
}
