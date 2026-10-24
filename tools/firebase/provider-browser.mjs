import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../node_modules/esbuild/lib/main.js';

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, '../..');
const output = resolve(root, '.contact-test-output');
if (process.env.GCLOUD_PROJECT !== 'demo-lasnotasdevero' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw Error('Provider tests require only the loopback demo-lasnotasdevero emulators');
const emulatorDocuments = 'projects/demo-lasnotasdevero/databases/(default)/documents';
const classPath = (uid, id) => `${emulatorDocuments}/students/${encodeURIComponent(uid)}/guides/lucas/classes/${encodeURIComponent(id)}`;
async function adminCommit(writes) {
  const response = await fetch(`http://127.0.0.1:8085/v1/${emulatorDocuments}:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ writes }) });
  if (!response.ok) throw Error(`Synthetic emulator seed failed: ${response.status} ${await response.text()}`);
}
async function seedRetired(uid, generation, count = 2) {
  await adminCommit(Array.from({ length: count }, (_, index) => ({ update: { name: classPath(uid, `retired-${index}`), fields: { schema: { integerValue: '1' }, generation: { stringValue: generation }, blocks: { mapValue: { fields: {} } } } } })));
}
async function adminRead(path) {
  const response = await fetch(`http://127.0.0.1:8085/v1/${path}`, { headers: { Authorization: 'Bearer owner' } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw Error(`Synthetic emulator read failed: ${response.status}`);
  return response.json();
}
async function storedClasses(uid) {
  const documents = [], seen = new Set();
  let token;
  for (let page = 0; page < 4; page++) {
    const result = await adminRead(`${emulatorDocuments}/students/${encodeURIComponent(uid)}/guides/lucas/classes?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    documents.push(...(result?.documents || []));
    if (!result?.nextPageToken) return documents;
    token = result.nextPageToken;
    assert.ok(!seen.has(token), 'synthetic pagination must advance'); seen.add(token);
  }
  throw Error('Synthetic inspection exceeds its bounded pagination limit');
}
const candidates = [process.env.BROWSER, process.env.LUCAS_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let browserPath;
for (const candidate of candidates) { try { await access(candidate); browserPath = candidate; break; } catch {} }
if (!browserPath) throw Error('Chromium browser missing: set BROWSER or LUCAS_BROWSER to its executable path');
await mkdir(output, { recursive: true });
const work = await mkdtemp(resolve(output, 'firebase-provider-'));
const catalog = JSON.parse(await readFile(resolve(root, 'firebase/generated/catalog.json'), 'utf8'));
const bundle = resolve(work, 'provider-test.bundle.js');
await build({ entryPoints: [resolve(source, 'provider-fixture.mjs')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: bundle, alias: { firebase: resolve(root,'node_modules/firebase') }, define: { __STUDY_CATALOG__: JSON.stringify(catalog) }, plugins: [{
  name: 'synthetic-provider-transaction-counts',
  setup(plugin) {
    plugin.onLoad({ filter: /study-firebase-provider\.js$/ }, async ({ path }) => {
      const original = await readFile(path, 'utf8');
      // Instrument only this ignored test bundle. No counters or student data
      // collection are included in the site's production JavaScript.
      const counters = `const __testReads=(tx,ref)=>{(globalThis.__providerMetrics??={reads:[],writes:[]}).reads.push(ref.path);return tx.get(ref)};const __testWrites=(tx,method,ref,...args)=>{(globalThis.__providerMetrics??={reads:[],writes:[]}).writes.push({method,path:ref.path});return tx[method](ref,...args)};`;
      const erasureCounters = `const __testDiscover=async(q)=>{const result=await getDocsFromServer(q);const metrics=globalThis.__providerMetrics??={reads:[],writes:[]};(metrics.queries??=[]).push(result.size);return result};const __testDeleteUser=async(u)=>{const metrics=globalThis.__providerMetrics??={reads:[],writes:[]};metrics.authDeletes=(metrics.authDeletes??0)+1;return deleteUser(u)};`;
      return { loader: 'js', contents: counters + erasureCounters + original.replaceAll('tx.get(', '__testReads(tx,').replaceAll('tx.set(', "__testWrites(tx,'set',").replaceAll('tx.delete(', "__testWrites(tx,'delete',").replaceAll('getDocsFromServer(', '__testDiscover(').replace('await reauthenticateWithPopup(u, google());', 'await globalThis.__providerTestReauthenticate(u);').replace('await deleteUser(u);', 'await __testDeleteUser(u);'), resolveDir: dirname(path) };
    });
  }
}] });

const html = `<!doctype html><meta charset="utf-8"><script type="module">
import { startFixture } from '/provider-test.bundle.js';
window.fixtureReady = true;
window.startFixture = startFixture;
</script>`;
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); }
  else if (pathname === '/provider-test.bundle.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(await readFile(bundle)); }
  else { response.writeHead(404); response.end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const serverOrigin = `http://127.0.0.1:${server.address().port}`;

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const launched = new Set();
async function launch(label) {
  const profile = resolve(work, `device-${label}`);
  const profileRelative = relative(work,profile);
  if (!profileRelative || profileRelative.startsWith('..') || isAbsolute(profileRelative)) throw Error('Unsafe temporary browser profile path');
  await mkdir(profile, { recursive: true });
  const child = spawn(browserPath, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const browser = { process: child, profile };
  launched.add(browser);
  let launchError;
  child.on('error', error => { launchError = error; });
  let port;
  for (let i = 0; i < 120; i++) {
    try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)[0]; break; } catch {}
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw Error(`Browser ${label} exited with ${child.exitCode}`);
    await delay(100);
  }
  assert.ok(port, `Browser ${label} DevTools starts`);
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((result) => result.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  browser.socket = socket;
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Fetch.requestPaused') {
      const url = new URL(message.params.request.url);
      const allowed = ['about:','data:','blob:'].includes(url.protocol) || url.protocol === 'http:' && url.hostname === '127.0.0.1' && [String(server.address().port),'8085','9099'].includes(url.port);
      browser.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? {requestId:message.params.requestId} : {requestId:message.params.requestId,errorReason:'BlockedByClient'}).catch(() => {});
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const handlers = pending.get(message.id); pending.delete(message.id); clearTimeout(handlers.timer);
    message.error ? handlers.reject(Error(message.error.message)) : handlers.resolve(message.result);
  };
  socket.onclose = () => { for (const handlers of pending.values()) { clearTimeout(handlers.timer); handlers.reject(Error('Browser closed')); } pending.clear(); };
  const send = (method, params = {}) => new Promise((resolveCommand, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(Error(`Browser command timeout: ${method}`)); },15000); pending.set(id, { resolve: resolveCommand, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  browser.send = send;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await send('Page.navigate', { url: serverOrigin + '/' });
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  browser.evaluate = evaluate;
  for (let i = 0; i < 100; i++) { if (await evaluate('!!window.fixtureReady').catch(() => false)) return browser; await delay(100); }
  throw Error(`Fixture page not ready for ${label}`);
}
async function shutdown(browser) {
  if (!browser) return;
  try { if (browser.send) await browser.send('Browser.close'); } catch {}
  browser.socket?.close();
  if (browser.process.exitCode === null) await Promise.race([once(browser.process, 'exit'), delay(3000)]);
  if (browser.process.exitCode === null && browser.process.pid) { browser.process.kill(); await Promise.race([once(browser.process, 'exit').catch(() => {}),delay(3000)]); }
}

let a, b;
const classCount = Object.keys(catalog.lucas).length;
try {
  a = await launch('a');
  const resultA = await a.evaluate(`(async()=>{window.a=await startFixture('student-emulator-a');const startup=a.metrics();a.resetMetrics();const s=await a.current();const warmGet=a.metrics();a.resetMetrics();await a.seedAllClasses();const firstSave=a.metrics();const first=await a.current();const before=await a.classes();a.resetMetrics();await a.markQuestion(0,1,true,Date.now()+20);const singleSave=a.metrics();const second=await a.current();const after=await a.classes();return {uid:a.subject,startup,warmGet,firstSave,singleSave,initial:s.revision,firstRevision:first.revision,secondRevision:second.revision,classes:Object.keys(second.progress.classes),before:before.map(x=>({id:x.id,version:x.version})),after:after.map(x=>({id:x.id,version:x.version})),storedClassCount:after.length}})()`);
  assert.equal(resultA.initial, 0); assert.equal(resultA.firstRevision, 1); assert.equal(resultA.secondRevision, 2); assert.equal(resultA.classes.length, classCount); assert.equal(resultA.storedClassCount, classCount); assert.ok(resultA.before.every((item) => Array.isArray(item.version) && item.version.length === 2));
  assert.equal(resultA.startup.reads.length, classCount + 2, 'cold read loads marker, header and every physical class');
  assert.equal(resultA.warmGet.reads.length, 2, 'unchanged remote header reuses confirmed classes');
  assert.equal(resultA.firstSave.reads.length, 2, 'initial save reuses its confirmed empty baseline');
  assert.equal(resultA.singleSave.reads.length, 2, 'one changed class reads only marker and header');
  assert.equal(resultA.singleSave.writes.length, 2, 'one changed class writes its document and header only');
  const firstClassId = catalog.lucas[Object.keys(catalog.lucas)[0]] && Object.keys(catalog.lucas)[0];
  const beforeVersions = Object.fromEntries(resultA.before.map((item) => [item.id, item.version]));
  const afterVersions = Object.fromEntries(resultA.after.map((item) => [item.id, item.version]));
  assert.notDeepEqual(afterVersions[firstClassId], beforeVersions[firstClassId], 'changed class document receives a new Firestore version');
  for (const id of Object.keys(beforeVersions).filter((item) => item !== firstClassId)) assert.deepEqual(afterVersions[id], beforeVersions[id], `unchanged class ${id} is not rewritten`);
  const cacheSafety = await a.evaluate(`(async()=>{
    const copy=await a.current(),first=a.catalog[0].id,question=a.catalog[0].questions[0];
    copy.progress.classes[first].blocks[question].value=false;
    a.resetMetrics();const remote=await a.current(),immutable=a.metrics();
    const partial=structuredClone(remote.progress);delete partial.classes[a.catalog[1].id];
    let missing;try{await a.request('progress','PUT',{generation:remote.generation,revision:remote.revision,progress:partial},a.subject);missing='allowed'}catch(error){missing=error.status}
    const after=await a.current();
    return{copyDidNotMutateCache:after.progress.classes[first].blocks[question].value===true,missing,revision:after.revision,classes:Object.keys(after.progress.classes).length,immutableReads:immutable.reads.length};
  })()`);
  assert.equal(cacheSafety.copyDidNotMutateCache, true, 'returned progress cannot mutate the provider baseline');
  assert.equal(cacheSafety.immutableReads, 2); assert.equal(cacheSafety.missing, 400, 'warm cache still forbids omitting a physical class');
  assert.equal(cacheSafety.revision, 2); assert.equal(cacheSafety.classes, classCount);

  await a.send('Page.reload');
  await delay(500);
  for (let i = 0; i < 100; i++) { if (await a.evaluate('!!window.fixtureReady').catch(() => false)) break; await delay(100); }
  const reload = await a.evaluate(`(async()=>{window.a=await startFixture('student-emulator-a',false);return {uid:a.subject,startup:a.metrics(),read:await a.current()}})()`);
  assert.equal(reload.uid, resultA.uid, 'browser session persists through page reload');
  assert.equal(Object.keys(reload.read.progress.classes).length, classCount, 'reload restores all class records');
  assert.equal(reload.startup.reads.length, classCount + 2, 'a new browser lifecycle never reuses a persisted baseline');

  b = await launch('b');
  const resultB = await b.evaluate(`(async()=>{window.b=await startFixture('student-emulator-b');const empty=await b.current();let forged;try{await b.request('progress','GET',undefined,${JSON.stringify(resultA.uid)});forged='allowed'}catch(e){forged=e.status}let direct;try{await b.directRead(${JSON.stringify(resultA.uid)});direct='allowed'}catch(e){direct=e.code}return {uid:b.subject,empty,forged,direct}})()`);
  assert.notEqual(resultB.uid, resultA.uid); assert.equal(resultB.empty.revision, 0); assert.equal(resultB.empty.progress, null); assert.equal(resultB.forged, 403); assert.equal(resultB.direct, 'permission-denied');

  const sameAccount = await b.evaluate(`(async()=>{await b.sync.logout();window.b=await startFixture('student-emulator-a');const startup=b.metrics();const state=await b.current();return {uid:b.subject,startup,classes:Object.keys(state.progress.classes),revision:state.revision}})()`);
  assert.equal(sameAccount.uid, resultA.uid); assert.equal(sameAccount.classes.length, classCount, 'a second device signed into the same account reads its shared progress');
  assert.equal(sameAccount.startup.reads.length, classCount + 2, 'switching owners starts with a cold verified baseline');
  await Promise.all([
    a.evaluate(`a.markQuestion(0,2,true,Date.now()+30)`),
    b.evaluate(`b.markQuestion(0,3,true,Date.now()+31)`),
  ]);
  await Promise.all([a.evaluate('a.sync.flush()'), b.evaluate('b.sync.flush()')]);
  const merged = await a.evaluate(`(async()=>{const result=await a.current();const first=a.catalog[0].id;return {revision:result.revision,blocks:result.progress.classes[first].blocks,classes:Object.keys(result.progress.classes)}})()`);
  const firstQuestions = catalog.lucas[Object.keys(catalog.lucas)[0]].questions;
  assert.equal(merged.blocks[firstQuestions[0]].value, true); assert.equal(merged.blocks[firstQuestions[1]].value, true); assert.equal(merged.blocks[firstQuestions[2]].value, true); assert.equal(merged.blocks[firstQuestions[3]].value, true); assert.equal(merged.classes.length, classCount); assert.equal(merged.revision, 4, 'stale concurrent edit conflicted and retried after merging');
  await b.evaluate(`(async()=>{await b.sync.connect(false);await b.markQuestion(1,0,false,Date.now()+100)})()`);
  const changedHeader = await a.evaluate(`(async()=>{a.resetMetrics();const remote=await a.current();window.staleEnvelope=structuredClone(remote);return{revision:remote.revision,reads:a.metrics().reads.length}})()`);
  assert.equal(changedHeader.revision, 5); assert.equal(changedHeader.reads, classCount + 2, 'another device revision invalidates the complete class baseline');
  await b.evaluate(`b.markQuestion(1,1,true,Date.now()+101)`);
  const staleCAS = await a.evaluate(`(async()=>{a.resetMetrics();try{await a.request('progress','PUT',{revision:staleEnvelope.revision,generation:staleEnvelope.generation,progress:staleEnvelope.progress},a.subject);return{allowed:true}}catch(error){return{status:error.status,reads:a.metrics().reads.length,revision:error.data.revision,classes:Object.keys(error.data.progress.classes).length}}})()`);
  assert.equal(staleCAS.status, 409); assert.equal(staleCAS.reads, classCount + 2); assert.equal(staleCAS.revision, 6); assert.equal(staleCAS.classes, classCount);
  const deletion = await a.evaluate(`(async()=>{const remote=await a.current();a.resetMetrics();const result=await a.request('progress','DELETE',{revision:remote.revision,generation:remote.generation},a.subject);const metrics=a.metrics();return{deleted:result.deleted,metrics,remaining:(await a.classes()).length}})()`);
  assert.equal(deletion.deleted, true); assert.equal(deletion.metrics.reads.length, classCount + 2); assert.equal(deletion.remaining, 0);
  const staleReset = await b.evaluate(`(async()=>{const local=b.sync.connected;const before=await b.current();b.resetMetrics();try{await b.request('progress','PUT',{revision:6,generation:${JSON.stringify(reload.read.generation)},progress:${JSON.stringify(reload.read.progress)}},b.subject);return{allowed:true}}catch(error){return{status:error.status,reads:b.metrics().reads.length,deleted:before.deleted}}})()`);
  assert.equal(staleReset.status, 410); assert.equal(staleReset.reads, classCount + 2); assert.equal(staleReset.deleted, true);
  const callerIsolation = await b.evaluate(`(async()=>{
    window.c=await startFixture('student-emulator-c');await c.seedAllClasses();const remote=await c.current();
    const first=c.catalog[0].id,question=c.catalog[0].questions[0],body={revision:remote.revision,generation:remote.generation,progress:structuredClone(remote.progress)};
    c.resetMetrics();const saving=c.request('progress','PUT',body,c.subject);
    body.progress.classes[first].blocks[question].value=false;body.progress.private='caller-only';body.revision=999;
    const result=await saving,saveReads=c.metrics().reads.length;
    result.progress.classes[first].blocks[question].value=false;result.progress.private='result-only';
    const actual=await c.current();return{revision:actual.revision,value:actual.progress.classes[first].blocks[question].value,extra:actual.progress.private??null,saveReads};
  })()`);
  assert.deepEqual(callerIsolation, { revision: 2, value: true, extra: null, saveReads: 2 }, 'neither mutable input nor returned PUT data can alter the confirmed baseline');
  const patchTime = Date.now() + 1000;
  await a.evaluate(`(async()=>{window.patchDevice=await startFixture('student-patch');await patchDevice.seedAllClasses();window.patchBase=await patchDevice.current()})()`);
  await b.evaluate(`(async()=>{window.patchDevice=await startFixture('student-patch');window.patchBase=await patchDevice.current()})()`);
  const patchFirst = await a.evaluate(`(async()=>{patchDevice.resetMetrics();const result=await patchDevice.patchQuestion(patchBase,0,1,true,${patchTime + 100});return{revision:result.revision,metrics:patchDevice.metrics()}})()`);
  assert.equal(patchFirst.revision, 2); assert.equal(patchFirst.metrics.reads.length, 2); assert.equal(patchFirst.metrics.writes.length, 2);
  const patchStale = await b.evaluate(`(async()=>{patchDevice.resetMetrics();const result=await patchDevice.patchQuestion(patchBase,0,2,true,${patchTime + 200});const first=patchDevice.catalog[0];return{revision:result.revision,classes:Object.keys(result.progress.classes).length,one:result.progress.classes[first.id].blocks[first.questions[1]].value,two:result.progress.classes[first.id].blocks[first.questions[2]].value,metrics:patchDevice.metrics()}})()`);
  assert.equal(patchStale.revision, 3); assert.equal(patchStale.classes, classCount); assert.equal(patchStale.one, true); assert.equal(patchStale.two, true);
  assert.equal(patchStale.metrics.reads.length, classCount + 2, 'stale same-generation PATCH merges in its single transaction');
  assert.equal(patchStale.metrics.writes.length, 2);
  const patchFalse = await a.evaluate(`(async()=>{const base=await patchDevice.current();const result=await patchDevice.patchQuestion(base,0,0,false,${patchTime + 400});return{revision:result.revision,value:result.progress.classes[patchDevice.catalog[0].id].blocks[patchDevice.catalog[0].questions[0]].value}})()`);
  assert.deepEqual(patchFalse, { revision: 4, value: false }, 'a newer explicit uncheck is preserved');
  const patchObsolete = await b.evaluate(`(async()=>{patchDevice.resetMetrics();const result=await patchDevice.patchQuestion(patchBase,0,0,true,${patchTime + 300});return{revision:result.revision,value:result.progress.classes[patchDevice.catalog[0].id].blocks[patchDevice.catalog[0].questions[0]].value,metrics:patchDevice.metrics()}})()`);
  assert.equal(patchObsolete.revision, 4); assert.equal(patchObsolete.value, false); assert.equal(patchObsolete.metrics.writes.length, 0, 'an obsolete delta is a read-only acknowledgment');
  const patchNoop = await b.evaluate(`(async()=>{patchDevice.resetMetrics();const result=await patchDevice.request('progress','PATCH',{generation:patchBase.generation,revision:patchBase.revision,progress:{version:1,classes:{[patchDevice.catalog[1].id]:{blocks:{}}}}},patchDevice.subject);return{revision:result.revision,metrics:patchDevice.metrics(),classes:Object.keys(result.progress.classes).length}})()`);
  assert.equal(patchNoop.revision, 4); assert.equal(patchNoop.metrics.reads.length, 2); assert.equal(patchNoop.metrics.writes.length, 0); assert.equal(patchNoop.classes, classCount);
  const patchTies = await a.evaluate(`(async()=>{let base=await patchDevice.current();const first=patchDevice.catalog[0],question=first.questions[3];let result=await patchDevice.patchQuestion(base,0,3,false,${patchTime + 500});const low=result.progress.classes[first.id].blocks[question].value;result=await patchDevice.patchQuestion(base,0,3,true,${patchTime + 500});const high=result.progress.classes[first.id].blocks[question].value;patchDevice.resetMetrics();result=await patchDevice.patchQuestion(base,0,3,false,${patchTime + 500});return{low,high,final:result.progress.classes[first.id].blocks[question].value,revision:result.revision,metrics:patchDevice.metrics()}})()`);
  assert.equal(patchTies.low, false); assert.equal(patchTies.high, true); assert.equal(patchTies.final, true); assert.equal(patchTies.revision, 6); assert.equal(patchTies.metrics.writes.length, 0, 'equal-clock resolution is deterministic regardless of incoming direction');
  const patchGuards = await b.evaluate(`(async()=>{const statuses={};const payload={generation:patchBase.generation,revision:patchBase.revision,progress:{version:1,classes:{}}};for(const [name,method,body,uid]of[['foreign','PATCH',payload,${JSON.stringify(resultB.uid)}],['initial-null','PATCH',{...payload,generation:null},patchDevice.subject],['wrong-generation','PATCH',{...payload,generation:crypto.randomUUID()},patchDevice.subject],['stale-delete','DELETE',{generation:patchBase.generation,revision:patchBase.revision},patchDevice.subject],['future-clock','PATCH',{...payload,progress:{version:1,classes:{},lastActivity:{value:Date.now()+600000,updatedAt:Date.now()+600000}}},patchDevice.subject]]){try{await patchDevice.request('progress',method,body,uid);statuses[name]='allowed'}catch(error){statuses[name]=error.status}}return statuses})()`);
  assert.deepEqual(patchGuards, { foreign: 403, 'initial-null': 409, 'wrong-generation': 410, 'stale-delete': 409, 'future-clock': 400 });
  const patchReset = await a.evaluate(`(async()=>{const base=await patchDevice.current();await patchDevice.request('progress','DELETE',{generation:base.generation,revision:base.revision},patchDevice.subject);try{await patchDevice.patchQuestion(base,0,0,true,${patchTime + 600});return'allowed'}catch(error){return error.status}})()`);
  assert.equal(patchReset, 410, 'an old PATCH cannot restore a deleted generation');
  const retiredProgress = await a.evaluate(`(async()=>{window.erasing=await startFixture('student-retired-progress');await erasing.seedAllClasses();const state=await erasing.current();return{uid:erasing.subject,generation:state.generation}})()`);
  await seedRetired(retiredProgress.uid, retiredProgress.generation);
  await seedRetired(resultB.uid, retiredProgress.generation, 1);
  assert.equal((await storedClasses(retiredProgress.uid)).length, classCount + 2);
  const retiredProgressDelete = await a.evaluate(`(async()=>{const state=await erasing.current();erasing.resetMetrics();const result=await erasing.request('progress','DELETE',{generation:state.generation,revision:state.revision},erasing.subject);return{deleted:result.deleted,authenticated:(await erasing.request('session')).authenticated,metrics:erasing.metrics()}})()`);
  assert.equal(retiredProgressDelete.deleted, true); assert.equal(retiredProgressDelete.authenticated, true);
  assert.deepEqual(retiredProgressDelete.metrics.queries, [classCount + 2]);
  assert.equal((await storedClasses(retiredProgress.uid)).length, 0, 'guide deletion removes current and retired classes atomically');
  assert.equal((await storedClasses(resultB.uid)).length, 1, 'guide deletion leaves a neighboring UID untouched');

  const retiredAccount = await a.evaluate(`(async()=>{window.erasing=await startFixture('student-retired-account');await erasing.seedAllClasses();const state=await erasing.current();return{uid:erasing.subject,generation:state.generation}})()`);
  await seedRetired(retiredAccount.uid, retiredAccount.generation);
  const retiredAccountDelete = await a.evaluate(`(async()=>{erasing.resetMetrics();const result=await erasing.request('account/delete','DELETE',{},erasing.subject);return{deleted:result.deleted,authenticated:(await erasing.request('session')).authenticated,metrics:erasing.metrics()}})()`);
  assert.equal(retiredAccountDelete.deleted, true); assert.equal(retiredAccountDelete.authenticated, false); assert.equal(retiredAccountDelete.metrics.authDeletes, 1);
  assert.equal((await storedClasses(retiredAccount.uid)).length, 0, 'account deletion removes retired documents before deleting Authentication');
  assert.equal(await adminRead(`${emulatorDocuments}/students/${encodeURIComponent(retiredAccount.uid)}/guides/lucas`), undefined);
  assert.ok(await adminRead(`${emulatorDocuments}/students/${encodeURIComponent(retiredAccount.uid)}`), 'the erasure lock remains for obsolete sessions');

  const cappedAccount = await a.evaluate(`(async()=>{window.erasing=await startFixture('student-erasure-cap');await erasing.seedAllClasses();const state=await erasing.current();return{uid:erasing.subject,generation:state.generation,revision:state.revision}})()`);
  await seedRetired(cappedAccount.uid, cappedAccount.generation, 201 - classCount);
  const cappedDelete = await a.evaluate(`(async()=>{const state=await erasing.current();erasing.resetMetrics();let status;try{await erasing.request('progress','DELETE',{generation:state.generation,revision:state.revision},erasing.subject);status='allowed'}catch(error){status=error.status}return{status,authenticated:(await erasing.request('session')).authenticated,metrics:erasing.metrics()}})()`);
  assert.equal(cappedDelete.status, 413); assert.equal(cappedDelete.authenticated, true); assert.equal(cappedDelete.metrics.writes.length, 0);
  assert.deepEqual(cappedDelete.metrics.queries, [201]); assert.equal((await storedClasses(cappedAccount.uid)).length, 201);
  assert.equal((await adminRead(`${emulatorDocuments}/students/${encodeURIComponent(cappedAccount.uid)}/guides/lucas`)).fields.deleted.booleanValue, false);
  const cappedErasure = await a.evaluate(`(async()=>{erasing.resetMetrics();let status;try{await erasing.request('account/delete','DELETE',{},erasing.subject);status='allowed'}catch(error){status=error.status}return{status,authenticated:(await erasing.request('session')).authenticated,metrics:erasing.metrics()}})()`);
  assert.equal(cappedErasure.status, 413); assert.equal(cappedErasure.authenticated, true); assert.equal(cappedErasure.metrics.authDeletes || 0, 0);
  assert.equal((await storedClasses(cappedAccount.uid)).length, 201, 'oversized discovery never reports successful or partially completed class cleanup');
  assert.ok(await adminRead(`${emulatorDocuments}/students/${encodeURIComponent(cappedAccount.uid)}`), 'failed account erasure is already locked against future writes');
  await adminCommit([{ delete: classPath(cappedAccount.uid, 'retired-0') }]);
  const retriedErasure = await a.evaluate(`(async()=>{erasing.resetMetrics();const result=await erasing.request('account/delete','DELETE',{},erasing.subject);return{deleted:result.deleted,authenticated:(await erasing.request('session')).authenticated,metrics:erasing.metrics()}})()`);
  assert.equal(retriedErasure.deleted, true); assert.equal(retriedErasure.authenticated, false); assert.equal(retriedErasure.metrics.authDeletes, 1);
  assert.deepEqual(retriedErasure.metrics.queries, [200]); assert.equal((await storedClasses(cappedAccount.uid)).length, 0);
  assert.equal((await storedClasses(resultB.uid)).length, 1, 'account erasure and its retry never touch a neighboring UID');
  console.log(JSON.stringify({ result: 'PASS', deviceA: { knownClasses: resultA.storedClassCount, reloadSession: 'passed', unchangedClassesSkipped: true }, deviceB: { isolatedEmptyRead: 'passed', forgedUID: resultB.forged, directFirestoreAccess: resultB.direct, sameAccountRead: sameAccount.classes.length === classCount }, concurrentMerge: { bothIndependentQuestionUpdatesPresent: true, finalRevision: merged.revision }, transactionReads: { cold: resultA.startup.reads.length, unchangedGet: resultA.warmGet.reads.length, singleClassSave: resultA.singleSave.reads.length, changedRemote: changedHeader.reads, staleCAS: staleCAS.reads, deletion: deletion.metrics.reads.length }, singleClassWrites: resultA.singleSave.writes.length, patch: {warmReads:patchFirst.metrics.reads.length,staleReads:patchStale.metrics.reads.length,staleWrites:patchStale.metrics.writes.length,obsoleteWrites:patchObsolete.metrics.writes.length,noopReads:patchNoop.metrics.reads.length,noopWrites:patchNoop.metrics.writes.length,explicitFalse:patchFalse.value,deterministicTie:patchTies.final,guards:patchGuards,reset:patchReset}, cacheSafety, callerIsolation, erasure: {retiredGuideDocumentsRemoved:true,retiredAccountDocumentsRemoved:true,neighborPreserved:true,discoveryLimit:200,overLimitStatus:cappedErasure.status,overLimitAuthDeleted:false,retryAtLimit:true}, resetProtection: staleReset.status, testData: 'synthetic Auth Emulator identities only; transaction calls counted only in this test bundle, not billing measurements' }, null, 2));
} finally {
  for (const browser of [...launched].reverse()) await shutdown(browser);
  await new Promise(resolveClose => server.close(resolveClose));
  const workRelative = relative(output, work);
  if (!workRelative || workRelative.startsWith('..') || isAbsolute(workRelative)) throw Error('Unsafe test cleanup path');
  await rm(work, { recursive: true, force: true });
}
