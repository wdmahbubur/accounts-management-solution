import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import { readRoleManagement } from "../../../../server/roles/service.ts";
import { listInvitations } from "../../../../server/invitations/service.ts";
import { InvitationsPanel } from "./invitations-panel.tsx";
import { RoleSettings } from "./role-settings.tsx";

export async function RoleScreen({ organizationId: raw, view }: { organizationId: string; view: "users" | "roles" }) {
  let organizationId;
  try { organizationId = parseOrganizationId(raw); } catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let actor: Awaited<ReturnType<typeof resolveActorContext>>;
  let data: Awaited<ReturnType<typeof readRoleManagement>>;
  let invitations: Awaited<ReturnType<typeof listInvitations>> = [];
  try {
    actor = await resolveActorContext(organizationId, runtime.dependencies);
    data = await readRoleManagement(runtime.client, actor);
    if (view === "users") invitations = await listInvitations(runtime.client, actor);
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (!(error instanceof CommandError && error.code === "FORBIDDEN")) throw error;
    return <main><p className="eyebrow">Company settings</p><h1>Access denied</h1>
      <p>You need the users.read capability to view users and roles.</p>
      <Link href={`/o/${organizationId}`}>Back to company</Link></main>;
  }
  const isOwner = data.members.some((member) => member.id === actor.memberId && member.isOwner);
  const grantable = data.roles.filter((role) => (role.templateKey !== "owner" || isOwner) && role.permissionCodes.every((code) => actor.capabilities.includes(code)));
  return <><RoleSettings view={view} organizationId={organizationId} nonce={runtime.current.nonce}
    actorMemberId={actor.memberId} actorCapabilities={[...actor.capabilities]} {...data} />
    {view === "users" && <InvitationsPanel organizationId={organizationId} nonce={runtime.current.nonce}
      roles={grantable} invitations={invitations} canManage={actor.capabilities.includes("users.manage")} />}</>;
}
