// Creates a NEW empty installation. No source database, Google access, resets or seeds.
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {root,quote,literal} from './runtime.mjs';
import {privateDirectory,privateJson,privateWrite} from './private-files.mjs';

const secret=()=>randomBytes(24).toString('base64url');
class SetupError extends Error {}
const stateFile=join(root,'runtime-state.json'),copyFile=join(root,'copy-state.json');
const rolePattern=/^kb_sync_(?:owner|app)_[a-f0-9]{10}$/;

function adminConnection() {
 if(!process.env.KB_SYNC_ADMIN_URL)throw new SetupError('KB_SYNC_ADMIN_URL is required in a private environment file');
 const url=new URL(process.env.KB_SYNC_ADMIN_URL);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/postgres'||!url.username||!url.password||url.search||url.hash)throw new SetupError('Expected a local PostgreSQL administrative URL for the postgres database');
 return url;
}
const databaseUrl=(admin,database,user,password)=>{const u=new URL(admin);u.pathname='/'+database;u.username=user;u.password=password;return u.href;};

async function verifyExisting(admin,state) {
 if(state.installMode!=='fresh'||!state.complete||!/^kb_launch_sync_test_[0-9]{8}_[0-9]{6}_[a-f0-9]{6}$/.test(state.database)||!state.marker?.startsWith('kb-launch-sync-test:')||!rolePattern.test(state.owner)||!rolePattern.test(state.app))throw new SetupError('Existing runtime is not a completed fresh installation; review it without resetting');
 const copy=JSON.parse(readFileSync(copyFile,'utf8'));
 if(copy.database!==state.database||copy.marker!==state.marker||copy.installMode!=='fresh')throw new SetupError('Private state files disagree');
 const db=(await admin.query("SELECT shobj_description(d.oid,'pg_database') marker,r.rolname owner FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=$1",[state.database])).rows[0];
 if(db?.marker!==state.marker||db.owner!==state.owner)throw new SetupError('Database ownership or marker mismatch');
 for(const role of [state.owner,state.app]){
  const found=(await admin.query("SELECT shobj_description(oid,'pg_authid') marker,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1",[role])).rows[0];
  if(found?.marker!==state.marker||found.rolsuper||found.rolbypassrls||found.rolcreatedb||found.rolcreaterole||found.rolreplication)throw new SetupError('Role identity or privileges mismatch');
 }
}

