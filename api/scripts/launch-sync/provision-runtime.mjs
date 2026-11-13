// Dedicated least-privilege runtime for the already marked, converted copy.
import{readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync}from'node:fs';
import{join,resolve,sep}from'node:path';import{fileURLToPath}from'node:url';import{randomBytes,createHash}from'node:crypto';
import{root,copyConnection,quote,literal}from'./runtime.mjs';
if(existsSync(join(root,'copy-state.json'))&&JSON.parse(readFileSync(join(root,'copy-state.json'),'utf8')).installMode==='fresh')throw Error('Fresh installation credentials are provisioned by fresh.mjs; this clone-only helper must not reset them');
const{hashPassword}=await import('../../src/auth/password.ts');
const{db,state}=await copyConnection({administrative:true});
const stateFile=join(root,'runtime-state.json');let phase='preflight';
try{
 const report=JSON.parse(readFileSync(join(root,'import-summary.json'),'utf8'));
 if(!report.applicationTablesUpdated||!report.readyForVerification)throw Error('Converted data is not ready for verification');
 let runtime;
 if(existsSync(stateFile))runtime=JSON.parse(readFileSync(stateFile,'utf8'));
 else{
  const suffix=randomBytes(5).toString('hex'),secret=()=>randomBytes(18).toString('base64url');
  runtime={database:state.database,marker:state.marker,owner:'kb_sync_owner_'+suffix,app:'kb_sync_app_'+suffix,ownerPassword:secret(),appPassword:secret(),
   userPasswords:{admin:secret(),doctor:secret(),reception:secret(),accounts:secret()},screenPassword:secret(),secretsKey:randomBytes(32).toString('base64'),complete:false};
  writeFileSync(stateFile,JSON.stringify(runtime,null,2),{mode:0o600,flag:'wx'});
 }
 if(runtime.database!==state.database||runtime.marker!==state.marker||!/^kb_sync_owner_[a-f0-9]{10}$/.test(runtime.owner)||!/^kb_sync_app_[a-f0-9]{10}$/.test(runtime.app))throw Error('Runtime state does not match copy');
 phase='private database roles';
 for(const [role,password]of[[runtime.owner,runtime.ownerPassword],[runtime.app,runtime.appPassword]]){
  const exists=(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount;
  if(!exists)await db.query(`CREATE ROLE ${quote(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD ${literal(password)}`);
 }
 await db.query(`ALTER DATABASE ${quote(state.database)} OWNER TO ${quote(runtime.owner)}`);
 await db.query(`REVOKE ALL ON DATABASE ${quote(state.database)} FROM PUBLIC,kb_app`);
 await db.query(`GRANT CONNECT ON DATABASE ${quote(state.database)} TO ${quote(runtime.app)}`);
 for(const schema of ['public','launch_sync']){
  await db.query(`ALTER SCHEMA ${quote(schema)} OWNER TO ${quote(runtime.owner)}`);
  const tables=(await db.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[schema])).rows;
  for(const t of tables)await db.query(`ALTER TABLE ${quote(schema)}.${quote(t.tablename)} OWNER TO ${quote(runtime.owner)}`);
 }
 const functions=(await db.query(`SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`)).rows;
 for(const fn of functions)await db.query(`ALTER FUNCTION ${fn.signature} OWNER TO ${quote(runtime.owner)}`);
 const sequences=(await db.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public'")).rows;
 for(const seq of sequences)await db.query(`ALTER SEQUENCE public.${quote(seq.sequencename)} OWNER TO ${quote(runtime.owner)}`);
 await db.query(readFileSync(fileURLToPath(new URL('../../migrations/grants.sql',import.meta.url)),'utf8').replace(/\bkb_app\b/g,quote(runtime.app)));
 await db.query(`REVOKE ALL ON SCHEMA launch_sync FROM PUBLIC,${quote(runtime.app)}`);
 await db.query(`REVOKE ALL ON ALL TABLES IN SCHEMA launch_sync FROM PUBLIC,${quote(runtime.app)}`);
 const definers=(await db.query("SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef")).rows;
 for(const fn of definers)await db.query(`REVOKE EXECUTE ON FUNCTION ${fn.signature} FROM PUBLIC,kb_app`);
 phase='separate application login credentials';
 await db.query('BEGIN');
 const users=(await db.query('SELECT id,username::text FROM app_users')).rows;
 for(const user of users){const password=runtime.userPasswords[user.username];if(!password)throw Error('Unexpected copied login; review before enabling');
  await db.query('UPDATE app_users SET password_hash=$2,failed_attempts=0,locked_until=NULL WHERE id=$1',[user.id,await hashPassword(password)]);}
 await db.query('DELETE FROM sessions');await db.query('DELETE FROM org_sessions');
 const master=await hashPassword(runtime.screenPassword);
 const org=(await db.query('SELECT id FROM org_identity')).rows[0].id;
 await db.query("SELECT set_config('app.organization_id',$1,true)",[org]);
 await db.query("UPDATE org_settings SET value=$1::jsonb WHERE key='clinical_master_password'",[JSON.stringify(master)]);
 await db.query("UPDATE clinic_settings SET value=$1::jsonb WHERE key IN ('finance_password','reports_password_1','reports_password_2','master_password')",[JSON.stringify(master)]);
 await db.query('COMMIT');
 phase='private attachment copy';
 const sourceRoot=resolve(root,'../realdata-review/documents'),destination=resolve(root,'documents');
 mkdirSync(destination,{recursive:true,mode:0o700});let checked=0;
 const docs=(await db.query("SELECT id,storage_key,checksum_sha256 FROM patient_documents WHERE storage_backend='local' AND deleted_at IS NULL")).rows;
 for(const doc of docs){
  const from=resolve(sourceRoot,...doc.storage_key.split('/')),to=resolve(destination,...doc.storage_key.split('/'));
  if(!from.startsWith(sourceRoot+sep)||!to.startsWith(destination+sep))throw Error('Document path escaped private root');
  mkdirSync(resolve(to,'..'),{recursive:true,mode:0o700});copyFileSync(from,to);
  const checksum=createHash('sha256').update(readFileSync(to)).digest('hex');if(doc.checksum_sha256&&checksum!==doc.checksum_sha256)throw Error('Document checksum mismatch');checked++;
 }
 const url=(role,password)=>{const u=new URL('postgresql://127.0.0.1:5432/'+state.database);u.username=role;u.password=password;return u.href;};
 writeFileSync(join(root,'app.env'),`DATABASE_URL=${url(runtime.app,runtime.appPassword)}\nPORT=8350\nDOCUMENT_DIR=${destination.replaceAll('\\','/')}\nKB_SECRETS_KEY=${runtime.secretsKey}\nANTHROPIC_API_KEY=\nPDF_BROWSER=\n`,{mode:0o600});
 writeFileSync(join(root,'logins.txt'),`PRIVATE DATABASE-BACKED VERIFICATION WEBSITE\nClinic code: kb-review\n${Object.entries(runtime.userPasswords).map(([user,password])=>user+': '+password).join('\n')}\nMaster / Finance / Reports: ${runtime.screenPassword}\nUse the existing website for operational entries during verification. No writes return to Sheets.\n`,{mode:0o600});
 runtime.primaryClinicId=(await db.query("SELECT id FROM clinics WHERE code::text='kb-review'")).rows[0].id;
 runtime.complete=true;runtime.documentsChecked=checked;writeFileSync(stateFile,JSON.stringify(runtime,null,2),{mode:0o600});
 console.log(JSON.stringify({provisioned:true,separateStaffPasswords:true,applicationRoleSuperuser:false,applicationRoleBypassRls:false,documentsCopiedAndChecksummed:checked,port:8350}));
}catch(error){try{await db.query('ROLLBACK');}catch{}console.error(JSON.stringify({provisioned:false,phase,code:error.constraint??error.code??error.name}));process.exitCode=1;}finally{await db.end();}
