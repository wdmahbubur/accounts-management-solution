import 'server-only';
import {parseBaseCurrency} from '@ams/contracts';
import type {RequestClient} from '../request-client.ts';
import {CommandError} from '../commands/errors.ts';
export async function readCompanyLocale(client:Pick<RequestClient,'rpc'>,organizationId:string){
 const result=await client.rpc('read_company_locale',{p_organization_id:organizationId});
 if(result.error){if(result.error.code==='P0002')throw CommandError.notFound();throw new Error('Company currency could not be loaded.');}
 const v=result.data as Record<string,unknown>|null;
 // Older onboarding accepted any two-letter code. Preserve read access to
 // those books; the new form/database command enforce the selection catalog.
 if(!v||v.organization_id!==organizationId||typeof v.country_code!=='string'||!(/^[A-Z]{2}$/).test(v.country_code)||typeof v.timezone!=='string'||typeof v.today!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.today))throw new Error('Invalid company locale.');
 return{baseCurrency:parseBaseCurrency(v.base_currency),countryCode:v.country_code,timezone:v.timezone,today:v.today};
}
