import test from 'node:test';
import assert from 'node:assert/strict';
import {project,date,instant,clock,cents} from './model.mjs';
const book=(role,tabs)=>({id:'fictional-'+role,role,timeZone:'Asia/Kolkata',tabs:tabs.map((t,i)=>({id:i,...t,rawRows:t.rawRows??t.rows}))});
const capture='2026-11-07T00:00:00Z';

test('date/clock conversion preserves Sheets calendar dates and clinic-local instants',()=>{
 assert.equal(date(46333.75),'2026-11-07');
 assert.equal(instant(46333.5),'2026-11-07T06:30:00.000Z');
 assert.equal(clock(.5),'12:00:00');assert.equal(clock('12:30 PM'),'12:30:00');
 assert.equal(clock('25:00'),null);assert.equal(date('31/02/2026'),null);
 assert.equal(cents('₹ 1,234.50'),123450);assert.throws(()=>cents('not recorded'));
});
test('keeps separate same-day register entries and source care values',()=>{
 const p=project([book('main',[{title:'Daily Register',rows:[['Timestamp','UHID','Full Name','Operating Doctor','Work Done'],
  [46333,'TEST-A','Example Patient','Recorded Doctor One','First procedure'],[46333,'TEST-A','Example Patient','Recorded Doctor Two','Second procedure']]}])],capture);
 const records=p.records.filter(r=>r.table==='daily_register');assert.equal(records.length,2);
 assert.notEqual(records[0].data.source_record_key,records[1].data.source_record_key);
 assert.equal(records[0].data.operating_doctor,'Recorded Doctor One');
});
test('retains undated clinical forms as unknown dates, not import-day care',()=>{
 const p=project([book('clinical',[{title:'Restoration',rows:[['Timestamp','UHID','Name','Material Used'],['','TEST-A','Example Patient','Recorded material']]}])],capture);
 const r=p.records.find(r=>r.table==='clinical_records');assert.equal(r.data.recorded_at,null);
 assert.equal(r.data.fields['Material Used'],'Recorded material');assert.equal(p.warnings.clinical_record_date_unknown,1);
});
test('keeps appointment attendance as recorded, even for old Scheduled bookings',()=>{
 const p=project([book('main',[{title:'Appointments',rows:[['Date','Time','UHID','Patient Name','Status'],['2020-01-01','10:00','TEST-A','Example Patient','Scheduled']]}])],capture);
 assert.equal(p.records.find(r=>r.table==='appointments').data.status,'Scheduled');
});
test('matches receipt mirrors without doubling split payments and enforces the cutoff',()=>{
 const p=project([book('finance',[
  {title:'Receipt No.',rows:[['Date','UHID',"Patient's Name",'Fee','E. Receipt No.'],['2024-04-01','TEST-A','Example Patient',150,'24-25/7'],['2024-03-31','TEST-A','Example Patient',999,'23-24/9']]},
  {title:'Patient Fee Receipt',rows:[['Timestamp','UHID',"Patient's Name",'Payment Mode','Amount','Payment Mode (Payment mode is more than one)','Amount (Payment mode is more than one)'],['2024-04-01','TEST-A','Example Patient','Cash',100,'UPI',50]]}
 ])],capture);
 const r=p.records.filter(r=>r.table==='receipts');assert.equal(r.length,1);assert.equal(r[0].data.legacy_receipt_no,'24-25/7');
 assert.equal(r[0].data.amount1,100);assert.equal(r[0].data.amount2,50);assert.equal(r[0].data.mode2,'UPI');
});
test('uses recorded expense date and original mode column rather than a duplicated derived heading',()=>{
 const p=project([book('finance',[{title:'Expense',rows:[['Timestamp','Date of Expense','Payment Done By','Name of Expense','Category','Amount','Mode of Expense','','','','','Mode of Expense'],
  ['2026-11-07','2024-04-02','Example Payer','Example expense','Office',123,'Cash','','','','','Derived']]}])],capture);
 const r=p.records.find(r=>r.table==='expenses');assert.equal(r.data.expense_date,'2024-04-02');assert.equal(r.data.mode,'Cash');
});
test('blank identities never become made-up patients; repeats retain source history',()=>{
 const p=project([book('main',[{title:'Registrations',rows:[['Timestamp','UHID','Full Name'],['2026-01-01','TEST-A','Example Original'],['2026-11-07','TEST-A','Example Updated'],['2026-11-07','','']]}])],capture);
 assert.equal(p.records.filter(r=>r.table==='patients').length,1);assert.equal(p.records.find(r=>r.table==='patients').data.full_name,'Example Updated');
 assert.equal(p.records.filter(r=>r.table==='patient_registrations').length,2);
 assert.equal(p.rejections['patients:empty_identity_row'],1);
});
test('finance opening estimates never overwrite an authored clinical treatment plan',()=>{
 const p=project([
  book('main',[{title:'Treatment Plans',rows:[['UHID','Patient Name','Date','Rows','Estimate'],['TEST-A','Example Patient','2026-11-07','[{"procedure":"Recorded care"}]','{"total":100}']]}]),
  book('finance',[{title:'Working for Balance',rows:[['Patient ID','Full Name','Treatment','Plan (Amount)'],['TEST-A','Example Patient','Finance opening',999]]}])
 ],capture);
 const plans=p.records.filter(r=>r.table==='treatment_plans');assert.equal(plans.length,1);assert.equal(plans[0].data.estimate.total,100);
});
test('preserves inconsistent source clocks without inventing normalized instants',()=>{
 const p=project([book('main',[{title:'Appointments',rows:[['Date','Time','Patient Name','Status','CheckinTime','EngagedTime','CheckoutTime'],
  ['2026-11-07','10:00','Example Patient','Completed','11:00','10:30','12:00']]}])],capture);
 const r=p.records.find(r=>r.table==='appointments');assert.equal(r.data.status,'Completed');assert.equal(r.data.checkin_at,null);
 assert.equal(r.data.source_timing.checkinTime,'11:00:00');assert.equal(r.data.source_timing.engagedTime,'10:30:00');assert.equal(r.data.source_timing.requiresReview,true);
});
test('collapses only exact duplicate procedure definitions',()=>{
 const row=['EXAMPLE','Example procedure','Family',1,2,1,'step','EXAMPLE-1','Recorded stage','No'];
 const p=project([book('main',[{title:'Procedure Library',rows:[['Procedure Code','Procedure Name','Family Code','Visits Min','Visits Max','Sequence No.','Stage Type','Stage Code','Stage Name','Completes Treatment'],row,row]}])],capture);
 assert.equal(p.records.filter(r=>r.table==='procedure_library').length,1);assert.equal(p.warnings.exact_duplicate_procedure_rows,1);
});
test('undated medical histories remain undated instead of appearing as care today',()=>{
 const p=project([book('main',[{title:'Registrations',rows:[['UHID','Full Name'],['TEST-A','Example Patient']]}])],capture);
 assert.equal(p.records.find(r=>r.table==='patient_registrations').data.collected_at,null);
});

