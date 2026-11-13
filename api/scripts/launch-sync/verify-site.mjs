// Read-only application checks against the new copy. Credentials never printed.
import{readFileSync,writeFileSync,existsSync}from'node:fs';import{join}from'node:path';
import{root,copyConnection}from'./runtime.mjs';import{hash}from'./engine.mjs';
const base=process.argv[2]??'http://127.0.0.1:8350';
const publicFile=join(root,'public-url.txt');
if(base!=='http://127.0.0.1:8350'&&(!existsSync(publicFile)||readFileSync(publicFile,'utf8').trim()!==base))throw Error('Only the recorded verification site can receive these credentials');
const state=JSON.parse(readFileSync(join(root,'runtime-state.json'),'utf8'));
const checks=[],skipped=[];let headers={};
const check=(name,ok)=>{checks.push({name,passed:!!ok});if(!ok)throw Error(name);};
const request=async(action,data={})=>{const response=await fetch(base+'/exec',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(45000)});return {response,body:await response.json()};};
let db;
try{
 const rootResponse=await fetch(base+'/',{signal:AbortSignal.timeout(45000)}),page=await rootResponse.text();
 check('Native database frontend without verification banner',rootResponse.ok&&page.includes('KB_SCRIPT_URL_OVERRIDE')&&!page.includes('Verification copy'));
 const anonymous=await fetch(base+'/exec?action=getAllPatients',{signal:AbortSignal.timeout(45000)});const denied=await anonymous.json();
 check('Anonymous patient access rejected',denied.success===false&&denied.authRequired===true&&!denied.patients);
 const login=await request('staffLogin',{clinic:'kb-review',username:'admin',password:state.userPasswords.admin});
 check('Independent staff login issues a session',login.body.success&&login.body.token&&login.response.headers.get('set-cookie'));
 const cookie=login.response.headers.get('set-cookie').split(';')[0];headers={Cookie:cookie};
 const me=(await request('whoAmI')).body;check('Session resumes',me.success&&me.clinicId&&me.clinicRevision!==undefined);
 headers['X-KB-Clinic']=me.clinicId;headers['X-KB-Clinic-Revision']=String(me.clinicRevision);
 const connection=await copyConnection();db=connection.db;await db.query('BEGIN READ ONLY');
 const org=(await db.query('SELECT id FROM org_identity')).rows[0].id;
 await db.query("SELECT set_config('app.clinic_id',$1,true),set_config('app.organization_id',$2,true)",[me.clinicId,org]);
 const patients=(await request('getAllPatients')).body;
 const count=Number((await db.query('SELECT count(*) AS n FROM patients WHERE deleted_at IS NULL')).rows[0].n);
 check('Patient directory matches converted database',patients.success&&patients.patients?.length===count);
 const plan=(await db.query('SELECT uhid,plan_rows,estimate FROM treatment_plans WHERE plan_rows IS NOT NULL LIMIT 1')).rows[0];
 if(plan){
 const planResponse=(await request('getTreatmentPlan',{uhid:plan.uhid})).body;
 check('Populated treatment plan values match',planResponse.success&&hash(planResponse.rows)===hash(plan.plan_rows)&&hash(planResponse.estimate)===hash(plan.estimate));
 }else skipped.push('Populated authored treatment plan: none in this source snapshot');
 const care=(await db.query('SELECT uhid,page1,page2,page3,page4 FROM care_plans LIMIT 1')).rows[0];
 if(care){
 const careResponse=(await request('getCarePlan',{uhid:care.uhid})).body;
 check('Care plan pages match',careResponse.success&&[1,2,3,4].every(n=>hash(careResponse['page'+n])===hash(care['page'+n])));
 }else skipped.push('Populated care plan: none in this source snapshot');
 const day=(await db.query('SELECT visit_date::text AS day,count(*)::int AS n FROM daily_register GROUP BY visit_date ORDER BY n DESC LIMIT 1')).rows[0];
 if(day){
 const register=(await request('getDailyRegister',{fromDate:day.day,toDate:day.day})).body;
 check('Register retains separate source rows',register.success&&register.entries?.length===day.n);
 }else skipped.push('Populated register day: none in this source snapshot');
 const apptCount=Number((await db.query('SELECT count(*) AS n FROM appointments')).rows[0].n);
 const timingReviewCount=Number((await db.query("SELECT count(*) AS n FROM appointments WHERE source_timing->>'requiresReview'='true'")).rows[0].n);
 const appts=(await request('getAppointments')).body;
 check('Appointment count and review timing flags match',appts.success&&appts.appointments?.length===apptCount&&appts.appointments.filter(a=>a.sourceTimingRequiresReview).length===timingReviewCount);
 const receipts=(await request('getReceipts',{fromDate:'2024-04-01',toDate:'2099-12-31'})).body;
 const expenses=(await request('getExpenses',{fromDate:'2024-04-01',toDate:'2099-12-31'})).body;
 const expectedR=Number((await db.query('SELECT coalesce(sum(amount1+amount2),0)*100 AS n FROM receipts')).rows[0].n);
 const expectedE=Number((await db.query('SELECT coalesce(sum(amount),0)*100 AS n FROM expenses')).rows[0].n);
 check('Receipt API total matches database',receipts.success&&receipts.receipts.reduce((n,r)=>n+Math.round(Number(r.fee)*100),0)===expectedR);
 check('Expense API total matches database',expenses.success&&expenses.expenses.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)===expectedE);
 const status=await fetch(base+'/api/v1/launch-sync/status',{headers,signal:AbortSignal.timeout(45000)});const statusBody=await status.json();
 const imported=JSON.parse(readFileSync(join(root,'import-summary.json'),'utf8'));
 check('Sync review requires the authorized session and shows source exceptions',status.ok&&statusBody.sourceIssueCount===imported.sourceIssueCount&&statusBody.financeReconciled);
 const logout=await request('staffLogout');check('Session can sign out',logout.body.success);
 const after=(await request('getAllPatients')).body;check('Signed-out patient access rejected',after.success===false&&after.authRequired===true);
 await db.query('COMMIT');
 const report={verifiedAt:new Date().toISOString(),public:base.startsWith('https:'),passed:checks.length,checks,skipped,patientValuesPrinted:false,applicationRecordWrites:0};
 writeFileSync(join(root,base.startsWith('https:')?'public-verification.json':'local-verification.json'),JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({verified:false,failedCheck:checks.find(c=>!c.passed)?.name??null,error:error.code??error.name,passed:checks.filter(c=>c.passed).length}));process.exitCode=1;}finally{if(db)await db.end();}
