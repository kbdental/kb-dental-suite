import {chmodSync,existsSync,lstatSync,mkdirSync,renameSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';

export function privateDirectory(path) {
 if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('Private runtime cannot be a symbolic link');
 mkdirSync(path,{recursive:true,mode:0o700});
 if(process.platform==='win32'){
  const sid=execFileSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).match(/S-1-[0-9-]+/)?.[0];
  if(!sid)throw Error('Cannot determine current Windows user');
  execFileSync('icacls',[path,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{stdio:'ignore',windowsHide:true});
 }else chmodSync(path,0o700);
}

export function privateWrite(path,contents,{exclusive=false}={}) {
 if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('Private file cannot be a symbolic link');
 if(exclusive){writeFileSync(path,contents,{flag:'wx',mode:0o600});return;}
 const temporary=path+'.'+randomUUID()+'.tmp';
 writeFileSync(temporary,contents,{flag:'wx',mode:0o600});renameSync(temporary,path);
}
export const privateJson=(path,value,options)=>privateWrite(path,JSON.stringify(value,null,2)+'\n',options);
export const postgresBinary=name=>process.env.KB_PG_BIN
 ?join(process.env.KB_PG_BIN,name+(process.platform==='win32'?'.exe':''))
 :process.platform==='win32'?join('C:/Program Files/PostgreSQL/18/bin',name+'.exe'):name;
