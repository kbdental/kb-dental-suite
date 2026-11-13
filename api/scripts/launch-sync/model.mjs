// Pure conversion functions. No credentials, network, database, or patient logs.
import {digest, tableRows} from './source.mjs';
import {dayOnly} from './compare.mjs';

const DAY = 86400000, OFFSET = 19800000;
export const text = value => String(value ?? '').trim();
export const idOf = value => text(value).toUpperCase();
export const nil = value => text(value) || null;
export function date(value) {
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text(value));
  return typeof value === 'number' ? dayOnly(value) : iso ? dayOnly(iso[1]) : dayOnly(value);
}
export function instant(value) {
  if (typeof value === 'number' && value > 1 && value < 2958465) {
    return new Date(Date.UTC(1899,11,30) + Math.round(value * DAY) - OFFSET).toISOString();
  }
  const s = text(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : s + '+05:30';
    const parsed = new Date(withZone);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const d = date(value);
  return d ? new Date(d + 'T00:00:00+05:30').toISOString() : null;
}
export function json(value, fallback = null) {
  if (value === '' || value === undefined || value === null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { throw new Error('invalid_json'); }
}
export function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (text(value).startsWith('[')) return json(value, []).map(text).filter(Boolean);
  return text(value).split(/[,;\n]/).map(text).filter(Boolean);
}
export function cents(value) {
  if (value === '' || value === undefined || value === null) return null;
  const clean = typeof value === 'number' ? String(value) : text(value).replace(/^(?:₹|INR)\s*/i,'').replace(/[,\s]/g,'');
  if (!/^[0-9]+(?:[.][0-9]+)?$/.test(clean)) throw new Error('invalid_amount');
  const amount = Number(clean);
  if (!Number.isFinite(amount) || amount > 9999999999.99) throw new Error('invalid_amount');
  return Math.round(amount * 100);
}
const yes = value => /^(yes|true|1)$/i.test(text(value));
function bool(value) { return text(value) ? yes(value) : null; }
const get = (row, ...aliases) => row.get(aliases);
const raw = (row, ...aliases) => row.getRaw(aliases);
function fields(tab, row, timezone) {
  if (!['Asia/Calcutta','Asia/Kolkata'].includes(timezone)) throw new Error('unsupported_source_timezone');
  const result = {};
  for (let i=0; i<(tab.rows[0]??[]).length; i++) {
    const heading = text(tab.rows[0][i]);
    if (!heading) continue;
    if (Object.hasOwn(result,heading)) throw new Error('duplicate_headers');
    const original = tab.rawRows?.[row.row-1]?.[i];
    const displayed = text(row.cells[i]);
    // The owning Apps Script emits Date cells as ISO instants. Detect numeric
    // date cells using their date heading and formatted date, never numeric IDs.
    result[heading] = typeof original === 'number' && /date|timestamp|saved at/i.test(heading)
      && !/^[0-9.,₹ ]+$/.test(displayed) ? instant(original) : displayed;
  }
  return result;
}
const clinicalAliases = ['UHID','UHID No.','Registration ID'];
function entry(book,tab,row,table,data,identity) {
  const key = digest([book.id,tab.id,table,identity ?? row.row]);
  return {table,key,data,source:{role:book.role,book:book.id,tab:tab.id,row:row.row}};
}
function dictionary(row,spec) {
  return Object.fromEntries(Object.entries(spec).map(([column,aliases])=>[column,nil(row.get(aliases.split('|')))]));
}

export function project(books, captureTime) {
  const records=[], rejections={}, warnings={}, identityEvidence=new Map();
  const reject = (table,reason) => { const key=table+':'+reason; rejections[key]=(rejections[key]??0)+1; };
  const warn = reason => { warnings[reason]=(warnings[reason]??0)+1; };
  const addEvidence = (uhid,name,source) => {
    if(!uhid||!name) return;
    const group=identityEvidence.get(uhid)??[]; group.push({name,source});identityEvidence.set(uhid,group);
  };
  const registrations = new Map();
  for(const book of books.filter(b=>['main','empanelled','historical-registration'].includes(b.role))) {
    const tabs=book.tabs.filter(t=>book.role==='historical-registration'?t.title==='Registration Form':t.title==='Registrations');
    for(const tab of tabs)for(const row of tableRows(tab)) {
      const uhid=idOf(row.get(clinicalAliases)),name=get(row,'Full Name','Patient Name','Name');
      if(!uhid||!name){reject('patients',!uhid&&!name?'empty_identity_row':!uhid?'missing_identifier':'missing_name');continue;}
      const when=instant(raw(row,'Timestamp','Registered On'));
      const historical=book.role==='historical-registration';
      const group=registrations.get(uhid)??[];
      group.push({book,tab,row,uhid,name,when,historical});registrations.set(uhid,group);
      if(!historical) {
        const habits=['Habits','Habits [Do you Smoke Beedi/Cigarette?]','Habits [Do you Chew Pan Masala]','Habits [Do you Consume Tobacco]','Habits [Do you Consume Alcohol]'];
        records.push(entry(book,tab,row,'patient_registrations',{uhid,
          collected_at:when,status:/^quick$/i.test(get(row,'Registration Status'))?'Quick':'Complete',
          conditions:list(get(row,'Have you ever suffered/suffering from any of the following?','Conditions')),
          allergies:list(get(row,'Are you allergic to any of the following?','Allergies')),
          medicines:nil(get(row,'Medicines you are taking currently:','Medicines')),
          habits:nil(habits.map(h=>get(row,h)).filter(Boolean).join(', ')),
          pregnant:bool(get(row,'For Only Women [Are you Pregnant]')),
          feeding_mother:bool(get(row,'For Only Women [Are you a Feeding mother]')),
          chief_complaint:nil(get(row,'What is your chief complaint?','Complaint')),
          pain_level:nil(get(row,'What is your level of pain on a scale of 0-10?','Pain Level')),
          how_known:nil(get(row,'How did you know about this clinic?')),
          consent_given:yes(get(row,'Consent')),
          form:{source:'live_sheets',source_order:(book.role==='empanelled'?10000000:0)+row.row,recorded_timestamp:when,collection_date_unknown:!when,fields:fields(tab,row,book.timeZone)}
        }));
      }
    }
  }
  for(const [uhid,group] of registrations) {
    // Current books outrank historical fallback, then recorded timestamp/row order.
    group.sort((a,b)=>Number(!a.historical)-Number(!b.historical)
      || (a.when??'').localeCompare(b.when??'') || Number(a.book.role==='empanelled')-Number(b.book.role==='empanelled') || a.row.row-b.row.row);
    const p=group.at(-1),r=p.row;
    const differences=new Set(group.map(x=>x.name.toLowerCase().replace(/\s+/g,' '))).size>1;
    const dobRaw=raw(r,'Date of Birth','DOB'),dob=date(dobRaw);
    const ptype=get(r,'Patient Type'),panel=get(r,'Panel');
    const review=differences||(!dob&&!!text(dobRaw))||!p.when||(ptype==='Panel'&&!panel);
    if(differences)warn('repeated_registration_name_variants');
    records.push(entry(p.book,p.tab,r,'patients',{uhid,full_name:p.name,
      ...dictionary(r,{gender:'Gender',blood_group:'Blood Group',occupation:'Occupation',marital_status:'Marital Status',
        address:'Complete Address|Address',mobile:'Mobile No.|Mobile',mobile_2:'Mobile 2',whatsapp:'WhatsApp No.|WhatsApp',email:'Email',
        emergency_name:'In Case Of Emergency Contact Person',emergency_contact:'In Case Of Emergency Contact Number',
        emergency_relation:'Relation with Person',referred_by:'Referred By',referred_by_type:'Referred By Type'}),
      date_of_birth:dob&&dob>'1900-01-01'?dob:null,patient_type:ptype==='Panel'&&panel?'Panel':ptype==='Normal'?'Normal':null,
      panel_name:ptype==='Panel'&&panel?panel:null,panel_category:ptype==='Panel'&&['Serving','Pensioner'].includes(get(r,'Panel Category'))?get(r,'Panel Category'):null,
      card_id:ptype==='Panel'?nil(get(r,'Card ID')):null,safety_flags:list(get(r,'Safety Flags')),
      registration_status:/^quick$/i.test(get(r,'Registration Status'))?'Quick':'Complete',registered_on:p.when??captureTime,
      import_provenance:{identity_source:p.historical?'historical_registration':'current_registration',
        registration_date_source:p.when?'recorded_timestamp':'import_timestamp_not_registration',review_required:review,
        recorded_patient_type:ptype,recorded_panel:panel,raw_date_of_birth:text(dobRaw),source:'live_sheets'}
    },uhid));
  }

  for(const book of books)for(const tab of book.tabs)for(const row of tableRows(tab)) {
    const uhid=idOf(row.get(clinicalAliases));
    const name=get(row,'Full Name','Patient Name','Name of Patient','Name','Patient');
    if(book.role==='clinical'||['Daily Register','Appointments','Treatment Cases','Care Plans','Treatment Plans'].includes(tab.title))
      addEvidence(uhid,name,{book,tab,row});
    try {
      if(book.role==='clinical'&&!tab.title.startsWith('Clinical Sheets')&&tab.title!=='Sheet1') {
        if(!uhid){reject('clinical_records','missing_identifier');continue;}
        const timestamp=instant(raw(row,'Timestamp'));
        if(!timestamp)warn('clinical_record_date_unknown');
        records.push(entry(book,tab,row,'clinical_records',{uhid,tab_name:tab.title,
          recorded_at:timestamp,fields:fields(tab,row,book.timeZone)}));
      }
      if(book.role==='clinical'&&tab.title.startsWith('Clinical Sheets')) {
        if(!uhid){reject('clinical_sheets','missing_identifier');continue;}
        records.push(entry(book,tab,row,'clinical_sheets',{uhid,patient_name:nil(name),sheet_type:get(row,'Sheet Type'),
          all_teeth:json(raw(row,'All Teeth Data'))},[uhid,get(row,'Sheet Type')]));
      }
      if(!['main','empanelled'].includes(book.role))continue;
      if(tab.title==='Daily Register') {
        const day=date(raw(row,'Timestamp','Date'));
        if(!day){reject('daily_register','missing_date');continue;}
        const record=entry(book,tab,row,'daily_register',{visit_date:day,uhid:uhid||null,
          ...dictionary(row,{month:'Month',patient_name:'Full Name|Patient Name',phone_no:'Phone No.',age:'Age',time_walk_in:'Time of Walk in',
            consultation_time:'Consultation Time',tat:'TAT (HR/MIN)',initial_assessment:'Initial Assessment Done',care_plan_documented:'Care Plan Documented',
            procedure_done:'Procedure Done',tooth_no:'Tooth No. (If any)',work_done:'Work Done',operating_doctor:'Operating Doctor',delay_reason:'If Delay Reason for Delay',mode_of_payment:'Mode of payment'}),serial_no:row.row-1});
        record.data.source_record_key=record.key;records.push(record);
      }
      if(['Treatment Plans','Care Plans','Consents'].includes(tab.title)) {
        if(!uhid){reject(tab.title,'missing_identifier');continue;}
        if(tab.title==='Treatment Plans')records.push(entry(book,tab,row,'treatment_plans',{uhid,patient_name:nil(name),plan_date:nil(get(row,'Date')),
          plan_rows:json(raw(row,'Rows')),estimate:json(raw(row,'Estimate'))},uhid));
        if(tab.title==='Care Plans')records.push(entry(book,tab,row,'care_plans',{uhid,patient_name:nil(name),plan_date:nil(get(row,'Date')),
          ...Object.fromEntries([1,2,3,4].map(n=>['page'+n,json(raw(row,'Page'+n))]))},uhid));
        if(tab.title==='Consents')records.push(entry(book,tab,row,'consents',{uhid,patient_name:nil(name),consent_date:nil(get(row,'Date')),
          ...dictionary(row,{procedure:'Procedure',language:'Language',soap:'SOAP|Findings',med_history:'Medical History',fee:'Fee',pay_terms:'Payment Terms',extra_proc:'Extra Procedures'})}));
      }
      if(tab.title==='Treatment Cases') {
        const opened=instant(raw(row,'OpenedDate')),status=get(row,'CaseStatus');
        if(!uhid||!opened||!['in_progress','completed'].includes(status)){reject('treatment_cases','invalid_identity_date_or_status');continue;}
        records.push(entry(book,tab,row,'treatment_cases',{uhid,patient_name:nil(name),case_ref:get(row,'CaseId'),
          procedure_code:get(row,'ProcedureCode'),procedure_name:get(row,'ProcedureName'),family_code:get(row,'FamilyCode'),tooth_ref:nil(get(row,'ToothRef')),
          case_status:status,opened_at:opened,closed_at:instant(raw(row,'ClosedDate')),visit_counter:Number(raw(row,'VisitCounter')||0),stages:json(raw(row,'StagesJson'),[])},get(row,'CaseId')));
      }
      if(tab.title.startsWith('CRM ')&&tab.title!=='CRM Lead Inbox') {
        const collection=tab.title.slice(4).toLowerCase();
        if(!['pipelines','leads','contacts','companies','followups','products','activities','payments','sources'].includes(collection))continue;
        const data=fields(tab,row,book.timeZone);
        for(let i=0;i<(tab.rows[0]??[]).length;i++){
          const heading=text(tab.rows[0][i]),value=tab.rawRows?.[row.row-1]?.[i];
          if(heading&&(typeof value==='boolean'||typeof value==='number'))data[heading]=value;
        }
        for(const [key,value]of Object.entries(data))if(/^[\[{]/.test(value))data[key]=json(value);
        records.push(entry(book,tab,row,'crm_records',{collection,position:row.row-2,data},[collection,data.id??row.row]));
      }
    }catch(error){reject(tab.title,error.message);}
  }
  // Recover only unambiguous recorded names for care-only identities; never create
  // fictional demographics or treat every finance reference as a person.
  for(const [uhid,evidence]of identityEvidence)if(!registrations.has(uhid)) {
    const names=new Set(evidence.map(x=>x.name.toLowerCase().replace(/\s+/g,' ')));
    if(names.size!==1){reject('patients','ambiguous_care_only_identity');continue;}
    const first=evidence[0],{book,tab,row}=first.source;
    records.push(entry(book,tab,row,'patients',{uhid,full_name:first.name,patient_type:null,registration_status:'Quick',registered_on:captureTime,
      import_provenance:{identity_source:'historical_record_only',registration_date_source:'import_timestamp_not_registration',review_required:true,source:'live_sheets'}},uhid));
  }
  const operations=projectOperations(books,new Set(records.filter(r=>r.table==='treatment_plans').map(r=>r.data.uhid)));
  records.push(...operations.records);
  for(const [key,count]of Object.entries(operations.rejections))rejections[key]=(rejections[key]??0)+count;
  for(const [key,count]of Object.entries(operations.warnings))warnings[key]=(warnings[key]??0)+count;
  return {records,rejections,warnings,issues:operations.issues};
}

export function clock(value) {
  if(typeof value==='number') {
    const seconds=Math.round(((value%1)+1)%1*86400)%86400;
    return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
  }
  const match=/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(text(value));
  if(!match)return null;
  let hour=Number(match[1]);const minute=Number(match[2]),second=Number(match[3]??0);
  if(match[4]){if(hour<1||hour>12)return null;hour=hour%12+(/PM/i.test(match[4])?12:0);}
  return hour<24&&minute<60&&second<60?[hour,minute,second].map(n=>String(n).padStart(2,'0')).join(':'):null;
}

function projectOperations(books,authored) {
 const records=[],rejections={},warnings={},issues=[];
 const reject=(table,reason,source)=>{const key=table+':'+reason;rejections[key]=(rejections[key]??0)+1;if(source)issues.push({table,reason,source});};
 const rowsFor=(book,title)=>book.tabs.filter(tab=>tab.title===title).flatMap(tab=>tableRows(tab).map(row=>({tab,row})));
 for(const book of books.filter(b=>b.role==='main')){
  // These are clinic-owned configuration tables, distinct from patient plans.
  const settings=[
   ['Clinical Templates (Type 1 & 2)','clinical_note_template_library',{category:'Category',template:'Template',type1:'Type 1 (Concise)',type2:'Type 2 (Comprehensive)',hindi:'Hindi'},'template'],
   ['Clinical Note Plan','clinical_note_plan',{plan:'Plan',treatment:'Plan Treatment',category:'Category',templates:'Templates',hindi:'Hindi'},'treatment'],
   ['Clinical Examination','clinical_examination',{section:'Section',finding:'Finding',kind:'Kind',key:'Key'},'finding']
  ];
  for(const [title,key,columns,required]of settings){
   const tab=book.tabs.find(t=>t.title===title);if(!tab)continue;
   const value=tableRows(tab).map(row=>Object.fromEntries(Object.entries(columns).map(([field,column])=>[field,get(row,column)]))).filter(row=>row[required]);
   if(key==='clinical_examination'){
    const keys=new Set();let valid=true;
    for(const row of value){row.kind=row.kind||'present';if(!row.key||keys.has(row.key)||!['healthy','present','check','text'].includes(row.kind))valid=false;keys.add(row.key);}
    if(!valid){reject('clinic_settings','invalid_examination_keys_or_kinds');continue;}
   }
   if(key==='clinical_note_plan'&&value.some(row=>!['Normal','CGHS'].includes(row.plan))){reject('clinic_settings','invalid_clinical_plan_type');continue;}
   records.push(entry(book,tab,{row:1},'clinic_settings',{key,value},key));
  }
  const profile=Object.fromEntries(rowsFor(book,'Clinic Profile').map(({row})=>[text(row.cells[0]),text(row.cells[1])]).filter(([key])=>key));
  const profileTab=book.tabs.find(t=>t.title==='Clinic Profile');
  if(profileTab)records.push(entry(book,profileTab,{row:1},'clinic_settings',{key:'clinic_profile',value:profile},'clinic_profile'));
  const off=[];for(const {tab,row}of rowsFor(book,'Working Days')){
    if(/^week/i.test(text(row.cells[0]))&&Number.isInteger(Number(row.cells[1])))off.push(Number(row.cells[1]));
    if(/^holiday/i.test(text(row.cells[0]))){const day=date(tab.rawRows?.[row.row-1]?.[1]??row.cells[1]);if(day)records.push(entry(book,tab,row,'holidays',{holiday_date:day,name:text(row.cells[2])},day));}
  }
  const tab=book.tabs.find(t=>t.title==='Working Days');
  if(tab)records.push(entry(book,tab,{row:1},'clinic_settings',{key:'week_off',value:[...new Set(off)].sort()},'week_off'));
 }
 for(const book of books.filter(b=>['main','empanelled'].includes(b.role)))for(const tab of book.tabs)for(const row of tableRows(tab))try {
  const uhid=idOf(row.get(clinicalAliases));
  if(tab.title==='Appointments') {
    const day=date(raw(row,'Date')),time=clock(raw(row,'Time'));
    const status=get(row,'Status')||'Scheduled';
    if(!day||!time||!['Scheduled','Checked In','In Chair','Completed','Cancelled','No Show'].includes(status)){reject('appointments','invalid_date_time_or_status');continue;}
    const starts=new Date(day+'T'+time+'+05:30'),stamp=heading=>{const v=raw(row,heading);if(v==='')return null;return typeof v==='number'&&v<1||clock(v)?new Date(day+'T'+clock(v)+'+05:30').toISOString():instant(v);};
    const timing={checkin_at:stamp('CheckinTime'),engaged_at:stamp('EngagedTime'),checkout_at:stamp('CheckoutTime')};
    let sourceTiming={};
    if(timing.engaged_at&&(!timing.checkin_at||timing.engaged_at<timing.checkin_at)||timing.checkout_at&&(!timing.engaged_at||timing.checkout_at<timing.engaged_at)){
      sourceTiming={checkinTime:clock(raw(row,'CheckinTime'))??get(row,'CheckinTime'),engagedTime:clock(raw(row,'EngagedTime'))??get(row,'EngagedTime'),
        checkoutTime:clock(raw(row,'CheckoutTime'))??get(row,'CheckoutTime'),requiresReview:true};
      timing.checkin_at=null;timing.engaged_at=null;timing.checkout_at=null;
      warnings.inconsistent_source_appointment_clocks=(warnings.inconsistent_source_appointment_clocks??0)+1;
    }
    records.push(entry(book,tab,row,'appointments',{uhid:uhid||null,patient_name:get(row,'Patient Name')||'Name not recorded',
      mobile:nil(get(row,'Mobile')),starts_at:starts.toISOString(),ends_at:new Date(+starts+30*60000).toISOString(),
      reason:get(row,'Type')||'Not recorded',sub_type:nil(get(row,'SubType')),doctor_name:nil(get(row,'Doctor')),chair_name:nil(get(row,'Chair')),
      notes:nil(get(row,'Notes')),status,legacy_id:nil(get(row,'ID')),...timing,source_timing:sourceTiming,
      cancel_reason:status==='Cancelled'?(get(row,'CancelReason')||'Reason not recorded in source'):null,
      case_ref:nil(get(row,'CaseId')),procedure_code:nil(get(row,'ProcedureCode')),procedure_name:nil(get(row,'ProcedureName')),family_code:nil(get(row,'FamilyCode')),
      planned_stages:json(raw(row,'PlannedStages'),[]),completed_stages:json(raw(row,'CompletedStages'),[]),visit_counter:nil(get(row,'VisitCounter'))},get(row,'ID')||row.row));
  }
  if(tab.title==='CGHS Bills') {
    const day=date(raw(row,'Bill Date')),amount=cents(raw(row,'Amount'));
    if(!uhid||!day||amount===null){reject('cghs_bills','missing_identity_date_or_amount');continue;}
    records.push(entry(book,tab,row,'cghs_bills',{uhid,patient_name:get(row,'Patient'),bill_no:get(row,'Bill No'),bill_date:day,panel:get(row,'Panel'),
      card_id:get(row,'Card ID'),panel_category:get(row,'Panel Category'),amount:amount/100,lines:json(raw(row,'Lines'),[]),address:get(row,'Address')},get(row,'Bill No')));
  }
  if(tab.title==='CRM Lead Inbox')records.push(entry(book,tab,row,'crm_lead_inbox',{inbox_ref:get(row,'id'),uhid:uhid||null,
    ...dictionary(row,{name:'name',mobile:'mobile',panel:'panel',panel_category:'panelCategory',card_id:'cardId',referred_by:'referredBy',referred_by_type:'referredByType'}),taken_at:instant(raw(row,'takenAt'))},get(row,'id')||row.row));
  if(tab.title==='Pending')records.push(entry(book,tab,row,'pending_registrations',{mobile:nil(get(row,'Mobile','Mobile No.')),
    form:fields(tab,row,book.timeZone),submitted_at:instant(raw(row,'Timestamp'))??null}));
  // Operating lists are organization clinic defaults, not separate panel clinics.
  if(book.role!=='main')continue;
  const master={
    'Doctor Details':['doctors',{name:'Name',phone:'Phone',email:'Email',role:'Role'}],
    'Chairs':['chairs',{name:'Chair'}], 'Panels':['panels',{name:'Panel'}],
    'Employees':['staff',{name:'Name',phone:'Phone',email:'Email',role:'Role'}],
    'Appointment Reasons':['appointment_reasons',{name:'Reason'}],
    'Treatments Master':['treatments',{name:'Treatment Name',department:'Department'}],
    'Medicines Master':['medicines',{name:'Medicine Name',default_dosage:'Default Dosage',default_frequency:'Default Frequency'}],
    'Implant Brands':['implant_brands',{name:'Brand'}]
  }[tab.title];
  if(master) {
    const [table,spec]=master,data=dictionary(row,spec);
    if(!data.name)continue;
    if(table==='treatments')data.fee=cents(raw(row,'Fee'))===null?null:cents(raw(row,'Fee'))/100;
    if(table==='implant_brands')data.sizes=list(get(row,'Sizes'));
    if(['treatments','medicines','implant_brands'].includes(table))data.sort_order=row.row-2;
    records.push(entry(book,tab,row,table,data,data.name.toLowerCase()));
  }
  const listName={
    'Payment Modes':'payment_mode','Document Categories':'document_category','Expense Categories':'expense_category','Expense Payers':'expense_payer',
    'Medicine Dosages':'medicine_dosage','Medicine Frequencies':'medicine_frequency','Medicine Durations':'medicine_duration','Medicine Notes':'medicine_note',
    'Medicine Instructions':'medicine_instruction','Clinical Note Templates':'clinical_note_template','Patient Types':'patient_type',
    'Occupations':'occupation','Referral Sources':'referral_source','Safety Flags':'safety_flag','Clinical Departments':'clinical_department'
  }[tab.title];
  if(listName&&text(row.cells[0])){
    const rich=['clinical_note_template','medicine_instruction'].includes(listName),situation=text(row.cells[0]);
    const data=rich?{situation,text:text(row.cells[1]),category:text(row.cells[2])}:null;
    records.push(entry(book,tab,row,'pick_lists',{list_name:listName,value:rich?digest([situation,data]):situation,data,sort_order:row.row-2},[listName,rich?data:situation]));
  }
  if(tab.title==='Panel Rates')records.push(entry(book,tab,row,'panel_rates',{panel_name:get(row,'Panel'),code:get(row,'Code'),procedure:nil(get(row,'Procedure')),
    rate:cents(raw(row,'Rate'))===null?null:cents(raw(row,'Rate'))/100,classification:get(row,'Classification'),sort_order:row.row-2}));
  if(tab.title==='Procedure Library')records.push(entry(book,tab,row,'procedure_library',{ord:row.row-2,procedure_code:get(row,'Procedure Code'),procedure_name:get(row,'Procedure Name'),
    family_code:get(row,'Family Code'),visits_min:Number(raw(row,'Visits Min')||0),visits_max:Number(raw(row,'Visits Max')||0),sequence_no:Number(raw(row,'Sequence No.')||0),
    stage_type:get(row,'Stage Type'),stage_code:get(row,'Stage Code'),stage_name:get(row,'Stage Name'),completes_treatment:yes(get(row,'Completes Treatment'))},[get(row,'Procedure Code'),get(row,'Sequence No.')]));
 }catch(error){reject(tab.title,error.message);}

 for(const book of books.filter(b=>['finance','empanelled'].includes(b.role))) {
  const numbered=new Map(),receipts=[];
  const paymentKey=x=>JSON.stringify([x.uhid,x.receipt_date,Math.round((x.amount1+x.amount2)*100)]);
  const payment=(row,numberedRow=false)=>({receipt_date:date(raw(row,numberedRow?'Date':'Timestamp')),uhid:idOf(get(row,'UHID'))||null,
    patient_name:nil(get(row,"Patient's Name",'Patient Name')),service:nil(get(row,'Nature of Professional Services','Service')),
    mode1:nil(get(row,numberedRow?'Mode':'Payment Mode')),amount1:(cents(raw(row,numberedRow?'Fee':'Amount'))??0)/100,
    mode2:numberedRow?null:nil(get(row,'Payment Mode (Payment mode is more than one)')),
    amount2:numberedRow?0:(cents(raw(row,'Amount (Payment mode is more than one)'))??0)/100,
    remarks:nil(get(row,'Remarks (If any)','Remarks')),legacy_receipt_no:numberedRow?nil(get(row,'E. Receipt No.')):null});
  for(const {tab,row}of rowsFor(book,'Receipt No.'))try{const data=payment(row,true);if(!data.receipt_date||data.receipt_date<'2024-04-01')continue;
    const key=paymentKey(data),group=numbered.get(key)??[];group.push({tab,row,data});numbered.set(key,group);}catch(e){reject('receipts',e.message);}
  for(const {tab,row}of rowsFor(book,'Patient Fee Receipt'))try{const data=payment(row);if(!data.receipt_date){if(data.uhid||data.amount1||data.amount2)reject('receipts','missing_date');continue;}if(data.receipt_date<'2024-04-01')continue;
    const matched=numbered.get(paymentKey(data))?.shift();if(matched)data.legacy_receipt_no=matched.data.legacy_receipt_no;
    receipts.push({tab,row,data});}catch(e){reject('receipts',e.message);}
  for(const group of numbered.values())receipts.push(...group);
  const electronic=new Map();for(const item of receipts){const key=paymentKey(item.data);electronic.set(key,(electronic.get(key)??0)+1);}
  const manual=new Map();
  for(const tab of book.tabs.filter(t=>/^FY\s*20[0-9]{2}[-/]/i.test(t.title))){
    const perTab=new Map();for(const row of tableRows(tab))try{
      const day=date(tab.rawRows?.[row.row-1]?.[1]??row.cells[1]);if(!day||day<'2024-04-01')continue;
      const data={receipt_date:day,uhid:idOf(row.cells[3])||null,patient_name:nil(row.cells[4]),service:nil(row.cells[5]),mode1:nil(row.cells[6]),
        amount1:(cents(tab.rawRows?.[row.row-1]?.[7]??row.cells[7])??0)/100,mode2:null,amount2:0,remarks:nil(row.cells[21]),legacy_receipt_no:null};
      const key=paymentKey(data),group=perTab.get(key)??[];group.push({tab,row,data});perTab.set(key,group);
    }catch(e){reject('receipts',e.message);}
    for(const [key,group]of perTab){const extra=group.slice(electronic.get(key)??0);if(extra.length>(manual.get(key)?.length??0))manual.set(key,extra);}
  }
  for(const group of manual.values())receipts.push(...group);
  for(const {tab,row,data}of receipts){data.service_source=data.service?'typed':null;records.push(entry(book,tab,row,'receipts',data,data.legacy_receipt_no||row.row));}
  for(const title of ['Expense','Expenses'])for(const {tab,row}of rowsFor(book,title))try{
    const historical=title==='Expense',day=date(raw(row,'Date','Date of Expense'))??date(raw(row,'Timestamp'));
    if(!day){reject('expenses','missing_date');continue;}if(day<'2024-04-01')continue;
    const amount=cents(raw(row,'Amount'));if(amount===null){reject('expenses','missing_amount');continue;}
    records.push(entry(book,tab,row,'expenses',{expense_date:day,paid_by:nil(get(row,'Payment Done By','Payment done by','Paid By')),
      expense_name:nil(get(row,'Name of Expense','Expense Name')),amount:amount/100,
      // Expense is the original form response layout: G is the entered mode;
      // L is a later derived mode column with the same heading. Never guess.
      mode:historical&&text(tab.rows[0]?.[6])==='Mode of Expense'?nil(row.cells[6]):nil(get(row,'Mode of Expense','Mode')),
      remarks:nil(get(row,'Remarks','Remarks (If any)','Remarks (Detail of Expense)')),category:nil(get(row,'Category','Expense Category')),legacy_id:historical?'SOURCE-'+digest([book.id,tab.id,row.row]):nil(get(row,'ID'))},get(row,'ID')||row.row));
  }catch(e){reject('expenses',e.message,{book:book.id,tab:tab.id,row:row.row});}
 }
 for(const book of books.filter(b=>b.role==='finance')){
  const groups=new Map();for(const item of rowsFor(book,'Working for Balance'))try{
    const uhid=idOf(get(item.row,'Patient ID')),amount=cents(raw(item.row,'Plan (Amount)'));
    if(!uhid||amount===null||authored.has(uhid))continue;
    const group=groups.get(uhid)??[];group.push({...item,amount});groups.set(uhid,group);
  }catch(e){reject('opening_estimates',e.message);}
  for(const [uhid,group]of groups){const {tab,row}=group[0];records.push(entry(book,tab,row,'treatment_plans',{uhid,patient_name:nil(get(row,'Full Name')),
    plan_date:null,plan_rows:null,estimate:{total:group.reduce((n,x)=>n+x.amount,0)/100,items:group.map(x=>({treatment:get(x.row,'Treatment'),amount:x.amount/100})),
      source:'Finance sheet, Working for Balance',verified:false}},uhid));}
 }
 const procedures=new Map(),filtered=[];
 for(const record of records){
  if(record.table!=='procedure_library'){filtered.push(record);continue;}
  const key=JSON.stringify([record.data.procedure_code,record.data.sequence_no]);
  const data={...record.data};delete data.ord;
  const previous=procedures.get(key);
  if(previous===undefined){procedures.set(key,digest(data));filtered.push(record);}
  else if(previous===digest(data))warnings.exact_duplicate_procedure_rows=(warnings.exact_duplicate_procedure_rows??0)+1;
  else reject('procedure_library','different_rows_share_procedure_key');
 }
 return {records:filtered,rejections,warnings,issues};
}
