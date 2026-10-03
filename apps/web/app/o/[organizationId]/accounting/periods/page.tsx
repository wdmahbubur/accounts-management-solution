import {parseOrganizationId} from "@ams/contracts";import Link from "next/link";import {redirect} from "next/navigation";
import {resolveActorContext} from "../../../../../server/auth/resolve-actor.ts";import {CommandError} from "../../../../../server/commands/errors.ts";
import {readPeriods} from "../../../../../server/periods/service.ts";import type {AccountingPeriod} from "../../../../../server/periods/contracts.ts";import {roleRuntime} from "../../../../../server/roles/runtime.ts";import {PeriodScreen} from "./screen.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function PeriodPage({params}:{params:Promise<{organizationId:string}>}){let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
let periods:AccountingPeriod[]=[];let canLock=false;let canReopen=false;let canAudit=false;let forbidden=false;
try{const actor=await resolveActorContext(organizationId,runtime.dependencies);periods=await readPeriods(runtime.client,actor);canLock=actor.capabilities.includes("periods.lock");canReopen=actor.capabilities.includes("periods.reopen");canAudit=actor.capabilities.includes("audit.read");
}catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="NOT_FOUND")redirect("/companies?error=not_found");if(error instanceof CommandError&&error.code==="FORBIDDEN")forbidden=true;else throw error;}
if(forbidden)return <main><p className="eyebrow">Accounting</p><h1>Access denied</h1><p>You need accounting.read to view fiscal periods.</p><Link href={`/o/${organizationId}`}>Back to company</Link></main>;
return <PeriodScreen organizationId={organizationId} nonce={runtime.current.nonce} periods={periods} canLock={canLock} canReopen={canReopen} canAudit={canAudit}/>;
}
