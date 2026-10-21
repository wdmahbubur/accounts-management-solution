import 'server-only';
import {cookies} from 'next/headers';
import {createClient} from '../../lib/database/server.ts';
import {readCompanyContext} from '../company-context.ts';
import {CommandError} from '../commands/errors.ts';
import {readCompanyLocale} from './locale.ts';
export async function companyDate():Promise<string>{
 const current=readCompanyContext(await cookies());if(!current)throw CommandError.notFound();
 return(await readCompanyLocale(await createClient(),current.organizationId)).today;
}
