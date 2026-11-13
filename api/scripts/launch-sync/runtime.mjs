import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {homedir} from 'node:os';
import pg from 'pg';
export const root=fileURLToPath(new URL('../../.organization-demo-runtime/launch-sync/',import.meta.url));
pg.types.setTypeParser(1082,value=>value);
export const quote=value=>'"'+value.replaceAll('"','""')+'"';
export const literal=value=>"'"+value.replaceAll("'","''")+"'";
export async function copyConnection({administrative=false}={}) {
  const state=JSON.parse(readFileSync(join(root,'copy-state.json'),'utf8'));
  if(!/^kb_launch_sync_test_[0-9]{8}_[0-9]{6}_[a-f0-9]{6}$/.test(state.database))throw new Error('Invalid copy target');
  const runtimeFile=join(root,'runtime-state.json');
  const runtime=!administrative&&existsSync(runtimeFile)?JSON.parse(readFileSync(runtimeFile,'utf8')):null;
  const config={host:'127.0.0.1',port:5432,database:state.database,user:runtime?.complete?runtime.owner:'postgres',
    password:runtime?.complete?runtime.ownerPassword:readFileSync(join(homedir(),'.kb-pms/postgres-superuser.txt'),'utf8').trim()};
  const db=new pg.Client(config);await db.connect();
  const marker=(await db.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0].marker;
  if(!state.marker?.startsWith('kb-launch-sync-test:')||marker!==state.marker){await db.end();throw new Error('Copy marker mismatch');}
  return {db,state,config};
}
export async function loadCapture(db) {
  const run=(await db.query('SELECT id,started_at,source_hash,summary FROM launch_sync.runs WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1')).rows[0];
  if(!run)throw new Error('No capture');
  const rows=(await db.query(`SELECT w.source_id,w.source_role,w.metadata,t.tab_id,t.title,t.cells,t.raw_cells
    FROM launch_sync.tabs t JOIN launch_sync.workbooks w USING(run_id,source_id) WHERE t.run_id=$1 ORDER BY w.source_role,t.tab_id`,[run.id])).rows;
  const grouped=new Map();
  for(const row of rows){
    if(!grouped.has(row.source_id))grouped.set(row.source_id,{id:row.source_id,role:row.source_role,...row.metadata,tabs:[]});
    grouped.get(row.source_id).tabs.push({id:row.tab_id,title:row.title,rows:row.cells,rawRows:row.raw_cells});
  }
  const books=[...grouped.values()];
  if(books.length!==5||!['main','clinical','finance','empanelled','historical-registration'].every(role=>books.some(book=>book.role===role)))throw new Error('Incomplete five-workbook source capture');
  return {run,books};
}
