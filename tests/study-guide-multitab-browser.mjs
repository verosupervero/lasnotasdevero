// Real guide/controller DOM, two tabs in one temporary browser profile.
// The provider is synthetic, served only by this loopback fixture. No real SDK
// artifact is replaced on disk, and all non-loopback browser traffic is blocked.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,mkdir,access} from 'node:fs/promises';
import {resolve,extname,relative,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {previewToml,run} from '../scripts/preview-firebase.mjs';
import {emptyProgress,mergeProgress,serializeProgress,updateProgress} from '../static/js/study-progress.js';

const root=process.cwd(), output=resolve(root,'.contact-test-output');
await mkdir(output,{recursive:true});
const work=await mkdtemp(resolve(output,'guide-multitab-'));
const project='demo-lasnotasdevero';
const configPath=resolve(work,'config.json');
await writeFile(configPath,JSON.stringify({enabled:false,firebase:{projectId:project,authDomain:project+'.firebaseapp.com',apiKey:'AIza'+'a'.repeat(35),appId:'1:42424242:web:abcdefabcdefabcdef'}}));
const catalog=JSON.parse(await readFile(resolve(root,'firebase/generated/catalog.json'),'utf8'));
const [q1,q2,q3,q4]=catalog.lucas['video-1'].questions;
assert.ok(q1&&q2&&q3&&q4,'Fixture requires four genuine question IDs');
let remote={revision:1,generation:crypto.randomUUID(),deleted:false,progress:updateProgress(emptyProgress(),'video-1','block',true,Date.now()-1000,q1)};
let source,holdNext=false,releaseHeld,patches=0,erased=false;
const fakeProvider=`
export async function createFirebaseProvider(config){
 if(config.projectId!=='demo-lasnotasdevero')throw Error('Synthetic project only');
 let subject=sessionStorage.getItem('fixture-auth')==='out'?undefined:'fixture-alice';const listeners=new Set();
 const session=()=>({authenticated:!!subject,...(subject?{subject}:{})});
 return {subscribeUser(fn){listeners.add(fn);queueMicrotask(()=>fn(session()));return()=>listeners.delete(fn);},
 async request(path,method='GET',body,expected){
 if(path==='session')return session();
 if(path==='auth/login'){subject='fixture-alice';sessionStorage.setItem('fixture-auth','in');listeners.forEach(fn=>fn(session()));return session();}
 if(path==='auth/logout'){subject=undefined;sessionStorage.setItem('fixture-auth','out');listeners.forEach(fn=>fn(session()));return{ok:true};}
 if(!subject||expected!==subject)throw Object.assign(Error('fixture-owner'),{status:403});
 const response=await fetch('/__fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,method,body,subject})});
 const result=await response.json();if(!response.ok)throw Object.assign(Error('fixture-http'),{status:response.status,data:result});
 if(path==='account/delete'){subject=undefined;sessionStorage.setItem('fixture-auth','out');listeners.forEach(fn=>fn(session()));}return result;
 },async dispose(){listeners.clear();}};
}`;
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/__fixture'){
   assert.equal(req.method,'POST');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>131072)throw Error('Fixture input too large');}
   const {path,method,body,subject}=JSON.parse(raw);if(subject!=='fixture-alice')return json(res,403,{});
   if(path==='account/delete'&&method==='DELETE'){erased=true;return json(res,200,{ok:true,deleted:true});}
   if(path!=='progress')return json(res,404,{});
   if(erased)return json(res,410,{revision:0,generation:null,deleted:true,progress:null});
   if(method==='GET')return json(res,200,remote);
   if(body.generation!==remote.generation)return json(res,body.generation===null&&!remote.deleted?409:410,remote);
   if(method==='DELETE'){
    if(body.revision!==remote.revision)return json(res,409,remote);
    remote={revision:remote.revision+1,generation:crypto.randomUUID(),deleted:true,progress:null};return json(res,200,remote);
   }
   if(!['PATCH','PUT'].includes(method))return json(res,405,{});
   if(body.revision>remote.revision||(method==='PUT'&&body.revision!==remote.revision))return json(res,409,remote);
   const next=method==='PATCH'?mergeProgress(remote.progress||emptyProgress(),body.progress):body.progress;
   if(serializeProgress(next)!==serializeProgress(remote.progress||emptyProgress()))remote={...remote,revision:remote.revision+1,deleted:false,progress:next};
   const ack=structuredClone(remote);patches++;
   if(holdNext){holdNext=false;await new Promise(r=>{releaseHeld=r;});releaseHeld=undefined;}
   return json(res,200,ack);
  }
  if(url.pathname==='/js/study-firebase.bundle.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});return res.end(fakeProvider);}
  let file=url.pathname==='/estudios/guia-estudio-lucas/'?'estudios/guia-estudio-lucas/index.html':decodeURIComponent(url.pathname).replace(/^\//,'');
  const boundary=file.startsWith('js/')?resolve(root,'static'):source;
  if(!boundary){res.writeHead(503);return res.end();}
  const absolute=resolve(boundary,file), child=relative(boundary,absolute);
  if(!child||child.startsWith('..')||isAbsolute(child)){res.writeHead(404);return res.end();}
  const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.woff2':'font/woff2'};
  res.writeHead(200,{'Content-Type':(types[extname(file)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(absolute));
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const pages=[];let browser,socketBrowser;
try{
 // The public preview command deliberately rejects demo-* projects. This
 // isolated test builds its own Hugo output, with synthetic config and provider.
 source=resolve(work,'site');
 const hugoConfig=resolve(work,'hugo.toml'),emptyConfig=resolve(work,'empty-config');
 await mkdir(emptyConfig);
 await writeFile(hugoConfig,previewToml(await readFile(resolve(root,'config/_default/config.toml'),'utf8'),1314,false));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('HUGO_')));
 await run(process.execPath,[resolve(root,'scripts/build-firebase.mjs')],{cwd:root,env});
 await run('hugo',['--config',hugoConfig,'--configDir',emptyConfig,'--destination',source,'--baseURL',origin+'/','--minify'],{cwd:root,env});
 await mkdir(resolve(source,'config'),{recursive:true});
 const synthetic=JSON.parse(await readFile(configPath,'utf8'));
 await writeFile(resolve(source,'config/firebase.json'),JSON.stringify({...synthetic,enabled:true}));
 const candidates=[process.env.BROWSER,process.env.LUCAS_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].filter(Boolean);
 let executable;for(const p of candidates){try{await access(p);executable=p;break;}catch{}}
 assert.ok(executable,'Chromium required');const profile=resolve(work,'profile');
 browser=spawn(executable,['--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let launchError;browser.on('error',e=>{launchError=e;});
 let port;for(let i=0;i<100;i++){try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0];break;}catch{}if(launchError)throw launchError;await pause(100);}
 assert.ok(port,'Browser started');
 async function page(){
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let serial=0;const waiting=new Map();
  const send=(method,params={})=>new Promise((r,j)=>{const id=++serial;const timer=setTimeout(()=>{waiting.delete(id);j(Error('CDP timeout '+method));},15000);waiting.set(id,{r,j,timer});socket.send(JSON.stringify({id,method,params}));});
  socket.onmessage=event=>{
   const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused'){
    const url=new URL(m.params.request.url);const allowed=url.origin===origin||['about:','data:','blob:'].includes(url.protocol);
    send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'}).catch(()=>{});return;
   }
   if(m.method==='Page.javascriptDialogOpening'){send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});return;}
   const w=waiting.get(m.id);if(!w)return;waiting.delete(m.id);clearTimeout(w.timer);m.error?w.j(Error(m.error.message)):w.r(m.result);
  };
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
  const p={socket,send,evaluate};pages.push(p);socketBrowser ||= p;
  await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await send('Page.navigate',{url:origin+'/estudios/guia-estudio-lucas/'});return p;
 }
 async function until(fn,label,timeout=25000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await pause(100);}throw Error('Timed out: '+label);}
 const connected=p=>p.evaluate(`!!document.querySelector('[data-account-connected]')&&!document.querySelector('[data-account-connected]').hidden`);
 const click=(p,selector)=>p.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing control');el.click();})()`);
 const control=q=>`[data-question-id="${q}"] [data-block-complete]`;
 const checked=(p,q)=>p.evaluate(`document.querySelector(${JSON.stringify(control(q))})?.checked===true`);
 const remoteHas=q=>remote.progress?.classes['video-1']?.blocks[q]?.value===true;

 const a=await page(),b=await page();await until(async()=>await connected(a)&&await connected(b),'both synthetic accounts connected');
 assert.equal(await checked(b,q1),true);
 await click(a,'[data-account-connected] [data-account-logout]');
 await until(async()=>!(await connected(a)),'A logout');
 assert.equal(await connected(b),true,'Other tab remains authenticated');
 assert.equal(await checked(b,q1),true,'Logout never empties other tab');
 await click(b,control(q2));await until(()=>remoteHas(q2),'B edit after A logout');
 assert.equal(remoteHas(q1),true,'Earlier block preserved after logout elsewhere');
 console.log('PASS logout A preserves B and prior cloud marks');

 const c=await page();await until(()=>connected(c),'C connected');
 await click(c,'[data-account-connected] [data-account-delete]');
 await until(()=>remote.deleted,'remote progress deleted');await pause(350);
 assert.equal(await checked(c,q1),false,'No old mark reintroduced in deleting tab');
 await click(c,control(q2));await until(()=>remoteHas(q2),'fresh generation edit');
 assert.equal(remoteHas(q1),false,'Deleted generation stays deleted');
 // The old tab must not send its former generation under the new epoch.
 if(!(await checked(b,q3)))await click(b,control(q3));await pause(8200);
 assert.equal(remoteHas(q1),false,'Old tab cannot resurrect old generation');
 console.log('PASS reset isolates old generation across tabs');

 // Ensure a later local edit survives the acknowledgment of an earlier batch.
 const d=await page();await until(()=>connected(d),'D connected');
 holdNext=true;await click(d,control(q1));await until(()=>!!releaseHeld,'held first acknowledgment');
 const before=patches;await click(d,control(q4));releaseHeld();
 await until(()=>patches>before&&remoteHas(q4),'new edit after in-flight batch');
 assert.equal(remoteHas(q1),true);assert.equal(remoteHas(q2),true);assert.equal(remoteHas(q4),true);
 console.log('PASS edits during upload survive acknowledgment');
 await d.send('Page.reload',{ignoreCache:true});await until(()=>connected(d),'reload resumes owner');
 assert.equal(await checked(d,q1),true);assert.equal(await checked(d,q4),true);
 const foreignKey='lasnotasdevero:lucas:progress:v1:private:v2:fixture-bob:foreign';
 await d.evaluate(`localStorage.setItem(${JSON.stringify(foreignKey)},JSON.stringify({version:2,uid:'fixture-bob',generation:'foreign-epoch',snapshot:{version:1,classes:{}},pending:{version:1,classes:{}}}))`);
 await click(d,'[data-account-connected] [data-account-delete-user]');
 await until(()=>erased,'explicit account erasure');
 await until(async()=>!(await connected(c))&&!(await connected(d)),'account deletion clears active peers');
 const remaining=await d.evaluate(`Object.keys(localStorage).filter(k=>k.includes(':private:v2:fixture-alice:')).length`);
 assert.equal(remaining,0,'All local copies of deleted UID removed');
 assert.equal(await d.evaluate(`localStorage.getItem(${JSON.stringify(foreignKey)})!==null`),true,'Other UID preserved');
 const report={passed:true,project,realStudentData:false,externalTrafficBlocked:true,sharedProfileTabs:pages.length,patches,cases:['logout-other-tab','reset-other-tab','inflight-edit','reload','account-delete-peer-cleanup']};
 await writeFile(resolve(work,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 releaseHeld?.();
 if(socketBrowser)await socketBrowser.send('Browser.close').catch(()=>{});
 for(const p of pages)p.socket.close();
 if(browser?.exitCode===null)browser.kill();
 server.closeAllConnections();await new Promise(r=>server.close(r));
}