async function initializeSchema(adminUrl,state,options) {
 const url=databaseUrl(adminUrl,state.database,decodeURIComponent(adminUrl.username),decodeURIComponent(adminUrl.password));
 const {migrate}=await import('../../src/migrator.ts');
 await migrate(url,()=>{},{applyGrants:false});
 const {DEFAULT_ROLES}=await import('../../src/auth/permissions.ts');
 const {hashPassword}=await import('../../src/auth/password.ts');
 const db=new pg.Client({connectionString:url});await db.connect();
 try{
  await db.query('BEGIN');
  const organization=(await db.query('INSERT INTO org_identity(id,code,name,hostname) VALUES(uuidv7(),$1,$2,$3) RETURNING id',['kb-vm',options.organizationName,options.hostname])).rows[0].id;
  await db.query("SELECT set_config('app.organization_id',$1,true)",[organization]);
  const clinic=(await db.query("INSERT INTO clinics(code,name,timezone) VALUES('kb-review',$1,'Asia/Kolkata') RETURNING id",[options.clinicName])).rows[0].id;
  await db.query("SELECT set_config('app.clinic_id',$1,true)",[clinic]);
  const unit=(await db.query("INSERT INTO org_units(code,name) VALUES('primary',$1) RETURNING id",[options.clinicName])).rows[0].id;
  await db.query('INSERT INTO org_clinical_units(organization_id,unit_id,clinic_id) VALUES($1,$2,$3)',[organization,unit,clinic]);
  for(const role of DEFAULT_ROLES){
   const id=(await db.query('INSERT INTO roles(name,permissions) VALUES($1,$2) RETURNING id',[role.name,role.permissions])).rows[0].id;
   const user=(await db.query('INSERT INTO app_users(username,display_name,password_hash,role_id) VALUES($1,$2,$3,$4) RETURNING id',[role.name,role.name,await hashPassword(state.userPasswords[role.name]),id])).rows[0].id;
   await db.query('INSERT INTO org_clinical_access(organization_id,principal_clinic_id,principal_user_id,clinic_id,user_id,manage_organization) VALUES($1,$2,$3,$2,$3,$4)',[organization,clinic,user,role.name==='admin']);
  }
  const password=await hashPassword(state.screenPassword);
  await db.query("INSERT INTO org_settings(key,value) VALUES('clinical_master_password',$1::jsonb)",[JSON.stringify(password)]);
  for(const key of ['master_password','finance_password','reports_password_1','reports_password_2'])await db.query('INSERT INTO clinic_settings(key,value) VALUES($1,$2::jsonb)',[key,JSON.stringify(password)]);
  await db.query('CREATE SCHEMA launch_sync');
  await db.query(`CREATE TABLE launch_sync.runs(id uuid PRIMARY KEY,started_at timestamptz NOT NULL,completed_at timestamptz,source_hash text,summary jsonb NOT NULL DEFAULT '{}'::jsonb);
   CREATE TABLE launch_sync.workbooks(run_id uuid NOT NULL REFERENCES launch_sync.runs(id),source_id text NOT NULL,source_role text NOT NULL,metadata jsonb NOT NULL,PRIMARY KEY(run_id,source_id));
   CREATE TABLE launch_sync.tabs(run_id uuid NOT NULL,source_id text NOT NULL,tab_id int NOT NULL,title text NOT NULL,content_hash text NOT NULL,cells jsonb NOT NULL,raw_cells jsonb NOT NULL,PRIMARY KEY(run_id,source_id,tab_id),FOREIGN KEY(run_id,source_id) REFERENCES launch_sync.workbooks(run_id,source_id));`);
  await db.query('COMMIT');
  state.primaryClinicId=clinic;
  // Transfer only this new database's application objects, never shared/global objects.
  for(const schema of ['public','launch_sync']){
   const tables=(await db.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[schema])).rows;
   for(const table of tables)await db.query(`ALTER TABLE ${quote(schema)}.${quote(table.tablename)} OWNER TO ${quote(state.owner)}`);
   await db.query(`ALTER SCHEMA ${quote(schema)} OWNER TO ${quote(state.owner)}`);
  }
  const functions=(await db.query("SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')")).rows;
  for(const fn of functions)await db.query(`ALTER FUNCTION ${fn.signature} OWNER TO ${quote(state.owner)}`);
  for(const seq of(await db.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public'")).rows)await db.query(`ALTER SEQUENCE public.${quote(seq.sequencename)} OWNER TO ${quote(state.owner)}`);
  const grants=readFileSync(fileURLToPath(new URL('../../migrations/grants.sql',import.meta.url)),'utf8').replace(/\bkb_app\b/g,quote(state.app));
  await db.query(grants);
  await db.query(`REVOKE ALL ON SCHEMA launch_sync FROM PUBLIC,${quote(state.app)}; REVOKE ALL ON ALL TABLES IN SCHEMA launch_sync FROM PUBLIC,${quote(state.app)}`);
  for(const fn of(await db.query("SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef")).rows)await db.query(`REVOKE ALL ON FUNCTION ${fn.signature} FROM PUBLIC`);
 }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}finally{await db.end();}
}

