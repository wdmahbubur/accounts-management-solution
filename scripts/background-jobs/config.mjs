const kinds = new Set(['mail', 'exports', 'scanner', 'reminders']);
function requireValue(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}.`);
  return value;
}
export function workerConfiguration(env, args) {
  const once = args.includes('--once'), selected = args.filter(value => value !== '--once');
  if (selected.length !== 1 || !kinds.has(selected[0]) || args.filter(value => value === '--once').length > 1) throw new Error('Select mail, exports, scanner or reminders, optionally with --once.');
  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'DATABASE_RUNTIME_URL', 'AUTH_SECRET']) {
    if (env[name]) throw new Error(`Remove ${name} from the dedicated worker environment.`);
  }
  if (env.NODE_ENV !== 'production') throw new Error('Dedicated workers require NODE_ENV=production.');
  let worker, target;
  try { worker = new URL(requireValue(env,'DATABASE_WORKER_URL')); target = new URL(requireValue(env,'DATABASE_WORKER_TARGET_URL')); }
  catch { throw new Error('Configure the restricted database credential and target reference.'); }
  if (!['postgres:','postgresql:'].includes(worker.protocol) || !['postgres:','postgresql:'].includes(target.protocol) ||
      decodeURIComponent(worker.username) !== 'ams_job_worker_login' || !worker.password ||
      target.username || target.password || target.search || target.hash ||
      worker.hostname !== target.hostname || worker.port !== target.port || worker.pathname !== target.pathname ||
      !/^\/[A-Za-z0-9_-]+$/.test(target.pathname) || !['require','verify-full'].includes(worker.searchParams.get('sslmode'))) {
    throw new Error('Worker must use the restricted TLS login on the explicitly selected database; target reference must contain no credentials.');
  }
  const interval = env.AMS_JOB_INTERVAL_MS ?? '60000';
  if (!/^\d+$/.test(interval) || Number(interval)<1000 || Number(interval)>3600000) throw new Error('AMS_JOB_INTERVAL_MS must be 1000–3600000.');
  const kind=selected[0];
  if (['mail','exports','scanner'].includes(kind)) {
    for (const name of ['OBJECT_STORE_BUCKET','OBJECT_STORE_ENDPOINT','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY']) requireValue(env,name);
    let endpoint;try{endpoint=new URL(env.OBJECT_STORE_ENDPOINT);}catch{throw new Error('Configure an HTTPS private storage endpoint.');}
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('Configure an HTTPS private storage endpoint.');
  }
  if (kind==='mail') {
    let smtp;try{smtp=new URL(requireValue(env,'SMTP_URL'));}catch{throw new Error('Configure an SMTP transport.');}
    const local=['127.0.0.1','localhost','smtp-fixture'].includes(smtp.hostname)&&!smtp.username&&!smtp.password;
    if(!['smtp:','smtps:'].includes(smtp.protocol)||!smtp.hostname||smtp.hash||
       [...smtp.searchParams].some(([key,value])=>(/rejectunauthorized$|^secure$/i.test(key)&&value==='false')||(/^ignoretls$/i.test(key)&&value==='true'))||
       (!local&&smtp.protocol!=='smtps:'&&smtp.searchParams.get('requireTLS')!=='true'))throw new Error('SMTP must require authenticated TLS with certificate verification; only a credential-free local fixture may use plaintext.');
    requireValue(env,'SMTP_FROM');
    if (!/^[a-f0-9]{64}$/i.test(requireValue(env,'INVITATION_DELIVERY_KEY'))) throw new Error('Configure the existing invitation delivery key.');
    let origin;try{origin=new URL(requireValue(env,'NEXT_PUBLIC_APP_URL'));}catch{throw new Error('Configure the canonical HTTPS application origin.');}
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new Error('Configure the canonical HTTPS application origin.');
  }
  if(kind==='scanner'&&(!env.CLAMAV_HOST||!/^\d+$/.test(env.CLAMAV_PORT??'')||Number(env.CLAMAV_PORT)<1||Number(env.CLAMAV_PORT)>65535))throw new Error('Configure the private scanner host and port.');
  return {kind,once,intervalMs:Number(interval)};
}
