import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { withWorkerDatabase } from "../../../../../server/database.ts";

export const runtime="nodejs";
export const dynamic="force-dynamic";
function authorized(request:Request){const expected=process.env.OUTBOX_WORKER_SECRET;if(!expected||expected.length<32)return false;
  const header=request.headers.get("authorization")??"",supplied=Buffer.from(header.startsWith("Bearer ")?header.slice(7):""),secret=Buffer.from(expected);
  return supplied.length===secret.length&&timingSafeEqual(supplied,secret);}
export async function POST(request:Request){const headers={"Cache-Control":"private, no-store"};
  if(!authorized(request))return NextResponse.json({error:"worker_unavailable"},{status:503,headers});
  try{const result=await withWorkerDatabase(client=>client.query<{queued:number|string}>("SELECT finance_private.enqueue_due_notification_reminders() AS queued"));
    const queued=Number(result.rows[0]?.queued);if(!Number.isSafeInteger(queued)||queued<0)throw new Error("Invalid scheduler result.");
    return NextResponse.json({data:{queued}},{headers});
  }catch{return NextResponse.json({error:"scheduler_failed"},{status:503,headers});}
}
