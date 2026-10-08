export type ContactSaveRequest = Readonly<{ key: string; body: string }>;
export type ContactSaveState = "idle" | "pending" | "uncertain" | "conflict" | "saved";

/** An uncertain mutation must be retried byte-for-byte before editing is allowed. */
export class ContactSaveGuard {
  state: ContactSaveState = "idle";
  private request: ContactSaveRequest | null = null;
  begin(body: string, createKey: () => string): ContactSaveRequest | null {
    if (["pending", "conflict", "saved"].includes(this.state)) return null;
    if (this.request && this.request.body !== body) return null;
    this.request ??= Object.freeze({ key: createKey(), body });
    this.state = "pending";
    return this.request;
  }
  uncertain() { this.state = "uncertain"; }
  reject() { this.request = null; this.state = "idle"; }
  conflict() { this.state = "conflict"; }
  saved() { this.state = "saved"; }
}

export class LatestContactLookup {
  private revision = 0;
  next(): number { return ++this.revision; }
  isCurrent(revision: number): boolean { return revision === this.revision; }
}

export function isConfirmedContactSave(value: unknown, expectedId?: string): value is {id:string;row_version:number;is_customer:boolean;is_vendor:boolean} {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string,unknown>;
  return typeof result.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.id) &&
    (!expectedId || result.id === expectedId) && Number.isSafeInteger(result.row_version) && Number(result.row_version) > 0 &&
    typeof result.is_customer === "boolean" && typeof result.is_vendor === "boolean" && (result.is_customer || result.is_vendor);
}

export type ContactSaveOutcome =
  | { kind: "confirmed"; contact: {id:string;row_version:number;is_customer:boolean;is_vendor:boolean} }
  | { kind: "uncertain" }
  | { kind: "conflict"; stale: boolean }
  | { kind: "rejected"; message: string; fields: Record<string,string> };

// Only the contact command's documented application failures establish rejection.
// Proxy/time-out responses cannot tell us whether the database already committed.
const contactRejectionStatus: Readonly<Record<string, number>> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_FAILED: 422,
  STALE_VERSION: 409, IDEMPOTENCY_CONFLICT: 409, PLAN_READ_ONLY: 409, RATE_LIMITED: 429
};

function recognizedContactError(value: unknown, status: number): {code:string;message:string;fields:Record<string,string>} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body=value as Record<string,unknown>;
  if (!body.error || typeof body.error !== "object" || Array.isArray(body.error) || !body.meta || typeof body.meta !== "object" || Array.isArray(body.meta)) return null;
  const error=body.error as Record<string,unknown>, meta=body.meta as Record<string,unknown>;
  if (typeof error.code !== "string" || !Object.hasOwn(contactRejectionStatus,error.code) || contactRejectionStatus[error.code] !== status ||
      typeof error.message !== "string" || !error.message.trim() || typeof meta.request_id !== "string" || !meta.request_id.trim()) return null;
  const fields=error.fields && typeof error.fields === "object" && !Array.isArray(error.fields)
    ? Object.fromEntries(Object.entries(error.fields).filter((entry):entry is [string,string]=>typeof entry[1]==="string")) : {};
  return {code:error.code,message:error.message,fields};
}

export async function performContactSave(input:{url:string;method:"POST"|"PATCH";expectedId?:string;request:ContactSaveRequest;requestId:string}, transport:typeof fetch = fetch):Promise<ContactSaveOutcome> {
  try {
    const response=await transport(input.url,{method:input.method,headers:{"Content-Type":"application/json","X-Request-Id":input.requestId,"Idempotency-Key":input.request.key},body:input.request.body});
    const result=await response.json().catch(()=>null);
    if(response.ok) return isConfirmedContactSave(result?.data,input.expectedId)?{kind:"confirmed",contact:result.data}:{kind:"uncertain"};
    const error=recognizedContactError(result,response.status);
    if(!error) return {kind:"uncertain"};
    if(response.status===409)return {kind:"conflict",stale:error.code==="STALE_VERSION"};
    return {kind:"rejected",message:error.message,fields:error.fields};
  } catch { return {kind:"uncertain"}; }
}

export function contactSaveDestination(organizationId:string,scope:"customer"|"vendor",readableScopes:readonly ("customer"|"vendor")[],contact:{id:string;is_customer:boolean;is_vendor:boolean}):string|null {
  const preference: ("customer"|"vendor")[]=[scope,scope==="customer"?"vendor":"customer"];
  const destination=preference.find(candidate=>readableScopes.includes(candidate)&&(candidate==="customer"?contact.is_customer:contact.is_vendor));
  return destination?`/o/${organizationId}/${destination==="customer"?"sales/customers":"purchases/vendors"}/${contact.id}`:null;
}
