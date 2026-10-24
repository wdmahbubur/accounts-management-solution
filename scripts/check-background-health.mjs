import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const kind=process.argv[2];
if(!['mail','exports','scanner','reminders'].includes(kind))process.exit(1);
try{
 const value=JSON.parse(await readFile(join(tmpdir(),`ams-worker-${kind}-heartbeat.json`),'utf8')),age=Date.now()-value.at;
 if(value.kind!==kind||!Number.isSafeInteger(value.at)||!Number.isSafeInteger(value.intervalMs)||value.intervalMs<1000||value.intervalMs>3600000||age < -5000||age>value.intervalMs+120000)process.exit(1);
}catch{process.exit(1);}
