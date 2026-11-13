// Normalizes a captured source into the marked ISOLATED copy only.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {copyConnection,loadCapture,root,quote} from './runtime.mjs';
import {project} from './model.mjs';
import {sourceIdentities} from './compare.mjs';
import {hash,businessData,identity,decision} from './engine.mjs';
import {privateJson,postgresBinary} from './private-files.mjs';

const order=['panels','doctors','chairs','staff','treatments','medicines','implant_brands','appointment_reasons','pick_lists','panel_rates','procedure_library','holidays','clinic_settings',
 'patients','patient_registrations','clinical_records','clinical_sheets','care_plans','treatment_plans','treatment_cases','daily_register','appointments','receipts','expenses','cghs_bills','crm_records','crm_lead_inbox','pending_registrations'];
const replace=['patient_registrations','clinical_records','clinical_sheets','care_plans','treatment_plans','treatment_cases','daily_register','appointments','receipts','expenses','cghs_bills','crm_records','crm_lead_inbox','pending_registrations','panel_rates','procedure_library','pick_lists','holidays'];
const natural={patients:['uhid'],panels:['name'],doctors:['name'],chairs:['name'],staff:['name'],treatments:['name'],medicines:['name'],implant_brands:['name'],appointment_reasons:['name'],
 clinical_sheets:['uhid','sheet_type'],care_plans:['uhid'],treatment_plans:['uhid'],treatment_cases:['case_ref'],cghs_bills:['bill_no'],pick_lists:['list_name','value'],clinic_settings:['key'],holidays:['holiday_date']};

