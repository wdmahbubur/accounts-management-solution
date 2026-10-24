// Test-only wrapper: run the actual production CLI in this process, then read
// the kernel's cgroup high-water mark. No credentials or file bytes are emitted.
import {readFile} from 'node:fs/promises';
process.argv=[process.execPath,'/app/scripts/run-background-jobs.mjs','scanner','--once'];
await import('/app/scripts/run-background-jobs.mjs');
console.log(JSON.stringify({event:'test.memory_peak',bytes:Number((await readFile('/sys/fs/cgroup/memory.peak','utf8')).trim())}));
