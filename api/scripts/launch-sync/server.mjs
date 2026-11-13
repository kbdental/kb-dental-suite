// Native backend with its own login. No Apps Script credentials or source writes.
import{readFileSync,existsSync}from'node:fs';import{join}from'node:path';import{parseEnv}from'node:util';
import{root}from'./runtime.mjs';
const file=join(root,'app.env'),config=parseEnv(readFileSync(file,'utf8'));
const state=JSON.parse(readFileSync(join(root,'runtime-state.json'),'utf8'));
if(state.installMode==='fresh'&&!state.importReady)throw Error('Fresh installation requires a reconciled source import before the website can start');
const system=new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','COMSPEC','PATHEXT']);
for(const key of Object.keys(process.env))if(!system.has(key.toUpperCase()))delete process.env[key];
Object.assign(process.env,config,{KB_APP_ENV_FILE:file,KB_LOAD_OWNER_ENV:'false',ANTHROPIC_API_KEY:'',PDF_BROWSER:''});
const[{createDb},{buildApp},{asActor},{sql}]=await Promise.all([import('../../src/db/index.ts'),import('../../src/app.ts'),import('../../src/http/context.ts'),import('kysely')]);
const{HttpError}=await import('../../src/http/errors.ts');
const url=new URL(config.DATABASE_URL);
if(!state.complete||url.pathname!=='/'+state.database||!/^kb_launch_sync_test_[0-9]{8}_[0-9]{6}_[a-f0-9]{6}$/.test(state.database)||url.username!==state.app)throw Error('Unexpected database runtime');
const db=createDb(config.DATABASE_URL,8);
const marker=(await sql`SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`.execute(db)).rows[0].marker;
if(marker!==state.marker)throw Error('Runtime marker mismatch');
const app=await buildApp({db,cookieSecure:true,publicDemo:true,logger:false});
const report=()=>JSON.parse(readFileSync(join(root,'import-summary.json'),'utf8'));
app.get('/api/v1/launch-sync/status',async req=>asActor(db,req,'roles:manage',async(_tx,actor)=>{
 if(actor.clinicId!==state.primaryClinicId)throw new HttpError(403,'forbidden','Open the source clinic to review its sync');
 const r=report(),workerFile=join(root,'worker-state.json'),worker=existsSync(workerFile)?JSON.parse(readFileSync(workerFile,'utf8')):null;
 return {verificationOnly:true,capturedAt:r.capturedAt,appliedAt:r.appliedAt,financeFrom:r.financeFrom,counts:r.actual,
  sourceWarnings:r.warnings,sourceRejections:r.rejections,sourceIssueCount:r.sourceIssueCount,conflicts:r.conflicts,missingSource:r.missingSource,
  financeReconciled:Object.values(r.financialCents).every(x=>x.matched),worker:worker?{running:worker.running,lastSuccessAt:worker.lastSuccessAt??null,nextAttemptAt:worker.nextAttemptAt??null,expiresAt:worker.expiresAt,lastError:worker.lastError??null}:null};
}));
app.get('/api/v1/launch-sync/issues',async req=>asActor(db,req,'roles:manage',async(_tx,actor)=>{
 if(actor.clinicId!==state.primaryClinicId)throw new HttpError(403,'forbidden','Open the source clinic to review its sync');
 const file=join(root,'source-issues.json');return {issues:existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[]};
}));
// This page contains no embedded patient data or credentials. Details require the
// current staff session, clinic context and organization-management permission.
app.get('/sync-review',async(_req,reply)=>reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Sync review</title><style>body{font:16px Arial,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#21313b}section{background:#f2f5f7;padding:18px;margin:16px 0;border-radius:8px}a{color:#075f91}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}</style></head><body><h1>Verification data and sync</h1><p>Entries on this verification website do not return to Google Sheets. Continue operational work on the existing website until the final cutover.</p><p><a href="/">Back to the application / sign in</a></p><section id="status">Checking your login…</section><section><h2>Imported records</h2><table><tbody id="counts"></tbody></table></section><section><h2>Source entries needing review</h2><p>Unreadable amounts are held for review; they are not silently counted as zero. Source links open in Google Sheets and require your Google account.</p><ul id="issues"></ul></section><script src="/sync-review.js"></script></body></html>`));
app.get('/sync-review.js',async(_req,reply)=>reply.type('text/javascript').send(`(async()=>{
const output=document.getElementById('status');const add=(parent,tag,text)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
try{const me=await(await fetch('/exec?action=whoAmI')).json();if(!me.success)throw Error('Sign in to the application first.');
const headers={'X-KB-Clinic':me.clinicId,'X-KB-Clinic-Revision':String(me.clinicRevision)};
const response=await fetch('/api/v1/launch-sync/status',{headers});const data=await response.json();if(!response.ok)throw Error(data.error?.message||'Your account cannot view sync status.');output.textContent='';
const when=value=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST':'Not yet';
add(output,'p','Source captured: '+when(data.capturedAt));add(output,'p','Database updated: '+when(data.appliedAt));
add(output,'p','Finance begins 1 April 2024. Readable source amounts reconcile: '+(data.financeReconciled?'Yes':'Needs review'));
add(output,'p','Conflicts held for review: '+data.conflicts+'. Source entries needing review: '+data.sourceIssueCount+'.');
if(data.worker){add(output,'p','Automatic refresh: '+(data.worker.running?'running':'stopped')+'. Last successful refresh: '+when(data.worker.lastSuccessAt));
add(output,'p','Next attempt: '+when(data.worker.nextAttemptAt)+'. Verification window ends: '+when(data.worker.expiresAt));if(data.worker.lastError)add(output,'p','The latest refresh failed. The previous imported dataset is preserved; the worker will retry.');}
const labels={patients:'Patient identities, including flagged historical identities',patient_registrations:'Registration histories',clinical_records:'Clinical forms',clinical_sheets:'Clinical charts',care_plans:'Care plans',treatment_cases:'Treatment cases',daily_register:'Register entries',appointments:'Appointments',receipts:'Receipts',expenses:'Expenses',cghs_bills:'CGHS bills'};
for(const[key,label]of Object.entries(labels)){const row=add(document.getElementById('counts'),'tr','');add(row,'td',label);add(row,'td',String(data.counts[key]??0));}
const issueResponse=await fetch('/api/v1/launch-sync/issues',{headers});const result=await issueResponse.json();if(!issueResponse.ok)throw Error('Could not load source review links.');
for(const issue of result.issues??[]){const item=add(document.getElementById('issues'),'li',issue.target_table==='expenses'?'Expense amount needs correction: ':'Source entry needs review: ');const ref=issue.source_ref;
if(ref?.book&&Number.isInteger(ref.tab)&&Number.isInteger(ref.row)&&ref.row>0){const link=add(item,'a','Open source row '+ref.row);link.href='https://docs.google.com/spreadsheets/d/'+encodeURIComponent(ref.book)+'/edit#gid='+ref.tab+'&range=A'+ref.row;link.target='_blank';link.rel='noopener noreferrer';}}
if(!result.issues?.length)add(document.getElementById('issues'),'li','No row-level exception links are currently available.');
}catch(error){output.textContent=error.message;}})();`));
const port=Number(config.PORT??8350);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid private application port');
await app.listen({host:'127.0.0.1',port});
console.log(JSON.stringify({listening:true,host:'127.0.0.1',port,googleWrites:false}));
for(const signal of['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();await db.destroy();process.exit(0);});
