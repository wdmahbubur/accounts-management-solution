import {yearClosePreview} from "../../../../../../../../server/year-close/http.ts";
export async function GET(request:Request,context:{params:Promise<{organizationId:string;fiscalYearId:string}>}){return yearClosePreview(request,context);}
