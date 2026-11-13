import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { makeWorld, OWNER_URL, type World } from "./setup.js";
import { execLogin } from "./legacy.js";
let w:World,cookie:string,desk:string,clinic:string;
async function call(action:string,params:Record<string,unknown>={},who?:string,method:"GET"|"POST"="POST"){
 const data={action,...params};return (await w.app.inject({method,url:"/exec",headers:{cookie:who??cookie,"x-kb-clinic":clinic,"x-kb-clinic-revision":"1"},...(method==="POST"?{payload:data}:{query:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,String(v)]))})})).json();
}
beforeAll(async()=>{
 w=await makeWorld();clinic=w.clinicA;
 const c=new pg.Client({connectionString:OWNER_URL});await c.connect();
 try{await c.query('BEGIN');await c.query("INSERT INTO org_identity(id,code,name,hostname) VALUES('00000000-0000-4000-8000-000000000001','test-org','Example Organization','test.localhost')");
 await c.query("SELECT set_config('app.organization_id','00000000-0000-4000-8000-000000000001',true),set_config('app.clinic_id',$1,true)",[clinic]);
 const unit=(await c.query("INSERT INTO org_units(code,name) VALUES('first','First clinic') RETURNING id")).rows[0].id;
 await c.query('INSERT INTO org_clinical_units VALUES(org_id(),$1,$2)',[unit,clinic]);
 const admin=(await c.query("SELECT id FROM app_users WHERE username='a-admin'")).rows[0].id;
 await c.query('INSERT INTO org_clinical_access VALUES(org_id(),$1,$2,$1,$2,true)',[clinic,admin]);
 await c.query('COMMIT');}finally{await c.end();}
 cookie=await execLogin(w,'alpha','a-admin');desk=await execLogin(w,'alpha','a-desk');
});
afterAll(async()=>{await w.close();});
describe('working clinics under Organization',()=>{
 it('denies non-managers, invalid fields and GET creation',async()=>{
  expect((await call('getOrganizationClinics',{},desk)).success).toBe(false);
  expect((await call('createOrganizationClinic',{code:'new-clinic',name:'New clinic',timezone:'Asia/Kolkata'},desk)).success).toBe(false);
  expect((await call('getOrganizationClinics')).locked).toBe(true);
  expect((await call('verifyMasterPassword',{password:''})).correct).toBe(true);
  for(const value of [{code:'bad code',name:'Example'},{code:'okay',name:''},{code:'okay',name:'Example',timezone:'Invalid/Zone'}])expect((await call('createOrganizationClinic',value)).success).toBe(false);
  expect((await call('createOrganizationClinic',{code:'get-clinic',name:'Get clinic'},undefined,'GET')).success).toBe(false);
 });
 it('creates a selectable clinic in the same organization without patient copies or other staff grants',async()=>{
  const result=await call('createOrganizationClinic',{code:'new-clinic',name:'New clinic',timezone:'Asia/Kolkata'});
  expect(result.success,JSON.stringify(result)).toBe(true);expect(result.created.id).toBeTruthy();
  const list=await call('getOrganizationClinics');expect(list.clinics).toHaveLength(2);
  expect((await call('getWorkingClinics')).clinics).toHaveLength(2);
  expect((await call('getWorkingClinics',{},desk)).clinics).toHaveLength(1);
  const duplicate=await call('createOrganizationClinic',{code:'new-clinic',name:'Duplicate clinic'});expect(duplicate.success).toBe(false);
  const switched=await call('switchWorkingClinic',{clinicId:result.created.id});expect(switched.success).toBe(true);
  const context=await w.app.inject({method:'POST',url:'/exec',headers:{cookie,'x-kb-clinic':result.created.id,'x-kb-clinic-revision':String(switched.revision)},payload:{action:'getAllPatients'}});
  expect(context.json()).toMatchObject({success:true,patients:[]});
  clinic=result.created.id;
  // Switch back for subsequent checks; the revision is intentionally explicit.
  const back=await w.app.inject({method:'POST',url:'/exec',headers:{cookie,'x-kb-clinic':clinic,'x-kb-clinic-revision':String(switched.revision)},payload:{action:'switchWorkingClinic',clinicId:w.clinicA}});
  expect(back.json().success).toBe(true);
 });
});
