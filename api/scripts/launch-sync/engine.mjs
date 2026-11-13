import {createHash} from 'node:crypto';
export function stable(value) {
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object'&&!(value instanceof Date))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
export const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function businessData(record) {
 const data={...record.data};delete data.source_record_key;
 if(record.table==='daily_register')delete data.serial_no;
 if(record.table==='patients'&&data.import_provenance?.registration_date_source==='import_timestamp_not_registration')delete data.registered_on;
 if(record.table==='patient_registrations'&&data.form?.collection_date_unknown)delete data.collected_at;
 if(record.table==='patient_registrations'&&data.form){data.form={...data.form};delete data.form.source_order;}
 return data;
}
export function identity(record) {
 const d=record.data,t=record.table;
 if(t==='patients')return hash([t,d.uhid]);
 if(t==='clinical_records')return hash([t,d.uhid,d.tab_name,d.recorded_at]);
 if(t==='patient_registrations')return hash([t,d.uhid,d.form?.recorded_timestamp]);
 if(t==='daily_register')return hash([t,d.uhid,d.visit_date]);
 if(t==='appointments')return hash([t,d.legacy_id||[d.uhid,d.patient_name,d.starts_at]]);
 if(t==='receipts')return hash([t,d.legacy_receipt_no||[d.uhid,d.receipt_date]]);
 if(t==='expenses')return hash([t,d.legacy_id?.startsWith('SOURCE-')?[d.expense_date,d.expense_name]:d.legacy_id||[d.expense_date,d.expense_name]]);
 if(t==='clinical_sheets')return hash([t,d.uhid,d.sheet_type]);
 if(['care_plans','treatment_plans'].includes(t))return hash([t,d.uhid]);
 if(t==='treatment_cases')return hash([t,d.case_ref]);
 if(t==='cghs_bills')return hash([t,d.bill_no]);
 if(t==='pick_lists')return hash([t,d.list_name,d.data?.situation??d.value,d.data?.category??'']);
 if(t==='clinic_settings')return hash([t,d.key]);
 if(t==='crm_records')return hash([t,record.source.role,d.collection,d.data.id??record.key]);
 return hash([t,record.key]);
}
export function decision({sourceChanged,targetChanged,targetExists=true,ambiguous=false}) {
 if(ambiguous)return 'conflict';
 if(!targetExists)return 'conflict';
 if(!sourceChanged)return targetChanged?'keep_local_change':'unchanged';
 return targetChanged?'conflict':'update';
}
