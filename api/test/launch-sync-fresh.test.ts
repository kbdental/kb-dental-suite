// A new, fictional installation; never reads/copies an existing clinic database.
import {readFileSync,existsSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import pg from 'pg';
import {afterAll,describe,expect,it} from 'vitest';
import {OWNER_URL} from './setup.js';
import {buildApp} from '../src/app.js';
import {createDb} from '../src/db/index.js';

const api=fileURLToPath(new URL('../',import.meta.url));
const root=mkdtempSync(join(tmpdir(),'kb-fresh-import-test-'));
const adminUrl=new URL(OWNER_URL);adminUrl.pathname='/postgres';adminUrl.username='postgres';
adminUrl.password=readFileSync(join(homedir(),'.kb-pms/postgres-superuser.txt'),'utf8').trim();
const env={...process.env,KB_SYNC_RUNTIME_DIR:root,KB_SYNC_ADMIN_URL:adminUrl.href};
const run=(script:string,args:string[]=[],extra:Record<string,string>={})=>execFileSync(process.execPath,
 ['--import','tsx',join(api,'scripts/launch-sync',script),...args],{cwd:api,env:{...env,...extra},encoding:'utf8',windowsHide:true,timeout:90000,stdio:['ignore','pipe','pipe']});
const state=()=>JSON.parse(readFileSync(join(root,'runtime-state.json'),'utf8'));
const targetUrl=(user:string,password:string,database:string)=>{const u=new URL(adminUrl);u.pathname='/'+database;u.username=user;u.password=password;return u.href;};
const ident=(s:string)=>'"'+s.replaceAll('"','""')+'"';

afterAll(async()=>{
 const file=join(root,'runtime-state.json');
 if(existsSync(file)){
  const s=state(),admin=new pg.Client({connectionString:adminUrl.href});await admin.connect();
  try{
   if(!/^kb_launch_sync_test_[0-9]{8}_[0-9]{6}_[a-f0-9]{6}$/.test(s.database)||!s.marker.startsWith('kb-launch-sync-test:'))throw Error('Unsafe fixture cleanup');
   const found=(await admin.query("SELECT shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=$1",[s.database])).rows[0];
   if(found){if(found.marker!==s.marker)throw Error('Fixture database marker changed');await admin.query('DROP DATABASE '+ident(s.database));}
   for(const role of [s.app,s.owner]){
    if(!/^kb_sync_(?:app|owner)_[a-f0-9]{10}$/.test(role))throw Error('Unsafe role cleanup');
    const found=(await admin.query("SELECT shobj_description(oid,'pg_authid') marker FROM pg_roles WHERE rolname=$1",[role])).rows[0];
    if(found){if(found.marker!==s.marker)throw Error('Fixture role marker changed');await admin.query('DROP ROLE '+ident(role));}
   }
  }finally{await admin.end();}
 }
 const folder=resolve(root);if(!folder.startsWith(resolve(tmpdir())+sep+'kb-fresh-import-test-'))throw Error('Unsafe folder cleanup');
 rmSync(folder,{recursive:true,force:true});
});

describe('fresh Google import installation',()=>{
 it('plans without credentials, databases, or private state writes',()=>{
  const result=JSON.parse(run('fresh.mjs',[],{KB_SYNC_ADMIN_URL:''}));
  expect(result).toMatchObject({mode:'plan',sourceDatabaseRequired:false,googleWrites:false});
  expect(existsSync(join(root,'runtime-state.json'))).toBe(false);
 });
 it('creates only a source-empty organization and restricted, dedicated roles',async()=>{
  const result=JSON.parse(run('fresh.mjs',['--apply','--hostname','vm.example.invalid']));
  expect(result).toMatchObject({initialized:true,sourceDatabaseCopied:false,readyForWeb:false});
  const s=state();expect(s).toMatchObject({installMode:'fresh',complete:true,importReady:false});
  const client=new pg.Client({connectionString:targetUrl('postgres',adminUrl.password,s.database)});await client.connect();
  try{
   for(const table of ['patients','org_patients','appointments','receipts','patient_documents'])expect(Number((await client.query('SELECT count(*) n FROM '+table)).rows[0].n)).toBe(0);
   expect(Number((await client.query('SELECT count(*) n FROM clinics')).rows[0].n)).toBe(1);
   expect(Number((await client.query('SELECT count(*) n FROM org_clinical_units')).rows[0].n)).toBe(1);
   expect(Number((await client.query('SELECT count(*) n FROM app_users')).rows[0].n)).toBe(4);
   expect(Number((await client.query('SELECT count(*) n FROM schema_migrations')).rows[0].n)).toBe(38);
   expect((await client.query('SELECT bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole) ok FROM pg_roles WHERE rolname=ANY($1)',[[s.app,s.owner]])).rows[0].ok).toBe(true);
   expect(Number((await client.query('SELECT count(*) n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname=\'public\' AND p.prosecdef AND r.rolsuper')).rows[0].n)).toBe(0);
   expect((await client.query("SELECT relforcerowsecurity FROM pg_class WHERE oid='patients'::regclass")).rows[0].relforcerowsecurity).toBe(true);
  }finally{await client.end();}
  const app=new pg.Client({connectionString:targetUrl(s.app,s.appPassword,s.database)});await app.connect();
  try{await expect(app.query('SELECT * FROM launch_sync.runs')).rejects.toMatchObject({code:'42501'});await expect(app.query('SELECT * FROM org_clinical_access')).rejects.toMatchObject({code:'42501'});}finally{await app.end();}
  expect(()=>run('server.mjs')).toThrow();
 },90000);
 it('reruns without rotating credentials and refuses a mismatched database identity',async()=>{
  const before=readFileSync(join(root,'runtime-state.json'),'utf8');
  expect(JSON.parse(run('fresh.mjs',['--apply'])).alreadyInitialized).toBe(true);
  expect(readFileSync(join(root,'runtime-state.json'),'utf8')).toBe(before);
  const s=state(),copyFile=join(root,'copy-state.json'),copy=readFileSync(copyFile,'utf8');
  writeFileSync(copyFile,JSON.stringify({...JSON.parse(copy),marker:'kb-launch-sync-test:wrong'}));
  try{expect(()=>run('fresh.mjs',['--apply'])).toThrow();}finally{writeFileSync(copyFile,copy);}
  expect(state().appPassword).toBe(s.appPassword);
  const runtimeFile=join(root,'runtime-state.json'),original=readFileSync(runtimeFile,'utf8');
  writeFileSync(runtimeFile,'{"private":"FICTIONAL-SECRET-SHOULD-NOT-PRINT",broken}');
  try{
   let stderr='';try{run('fresh.mjs',['--apply']);}catch(error){stderr=String((error as {stderr?:string}).stderr??'');}
   expect(stderr).toContain('Fresh setup failed');expect(stderr).not.toContain('FICTIONAL-SECRET-SHOULD-NOT-PRINT');
  }finally{writeFileSync(runtimeFile,original);}
 });
 it('imports fictional five-book source data and serves protected native APIs without a review clone',async()=>{
  const s=state(),client=new pg.Client({connectionString:targetUrl('postgres',adminUrl.password,s.database)});await client.connect();
  const book=(role:string,tabs:{title:string;rows:unknown[][]}[])=>({role,id:'fictional-'+role,title:role,timeZone:'Asia/Kolkata',tabs});
  const books=[
   book('main',[
    {title:'Registrations',rows:[['Timestamp','UHID','Full Name','Patient Type'],['2026-11-13','FICTIONAL-VM-1','Fictional VM Patient','Normal']]},
    {title:'Daily Register',rows:[['Timestamp','UHID','Full Name','Work Done'],['2026-11-13','FICTIONAL-VM-1','Fictional VM Patient','Fictional observation']]},
    {title:'Appointments',rows:[['ID','Date','Time','UHID','Patient Name','Status'],['fixture-1','2026-11-13','10:00','FICTIONAL-VM-1','Fictional VM Patient','Scheduled']]}
   ]),
   book('clinical',[{title:'RCT',rows:[['Timestamp','UHID','Patient Name','Doctor'],['2026-11-13','FICTIONAL-VM-1','Fictional VM Patient','Fictional Doctor']]}]),
   book('finance',[{title:'Patient Fee Receipt',rows:[['Timestamp','UHID',"Patient's Name",'Payment Mode','Amount'],['2026-11-13','FICTIONAL-VM-1','Fictional VM Patient','Cash',1250]]}]),
   book('empanelled',[{title:'Registrations',rows:[['Timestamp','UHID','Full Name']]}]),
   book('historical-registration',[{title:'Registration Form',rows:[['Timestamp','UHID','Full Name']]}])
  ];
  try{
   const runId=(await client.query('INSERT INTO launch_sync.runs(id,started_at) VALUES(uuidv7(),now()) RETURNING id')).rows[0].id;
   for(const b of books){
    await client.query('INSERT INTO launch_sync.workbooks(run_id,source_id,source_role,metadata) VALUES($1,$2,$3,$4)',[runId,b.id,b.role,JSON.stringify({title:b.title,timeZone:b.timeZone})]);
    for(const [i,tab]of b.tabs.entries())await client.query('INSERT INTO launch_sync.tabs VALUES($1,$2,$3,$4,$5,$6,$6)',[runId,b.id,i,tab.title,'fictional-hash',JSON.stringify(tab.rows)]);
   }
   await client.query("UPDATE launch_sync.runs SET completed_at=now(),source_hash='fictional' WHERE id=$1",[runId]);
   const protectedRow=(await client.query("INSERT INTO clinical_records(clinic_id,tab_name,uhid,fields) VALUES($1,'RCT','FICTIONAL-EXISTING','{}') RETURNING id",[s.primaryClinicId])).rows[0].id;
   try{
    expect(()=>run('import.mjs',['--apply'])).toThrow();
    expect(Number((await client.query('SELECT count(*) n FROM clinical_records WHERE id=$1',[protectedRow])).rows[0].n)).toBe(1);
    expect(state().importReady).toBe(false);
   }finally{await client.query('DELETE FROM clinical_records WHERE id=$1',[protectedRow]);}
  }finally{await client.end();}
  const report=JSON.parse(run('import.mjs',['--apply']));
  expect(report.readyForVerification).toBe(true);expect(report.actual.patients).toBe(1);expect(report.financialCents.receipts).toMatchObject({actual:125000,matched:true});
  expect(state().importReady).toBe(true);
  const again=JSON.parse(run('import.mjs',['--apply']));expect(again.actual.patients).toBe(1);expect(again.actual.receipts).toBe(1);
  const db=createDb(targetUrl(s.app,s.appPassword,s.database),2),app=await buildApp({db,cookieSecure:false});
  try{
   expect((await app.inject({url:'/exec?action=getAllPatients'})).json().authRequired).toBe(true);
   const response=await app.inject({method:'POST',url:'/exec',payload:{action:'staffLogin',clinic:'kb-review',username:'admin',password:s.userPasswords.admin}}),login=response.json();
   expect(login.success).toBe(true);
   const cookie='kb_session='+response.cookies.find(c=>c.name==='kb_session')!.value;
   const me=(await app.inject({method:'POST',url:'/exec',headers:{cookie},payload:{action:'whoAmI'}})).json();
   const headers={cookie,'x-kb-clinic':me.clinicId,'x-kb-clinic-revision':String(me.clinicRevision)};
   const patients=(await app.inject({method:'POST',url:'/exec',headers,payload:{action:'getAllPatients'}})).json();
   expect(patients.success).toBe(true);expect(patients.patients).toHaveLength(1);
   expect(patients.patients[0].uhid).toBe('FICTIONAL-VM-1');
   const clinics=(await app.inject({method:'POST',url:'/exec',headers,payload:{action:'getWorkingClinics'}})).json();
   expect(clinics.clinics).toHaveLength(1);
  }finally{await app.close();await db.destroy();}
 },90000);
 it('starts the real server and verifies a fresh snapshot without old hard-coded flags or plan rows',async()=>{
  const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=(reservation.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  const file=join(root,'app.env'),previous=readFileSync(file,'utf8');
  writeFileSync(file,previous.replace(/^PORT=.*$/m,'PORT='+port));
  const base='http://127.0.0.1:'+port;writeFileSync(join(root,'public-url.txt'),base);
  const child=spawn(process.execPath,['--import','tsx',join(api,'scripts/launch-sync/server.mjs')],{cwd:api,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
   await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Fixture server did not become ready')),15000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture server exited before readiness'));});
    child.stdout.on('data',data=>{if(String(data).includes('"listening":true')){clearTimeout(timer);resolve();}});
   });
   const result=await promisify(execFile)(process.execPath,['--import','tsx',join(api,'scripts/launch-sync/verify-site.mjs'),base],{cwd:api,env,windowsHide:true,timeout:45000});
   const report=JSON.parse(result.stdout);expect(report.passed).toBeGreaterThanOrEqual(10);expect(report.skipped).toHaveLength(2);
  }finally{
   if(child.exitCode===null){const stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill();await stopped;}
   writeFileSync(file,previous);
  }
 },90000);
});
