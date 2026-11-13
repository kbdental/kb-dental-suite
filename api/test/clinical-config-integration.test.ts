import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {makeWorld,type World} from './setup.js';import {execLogin,exec} from './legacy.js';
let w:World,admin:string,desk:string;
beforeAll(async()=>{w=await makeWorld();admin=await execLogin(w,'alpha','a-admin');desk=await execLogin(w,'alpha','a-desk');});
afterAll(async()=>{await w.close();});
describe('latest native Master clinical configuration contract',()=>{
 it('preserves existing templates until the new library is explicitly saved',async()=>{
  await exec(w,admin,'saveClinicalNoteTemplates',{templates:[{situation:'Example source note',category:'General',text:'Existing curated text'}]});
  const lib=await exec(w,admin,'getClinicalNoteTemplateLib');expect(lib).toMatchObject({success:true,rows:[{template:'Example source note',type1:'Existing curated text',type2:'Existing curated text'}]});
  expect((await exec(w,admin,'getClinicalNoteTemplates')).templates[0].text).toBe('Existing curated text');
 });
 it('round trips concise, comprehensive and Hindi notes, and keeps the clinical/printed lengths distinct',async()=>{
  const rows=[{category:'Example',template:'Example note',type1:'Short note',type2:'Full clinical note',hindi:'उदाहरण'}];
  expect((await exec(w,admin,'saveClinicalNoteTemplateLib',{rows})).success).toBe(true);
  expect((await exec(w,admin,'getClinicalNoteTemplateLib')).rows).toEqual(rows);
  expect((await exec(w,admin,'getClinicalNoteTemplates')).templates).toEqual([{category:'Example',situation:'Example note',text:'Full clinical note',concise:'Short note',comprehensive:'Full clinical note',hindi:'उदाहरण'}]);
  expect((await exec(w,desk,'saveClinicalNoteTemplateLib',{rows:[]})).success).toBe(false);
  expect((await exec(w,admin,'saveClinicalNoteTemplateLib',{rows:[{template:'Invalid',type1:{bad:true}}]})).success).toBe(false);
  expect((await exec(w,admin,'getClinicalNoteTemplateLib')).rows).toEqual(rows);
 });
 it('stores both plan types and departments without leaking them to another clinic',async()=>{
  const rows=[{plan:'Normal',treatment:'Example treatment',category:'Example',templates:'Example note',hindi:'उपचार'},{plan:'CGHS',treatment:'Panel example',category:'Example',templates:'Example note',hindi:''}];
  expect((await exec(w,admin,'saveClinicalNotePlan',{rows})).success).toBe(true);
  expect((await exec(w,admin,'getClinicalNotePlan')).rows).toEqual(rows);
  expect((await exec(w,admin,'saveClinicalDepartmentsList',{departments:['Example','Other']})).success).toBe(true);
  expect((await exec(w,admin,'getClinicalDepartmentsList')).departments).toEqual(['Example','Other']);
  const second=await execLogin(w,'beta','b-admin');expect((await exec(w,second,'getClinicalNotePlan')).rows).toEqual([]);
 });
 it('persists examination findings with stable keys and refuses duplicate keys',async()=>{
  const findings=[{section:'Extraoral',finding:'Example finding',kind:'present',key:'example_finding'}];
  expect((await exec(w,admin,'saveClinicalExaminationList',{findings})).success).toBe(true);
  expect((await exec(w,admin,'getClinicalExaminationList')).findings).toEqual(findings);
  expect((await exec(w,desk,'saveClinicalExaminationList',{findings:[]})).success).toBe(false);
  expect((await exec(w,admin,'saveClinicalExaminationList',{findings:[...findings,...findings]})).success).toBe(false);
  expect((await exec(w,admin,'getClinicalExaminationList')).findings).toEqual(findings);
 });
 it('keeps an explicitly emptied library empty instead of reseeding old notes',async()=>{
  expect((await exec(w,admin,'saveClinicalNoteTemplateLib',{rows:[]})).success).toBe(true);
  expect((await exec(w,admin,'getClinicalNoteTemplateLib')).rows).toEqual([]);
  expect((await exec(w,admin,'getClinicalNoteTemplates')).templates).toEqual([]);
 });
});
