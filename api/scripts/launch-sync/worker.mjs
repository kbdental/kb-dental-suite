// Import-only hourly verification worker. No writes to Google; limited DB owner.
import{readFileSync,writeFileSync,existsSync}from'node:fs';import{join}from'node:path';import{fileURLToPath}from'node:url';
import{execFileSync}from'node:child_process';import{root}from'./runtime.mjs';
const config=JSON.parse(readFileSync(join(root,'worker-config.json'),'utf8'));
const expiry=Date.parse(config.expiresAt);if(!Number.isFinite(expiry))throw Error('Explicit worker expiry required');
const stateFile=join(root,'worker-state.json'),api=fileURLToPath(new URL('../../',import.meta.url));
const save=state=>writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600});
let state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{};
state={...state,running:true,expiresAt:config.expiresAt};
let stopping=false;
for(const signal of['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;state.running=false;save(state);});
while(!stopping&&Date.now()<expiry){
 const next=Date.parse(state.nextAttemptAt??'');
 if(Number.isFinite(next)&&next>Date.now()){await new Promise(resolve=>setTimeout(resolve,Math.min(30000,next-Date.now())));continue;}
 state.lastAttemptAt=new Date().toISOString();state.lastError=null;save(state);
 try{
  for(const args of[
   [join(api,'scripts/launch-sync/rehearse.mjs'),'--credentials',config.credentialFile,'--reuse-copy'],
   ['--import','tsx',join(api,'scripts/launch-sync/import.mjs'),'--apply']
  ]){
   const output=execFileSync(process.execPath,args,{cwd:api,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:15*60*1000,maxBuffer:8*1024*1024});
   writeFileSync(join(root,'worker-last-step.log'),output,{mode:0o600});
  }
  state.lastSuccessAt=new Date().toISOString();state.nextAttemptAt=new Date(Date.now()+3600000).toISOString();
 }catch(error){state.lastError='sync_attempt_failed_previous_data_preserved';state.nextAttemptAt=new Date(Date.now()+300000).toISOString();
  // Child scripts redact errors and emit aggregate counts only.
  writeFileSync(join(root,'worker-last-step.log'),Buffer.concat([error.stdout??Buffer.alloc(0),error.stderr??Buffer.alloc(0)]),{mode:0o600});}
 save(state);
}
state.running=false;state.stoppedAt=new Date().toISOString();save(state);
