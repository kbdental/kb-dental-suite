const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('const MASTER_STRUCTURE = [');
const end=html.indexOf('\n];',start)+3;
function navigation(native){
 const helper=html.indexOf('function masterNavigation(');
 assert.ok(helper>=0,'backend-specific navigation exists');
 const helperEnd=html.indexOf('\n}',helper)+2;
 return vm.runInNewContext(html.slice(start,end)+'\n'+html.slice(helper,helperEnd)+'\nmasterNavigation('+native+')');
}
test('native Master has one clinic category and organization clinic creation',()=>{
 const groups=navigation(true);
 assert.equal(groups.filter(x=>x.id==='clinic').length,1);
 assert.ok(!groups.some(x=>x.id==='clinicalConfig'||x.id==='security'));
 const org=groups.find(x=>x.id==='organization');
 assert.ok(org.subtabs.some(x=>x.id==='rolesAccess'));
 assert.ok(org.subtabs.some(x=>x.id==='security'));
 assert.equal(org.subtabs.find(x=>x.id==='otherClinic').label,'Clinics');
 const clinic=groups.find(x=>x.id==='clinic');
 for(const id of ['clinicProfile','doctors','employees','chairs','templates','medInstructions','medNotes','implantBrands'])assert.ok(clinic.subtabs.some(x=>x.id===id),id+' remains reachable');
 assert.ok(!clinic.subtabs.some(x=>x.id==='otherClinic'));
 const ids=groups.flatMap(x=>x.subtabs?.map(s=>s.id)??[x.id]);
 assert.equal(new Set(ids).size,ids.length,'each editor has one navigation entry');
});
test('Sheets navigation preserves its existing clinical and document settings',()=>{
 const groups=navigation(false);
 assert.ok(groups.some(x=>x.id==='clinicalConfig'));
 assert.ok(groups.some(x=>x.id==='security'));
 assert.ok(groups.find(x=>x.id==='clinic').subtabs.some(x=>x.id==='otherClinic'));
});
function finance(native){
 const code=html.slice(html.indexOf('function FinanceSettingsSubTab()'),html.indexOf('function ReportsPasswordChanger()'));
 const React={useState:value=>[value,()=>{}],useEffect:()=>{},createElement:(type,props,...children)=>({type:typeof type==='string'?type:'component',props,children})};
 return JSON.stringify(vm.runInNewContext(code+'\nFinanceSettingsSubTab()',{React,window:{KB_SCRIPT_URL_OVERRIDE:native?'native':''},BORDER:'#ddd',T:'#078',inp:{},Lbl:()=>{}}));
}
test('native Finance cannot suggest changing its live Sheets connection',()=>{
 const native=finance(true);
 assert.ok(!native.includes('Finance Google Sheet'));
 assert.ok(!native.includes('Google Sheet URL or ID'));
 assert.ok(native.includes('Receipt & P&L Password'));
 const sheets=finance(false);
 assert.ok(sheets.includes('Finance Google Sheet'));
});
test('native security has no duplicate staff access editor',()=>{
 const code=html.slice(html.indexOf('    security: () =>'),html.indexOf('    sales: () =>'));
 let docs=0,master=0;
 const React={createElement:(type,props,...children)=>{if(typeof type==='function')return type(props);return children;}};
 vm.runInNewContext('const content={'+code+'}; content.security();',{React,window:{KB_SCRIPT_URL_OVERRIDE:'native'},DocumentsPasswordChanger:()=>{docs++;},MasterPasswordChanger:()=>{master++;}});
 assert.equal(docs,0);assert.equal(master,1);
});
