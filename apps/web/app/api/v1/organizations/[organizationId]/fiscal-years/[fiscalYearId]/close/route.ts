import {mutateYearClose} from "../../../../../../../../server/year-close/http.ts";
export async function POST(request:Request,context:{params:Promise<{organizationId:string;fiscalYearId:string}>}){return mutateYearClose(request,context,"close");}
