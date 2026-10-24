import {setTimeout as sleep} from 'node:timers/promises';

/** One outstanding batch per process. A stop drains it, then claims no more. */
export async function runSerialJobs({run,signal,intervalMs,once=false,wait=(ms,signal)=>sleep(ms,undefined,{signal})}) {
  while(!signal.aborted){
    await run();
    if(once||signal.aborted)return;
    try{await wait(intervalMs,signal);}catch(error){if(!signal.aborted)throw error;}
  }
}
