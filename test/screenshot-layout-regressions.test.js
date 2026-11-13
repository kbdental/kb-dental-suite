const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const html=fs.readFileSync('index.html','utf8');
function source(name){const from=html.indexOf('function '+name+'(');assert.ok(from>=0,name+' exists');const end=html.indexOf('\n}',from)+2;return html.slice(from,end);}
const element=(type,props,...children)=>({type:typeof type==='function'?type.name:type,props:props||{},children});
test('historical single-day register filters show the chosen date, not Today',()=>{
 const fn=vm.runInNewContext('('+source('registerRangeLabel')+')',{fmtDMY:v=>v.split('-').reverse().join('/')});
 assert.equal(fn('2026-10-12','2026-10-12','2026-11-07'),'12/10/2026');
 assert.equal(fn('2026-11-07','2026-11-07','2026-11-07'),'Today');
 assert.equal(fn('2026-10-12','2026-10-13','2026-11-07'),'12/10/2026 → 13/10/2026');
});
test('clinic choice stays visible until the switch is confirmed',()=>{
 const state={clinic_id:'clinic-a',clinics:[{id:'clinic-a',name:'Clinic A'},{id:'clinic-b',name:'Clinic B'}]};let n=0;
 const tree=vm.runInNewContext(source('WorkingClinicSelector')+'\nWorkingClinicSelector()',{useState:()=>[[state,false,'','clinic-b'][n++],()=>{}],useEffect:()=>{},React:{createElement:element},BORDER:'#ddd'});
 const select=tree.children[0].children[1];assert.equal(select.type,'select');assert.equal(select.props.value,'clinic-b');
});
test('embedded register keeps letterhead before its tabs and renders only one letterhead',()=>{
 const code=source('Daysheet');let n=0;const values=['2026-11-07','All Doctors','',[],false,false,'register',''];
 const tree=vm.runInNewContext(code+'\nDaysheet({})',{clinicISODate:()=>values[0],useState:()=>[values[n++],()=>{}],useEffect:()=>{},useDoctors:()=>[],React:{createElement:element,useRef:()=>({current:0})},T:'#078',BORDER:'#ddd',ClinicHeader:function ClinicHeader(){},DailyRegister:function DailyRegister(){}});
 assert.equal(tree.children[0].type,'ClinicHeader');
 const register=tree.children.find(x=>x&&x.type==='DailyRegister');assert.equal(register.props.showHeader,false);
});
