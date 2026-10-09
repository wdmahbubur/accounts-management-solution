import { parseUuid } from "@ams/contracts";
import { isCreditApplicationDate, parseCreditApplicationOptions } from "../../lib/credit-application.ts";
import type { ActorContext } from "../auth/types.ts";
import { CommandError } from "../commands/errors.ts";
import type { RequestClient } from "../request-client.ts";

export async function readCreditApplicationOptions(client:Pick<RequestClient,"rpc">,actor:ActorContext,documentId:string,effectiveDate:string) {
  if(!actor.capabilities.includes("dues.read"))throw CommandError.forbidden();
  const id=parseUuid(documentId,"document_id");
  if(!isCreditApplicationDate(effectiveDate))throw CommandError.validation({effective_date:"Choose a valid effective date."});
  const result=await client.rpc("read_credit_application_options",{p_organization_id:actor.organizationId,p_document_id:id,p_effective_date:effectiveDate});
  if(result.error) {
    if(result.error.code==="42501")throw CommandError.forbidden();
    if(result.error.code==="P0002")throw CommandError.notFound();
    if(result.error.code==="22023")throw CommandError.validation({document:"Choose a posted trade credit and valid effective date."});
    throw new Error("Credit application information could not be loaded.");
  }
  return parseCreditApplicationOptions(result.data,{organizationId:actor.organizationId,documentId:id,effectiveDate});
}