export async function main(args=process.argv.slice(2)) {
 const options={hostname:'127.0.0.1:8350',organizationName:'KB Dental',clinicName:'KB Dental'};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--apply')continue;
  const key={'--hostname':'hostname','--organization-name':'organizationName','--clinic-name':'clinicName'}[args[i]];
  if(!key||!args[i+1]||args[i+1].startsWith('--'))throw new SetupError('Unknown or incomplete fresh-install argument');
  options[key]=args[++i];
 }
 const hostname=new URL('https://'+options.hostname);
 if(hostname.host!==options.hostname||hostname.pathname!=='/'||hostname.username||hostname.password||hostname.search||hostname.hash||Object.values(options).some(value=>value.length>200||!value.trim()))throw new SetupError('Invalid installation identity');
 if(!args.includes('--apply'))return {mode:'plan',sourceDatabaseRequired:false,googleWrites:false,creates:'new empty database, organization, clinic and private accounts',next:'capture with --reuse-copy, then import --apply'};
 // Never enter the old clone/reset/provision flows, even when files already exist.
 const adminUrl=adminConnection(),admin=new pg.Client({connectionString:adminUrl.href});await admin.connect();
 try{
  if(existsSync(stateFile)){
   const state=JSON.parse(readFileSync(stateFile,'utf8'));await verifyExisting(admin,state);
   return {initialized:true,alreadyInitialized:true,credentialsUnchanged:true,readyForWeb:!!state.importReady};
  }
  if(existsSync(copyFile)||existsSync(join(root,'app.env')))throw new SetupError('Existing copy/configuration found; fresh setup will not replace it');
  if(Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num)<180000)throw new SetupError('PostgreSQL 18 or newer is required');
  if(!(await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper)throw new SetupError('One-time local PostgreSQL administrator access is required');
  const suffix=randomBytes(5).toString('hex'),timestamp=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
  const state={installMode:'fresh',database:`kb_launch_sync_test_${timestamp.slice(0,8)}_${timestamp.slice(8)}_${randomBytes(3).toString('hex')}`,marker:'kb-launch-sync-test:'+randomUUID(),
   host:adminUrl.hostname==='[::1]'?'::1':adminUrl.hostname,port:Number(adminUrl.port||5432),owner:'kb_sync_owner_'+suffix,app:'kb_sync_app_'+suffix,
   ownerPassword:secret(),appPassword:secret(),userPasswords:Object.fromEntries(['admin','doctor','reception','accounts'].map(user=>[user,secret()])),
   screenPassword:secret(),secretsKey:randomBytes(32).toString('base64'),complete:false,importReady:false};
  if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[state.database])).rowCount||(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)',[[state.owner,state.app]])).rowCount)throw new SetupError('New database/role collision; no existing resources are adopted');
  privateDirectory(root);privateJson(stateFile,state,{exclusive:true});
  privateJson(copyFile,{database:state.database,marker:state.marker,installMode:'fresh',host:state.host,port:state.port,sourceDatabase:null,createdAt:new Date().toISOString(),applicationTablesUpdated:false},{exclusive:true});
  for(const [role,password]of[[state.owner,state.ownerPassword],[state.app,state.appPassword]]){
   await admin.query('BEGIN');
   try{await admin.query(`CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD ${literal(password)}`);await admin.query(`COMMENT ON ROLE ${quote(role)} IS ${literal(state.marker)}`);await admin.query('COMMIT');}catch(error){await admin.query('ROLLBACK');throw error;}
  }
  await admin.query(`CREATE DATABASE ${quote(state.database)} OWNER ${quote(state.owner)}`);
  await admin.query(`COMMENT ON DATABASE ${quote(state.database)} IS ${literal(state.marker)}`);
  await admin.query(`REVOKE ALL ON DATABASE ${quote(state.database)} FROM PUBLIC; GRANT CONNECT ON DATABASE ${quote(state.database)} TO ${quote(state.app)}`);
  await initializeSchema(adminUrl,state,options);
  const documents=join(root,'documents');privateDirectory(documents);
  const config={DATABASE_URL:databaseUrl(adminUrl,state.database,state.app,state.appPassword),PORT:'8350',DOCUMENT_DIR:documents.replaceAll('\\','/'),KB_SECRETS_KEY:state.secretsKey,ANTHROPIC_API_KEY:'',PDF_BROWSER:''};
  privateWrite(join(root,'app.env'),Object.entries(config).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{exclusive:true});
  privateWrite(join(root,'logins.txt'),'PRIVATE VM INSTALLATION\nClinic code: kb-review\n'+Object.entries(state.userPasswords).map(([u,p])=>u+': '+p).join('\n')+'\nMaster / Finance / Reports: '+state.screenPassword+'\nSource import and acceptance are required before use.\n',{exclusive:true});
  state.complete=true;privateJson(stateFile,state);
  return {initialized:true,sourceDatabaseCopied:false,syntheticPatientsCreated:0,readyForWeb:false,credentialsWrittenPrivately:true,next:'capture --reuse-copy, then import --apply'};
 }finally{await admin.end();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({initialized:false,error:error.name,code:error.code??null,message:error instanceof SetupError?error.message:'Fresh setup failed; inspect private setup state without resetting'}));process.exitCode=1;});
}
