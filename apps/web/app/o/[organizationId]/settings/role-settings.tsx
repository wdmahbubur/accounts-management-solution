"use client";

import type { ApiResult } from "@ams/contracts";
import { capabilityCodes } from "@ams/permissions";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, type ReactNode } from "react";
import type { ManagedMember, ManagedRole, RoleOperation, RoleReceipt } from "../../../../server/roles/contracts.ts";
import { changeRoleAction } from "./role-actions.ts";

interface Props {
  view: "users" | "roles"; organizationId: string; nonce: string;
  actorMemberId: string; actorCapabilities: string[]; roles: ManagedRole[]; members: ManagedMember[];
}
function MutationForm({ operation, organizationId, nonce, children, label }: {
  operation: RoleOperation; organizationId: string; nonce: string; children: ReactNode; label: string;
}) {
  const [state, action, pending] = useActionState<ApiResult<RoleReceipt> | null, FormData>(changeRoleAction, null);
  const router = useRouter();
  useEffect(() => { if (state && "data" in state) router.refresh(); }, [state, router]);
  return <form action={action} className="settings-form" aria-label={label}>
    <input type="hidden" name="operation" value={operation} />
    <input type="hidden" name="company" value={organizationId} />
    <input type="hidden" name="company_context" value={nonce} />
    <fieldset disabled={pending} className="mutation-fields">
      {children}<button type="submit">{pending ? "Saving…" : label}</button>
    </fieldset>
    {state && "error" in state && <p role="alert" className="alert">
      {state.error.message} {state.error.fields && Object.values(state.error.fields).join(" ")}
    </p>}
    {state && "data" in state && <p role="status" className="alert">{state.data.message}</p>}
  </form>;
}
function CapabilityFields({ role, grantable }: { role?: ManagedRole; grantable: readonly string[] }) {
  const id = useId();
  return <>
    <label className="field" htmlFor={`${id}-name`}><span>Role name</span>
      <input id={`${id}-name`} name="name" required maxLength={120} defaultValue={role?.name ?? ""} />
    </label>
    <fieldset className="capability-options"><legend>Capabilities</legend>
      {capabilityCodes.map((code) => <label key={code} className="check-field">
        <input type="checkbox" name="permission_codes" value={code}
          defaultChecked={role?.permissionCodes.includes(code) ?? false} disabled={!grantable.includes(code)} />
        <span>{code}</span>
      </label>)}
    </fieldset>
  </>;
}
export function RoleSettings(props: Props) {
  const transferId = useId();
  const { organizationId, nonce, actorMemberId, actorCapabilities, members, roles, view } = props;
  const owner = members.some((member) => member.id === actorMemberId && member.isOwner);
  const canManage = actorCapabilities.includes("users.manage");
  const grantable = owner ? capabilityCodes : actorCapabilities;
  const canGrant = (role: ManagedRole) => (role.templateKey !== "owner" || owner) && role.permissionCodes.every((code) => grantable.includes(code));
  return <main className="management-shell">
    <nav className="link-row" aria-label="Company settings">
      <Link href={`/o/${organizationId}`}>Company</Link>
      <Link href={`/o/${organizationId}/settings/users`} aria-current={view === "users" ? "page" : undefined}>Users</Link>
      <Link href={`/o/${organizationId}/settings/roles`} aria-current={view === "roles" ? "page" : undefined}>Roles</Link>
    </nav>
    <p className="eyebrow">Company access</p><h1>{view === "users" ? "Users and access" : "Roles and capabilities"}</h1>
    <p>Roles apply only to this company. Administration does not automatically grant financial access.</p>
    {!canManage && <p className="alert">Read-only access. Ask an authorized manager to make changes.</p>}
    {canManage && <p className="muted">Changes require a recent sign-in. <Link href="/auth/sign-in?next=/companies">Sign in again</Link> when requested.
      You can grant only capabilities you hold. Your own role cannot be changed here.</p>}
    {view === "roles" ? <>
      <section aria-label="Existing roles" className="management-grid">
        {roles.length === 0 && <p>No roles are available.</p>}
        {roles.map((role) => <article className="panel" key={`${role.id}:${role.name}:${role.permissionCodes.join(",")}`}>
          <h2>{role.name}</h2><p className="muted">{role.isSystem ? "System template · read-only" : "Custom company role"}</p>
          <p>{role.permissionCodes.length ? role.permissionCodes.join(", ") : "No capabilities assigned."}</p>
          {!role.isSystem && canManage && canGrant(role) && <details><summary>Edit {role.name}</summary>
            <MutationForm operation="update" organizationId={organizationId} nonce={nonce} label={`Save ${role.name}`}>
              <input type="hidden" name="role_id" value={role.id} /><CapabilityFields role={role} grantable={grantable} />
            </MutationForm>
          </details>}
        </article>)}
      </section>
      {canManage && <section className="panel" aria-label="New custom role"><h2>Create custom role</h2>
        <MutationForm operation="create" organizationId={organizationId} nonce={nonce} label="Create role">
          <CapabilityFields grantable={grantable} />
        </MutationForm>
      </section>}
    </> : <>
      <section aria-label="Company members" className="management-grid">
        {members.length === 0 && <p>No members are available.</p>}
        {members.map((member) => {
          const editable = canManage && member.status === "active" && member.id !== actorMemberId && (!member.isOwner || owner);
          const selected = roles.filter((role) => member.roleIds.includes(role.id));
          return <article className="panel" key={`${member.id}:${member.status}:${member.roleIds.join(",")}`}>
            <h2>{member.displayName}{member.id === actorMemberId ? " (you)" : ""}</h2>
            <p>{member.status === "active" ? "Active" : "Inactive"}{member.isOwner ? " · Owner" : ""}</p>
            <p>{member.roleNames.length ? member.roleNames.join(", ") : "No roles assigned."}</p>
            {editable && selected.every(canGrant) && <MutationForm operation="assign" organizationId={organizationId} nonce={nonce} label={`Save roles for ${member.displayName}`}>
              <input type="hidden" name="member_id" value={member.id} />
              <fieldset className="capability-options"><legend>Assigned roles</legend>
                {roles.filter(canGrant).map((role) => <label className="check-field" key={role.id}>
                  <input type="checkbox" name="role_ids" value={role.id} defaultChecked={member.roleIds.includes(role.id)} />
                  <span>{role.name}</span>
                </label>)}
              </fieldset>
            </MutationForm>}
            {editable && <details><summary>Remove {member.displayName}&apos;s access</summary>
              <MutationForm operation="deactivate" organizationId={organizationId} nonce={nonce} label={`Deactivate ${member.displayName}`}>
                <input type="hidden" name="member_id" value={member.id} />
                <label className="check-field"><input type="checkbox" name="confirmed" value="yes" required />
                  <span>I understand this removes company access immediately and keeps the audit identity.</span></label>
              </MutationForm>
            </details>}
          </article>;
        })}
      </section>
      {owner && canManage && <section className="panel"><h2>Transfer ownership</h2>
        <p>The selected active member becomes Owner before your Owner role is removed. Other roles are retained.</p>
        {members.filter((member) => member.id !== actorMemberId && member.status === "active").length === 0
          ? <p>Add another active member before transferring ownership.</p>
          : <MutationForm operation="transfer" organizationId={organizationId} nonce={nonce} label="Transfer ownership">
            <div className="field"><label htmlFor={`${transferId}-owner`}>New owner</label>
              <select id={`${transferId}-owner`} name="member_id" required defaultValue="">
              <option value="" disabled>Select an active member</option>
              {members.filter((member) => member.id !== actorMemberId && member.status === "active").map((member) =>
                <option key={member.id} value={member.id}>{member.displayName}</option>)}
            </select></div>
            <label className="check-field"><input type="checkbox" name="confirmed" value="yes" required />
              <span>I understand my Owner access will be removed.</span></label>
          </MutationForm>}
      </section>}
    </>}
  </main>;
}
