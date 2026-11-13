// Offline tests: delayed anonymous/expired-session reads must not undo a new login.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup() {
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const start=html.indexOf('const KB_TOKEN_KEY =');
 const end=html.indexOf('// Several reads in ONE round trip.',start);
 assert.ok(start>0&&end>start);
 const storage=new Map(),requests=[];
 const context={URLSearchParams,setTimeout,clearTimeout,
  SCRIPT_URL:'https://script.google.com/macros/s/fictional/exec',KB_BACKEND_IS_APPS_SCRIPT:true,
  scopedKey:key=>key,window:{},console:{error(){}},
  sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  fetch:(url,options)=>new Promise(resolve=>{
   const payload=options?.body?JSON.parse(options.body):Object.fromEntries(new URL(url).searchParams);
   requests.push({payload,reply:body=>resolve({ok:true,status:200,json:async()=>body})});
  })};
 vm.createContext(context);
 vm.runInContext(html.slice(start,end),context);
 let reopened=0;
 context.setAuthRequiredHandler(()=>{reopened++;});
 return {context,requests,reopened:()=>reopened};
}

test('late expired-session read does not clear a newly issued login token',async()=>{
 const h=setup();
 h.context.setSessionToken('fictional-old-token');
 const read=h.context.apiDirect('getAllPatients');
 assert.equal(h.requests[0].payload.token,'fictional-old-token');
 const login=h.context.apiDirect('staffLogin',{password:'fictional-test-password'});
 h.requests[1].reply({success:true,token:'fictional-new-token'});
 const signedIn=await login;
 h.context.setSessionToken(signedIn.token);
 h.requests[0].reply({success:false,authRequired:true,error:'AUTH_REQUIRED'});
 await read;
 assert.equal(h.context.getSessionToken(),'fictional-new-token');
 assert.equal(h.reopened(),0);
});

test('late batched anonymous read does not reopen sign-in after login',async()=>{
 const h=setup();
 const read=h.context.api('getDoctors');
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(h.requests[0].payload.action,'batch');
 h.context.setSessionToken('fictional-new-token');
 h.requests[0].reply({success:true,results:{'getDoctors|{}':{success:false,authRequired:true,error:'AUTH_REQUIRED'}}});
 await read;
 assert.equal(h.context.getSessionToken(),'fictional-new-token');
 assert.equal(h.reopened(),0);
});

test('rejection of the current session still clears it and opens sign-in',async()=>{
 const h=setup();
 h.context.setSessionToken('fictional-current-token');
 const read=h.context.apiDirect('getAllPatients');
 h.requests[0].reply({success:false,authRequired:true,error:'AUTH_REQUIRED'});
 await read;
 assert.equal(h.context.getSessionToken(),'');
 assert.equal(h.reopened(),1);
});