test('imports the authoritative bilingual template library, plans, departments and examination configuration',()=>{
 const p=project([book('main',[
  {title:'Clinical Templates (Type 1 & 2)',rows:[['Category','Template','Type 1 (Concise)','Type 2 (Comprehensive)','Updated At','Hindi'],['Example','Example template','Short','Full','','उदाहरण']]},
  {title:'Clinical Note Plan',rows:[['Plan','Plan Treatment','Category','Templates','Updated At','Hindi'],['Normal','Example treatment','Example','Example template','','उपचार']]},
  {title:'Clinical Examination',rows:[['Section','Finding','Kind','Key','Updated At'],['Extraoral','Example finding','present','example_finding','']]},
  {title:'Clinical Departments',rows:[['Department','Updated At'],['Example','']]}
 ])],capture);
 const settings=Object.fromEntries(p.records.filter(r=>r.table==='clinic_settings').map(r=>[r.data.key,r.data.value]));
 assert.equal(settings.clinical_note_template_library[0].type2,'Full');
 assert.equal(settings.clinical_note_template_library[0].hindi,'उदाहरण');
 assert.equal(settings.clinical_note_plan[0].templates,'Example template');
 assert.equal(settings.clinical_examination[0].key,'example_finding');
 assert.ok(p.records.some(r=>r.table==='pick_lists'&&r.data.list_name==='clinical_department'&&r.data.value==='Example'));
});
