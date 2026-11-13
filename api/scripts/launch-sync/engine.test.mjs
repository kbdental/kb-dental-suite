import test from 'node:test';import assert from'node:assert/strict';
import{hash,decision,businessData,identity}from'./engine.mjs';
test('canonical hashing survives PostgreSQL JSONB key order',()=>{
 assert.equal(hash({b:2,a:{y:3,x:4}}),hash({a:{x:4,y:3},b:2}));
 assert.notEqual(hash([1,2]),hash([2,1]));
});
test('source-only changes apply, local changes survive, and edits on both sides conflict',()=>{
 assert.equal(decision({sourceChanged:true,targetChanged:false}),'update');
 assert.equal(decision({sourceChanged:false,targetChanged:true}),'keep_local_change');
 assert.equal(decision({sourceChanged:true,targetChanged:true}),'conflict');
 assert.equal(decision({sourceChanged:false,targetChanged:false}),'unchanged');
 assert.equal(decision({sourceChanged:false,targetChanged:false,targetExists:false}),'conflict');
});
test('register source position changes do not change the clinical data fingerprint',()=>{
 const a={table:'daily_register',data:{uhid:'TEST',visit_date:'2026-11-07',work_done:'Recorded care',serial_no:1,source_record_key:'first'}};
 const b={...a,data:{...a.data,serial_no:9,source_record_key:'moved'}};
 assert.equal(hash(businessData(a)),hash(businessData(b)));assert.equal(identity(a),identity(b));
});
test('a later capture time is not a change to an undated historical identity or history form',()=>{
 for(const record of[
  {table:'patients',data:{uhid:'TEST',registered_on:'2026-11-07T00:00:00Z',import_provenance:{registration_date_source:'import_timestamp_not_registration'}}},
  {table:'patient_registrations',data:{collected_at:'2026-11-07T00:00:00Z',form:{collection_date_unknown:true}}}
 ]){
  const next={...record,data:{...record.data,[record.table==='patients'?'registered_on':'collected_at']:'2026-11-07T01:00:00Z'}};
  assert.equal(hash(businessData(record)),hash(businessData(next)));
 }
});
