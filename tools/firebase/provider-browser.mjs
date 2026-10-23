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
const candidates = [process.env.BROWSER, process.env.LUCAS_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let browserPath;
for (const candidate of candidates) { try { await access(candidate); browserPath = candidate; break; } catch {} }
if (!browserPath) throw Error('Chromium browser missing: set BROWSER or LUCAS_BROWSER to its executable path');
await mkdir(output, { recursive: true });
const work = await mkdtemp(resolve(output, 'firebase-provider-'));
const catalog = JSON.parse(await readFile(resolve(root, 'firebase/generated/catalog.json'), 'utf8'));
const bundle = resolve(work, 'provider-test.bundle.js');
await build({ entryPoints: [resolve(source, 'provider-fixture.mjs')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: bundle, alias: { firebase: resolve(root,'node_modules/firebase') }, define: { __STUDY_CATALOG__: JSON.stringify(catalog) } });

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
  const resultA = await a.evaluate(`(async()=>{window.a=await startFixture('student-emulator-a');const s=await a.current();await a.seedAllClasses();const first=await a.current();const before=await a.classes();await a.markQuestion(0,1,true,Date.now()+20);const second=await a.current();const after=await a.classes();return {uid:a.subject,initial:s.revision,firstRevision:first.revision,secondRevision:second.revision,classes:Object.keys(second.progress.classes),before:before.map(x=>({id:x.id,version:x.version})),after:after.map(x=>({id:x.id,version:x.version})),storedClassCount:after.length}})()`);
  assert.equal(resultA.initial, 0); assert.equal(resultA.firstRevision, 1); assert.equal(resultA.secondRevision, 2); assert.equal(resultA.classes.length, classCount); assert.equal(resultA.storedClassCount, classCount); assert.ok(resultA.before.every((item) => Array.isArray(item.version) && item.version.length === 2));
  const firstClassId = catalog.lucas[Object.keys(catalog.lucas)[0]] && Object.keys(catalog.lucas)[0];
  const beforeVersions = Object.fromEntries(resultA.before.map((item) => [item.id, item.version]));
  const afterVersions = Object.fromEntries(resultA.after.map((item) => [item.id, item.version]));
  assert.notDeepEqual(afterVersions[firstClassId], beforeVersions[firstClassId], 'changed class document receives a new Firestore version');
  for (const id of Object.keys(beforeVersions).filter((item) => item !== firstClassId)) assert.deepEqual(afterVersions[id], beforeVersions[id], `unchanged class ${id} is not rewritten`);

  await a.send('Page.reload');
  await delay(500);
  for (let i = 0; i < 100; i++) { if (await a.evaluate('!!window.fixtureReady').catch(() => false)) break; await delay(100); }
  const reload = await a.evaluate(`(async()=>{window.a=await startFixture('student-emulator-a',false);return {uid:a.subject,read:await a.current()}})()`);
  assert.equal(reload.uid, resultA.uid, 'browser session persists through page reload');
  assert.equal(Object.keys(reload.read.progress.classes).length, classCount, 'reload restores all class records');

  b = await launch('b');
  const resultB = await b.evaluate(`(async()=>{window.b=await startFixture('student-emulator-b');const empty=await b.current();let forged;try{await b.request('progress','GET',undefined,${JSON.stringify(resultA.uid)});forged='allowed'}catch(e){forged=e.status}let direct;try{await b.directRead(${JSON.stringify(resultA.uid)});direct='allowed'}catch(e){direct=e.code}return {uid:b.subject,empty,forged,direct}})()`);
  assert.notEqual(resultB.uid, resultA.uid); assert.equal(resultB.empty.revision, 0); assert.equal(resultB.empty.progress, null); assert.equal(resultB.forged, 403); assert.equal(resultB.direct, 'permission-denied');

  const sameAccount = await b.evaluate(`(async()=>{await b.sync.logout();window.b=await startFixture('student-emulator-a');const state=await b.current();return {uid:b.subject,classes:Object.keys(state.progress.classes),revision:state.revision}})()`);
  assert.equal(sameAccount.uid, resultA.uid); assert.equal(sameAccount.classes.length, classCount, 'a second device signed into the same account reads its shared progress');
  await Promise.all([
    a.evaluate(`a.markQuestion(0,2,true,Date.now()+30)`),
    b.evaluate(`b.markQuestion(0,3,true,Date.now()+31)`),
  ]);
  await Promise.all([a.evaluate('a.sync.flush()'), b.evaluate('b.sync.flush()')]);
  const merged = await a.evaluate(`(async()=>{const result=await a.current();const first=a.catalog[0].id;return {revision:result.revision,blocks:result.progress.classes[first].blocks,classes:Object.keys(result.progress.classes)}})()`);
  const firstQuestions = catalog.lucas[Object.keys(catalog.lucas)[0]].questions;
  assert.equal(merged.blocks[firstQuestions[0]].value, true); assert.equal(merged.blocks[firstQuestions[1]].value, true); assert.equal(merged.blocks[firstQuestions[2]].value, true); assert.equal(merged.blocks[firstQuestions[3]].value, true); assert.equal(merged.classes.length, classCount); assert.equal(merged.revision, 4, 'stale concurrent edit conflicted and retried after merging');
  console.log(JSON.stringify({ result: 'PASS', deviceA: { knownClasses: resultA.storedClassCount, reloadSession: 'passed', unchangedClassesSkipped: true }, deviceB: { isolatedEmptyRead: 'passed', forgedUID: resultB.forged, directFirestoreAccess: resultB.direct, sameAccountRead: sameAccount.classes.length === classCount }, concurrentMerge: { bothIndependentQuestionUpdatesPresent: true, finalRevision: merged.revision }, testData: 'synthetic Auth Emulator identities only' }, null, 2));
} finally {
  for (const browser of [...launched].reverse()) await shutdown(browser);
  await new Promise(resolveClose => server.close(resolveClose));
  const workRelative = relative(output, work);
  if (!workRelative || workRelative.startsWith('..') || isAbsolute(workRelative)) throw Error('Unsafe test cleanup path');
  await rm(work, { recursive: true, force: true });
}