export async function main(args=process.argv.slice(2)) {
 const {db,state,config}=await copyConnection();
 let phase='projection';
 try {
  const {run,books}=await loadCapture(db),projection=project(books,run.started_at.toISOString());
  const counts={};for(const r of projection.records)counts[r.table]=(counts[r.table]??0)+1;
  if(!args.includes('--apply')){console.log(JSON.stringify({mode:'preview',counts,rejections:projection.rejections,warnings:projection.warnings}));return;}
  const acquired=(await db.query('SELECT pg_try_advisory_lock(73459341) AS acquired')).rows[0].acquired;
  if(!acquired)throw new Error('Another launch import is running');
  phase='migration';
  const {migrate}=await import('../../src/migrator.ts');
  const url=new URL('postgresql://localhost/'+state.database);url.hostname=config.host;url.port=String(config.port);url.username=config.user;url.password=config.password;
  await migrate(url.href,()=>{},{applyGrants:false});
  await db.query(`CREATE TABLE IF NOT EXISTS launch_sync.links (
   id uuid PRIMARY KEY,target_table text NOT NULL,target_id uuid NOT NULL,source_key text NOT NULL,
   identity_hash text NOT NULL,source_hash text NOT NULL,target_hash text NOT NULL,baseline_data jsonb NOT NULL,
   source_ref jsonb NOT NULL,last_capture uuid NOT NULL,missing_source boolean NOT NULL DEFAULT false)`);
  await db.query(`CREATE TABLE IF NOT EXISTS launch_sync.conflicts (
   id uuid PRIMARY KEY,link_id uuid REFERENCES launch_sync.links(id),kind text NOT NULL,
   source_hash text NOT NULL,target_hash text NOT NULL,source_proposal jsonb NOT NULL,
   happened_at timestamptz NOT NULL DEFAULT now(),UNIQUE(link_id,source_hash,target_hash,kind))`);
  await db.query('CREATE TABLE IF NOT EXISTS launch_sync.import_runs(id uuid PRIMARY KEY,capture_id uuid NOT NULL,completed_at timestamptz NOT NULL DEFAULT now(),report jsonb NOT NULL)');
  const initial=!(await db.query('SELECT 1 FROM launch_sync.links LIMIT 1')).rowCount;
  if(initial&&state.installMode==='fresh'){
   // This is the only no-backup exception: the marked, newly created installation
   // must contain no imported/native business records before its first import.
   phase='empty fresh installation guard';
   const runtime=JSON.parse(readFileSync(join(root,'runtime-state.json'),'utf8'));
   if(runtime.importReady)throw new Error('Fresh installation already accepted data without import baselines');
   const clinic=runtime.primaryClinicId,org=(await db.query('SELECT id FROM org_identity')).rows[0]?.id;
   await db.query('BEGIN READ ONLY');
   try{
    await db.query("SELECT set_config('app.clinic_id',$1,true),set_config('app.organization_id',$2,true)",[clinic,org]);
    for(const table of [...new Set([...replace,'patients','patient_documents','org_patients','org_documents'])])
     if((await db.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`)).rowCount)throw new Error('Fresh first import requires an empty installation');
    await db.query('COMMIT');
   }catch(error){await db.query('ROLLBACK');throw error;}
  }else if(initial){
   phase='private rollback backup';const file=join(root,'before-normalized-import.dump');
   if(!existsSync(file))execFileSync(postgresBinary('pg_dump'),
    ['--format=custom','--file='+file,state.database],{env:{...process.env,PGHOST:config.host,PGPORT:String(config.port),PGUSER:config.user,PGPASSWORD:config.password},
      windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});
  }
  phase='transaction';await db.query('BEGIN');await db.query("SET LOCAL TIME ZONE 'UTC'");
  const clinic=(await db.query("SELECT id FROM clinics WHERE code::text='kb-review'")).rows[0]?.id;
  const org=(await db.query('SELECT id FROM org_identity')).rows;
  if(!clinic||org.length!==1)throw new Error('Unexpected organization/clinic configuration');
  await db.query("SELECT set_config('app.clinic_id',$1,true),set_config('app.organization_id',$2,true)",[clinic,org[0].id]);
  const actor=(await db.query("SELECT id FROM app_users WHERE clinic_id=$1 AND username::text='admin'",[clinic])).rows[0].id;
  await db.query("SELECT set_config('app.user_id',$1,true)",[actor]);
  const report={capturedAt:run.started_at.toISOString(),appliedAt:new Date().toISOString(),financeFrom:'2024-04-01',initial,
   rows:{},rejections:{...projection.rejections},warnings:{...projection.warnings},conflicts:0,localChangesPreserved:0,missingSource:0};
  const reject=(table,code)=>{const key=table+':'+code;report.rejections[key]=(report.rejections[key]??0)+1;};
  await db.query('CREATE TABLE IF NOT EXISTS launch_sync.issues(id uuid PRIMARY KEY,capture_id uuid NOT NULL,target_table text NOT NULL,reason text NOT NULL,source_ref jsonb NOT NULL)');
  await db.query('DELETE FROM launch_sync.issues WHERE capture_id=$1',[run.id]);
  for(const issue of projection.issues)await db.query('INSERT INTO launch_sync.issues VALUES($1,$2,$3,$4,$5)',[randomUUID(),run.id,issue.table,issue.reason,JSON.stringify(issue.source)]);
  const allReferences=sourceIdentities(books);
  const patientProjection=new Set(projection.records.filter(r=>r.table==='patients').map(r=>r.data.uhid));
  // An already verified historical identity with a now-blank source name is a
  // useful retained fact, not permission to invent a replacement name.
  const previousPatients=(await db.query('SELECT * FROM patients WHERE clinic_id=$1',[clinic])).rows;
  for(const p of previousPatients)if(allReferences.has(p.uhid.toUpperCase())&&!patientProjection.has(p.uhid.toUpperCase())){
   const data={...p};for(const k of ['id','clinic_id','version','created_at','updated_at','created_by','updated_by','deleted_at'])delete data[k];
   data.import_provenance={...data.import_provenance,review_required:true,identity_source:'prior_verified_identity_with_current_reference',source:'live_sheets'};
   projection.records.push({table:'patients',key:hash(['retained-source-backed',p.uhid]),data,source:{role:'prior-verified-source-backed',book:'',tab:0,row:0}});
   report.warnings.retainedPriorSourceBackedIdentity=(report.warnings.retainedPriorSourceBackedIdentity??0)+1;
  }
  if(initial){
   phase='initial source-authoritative replacement';
   for(const table of replace)await db.query(`DELETE FROM public.${quote(table)} WHERE clinic_id=$1`,[clinic]);
   for(const table of ['panels','doctors','chairs','staff','treatments','medicines','implant_brands'])await db.query(`UPDATE ${quote(table)} SET active=false WHERE clinic_id=$1`,[clinic]);
   const keep=new Set(projection.records.filter(r=>r.table==='patients').map(r=>r.data.uhid.toUpperCase()));
   const excluded=previousPatients.filter(p=>!keep.has(p.uhid.toUpperCase()));
   for(const p of excluded){
    // No source link is inferred. Excluded copy-only patients stay in the rollback
    // backup; source documents or native organization care block silent exclusion.
    const canonical=(await db.query('SELECT organization_patient_id AS id FROM org_clinical_patient_links WHERE clinic_id=$1 AND patient_id=$2',[clinic,p.id])).rows[0]?.id;
    const docs=Number((await db.query('SELECT count(*) AS n FROM patient_documents WHERE patient_id=$1',[p.id])).rows[0].n);
    let native=0;if(canonical)for(const t of ['org_notes','org_appointments','org_receipts','org_submissions','org_documents'])native+=Number((await db.query(`SELECT count(*) AS n FROM ${quote(t)} WHERE patient_id=$1`,[canonical])).rows[0].n);
    if(docs||native){report.warnings.sourceAbsentIdentityWithIndependentCare=(report.warnings.sourceAbsentIdentityWithIndependentCare??0)+1;continue;}
    await db.query('DELETE FROM org_clinical_patient_links WHERE patient_id=$1',[p.id]);
    await db.query('DELETE FROM patients WHERE id=$1',[p.id]);
    if(canonical)await db.query('DELETE FROM org_patients WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM org_clinical_patient_links WHERE organization_patient_id=$1)',[canonical]);
   }
   report.excludedCopyOnlyIdentities=excluded.length;
  }
  const columns=new Map();
  for(const table of order)columns.set(table,new Map((await db.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[table])).rows.map(r=>[r.column_name,r.data_type])));
  const links=(await db.query('SELECT * FROM launch_sync.links')).rows,claimed=new Set();
  // Upgrade the first rehearsal's import-time fingerprints without treating a
  // changed hashing convention as changed source care or a local correction.
  for(const record of projection.records.filter(r=>['patients','patient_registrations'].includes(r.table))){
   const link=links.find(l=>l.target_table===record.table&&l.source_key===record.key);if(!link)continue;
   const legacy={...record.data};delete legacy.source_record_key;
   if(legacy.form){legacy.form={...legacy.form};delete legacy.form.source_order;}
   const key=record.table==='patients'?'registered_on':'collected_at';
   const unknown=record.table==='patients'?legacy.import_provenance?.registration_date_source==='import_timestamp_not_registration':legacy.form?.collection_date_unknown;
   if(unknown&&link.baseline_data[key])legacy[key]=new Date(link.baseline_data[key]).toISOString();
   const sourceHash=hash(businessData(record));
   if(link.source_hash===hash(legacy)&&link.source_hash!==sourceHash){link.source_hash=sourceHash;
    await db.query('UPDATE launch_sync.links SET source_hash=$2 WHERE id=$1',[link.id,sourceHash]);}
  }
  const by=(filter)=>links.filter(link=>!claimed.has(link.id)&&filter(link));
  const rowPayload=async(table,id,lock=false)=>(await db.query(`SELECT to_jsonb(t) AS payload FROM ${quote(table)} t WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0]?.payload;
  const slice=(row,keys)=>row?Object.fromEntries(keys.map(key=>[key,row[key]])):null;
  const foreign=async(table,name)=>{
   if(!name)return null;
   const found=(await db.query(`SELECT id FROM ${quote(table)} WHERE clinic_id=$1 AND lower(name)=lower($2)`,[clinic,name])).rows[0];
   if(found)return found.id;
   if(table!=='panels')return null;
   return (await db.query('INSERT INTO panels(clinic_id,name) VALUES($1,$2) RETURNING id',[clinic,name])).rows[0].id;
  };
  const patients=new Map((await db.query('SELECT upper(uhid) AS uhid,id FROM patients WHERE clinic_id=$1 AND deleted_at IS NULL',[clinic])).rows.map(r=>[r.uhid,r.id]));
  let nextReceipt=Number((await db.query('SELECT coalesce(max(receipt_no),0) AS n FROM receipts WHERE clinic_id=$1',[clinic])).rows[0].n);
  phase='normalize records';
  const records=projection.records.sort((a,b)=>order.indexOf(a.table)-order.indexOf(b.table));
  for(const record of records){
   const table=record.table,sourceHash=hash(businessData(record)),semantic=identity(record),data={...record.data};
   await db.query('SAVEPOINT source_record');
   try{
    const uhid=data.uhid?.toUpperCase();
    if(data.panel_name!==undefined){data.panel_id=await foreign('panels',data.panel_name);delete data.panel_name;}
    if(data.doctor_name!==undefined)data.doctor_id=await foreign('doctors',data.doctor_name);
    if(table==='appointments')data.chair_id=null; // recorded chair_name is preserved; historical overlaps are not rewritten.
    if(table!=='patients'&&columns.get(table).has('patient_id'))data.patient_id=patients.get(uhid)??null;
    if(table==='patient_registrations'){delete data.uhid;if(!data.patient_id)throw Object.assign(new Error('unresolved_identity'),{code:'unresolved_identity'});}
    const sameHash=by(link=>link.target_table===table&&link.source_hash===sourceHash);
    let link=sameHash.find(link=>link.source_key===record.key)??sameHash[0];
    if(!link){const sameIdentity=by(link=>link.target_table===table&&link.identity_hash===semantic);
     if(sameIdentity.length===1)link=sameIdentity[0];
     else if(sameIdentity.length>1){report.conflicts++;reject(table,'ambiguous_source_event');await db.query('ROLLBACK TO SAVEPOINT source_record');continue;}
    }
    let targetId=link?.target_id,current=link?await rowPayload(table,link.target_id):null;
    // Collection editors can regenerate storage UUIDs while keeping their own
    // stable record ID. Rebind only an unambiguous exact record identity.
    if(link&&!current&&table==='crm_records'&&data.data?.id){
      const found=(await db.query("SELECT id,to_jsonb(t) AS payload FROM crm_records t WHERE clinic_id=$1 AND collection=$2 AND data->>'id'=$3",[clinic,data.collection,String(data.data.id)])).rows;
      if(found.length===1){targetId=found[0].id;current=found[0].payload;}
    }
    if(link&&!current&&table==='pick_lists'){
      const found=(await db.query('SELECT id,to_jsonb(t) AS payload FROM pick_lists t WHERE clinic_id=$1 AND list_name=$2 AND (value=$3 OR ($4::jsonb IS NOT NULL AND data=$4::jsonb))',[clinic,data.list_name,data.value,data.data?JSON.stringify(data.data):null])).rows;
      if(found.length===1){targetId=found[0].id;current=found[0].payload;}
    }
    if(!link&&natural[table]){
      const keys=natural[table],where=keys.map((key,i)=>key==='name'?`lower(${quote(key)})=lower($${i+2})`:`${quote(key)}=$${i+2}`).join(' AND ');
      const found=(await db.query(`SELECT id,to_jsonb(t) AS payload FROM ${quote(table)} t WHERE clinic_id=$1 AND ${where} LIMIT 1`,[clinic,...keys.map(key=>data[key])])).rows[0];
      if(found){targetId=found.id;current=found.payload;}
    }
    if(current&&table==='patients'&&data.import_provenance?.registration_date_source==='import_timestamp_not_registration')data.registered_on=current.registered_on;
    const linkId=link?.id??randomUUID();
    if(table==='daily_register')data.source_record_key=linkId;
    if(table==='receipts')data.receipt_no=current?.receipt_no??++nextReceipt;
    if(['panels','doctors','chairs','staff','treatments','medicines','implant_brands'].includes(table))data.active=true;
    data.clinic_id=clinic;
    const keys=Object.keys(data).filter(key=>columns.get(table).has(key));
    let currentData=slice(current,link?Object.keys(link.baseline_data):keys),targetHash=currentData?hash(businessData({table,data:currentData})):'';
    let outcome=link?decision({sourceChanged:sourceHash!==link.source_hash,targetChanged:targetHash!==hash(businessData({table,data:link.baseline_data})),targetExists:!!current}):'insert_or_adopt';
    if(link&&outcome==='update'){
      current=await rowPayload(table,targetId,true);
      currentData=slice(current,Object.keys(link.baseline_data));targetHash=currentData?hash(businessData({table,data:currentData})):'';
      outcome=decision({sourceChanged:true,targetChanged:targetHash!==hash(businessData({table,data:link.baseline_data})),targetExists:!!current});
    }
    if(!initial&&!link&&current&&targetHash!==hash(businessData({table,data}))){
      report.conflicts++;reject(table,'unlinked_local_record');
      await db.query(`INSERT INTO launch_sync.conflicts(id,kind,source_hash,target_hash,source_proposal) VALUES($1,'unlinked_local_record',$2,$3,$4)`,
        [randomUUID(),sourceHash,targetHash,JSON.stringify({table,data,source:record.source})]);
      await db.query('RELEASE SAVEPOINT source_record');continue;
    }
    if(outcome==='conflict'){
      await db.query(`INSERT INTO launch_sync.conflicts(id,link_id,kind,source_hash,target_hash,source_proposal)
       VALUES($1,$2,'both_sides_changed',$3,$4,$5) ON CONFLICT DO NOTHING`,[randomUUID(),link.id,sourceHash,targetHash,JSON.stringify({table,data,source:record.source})]);
      await db.query('UPDATE launch_sync.links SET last_capture=$2,source_key=$3,missing_source=false WHERE id=$1',[link.id,run.id,record.key]);
      claimed.add(link.id);report.conflicts++;await db.query('RELEASE SAVEPOINT source_record');continue;
    }
    if(outcome==='unchanged'||outcome==='keep_local_change'){
      if(table==='patient_registrations'&&(data.form?.source_order!==current.form?.source_order||data.form?.collection_date_unknown&&current.collected_at!==null))
        await db.query("UPDATE patient_registrations SET form=jsonb_set(form,'{source_order}',$2::jsonb),collected_at=CASE WHEN form->>'collection_date_unknown'='true' THEN NULL ELSE collected_at END WHERE id=$1",[targetId,JSON.stringify(data.form.source_order)]);
      if(outcome==='keep_local_change')report.localChangesPreserved++;
      await db.query('UPDATE launch_sync.links SET last_capture=$2,source_key=$3,source_ref=$4,target_id=$5,missing_source=false WHERE id=$1',[link.id,run.id,record.key,JSON.stringify(record.source),targetId]);
      claimed.add(link.id);report.rows[table]??={inserted:0,updated:0,unchanged:0};report.rows[table].unchanged++;
      await db.query('RELEASE SAVEPOINT source_record');continue;
    }
    const values=keys.map(key=>columns.get(table).get(key)==='jsonb'?JSON.stringify(data[key]):data[key]);
    if(targetId){await db.query(`UPDATE ${quote(table)} SET ${keys.map((key,i)=>quote(key)+'=$'+(i+1)).join(',')} WHERE id=$${keys.length+1}`,[...values,targetId]);}
    else targetId=(await db.query(`INSERT INTO ${quote(table)}(${keys.map(quote).join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,values)).rows[0].id;
    const baseline=slice(await rowPayload(table,targetId),keys);
    await db.query(`INSERT INTO launch_sync.links(id,target_table,target_id,source_key,identity_hash,source_hash,target_hash,baseline_data,source_ref,last_capture)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET target_id=excluded.target_id,source_key=excluded.source_key,identity_hash=excluded.identity_hash,
     source_hash=excluded.source_hash,target_hash=excluded.target_hash,baseline_data=excluded.baseline_data,source_ref=excluded.source_ref,last_capture=excluded.last_capture,missing_source=false`,
     [linkId,table,targetId,record.key,semantic,sourceHash,hash(businessData({table,data:baseline})),JSON.stringify(baseline),JSON.stringify(record.source),run.id]);
    claimed.add(linkId);
    report.rows[table]??={inserted:0,updated:0,unchanged:0};report.rows[table][current?'updated':'inserted']++;
    if(table==='patients'){
      patients.set(data.uhid.toUpperCase(),targetId);
      await db.query(`UPDATE org_patients SET import_review_required=$2 WHERE id=(SELECT organization_patient_id FROM org_clinical_patient_links WHERE clinic_id=$3 AND patient_id=$1)`,[targetId,!!data.import_provenance?.review_required,clinic]);
    }
    await db.query('RELEASE SAVEPOINT source_record');
   }catch(error){await db.query('ROLLBACK TO SAVEPOINT source_record');const reason=error.constraint??error.code??'conversion_error';reject(table,reason);
    await db.query('INSERT INTO launch_sync.issues VALUES($1,$2,$3,$4,$5)',[randomUUID(),run.id,table,reason,JSON.stringify(record.source)]);}
  }
  for(const link of links)if(!claimed.has(link.id)){await db.query('UPDATE launch_sync.links SET missing_source=true WHERE id=$1',[link.id]);report.missingSource++;}
  await db.query(`INSERT INTO clinic_settings(key,value) VALUES('clinical_note_templates_initialized','true'),('list_initialized:clinical_note_template','true') ON CONFLICT(clinic_id,key) DO UPDATE SET value='true'`);
  await db.query('INSERT INTO receipt_counters(last_value) VALUES($1) ON CONFLICT(clinic_id) DO UPDATE SET last_value=greatest(receipt_counters.last_value,excluded.last_value)',[nextReceipt]);
  report.actual={};for(const table of order)report.actual[table]=Number((await db.query(`SELECT count(*) AS n FROM ${quote(table)} WHERE clinic_id=$1`,[clinic])).rows[0].n);
  report.financialCents={};for(const [table,expression]of [['receipts','amount1+amount2'],['expenses','amount']]){
   const expected=records.filter(r=>r.table===table).reduce((n,r)=>n+Math.round((table==='receipts'?r.data.amount1+r.data.amount2:r.data.amount)*100),0);
   const actual=Number((await db.query(`SELECT coalesce(sum(${expression}),0)*100 AS n FROM ${quote(table)} WHERE clinic_id=$1`,[clinic])).rows[0].n);
   report.financialCents[table]={expected,actual,matched:expected===actual};
  }
  report.applicationTablesUpdated=true;report.scheduleEnabled=false;
  report.sourceIssueCount=projection.issues.length;
  report.readyForVerification=report.conflicts===0&&report.missingSource===0&&Object.values(report.financialCents).every(x=>x.matched);
  report.productionAccepted=false;
  await db.query('INSERT INTO launch_sync.import_runs(id,capture_id,report) VALUES($1,$2,$3)',[randomUUID(),run.id,JSON.stringify(report)]);
  await db.query('COMMIT');
  writeFileSync(join(root,'import-summary.json'),JSON.stringify(report,null,2),{mode:0o600});
  const issueRows=(await db.query('SELECT target_table,reason,source_ref FROM launch_sync.issues WHERE capture_id=$1',[run.id])).rows;
  writeFileSync(join(root,'source-issues.json'),JSON.stringify(issueRows,null,2),{mode:0o600});
  if(state.installMode==='fresh'&&report.readyForVerification&&report.actual.patients>0){
   const file=join(root,'runtime-state.json'),runtime=JSON.parse(readFileSync(file,'utf8'));
   if(!runtime.importReady)privateJson(file,{...runtime,importReady:true,firstImportAt:report.appliedAt});
  }
  console.log(JSON.stringify(report));
 }catch(error){try{await db.query('ROLLBACK');}catch{}console.error(JSON.stringify({complete:false,phase,code:error.constraint??error.code??error.name}));process.exitCode=1;}
 finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
