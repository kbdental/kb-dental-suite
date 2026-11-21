import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {copyConnection,quote,root} from './runtime.mjs';

export async function applyRuntimeMigrations({db,state,config},log=()=>{}) {
 const runtimeFile=join(root,'runtime-state.json');
 const runtime=existsSync(runtimeFile)?JSON.parse(readFileSync(runtimeFile,'utf8')):null;
 if(runtime?.complete){
  if(runtime.database!==state.database||runtime.marker!==state.marker||config.user!==runtime.owner||!/^kb_sync_app_[a-f0-9]{10}$/.test(runtime.app))
   throw Error('Runtime roles do not match the marked database');
  const role=(await db.query('SELECT NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) AS restricted FROM pg_roles WHERE rolname=$1',[runtime.app])).rows[0];
  if(!role?.restricted)throw Error('Unexpected verification application privileges');
 }
 const url=new URL('postgresql://localhost/'+state.database);
 url.hostname=config.host;url.port=String(config.port);url.username=config.user;url.password=config.password;
 const {migrate}=await import('../../src/migrator.ts');
 await migrate(url.href,log,{applyGrants:false});
 if(runtime?.complete){
  const app=quote(runtime.app);
  await db.query(`GRANT SELECT, INSERT ON public.cghs_prescriptions, public.cghs_prescription_pdfs TO ${app};
    REVOKE UPDATE, DELETE ON public.cghs_prescriptions, public.cghs_prescription_pdfs FROM ${app}`);
  const permissions=(await db.query(`SELECT count(*)=2 AND bool_and(relrowsecurity AND relforcerowsecurity
     AND has_table_privilege($1,oid,'SELECT') AND has_table_privilege($1,oid,'INSERT')
     AND NOT has_table_privilege($1,oid,'UPDATE') AND NOT has_table_privilege($1,oid,'DELETE')) AS safe
    FROM pg_class WHERE oid IN ('public.cghs_prescriptions'::regclass,'public.cghs_prescription_pdfs'::regclass)`,[runtime.app])).rows[0];
  if(!permissions?.safe)throw Error('CGHS table granted more than append-only access or clinic isolation is missing');
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const connection=await copyConnection();
 try{
  const runtime=JSON.parse(readFileSync(join(root,'runtime-state.json'),'utf8'));
  if(!runtime.complete)throw Error('A complete marked runtime is required');
  const locked=(await connection.db.query('SELECT pg_try_advisory_lock(73459341) AS locked')).rows[0].locked;
  if(!locked)throw Error('A verification import or migration is already running');
  await applyRuntimeMigrations(connection,console.log);
  console.log('Marked runtime migrations and CGHS grants verified.');
 }finally{await connection.db.end();}
}
