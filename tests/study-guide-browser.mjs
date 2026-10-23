import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve, extname } from 'node:path';

const origin='https://www.lasnotasdevero.com', route='/estudios/guia-estudio-lucas/';
const root=resolve('public'), out=resolve('.contact-test-output/lucas-bibliography');
const key='lasnotasdevero:lucas:progress:v1';
const baselineHtml=null; // Prior task's archive predates the editor's latest Video 3 questions.
const otherBefore=await readFile(resolve('.contact-test-output/lucas-platform/other-pages-before.json'),'utf8').then(JSON.parse).catch(()=>null);
const markdownDir=resolve('content/estudios/guia-estudio-lucas');
const markdownFiles=(await readdir(markdownDir)).filter(name=>name.endsWith('.md')).sort();
const pageSources=await Promise.all(markdownFiles.map(async name=>({name,text:await readFile(resolve(markdownDir,name),'utf8')})));
const expectedQuestionIds=pageSources.flatMap(({text})=>[...text.matchAll(/\{\{<\s*study-question\s+id="([^"]+)"/g)].map(match=>match[1]));
const expectedLessons=pageSources.flatMap(({text})=>[...text.matchAll(/\{\{<\s*study-video\s+([^>]+)>\}\}/g)].map(match=>{
  const attributes=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute=>[attribute[1],attribute[2]]));
  assert.ok(attributes.id,'Every study-video source declares a stable ID');
  return {id:attributes.id,kind:attributes.kind||'course'};
}));
const expectedCourseCount=expectedLessons.filter(lesson=>lesson.kind==='course').length;
const bibliography=JSON.parse(await readFile(resolve('data/bibliography.json'),'utf8'));
const originalFiles=['video-3-original.md','censo-original.md','general-original.md'];
const originalSources=await Promise.all(originalFiles.map(async name=>readFile(resolve('.contact-test-output/lucas-bibliography',name),'utf8').catch(()=>null)));
const originalQuestionIds=originalSources.filter(Boolean).flatMap(source=>[...source.matchAll(/\{\{<\s*study-question\s+id="([^"]+)"/g)].map(match=>match[1]));
const originalLinks=originalSources.filter(Boolean).flatMap(source=>[...source.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map(match=>match[1]));
const expectedBibliography={
  'lucas-1-6-cierre-practico':['walton-keener-vida-2016','bird-whispers-revolution-2025','wright-bird-2019','fee-exegesis-espiritualidad-por-confirmar','keener-reflexion-milagros-por-identificar','keener-miracles-2011'],
  'video-6':['imes-portadores-de-su-nombre','keener-ivp-2014','osborne-lucas-2020','walton-keener-vida-2016'],
  'video-5':['bird-early-christian-history','keener-ivp-2014','osborne-lucas-2020','walton-keener-vida-2016'],
  'video-4':['wright-bird-2019','keener-ivp-2014','walton-keener-vida-2016'],
  'video-3':['wright-bird-2019','keener-ivp-2014','walton-keener-vida-2016','keener-mundo-hispano','glahn-shepherds','green-up-down','keener-two-kings','keener-shepherds','keener-mary'],
  'censo-lucas-2':['huebner-census-2019','keener-ivp-2014','bird-nativity-2025'],
  general:Object.entries(bibliography).map(([id])=>id)
};
await mkdir(out,{recursive:true});
const browserPath=process.env.LUCAS_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile=resolve(out,`edge-profile-${Date.now()}`);
await mkdir(profile,{recursive:true});
const args=['--headless=new','--disable-gpu','--disable-breakpad','--disable-crash-reporter','--no-sandbox','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const misses=[],external=[],requests=[];let transportError,send,activeBrowser,activeSocket;
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const until=async(expression,timeout=8000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(transportError)throw transportError;if(await evaluate(expression))return;await pause(40);}throw Error(`Timed out: ${expression}`);};
async function respond({requestId,request}){
  const url=new URL(request.url);requests.push({url:url.href,method:request.method});
  if(url.origin!==origin){external.push(url.href);await send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});return;}
  assert.equal(request.method,'GET',`Unexpected ${request.method} request to ${url.href}; local progress must not require a server`);
  let path=decodeURIComponent(url.pathname);if(path.endsWith('/'))path+='index.html';
  try{const bytes=await readFile(resolve(root,'.'+path));const ext=extname(path);const type=({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'})[ext]||'application/octet-stream';await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:type}],body:Buffer.from(bytes).toString('base64')});}
  catch(e){if(e.code!=='ENOENT')throw e;misses.push(path);await send('Fetch.fulfillRequest',{requestId,responseCode:404,responseHeaders:[{name:'Content-Type',value:'text/plain'}],body:''});}
}
async function connect(profilePath){
  await rm(resolve(profilePath,'DevToolsActivePort'),{force:true});
  const proc=spawn(browserPath,args.map(a=>a.replace(`--user-data-dir=${profile}`,`--user-data-dir=${profilePath}`)),{windowsHide:true,stdio:['ignore','inherit','inherit']});
  let port;
  for(let i=0;i<120;i++){try{port=(await readFile(resolve(profilePath,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/)[0];break;}catch{}if(proc.exitCode!==null)throw Error(`Edge exited: ${proc.exitCode}`);await pause(100);}
  assert.ok(port,'Edge DevTools must start');
  const target=await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'}).then(r=>r.json());
  const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let sequence=0;const pending=new Map();
  const command=(method,params={})=>new Promise((r,j)=>{const id=++sequence;pending.set(id,{r,j});ws.send(JSON.stringify({id,method,params}));});
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const {r,j}=pending.get(m.id);pending.delete(m.id);m.error?j(m.error):r(m.result);}else if(m.method==='Fetch.requestPaused')respond(m.params).catch(async e=>{transportError=e;try{await command('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Failed'});}catch{}});};
  await command('Page.enable');await command('Runtime.enable');await command('DOM.enable');await command('Accessibility.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  return {proc,ws,command};
}
async function stop(conn){try{await conn.command('Browser.close');}catch{}if(conn.proc.exitCode===null)await Promise.race([once(conn.proc,'exit'),pause(3000)]);if(conn.proc.exitCode===null){conn.proc.kill();await once(conn.proc,'exit').catch(()=>{});}conn.ws.close();}
try{
  let conn=await connect(profile);activeBrowser=conn.proc;activeSocket=conn.ws;send=conn.command;
  await send('Page.navigate',{url:origin+route});
  await until(`!!document.querySelector('main#study-platform')&&location.pathname===${JSON.stringify(route)}`);
  await until(`!document.querySelector('#study-tools')?.hidden`);
  const initial=await evaluate(`(()=>{const app=document.querySelector('main#study-platform'),lessons=[...app.querySelectorAll('article.study-lesson')],sel=document.querySelector('#study-class-selector');return {canonical:[...document.querySelectorAll('link[rel=canonical]')].at(-1)?.href,heading:app.querySelector('h1')?.textContent.trim(),courseId:app.dataset.courseId,planned:app.dataset.plannedVideos,lessons:lessons.map(l=>({id:l.dataset.studyId,kind:l.dataset.kind,title:l.dataset.title||l.querySelector('h2')?.textContent.trim(),label:l.dataset.label,passage:l.dataset.passage,visible:!l.hidden,blocks:l.querySelectorAll('details.study-question').length})),blocks:[...app.querySelectorAll('details.study-question')].map(b=>({id:b.dataset.questionId,anchor:b.querySelector('h3[id]')?.id,lesson:b.closest('article.study-lesson')?.dataset.studyId,checked:!!b.querySelector('input[data-block-complete]')?.checked,open:b.open,named:!!b.querySelector('input[data-block-complete]')?.labels?.length})),options:[...sel.options].map(o=>({id:o.value,text:o.textContent.trim(),selected:o.selected})),resumeHidden:document.querySelector('#study-resume')?.hidden,progress:document.querySelector('#study-overall-text')?.textContent,last:document.querySelector('#study-last-activity')?.textContent,text:app.textContent,iframes:[...app.querySelectorAll('iframe')].map(f=>({src:f.getAttribute('src'),title:f.title,loading:f.loading,allowfullscreen:f.allowFullscreen})),h1:app.querySelectorAll('h1').length}})()`);
  assert.equal(initial.courseId,'lucas');assert.equal(initial.planned,'13');assert.equal(initial.heading,'Estudiemos el Evangelio de Lucas');assert.ok(initial.canonical?.endsWith(route));
  assert.deepEqual(initial.lessons.map(({id,kind})=>({id,kind})),expectedLessons,'Render exactly the source classes in resource order');assert.deepEqual(initial.options.map(option=>option.id),expectedLessons.map(lesson=>lesson.id),'Selector reflects source classes');
  assert.equal(initial.blocks.length,expectedQuestionIds.length);assert.deepEqual(initial.blocks.map(block=>block.id),expectedQuestionIds,'Every source question appears in resource order');assert.ok(initial.blocks.every(b=>b.id&&b.anchor&&b.named));assert.equal(new Set(initial.blocks.map(b=>b.id)).size,initial.blocks.length);assert.ok(originalQuestionIds.every(id=>expectedQuestionIds.includes(id)),'Original saved question IDs remain stable');assert.equal(new Set(initial.lessons.map(l=>l.id)).size,expectedLessons.length);assert.equal(initial.lessons.filter(l=>l.visible).length,1);assert.equal(initial.h1,1);
  assert.ok(initial.lessons.filter(l=>l.kind==='course').every(l=>l.label&&l.title&&l.passage));assert.ok(initial.iframes.length<=1);assert.ok(initial.iframes.every(f=>f.title&&f.loading==='lazy'&&f.allowfullscreen));assert.equal(initial.resumeHidden,true);assert.ok(initial.blocks.every(b=>!b.checked&&!b.open));assert.match(initial.progress,new RegExp(`0 de ${expectedCourseCount} clases publicadas`));assert.match(initial.progress,/13 videos previstos/);assert.match(initial.last,/todav[ií]a no registraste actividad/i);
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(key)})`),null,'A passive first visit should not write progress');
  assert.equal(await evaluate(`document.querySelectorAll('#study-platform input[type=email],#study-platform input[type=password],#study-platform form[action*=auth]').length`),0,'Local study should not ask for account credentials');

  const baseline=baselineHtml?await evaluate(`(()=>{const d=new DOMParser().parseFromString(${JSON.stringify(baselineHtml)},'text/html'),c=d.querySelector('#content.article-content');return {questions:[...c.querySelectorAll('p,li')].map(x=>x.textContent.trim().replace(/\\s+/g,' ')).filter(x=>x.includes('?')),links:[...c.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>h&&!h.startsWith('#')),ids:[...c.querySelectorAll('[id]')].map(x=>x.id)}})()`):null;
  const content=await evaluate(`(()=>{const c=document.querySelector('#study-content');return {questions:[...c.querySelectorAll('p,li')].map(x=>x.textContent.trim().replace(/\\s+/g,' ')).filter(x=>x.includes('?')),links:[...c.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>h&&!h.startsWith('#')),ids:[...c.querySelectorAll('[id]')].map(x=>x.id)}})()`);
  const norm=x=>x.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\s+/g,' ').toLowerCase(), nowQ=new Set(content.questions.map(norm));
  const kept=baseline?baseline.questions.filter(q=>nowQ.has(norm(q))):null;
  const abs=x=>new URL(x,origin+route).href,missingLinks=baseline?[...new Set(baseline.links)].filter(h=>!content.links.map(abs).includes(abs(h))):null,missingIds=baseline?[...new Set(baseline.ids)].filter(id=>!content.ids.includes(id)):null;
  if(baseline){assert.equal(content.questions.length,baseline.questions.length,'Keep original question/prose entry count');assert.equal(kept.length,baseline.questions.length,'No original question text removed');assert.deepEqual(missingLinks,[],'Original external/content links retained');assert.deepEqual(missingIds,[],'Old anchors retained');}
  const retainedOriginalLinks=[...new Set(originalLinks)].filter(href=>content.links.some(link=>abs(link)===abs(href)));
  assert.equal(retainedOriginalLinks.length,new Set(originalLinks).size,'Retain links from the original Video 3, census, and general bibliography sources');
  assert.equal(content.ids.length,new Set(content.ids).size,'Unique generated IDs');

  const renderedBibliography=await evaluate(`(()=>{const lessons=[...document.querySelectorAll('#study-content article.study-lesson')],panelData=el=>({summary:el.querySelector('summary')?.textContent.trim(),open:el.open,lists:[...el.querySelectorAll('ul.bibliography-list')].map(list=>[...list.querySelectorAll('li[data-bibliography-id]')].map(item=>({id:item.dataset.bibliographyId,text:item.textContent.trim(),links:[...item.querySelectorAll('a[href]')].map(a=>a.href)}))),text:el.textContent});return {classes:lessons.map(lesson=>{const panel=lesson.querySelector('details.study-bibliography'),questions=[...lesson.querySelectorAll('details.study-question')],complete=lesson.querySelector('[data-complete-class]');return {id:lesson.dataset.studyId,panel:panel&&panelData(panel),placement:!!panel&&!!complete&&questions.at(-1).compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING&&panel.compareDocumentPosition(complete)&Node.DOCUMENT_POSITION_FOLLOWING}}),general:[...document.querySelectorAll('details.study-resource')].filter(el=>!el.closest('article.study-lesson')).map(panelData)}})()`);
  assert.ok(Object.keys(bibliography).length>0);assert.ok(Object.entries(bibliography).every(([id,item])=>id&&item.authors&&item.title&&['book','article','channel','pending'].includes(item.kind)),'Every central catalog item needs stable ID, author, title and recognized kind');
  const panelByClass=Object.fromEntries(renderedBibliography.classes.map(item=>[item.id,item]));
  const generalPanel=renderedBibliography.general.find(panel=>panel.summary?.toLowerCase().includes('bibliograf'));
  assert.ok(generalPanel&&!generalPanel.open,'General bibliography is a closed native disclosure');
  assert.ok(renderedBibliography.classes.every(item=>item.panel&&!item.panel.open&&item.placement),'Each class bibliography is closed and follows its questions before class completion');
  const idsInLists=panel=>panel.lists.flatMap(list=>list.map(item=>item.id));
  for(const [id,expected] of Object.entries(expectedBibliography).filter(([id])=>id!=='general'))assert.deepEqual(idsInLists(panelByClass[id].panel),expected,`Exact references for ${id}`);
  const generalIds=idsInLists(generalPanel);
  assert.deepEqual([...generalIds].sort(),[...expectedBibliography.general].sort(),'General bibliography includes every catalog entry exactly once');
  assert.equal(new Set(generalIds).size,generalIds.length,'General bibliography never duplicates a catalog record');
  const generalGroups=await evaluate(`(()=>{const panel=[...document.querySelectorAll('details.study-resource')].find(p=>p.querySelector('summary')?.textContent.toLowerCase().includes('bibliograf'));return [...panel.querySelectorAll('h3')].map(h=>({heading:h.textContent.trim(),ids:[...h.nextElementSibling.querySelectorAll('li[data-bibliography-id]')].map(li=>li.dataset.bibliographyId)}))})()`);
  assert.deepEqual(generalGroups.map(group=>group.heading),['Libros y comentarios','Artículos y capítulos','Recursos audiovisuales','Fuentes pendientes de identificación']);
  assert.deepEqual(generalGroups.map(group=>group.ids.length),['book','article','channel','pending'].map(kind=>Object.values(bibliography).filter(record=>record.kind===kind).length));
  for(const [index,kind] of ['book','article','channel','pending'].entries()){
    const sorted=Object.entries(bibliography).filter(([,record])=>record.kind===kind).map(([id,record])=>({id,key:record.authors.toLowerCase()+'|'+record.title.toLowerCase()+'|'+id})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(record=>record.id);
    assert.deepEqual(generalGroups[index].ids,sorted,`General ${kind} entries sort by author and title`);
  }
  assert.ok(!generalPanel.text.includes('<ul')&&!generalPanel.text.includes('<li'),'General bibliography renders HTML lists without escaped markup');
  assert.equal(panelByClass['censo-lucas-2'].panel.lists.length,2,'Census further reading is labeled and kept separate');
  assert.equal(panelByClass['video-6'].panel.lists.length,2,'Video 6 support material is kept separate from its used sources');
  assert.deepEqual(panelByClass['video-6'].panel.lists[0].map(item=>item.id),expectedBibliography['video-6'].slice(0,3),'Video 6 lists exactly three used sources');
  assert.deepEqual(panelByClass['video-6'].panel.lists[1].map(item=>item.id),['walton-keener-vida-2016'],'Video 6 support material contains Walton and Keener');
  assert.match(panelByClass['video-6'].panel.text,/Material de apoyo/);
  const closurePanel=panelByClass['lucas-1-6-cierre-practico'].panel;
  assert.deepEqual(closurePanel.lists.map(list=>list.length),[3,2,1],'Closure separates three identified books, two pending sources, and one support work');
  assert.match(closurePanel.text,/Fuentes pendientes de identificación/);
  assert.match(closurePanel.text,/Título de la edición por confirmar visualmente/);
  assert.match(closurePanel.text,/Pendiente identificar el artículo y su enlace exactos/);
  const closureProgress=await evaluate(`(()=>{const lesson=document.querySelector('article[data-study-id="lucas-1-6-cierre-practico"]');return {kind:lesson.dataset.kind,questions:lesson.querySelectorAll('details.study-question').length,checks:lesson.querySelectorAll('input[data-block-complete]').length,bibliographyChecks:lesson.querySelectorAll('details.study-bibliography input').length,completionButtons:lesson.querySelectorAll('[data-complete-class]').length}})()`);
  assert.deepEqual(closureProgress,{kind:'complement',questions:9,checks:9,bibliographyChecks:0,completionButtons:1},'Closure keeps its own progress without adding a numbered course video or bibliography checks');
  const video6FinalPrompts=await evaluate(`(()=>{const lesson=document.querySelector('article[data-study-id="video-6"]');return [...lesson.querySelectorAll('details.study-question')].map(block=>[...block.querySelectorAll('p')].filter(p=>/^(Para profundizar:|Para reflexionar:|Pregunta final:)/.test(p.textContent.trim())).map(p=>({text:p.textContent.trim(),insideList:!!p.closest('li')})))})()`);
  assert.equal(video6FinalPrompts.length,9);
  assert.ok(video6FinalPrompts.every(prompts=>prompts.length===1&&!prompts[0].insideList),'Each Video 6 closing prompt renders as its own paragraph outside the question list');
  const normalizedNotes=Object.fromEntries(['censo-lucas-2','video-1'].map(id=>[id,panelByClass[id].panel.text.normalize('NFD').replace(/[\u0300-\u036f]/g,'')]));
  assert.match(normalizedNotes['censo-lucas-2'],/uso en el video pendiente de verificacion/i);
  assert.match(normalizedNotes['video-1'],/obra concreta utilizada esta pendiente de verificacion/i);
  for(const id of ['video-1','video-2'])assert.equal(idsInLists(panelByClass[id].panel).length,0,`${id} must not claim an unverified bibliography`);
  assert.ok(renderedBibliography.classes.flatMap(item=>item.panel.lists.flat()).every(item=>item.text&&item.links.every(link=>link.startsWith('https://'))),'Rendered citations expose metadata and secure links');

  // Fresh deep link into class 3, then complete a question and the class explicitly.
  const third=initial.lessons.find(l=>l.title?.includes('Lucas 1–2')&&l.kind==='course');assert.ok(third);
  const firstBlock=initial.blocks.find(b=>b.lesson===third.id);assert.ok(firstBlock);
  const legacyHash=content.ids.find(id=>id.includes('video-3')||id.includes('anuncio-y-nacimiento'));
  assert.ok(legacyHash,'Existing video 3 anchor should remain');
  await evaluate(`location.hash=${JSON.stringify(legacyHash)}`);await until(`document.querySelector('#study-class-selector')?.value===${JSON.stringify(third.id)}`);
  const untouched=await evaluate(`(()=>{const l=[...document.querySelectorAll('article.study-lesson')].find(x=>x.dataset.studyId===${JSON.stringify(third.id)});return {visible:!l.hidden,done:l.querySelector('[data-complete-class]').getAttribute('aria-pressed'),checked:[...l.querySelectorAll('input[data-block-complete]:checked')].length}})()`);
  assert.equal(untouched.visible,true);assert.equal(untouched.done,'false');assert.equal(untouched.checked,0,'Opening a deep link does not complete study');
  const selectedSaved=await evaluate(`localStorage.getItem(${JSON.stringify(key)})`);assert.ok(selectedSaved,'Explicit deep-link activity should save selected class');
  const interaction=await evaluate(`(()=>{const l=[...document.querySelectorAll('article.study-lesson')].find(x=>x.dataset.studyId===${JSON.stringify(third.id)}),b=[...l.querySelectorAll('details.study-question')].find(x=>x.dataset.questionId===${JSON.stringify(firstBlock.id)});b.open=true;b.querySelector('input[data-block-complete]').click();l.querySelector('[data-complete-class]').click();return {checked:b.querySelector('input').checked,complete:l.querySelector('[data-complete-class]').getAttribute('aria-pressed'),progress:document.querySelector('#study-overall-text').textContent}})()`);
  assert.equal(interaction.checked,true);assert.equal(interaction.complete,'true');assert.match(interaction.progress,new RegExp(`1 de ${expectedCourseCount} clases publicadas`));assert.match(interaction.progress,/13 videos previstos/);
  const state1=await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);assert.equal(state1.version,1);assert.equal(state1.classes[third.id].blocks[firstBlock.id].value,true);assert.equal(state1.classes[third.id].complete.value,true);assert.ok(state1.classes[third.id].lastPoint?.value);assert.ok(state1.classes[third.id].lastActivity?.value);assert.ok(state1.lastActivity?.value);

  const other=initial.lessons.find(l=>l.kind==='course'&&l.id!==third.id);assert.ok(other);const otherBlock=initial.blocks.find(b=>b.lesson===other.id);assert.ok(otherBlock);
  await evaluate(`(()=>{const s=document.querySelector('#study-class-selector');s.value=${JSON.stringify(other.id)};s.dispatchEvent(new Event('change',{bubbles:true}));const l=[...document.querySelectorAll('article.study-lesson')].find(x=>x.dataset.studyId===${JSON.stringify(other.id)}),b=[...l.querySelectorAll('details.study-question')].find(x=>x.dataset.questionId===${JSON.stringify(otherBlock.id)});b.open=true;return true})()`);await pause(180);
  assert.equal(await evaluate(`document.querySelectorAll('#study-platform article.study-lesson:not([hidden])').length`),1);assert.ok(await evaluate(`!!document.querySelector('#study-platform iframe')`));
  const activityBeforeReload=await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);await evaluate('location.reload()');await until(`document.querySelector('#study-class-selector')?.value===${JSON.stringify(other.id)}`);
  const restored=await evaluate(`(()=>{const a=[...document.querySelectorAll('article.study-lesson')].find(x=>x.dataset.studyId===${JSON.stringify(third.id)}),b=[...document.querySelectorAll('article.study-lesson')].find(x=>x.dataset.studyId===${JSON.stringify(other.id)}),block=[...a.querySelectorAll('details.study-question')].find(x=>x.dataset.questionId===${JSON.stringify(firstBlock.id)});return {selected:document.querySelector('#study-class-selector').value,checked:block.querySelector('input').checked,done:a.querySelector('[data-complete-class]').getAttribute('aria-pressed'),lastOpen:[...b.querySelectorAll('details.study-question[open]')].map(x=>x.dataset.questionId),resumeHidden:document.querySelector('#study-resume').hidden}})()`);
  assert.equal(restored.selected,other.id);assert.equal(restored.checked,true);assert.equal(restored.done,'true');assert.ok(restored.lastOpen.includes(otherBlock.id));assert.equal(restored.resumeHidden,false);
  const activityAfterReload=await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);assert.deepEqual(activityAfterReload.lastActivity,activityBeforeReload.lastActivity,'Passive reload must not advance last activity');assert.deepEqual(activityAfterReload.classes[other.id].lastActivity,activityBeforeReload.classes[other.id].lastActivity);
  await evaluate(`document.querySelector('#study-resume').click()`);await pause(80);assert.equal(await evaluate('document.querySelector("#study-class-selector").value'),other.id);assert.ok(await evaluate(`!!document.querySelector('#study-platform details[data-question-id='+CSS.escape(${JSON.stringify(otherBlock.id)})+'][open]')`));

  // Close Edge entirely and reopen the same browser profile.
  await stop(conn);conn=null;activeBrowser=undefined;activeSocket=undefined;
  conn=await connect(profile);activeBrowser=conn.proc;activeSocket=conn.ws;send=conn.command;
  await send('Page.navigate',{url:origin+route});await until(`!!document.querySelector('main#study-platform')&&document.querySelector('#study-class-selector')?.value===${JSON.stringify(other.id)}`);
  const afterClose=await evaluate(`(()=>{const l=[...document.querySelectorAll('article.study-lesson')].find(x=>x.dataset.studyId===${JSON.stringify(third.id)}),b=[...l.querySelectorAll('details.study-question')].find(x=>x.dataset.questionId===${JSON.stringify(firstBlock.id)});return {selected:document.querySelector('#study-class-selector').value,checked:b.querySelector('input').checked,complete:l.querySelector('[data-complete-class]').getAttribute('aria-pressed'),resumeHidden:document.querySelector('#study-resume').hidden}})()`);
  assert.deepEqual(afterClose,{selected:other.id,checked:true,complete:'true',resumeHidden:false},'Progress must survive full browser close/reopen');

  // Undo class completion without erasing a separately checked question.
  const undo=await evaluate(`(()=>{const l=[...document.querySelectorAll('article.study-lesson')].find(x=>x.dataset.studyId===${JSON.stringify(third.id)}),b=l.querySelector('[data-complete-class]');b.click();return {pressed:b.getAttribute('aria-pressed'),checked:l.querySelector('input[data-block-complete]').checked}})()`);assert.equal(undo.pressed,'false');assert.equal(undo.checked,true);

  // Safe handling for future schema, corrupt data, unrecognized future class IDs, denied/quota storage.
  await evaluate(`localStorage.setItem(${JSON.stringify(key)},JSON.stringify({version:2,sentinel:'keep'}));location.reload()`);await pause(300);assert.ok(await evaluate(`document.querySelector('#study-storage-message').textContent.includes('versión más nueva')`));const newer=await evaluate(`localStorage.getItem(${JSON.stringify(key)})`);await evaluate(`document.querySelector('#study-class-selector').dispatchEvent(new Event('change',{bubbles:true}))`);assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(key)})`),newer,'Do not overwrite a future schema');
  const corrupt='{invalid';await evaluate(`localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(corrupt)});location.reload()`);await pause(300);assert.ok(await evaluate(`document.querySelector('#study-storage-message').textContent.includes('No pudimos leer')`));assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(key)})`),corrupt);
  const futureFixture={version:1,selected:{value:third.id,updatedAt:100},lastActivity:{value:100,updatedAt:100},classes:{'future-class-id':{blocks:{'future-question-id':{value:true,updatedAt:100}}}}};await evaluate(`localStorage.setItem(${JSON.stringify(key)},JSON.stringify(${JSON.stringify(futureFixture)}));location.reload()`);await pause(300);await evaluate(`document.querySelector('#study-class-selector').dispatchEvent(new Event('change',{bubbles:true}))`);const merged=await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);assert.equal(merged.classes['future-class-id'].blocks['future-question-id'].value,true,'Future class/question progress must survive catalog changes');
  const diskFixture={version:1,classes:{'disk-only-class':{blocks:{'disk-only-question':{value:true,updatedAt:200}}}}},tabFixture={version:1,classes:{'tab-only-class':{blocks:{'tab-only-question':{value:true,updatedAt:300}}}}};await evaluate(`localStorage.setItem(${JSON.stringify(key)},JSON.stringify(${JSON.stringify(diskFixture)}));location.reload()`);await until(`!!document.querySelector('#study-class-selector')?.value`);await evaluate(`window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(key)},newValue:${JSON.stringify(JSON.stringify(tabFixture))}}))`);await until(`(()=>{const s=JSON.parse(localStorage.getItem(${JSON.stringify(key)}));return !!s.classes['disk-only-class']&&!!s.classes['tab-only-class']})()`);await evaluate(`localStorage.removeItem(${JSON.stringify(key)});window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(key)},newValue:null}))`);await pause(80);assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(key)})`),null,'Explicit remove must reset without resurrecting merged progress');assert.match(await evaluate(`document.querySelector('#study-overall-text').textContent`),new RegExp(`0 de ${expectedCourseCount} clases publicadas`));
  await evaluate('localStorage.clear()');const deniedScript=await send('Page.addScriptToEvaluateOnNewDocument',{source:`const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(k){if(k==='${key}')throw new DOMException('denied','SecurityError');return get.call(this,k)};Storage.prototype.setItem=function(k,v){if(k==='${key}')throw new DOMException('denied','SecurityError');return set.call(this,k,v)};`});await send('Page.navigate',{url:origin+route});await pause(300);assert.ok(await evaluate(`document.querySelector('#study-storage-message').textContent.includes('no permite guardar')`));await evaluate(`document.querySelector('#study-class-selector').dispatchEvent(new Event('change',{bubbles:true}))`);assert.equal(await evaluate(`document.querySelectorAll('#study-platform article.study-lesson').length`),expectedLessons.length);await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:deniedScript.identifier});
  const quotaScript=await send('Page.addScriptToEvaluateOnNewDocument',{source:`const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='${key}')throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v)};`});await send('Page.navigate',{url:origin+route});await pause(250);await evaluate(`document.querySelector('#study-class-selector').dispatchEvent(new Event('change',{bubbles:true}))`);await evaluate(`document.querySelector('#study-platform input[data-block-complete]').click()`);assert.ok(await evaluate(`document.querySelector('#study-storage-message').textContent.includes('no permite guardar')`));assert.ok(await evaluate(`document.querySelector('#study-platform input[data-block-complete]').checked`));await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:quotaScript.identifier});await evaluate('localStorage.clear();location.reload()');await until(`!!document.querySelector('main#study-platform')&&document.querySelector('#study-class-selector')?.value`);

  // Responsive views and review screenshots. Full-page question captures include the progress panel.
  const responsive=[];
  for(const width of [360,768,1280]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1200,deviceScaleFactor:1,mobile:width<500});
    const m=await evaluate(`(()=>{const app=document.querySelector('#study-platform'),progress=document.querySelector('#study-overall-progress')?.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,iframes:[...app.querySelectorAll('iframe')].map(f=>{const r=f.getBoundingClientRect();return {width:r.width,height:r.height,ratio:r.width/r.height}}),progress:progress?.toJSON()}})()`);
    assert.ok(m.scrollWidth<=m.width&&m.bodyWidth<=m.width,`No horizontal overflow at ${width}px`);assert.ok(m.iframes.length<=1);assert.ok(m.iframes.every(f=>Math.abs(f.ratio-16/9)<0.03));responsive.push(m);
    await evaluate('window.scrollTo(0,0)');await writeFile(resolve(out,`platform${width}-overview.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
    await evaluate(`(()=>{const d=document.querySelector('#study-platform article.study-lesson:not([hidden]) details.study-question');if(!d.open)d.querySelector('summary').click()})()`);await pause(80);
    const layout=await send('Page.getLayoutMetrics'),height=Math.min(layout.cssContentSize.height,6000);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}});await writeFile(resolve(out,`platform${width}-question-open-full.png`),Buffer.from(shot.data,'base64'));
  }
  await send('Emulation.clearDeviceMetricsOverride');

  // Capture the newly centralized class bibliographies in an ordinary healthy state.
  const bibliographyViews=[];
  const captureBibliography=async(classId,width,name)=>{
    await send('Emulation.setDeviceMetricsOverride',{width,height:1200,deviceScaleFactor:1,mobile:width<500});
    await evaluate(`(()=>{const s=document.querySelector('#study-class-selector');s.value=${JSON.stringify(classId)};s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await until(`document.querySelector('#study-class-selector')?.value===${JSON.stringify(classId)}`);
    await evaluate(`(()=>{const l=[...document.querySelectorAll('article.study-lesson')].find(x=>x.dataset.studyId===${JSON.stringify(classId)}),d=l.querySelector('details.study-bibliography');if(d.open)d.querySelector('summary').click();d.scrollIntoView({block:'start'});return true})()`);await pause(100);
    await evaluate(`(()=>{const l=[...document.querySelectorAll('article.study-lesson')].find(x=>x.dataset.studyId===${JSON.stringify(classId)}),d=l.querySelector('details.study-bibliography');d.querySelector('summary').click();return d.open})()`);
    const state=await evaluate(`(()=>{const l=[...document.querySelectorAll('article.study-lesson')].find(x=>x.dataset.studyId===${JSON.stringify(classId)}),d=l.querySelector('details.study-bibliography');return {open:d.open,ids:[...d.querySelectorAll('li[data-bibliography-id]')].map(x=>x.dataset.bibliographyId),iframes:document.querySelectorAll('#study-platform iframe').length,scrollWidth:document.documentElement.scrollWidth,width:innerWidth}})()`);
    assert.ok(state.open);assert.ok(state.iframes<=1);assert.ok(state.scrollWidth<=state.width,`No horizontal overflow with ${classId} bibliography open at ${width}px`);
    const layout=await send('Page.getLayoutMetrics'),height=Math.min(layout.cssContentSize.height,8000);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}});await writeFile(resolve(out,name),Buffer.from(shot.data,'base64'));
    bibliographyViews.push({classId,width,ids:state.ids,open:state.open,screenshot:name});
  };
  await captureBibliography('video-3',360,'video3-bibliography360.png');
  await captureBibliography('video-3',1280,'video3-bibliography1280.png');
  await captureBibliography('censo-lucas-2',360,'censo-bibliography360.png');
  await send('Emulation.clearDeviceMetricsOverride');

  // Accessibility tree check after opening a native question disclosure.
  await evaluate(`document.querySelector('#study-platform article.study-lesson:not([hidden]) details.study-question').open=true`);await pause(80);
  const ax=await send('Accessibility.getFullAXTree'),nodes=ax.nodes.map(n=>({role:n.role?.value,name:n.name?.value,expanded:n.properties?.find(p=>p.name==='expanded')?.value?.value,checked:n.properties?.find(p=>p.name==='checked')?.value?.value}));
  assert.ok(nodes.some(n=>n.role==='progressbar'&&n.name));assert.ok(nodes.some(n=>n.role==='checkbox'&&n.name));assert.ok(nodes.some(n=>n.role==='DisclosureTriangle'&&n.name));
  const oldHashes=baselineHtml?await evaluate(`(()=>{const d=new DOMParser().parseFromString(${JSON.stringify(baselineHtml)},'text/html');return [...d.querySelectorAll('#content.article-content [id]')].map(x=>x.id).filter(id=>id.startsWith('-video')||/^1-/.test(id))})()`):content.ids.filter(id=>id.startsWith('-video')||/^1-/.test(id)),hashes=[];
  for(const id of [...new Set(oldHashes)].slice(0,10)){await evaluate(`location.hash=${JSON.stringify(id)}`);await until(`!!document.getElementById(${JSON.stringify(id)})?.closest('article.study-lesson')&&!document.getElementById(${JSON.stringify(id)}).closest('article.study-lesson').hidden`);hashes.push(id);}
  const nested=initial.blocks[0];await evaluate(`location.hash=${JSON.stringify(nested.anchor)}`);await until(`!!document.getElementById(${JSON.stringify(nested.anchor)})?.closest('details.study-question')?.open`);
  await evaluate(`document.querySelector('#study-next').click()`);await pause(80);assert.equal(await evaluate(`document.querySelectorAll('#study-platform article.study-lesson:not([hidden])').length`),1);await evaluate(`document.querySelector('#study-prev').click()`);await pause(80);
  await evaluate(`document.querySelector('#study-integration').click()`);assert.ok(await evaluate(`location.hash.includes('integration')||location.hash.includes('integracion')`));

  // With JS disabled, all server-rendered lessons and questions remain readable.
  await send('Emulation.setScriptExecutionDisabled',{value:true});await send('Page.navigate',{url:origin+route});await pause(250);
  const noScript=await evaluate(`(()=>{const a=document.querySelector('#study-platform');return {lessons:a.querySelectorAll('article.study-lesson').length,questions:[...a.querySelectorAll('details.study-question')].map(block=>block.dataset.questionId),text:a.textContent}})()`);
  assert.equal(noScript.lessons,expectedLessons.length);assert.equal(noScript.questions.length,expectedQuestionIds.length);assert.deepEqual([...noScript.questions].sort(),[...expectedQuestionIds].sort(),'All question blocks and stable IDs stay in server HTML without JS');await send('Emulation.setScriptExecutionDisabled',{value:false});

  // Other published output should stay unchanged except homepage title text for this page.
  if(otherBefore)for(const path of ['contacto/index.html','estudios/efesios-1-1-en-efeso/index.html']){const bytes=await readFile(resolve(root,path));assert.equal(createHash('sha256').update(bytes).digest('hex'),otherBefore[path],`Unrelated page output changed: ${path}`);}
  assert.ok(!requests.some(r=>r.method!=='GET'));assert.ok(!requests.some(r=>/supabase|auth0|firebase|mailgun|sendgrid/i.test(r.url)));assert.ok(!misses.includes('/styles/study-guide.css')&&!misses.includes('/js/study-guide.js')&&!misses.includes('/js/study-progress.js'),`Missing platform asset ${misses.join(', ')}`);
  const report={route,canonical:initial.canonical,planned:initial.planned,lessons:initial.lessons,questionBlockCount:initial.blocks.length,originalQuestionIdsCompared:originalQuestionIds.length,originalHrefCount:new Set(originalLinks).size,baselineComparison:'older full-page archive skipped because it predates the latest Video 3 source update',bibliographyChecks:{catalogRecords:Object.keys(bibliography).length,classes:Object.fromEntries(renderedBibliography.classes.map(item=>[item.id,idsInLists(item.panel)])),general:idsInLists(generalPanel)},bibliographyViews,otherPageSnapshot:otherBefore?'unchanged':'not available in this checkout',actions:{selected:third.id,checked:firstBlock.id,explicitCompletion:true,reload:true,fullBrowserRestart:true,resume:true,undo:true,futureVersionProtected:true,corruptProtected:true,storageDenied:true,quota:true,futureIdsPreserved:true,concurrentStorageMerge:true,explicitRemovalNoResurrection:true},responsive,hashes,accessibility:nodes.filter(n=>['progressbar','checkbox','DisclosureTriangle'].includes(n.role)),noScript:{lessons:noScript.lessons,questions:noScript.questions},blockedExternal:[...new Set(external)],missingAssets:misses,screenshots:[360,768,1280].flatMap(w=>[`platform${w}-overview.png`,`platform${w}-question-open-full.png`]).concat(bibliographyViews.map(view=>view.screenshot))};
  await writeFile(resolve(out,'browser-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{activeSocket?.close();if(activeBrowser?.exitCode===null){activeBrowser.kill();await once(activeBrowser,'exit').catch(()=>{});}}
