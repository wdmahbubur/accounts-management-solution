// Billing is deliberately deferred. Never acknowledge an event as processed,
// parse untrusted payloads, or change subscriptions while no provider is active.
export async function POST(){return Response.json({error:{code:'BILLING_DISABLED',message:'Paid billing is not enabled.'}},{status:503,headers:{'Cache-Control':'private, no-store'}});}
