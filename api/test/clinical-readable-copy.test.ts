import {beforeAll,afterAll,describe,it,expect}from'vitest';import{makeWorld,type World}from'./setup.js';import{execLogin,exec}from'./legacy.js';
let w:World,admin:string,desk:string;
beforeAll(async()=>{w=await makeWorld();admin=await execLogin(w,'alpha','a-admin');desk=await execLogin(w,'alpha','a-desk');});afterAll(async()=>w.close());
describe('upstream readable clinical-sheet integrations',()=>{
 it('retains new examination answers inside the existing versioned care-plan JSON',async()=>{
  const page3={examination:{example_finding:{present:true,note:'Example observation'}}};
  expect((await exec(w,admin,'saveCarePlan',{uhid:'SYNTHETIC-A',patientName:'Example Patient',date:'2026-11-12',page1:{},page2:{},page3,page4:{},version:0})).success).toBe(true);
  const saved=await exec(w,admin,'getCarePlan',{uhid:'SYNTHETIC-A'});expect(saved.page3).toEqual(page3);expect(saved.version).toBeGreaterThan(0);
 });
 it('round trips wizard JSON and lists it with clinic-scoped paging',async()=>{
  await exec(w,admin,'saveClinicalSheets',{uhid:'SYNTHETIC-A',patientName:'Example Patient',sheetType:'rct',allTeeth:[{toothNo:'46',visits:[{date:'2026-11-12',note:'Example note'}]}]});
  const page=await exec(w,admin,'listClinicalSheetRecords',{sheetType:'rct',offset:0,limit:1});expect(page).toMatchObject({success:true,total:1,next:null,records:[{uhid:'SYNTHETIC-A',sheetType:'rct'}]});expect(page.records[0].allTeeth[0].toothNo).toBe('46');
  const other=await execLogin(w,'beta','b-admin');expect((await exec(w,other,'listClinicalSheetRecords',{sheetType:'rct'})).records).toEqual([]);
 });
 it('upserts readable rows by patient, visit date and tooth without duplicates',async()=>{
  const row={'UHID':'SYNTHETIC-A','Patient Name':'Example Patient','Visit Date':'2026-11-12','Tooth No.':'46','Doctor':'Example Doctor'};
  const args={tabName:'RCT',rows:[row],keyColumns:['UHID','Visit Date','Tooth No.']};
  expect(await exec(w,admin,'appendClinicalRecordRows',args)).toMatchObject({success:true,written:1,updated:0});
  expect(await exec(w,admin,'appendClinicalRecordRows',{...args,rows:[{...row,Doctor:'Another Example Doctor'}]})).toMatchObject({success:true,written:0,updated:1});
  const result=await exec(w,admin,'getClinicalRecords',{tabName:'RCT',uhid:'SYNTHETIC-A'});expect(result.records).toHaveLength(1);expect(result.records[0].Doctor).toBe('Another Example Doctor');
 });
 it('denies unauthorized writes, unknown record tables and keys without patient identity',async()=>{
  expect((await exec(w,desk,'appendClinicalRecordRows',{tabName:'RCT',rows:[]})).success).toBe(false);
  expect((await exec(w,admin,'appendClinicalRecordRows',{tabName:'app_users',rows:[{UHID:'SYNTHETIC-A'}]})).success).toBe(false);
  expect((await exec(w,admin,'appendClinicalRecordRows',{tabName:'RCT',rows:[{UHID:'SYNTHETIC-A'}],keyColumns:['Doctor']})).success).toBe(false);
 });
});
