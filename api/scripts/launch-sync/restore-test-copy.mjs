// Rehearsal-only rollback before a web runtime exists. Never kills connections.
import{existsSync}from'node:fs';import{join}from'node:path';import{execFileSync}from'node:child_process';
import{copyConnection,root}from'./runtime.mjs';
if(process.argv[2]!=='--before-initial-import')throw Error('Explicit rehearsal rollback flag required');
if(existsSync(join(root,'app.env')))throw Error('A web runtime exists; refuse to discard review edits');
const{db,state,config}=await copyConnection();
try{
 const active=Number((await db.query('SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')).rows[0].n);
 if(active)throw Error('Another connection is using the copy');
 const file=join(root,'before-normalized-import.dump');if(!existsSync(file))throw Error('Rollback backup missing');
 await db.end();
 execFileSync(join(process.env.KB_PG_BIN??'C:/Program Files/PostgreSQL/18/bin','pg_restore.exe'),
  ['--exit-on-error','--no-owner','--no-privileges','--clean','--if-exists','--dbname='+state.database,file],
  {env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:config.user,PGPASSWORD:config.password},windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});
 console.log('Isolated copy restored to its private pre-import backup. No active website or source changed.');
}catch(error){try{await db.end();}catch{}console.error(JSON.stringify({restored:false,code:error.code??error.name}));process.exitCode=1;}
