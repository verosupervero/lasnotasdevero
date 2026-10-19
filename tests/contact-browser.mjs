// Local intercepted-browser tests only: no real key, remote form or email is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { generateKey, readMessage, decrypt } from 'openpgp';

const origin = 'https://contact-test.invalid';
const recipient = 'contact-test@example.invalid';
const root = resolve('public');
const output = resolve('.contact-test-output');
await mkdir(output, { recursive: true });
const html = await readFile(resolve(root, 'contacto/index.html'), 'utf8');
const productionConfig = JSON.parse(await readFile('data/contact.json', 'utf8'));
const csp = (await readFile('netlify.toml', 'utf8')).match(/Content-Security-Policy = "([^"]+)"/)[1];
const fixture = await generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ name: 'TEST ONLY', email: recipient }], format: 'object' });
const fingerprint = fixture.publicKey.getFingerprint();
const values = { name: 'SENSITIVE-NAME-ñ-12345', email: 'sensitive-test@example.invalid', subject: 'SENSITIVE-SUBJECT-12345', message: 'SENSITIVE-MESSAGE-12345\nTildes áéíóú y 🔒.' };
const profile = resolve(output, `browser-${Date.now()}`);
await mkdir(profile, { recursive: true });
const executable = process.env.CONTACT_BROWSER || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : 'chromium');
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)[0]; break; } catch {}
    if (browser.exitCode !== null) throw Error(`Browser exited: ${browser.exitCode}`);
    await delay(100);
  }
  assert.ok(port, 'Browser debugger must start');
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  let serial = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((r, j) => {
    const id = ++serial; pending.set(id, { r, j }); socket.send(JSON.stringify({ id, method, params }));
  });
  let mode = 'missing', replyStatus = 200, posts = 0, external = 0, lastCiphertext, transportError;
  const cspViolations = [];
  const resourceFailures = [];
  const fulfill = (requestId, responseCode, body, contentType, extra = []) => send('Fetch.fulfillRequest', {
    requestId, responseCode,
    responseHeaders: [{ name: 'Content-Type', value: contentType }, ...extra],
    body: Buffer.from(body).toString('base64'),
  });
  async function intercept({ requestId, request }) {
    const url = new URL(request.url);
    if (url.origin !== origin) { external++; await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return; }
    for (const text of Object.values(values)) assert.equal((request.url + JSON.stringify(request.headers)).includes(text), false);
    if (request.method === 'POST') {
      assert.equal(Object.keys(request.headers).some((name) => name.toLowerCase() === 'cookie'), false);
      posts++;
      assert.equal(url.pathname, '/contacto/');
      const body = new URLSearchParams(request.postData);
      assert.deepEqual([...body.keys()].sort(), ['bot-field', 'encrypted_message', 'form-name']);
      assert.equal(body.get('form-name'), 'contacto-cifrado'); assert.equal(body.get('bot-field'), '');
      lastCiphertext = body.get('encrypted_message');
      assert.match(lastCiphertext, /^-----BEGIN PGP MESSAGE-----/);
      for (const text of Object.values(values)) assert.equal(request.postData.includes(text) || decodeURIComponent(request.postData.replace(/\+/g, ' ')).includes(text), false);
      await delay(250);
      await fulfill(requestId, replyStatus, 'LOCAL TEST RESPONSE ONLY', 'text/plain'); return;
    }
    if (url.pathname === '/keys/test-public.asc') {
      await fulfill(requestId, mode === 'unavailable' ? 404 : 200, mode === 'invalid' ? 'not a public key' : fixture.publicKey.armor(), 'text/plain'); return;
    }
    let pathname = url.pathname;
    if (pathname.endsWith('/')) pathname += 'index.html';
    try {
      let bytes = await readFile(resolve(root, '.' + pathname));
      const ext = extname(pathname);
      if (ext === '.html' && pathname === '/contacto/index.html') {
        let text = html;
        if (mode !== 'actual-public-key') text = text.replace(/<div\b[^>]*\bid=(?:"contact-editor"|contact-editor)[^>]*>/, (tag) => {
          for (const attr of ['data-enabled', 'data-key-url', 'data-key-fingerprint']) tag = tag.replace(new RegExp(`\\s${attr}(?:=(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, 'g'), '');
          if (mode === 'missing') return tag.slice(0, -1) + ' data-enabled="false" data-key-url="" data-key-fingerprint="">';
          return tag.slice(0, -1) + ` data-enabled="true" data-key-url="/keys/test-public.asc" data-key-fingerprint="${mode === 'wrong-fingerprint' ? '0'.repeat(40) : fingerprint}">`;
        });
        bytes = Buffer.from(text);
      }
      // Replace only the expected recipient constant in the local intercepted test
      // response. The shipped bundle and production configuration are not modified.
      if (pathname === '/js/contact.js' && mode !== 'actual-public-key') bytes = Buffer.from(bytes.toString().replaceAll('lasnotasdevero@protonmail.com', recipient));
      await fulfill(requestId, 200, bytes, ({ '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' })[ext] || 'application/octet-stream', ext === '.html' ? [{ name: 'Content-Security-Policy', value: csp }, { name: 'Referrer-Policy', value: 'no-referrer' }] : []);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      resourceFailures.push(pathname);
      await fulfill(requestId, 404, '', 'text/plain');
    }
  }
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { r, j } = pending.get(message.id); pending.delete(message.id); message.error ? j(message.error) : r(message.result);
    } else if (message.method === 'Fetch.requestPaused') {
      intercept(message.params).catch(async (error) => {
        transportError = error;
        try { await send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Failed' }); } catch {}
      });
    } else if (message.method === 'Runtime.bindingCalled' && message.params.name === 'contactCspReport') {
      cspViolations.push(JSON.parse(message.params.payload));
    }
  };
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 100; i++) { if (transportError) throw transportError; if (await evaluate(expression)) return; await delay(50); }
    throw Error('Timed out: ' + expression);
  };
  const navigate = async () => { await send('Page.navigate', { url: origin + '/contacto/' }); await until(`!!document.querySelector('#contact-editor')`); await delay(250); };
  const click = () => evaluate(`document.querySelector('.contact-submit').click()`);
  const fill = (overrides = {}) => evaluate(`(() => {const values=${JSON.stringify({ ...values, ...overrides })};for(const[name,value]of Object.entries(values)){const el=document.getElementById('contact-'+name);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Runtime.addBinding', { name: 'contactCspReport' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('securitypolicyviolation',e=>contactCspReport(JSON.stringify({directive:e.effectiveDirective,blockedURI:e.blockedURI,disposition:e.disposition})));` });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  const report = { realProtonPrivateKey: false, realProtonPublicKeyChecked: false, realNetlifySubmission: false, realEmailDelivery: false, scenarios: [] };

  if (productionConfig.public_key_path && productionConfig.public_key_fingerprint) {
    mode = 'actual-public-key';
    await navigate(); await until(`!document.querySelector('.contact-submit').disabled`);
    assert.equal(posts, 0);
    report.realProtonPublicKeyChecked = true;
    report.scenarios.push('configured real public key validates in unchanged browser bundle; no submission attempted');
    mode = 'missing';
  }

  await navigate();
  assert.equal(await evaluate(`document.querySelector('.contact-submit').disabled`), true);
  assert.equal(await evaluate(`[...document.querySelectorAll('.contact-field input,.contact-field textarea')].every(e=>!e.name&&!e.form)`), true);
  report.scenarios.push('missing key disables sending; sensitive fields have no name or form');
  for (mode of ['invalid', 'unavailable', 'wrong-fingerprint']) {
    await navigate(); await until(`document.querySelector('#contact-status').dataset.state==='error'`); await fill(); await click();
    assert.equal(posts, 0); assert.equal(await evaluate(`document.querySelector('.contact-submit').disabled`), true);
    report.scenarios.push(mode + ': zero POST requests');
  }
  mode = 'ready'; await navigate(); await until(`!document.querySelector('.contact-submit').disabled`);
  await evaluate(`Promise.all([400,600,700,800].map(w=>document.fonts.load(w+' 16px "Open Sans"')).concat([400,600,700].map(w=>document.fonts.load(w+' 16px "Poppins"')))).then(()=>document.fonts.ready).then(()=>true)`);
  const resources = await evaluate(`(async()=>{await Promise.all([...document.images].map(i=>i.decode()));return {styles:[...document.styleSheets].map(s=>({url:s.href,rules:s.cssRules.length})),images:[...document.images].map(i=>({url:i.currentSrc,width:i.naturalWidth,height:i.naturalHeight})),fonts:[...document.fonts].map(f=>({family:f.family,weight:f.weight,status:f.status}))};})()`);
  assert.equal(resources.styles.length, 3);
  assert.ok(resources.styles.every(s=>s.url.startsWith(origin)&&s.rules>0));
  assert.ok(resources.images.length>=4&&resources.images.every(i=>i.width>0&&i.height>0));
  assert.equal(resources.fonts.length, 7);
  assert.ok(resources.fonts.every(f=>f.status==='loaded'));
  await send('DOM.enable'); await send('CSS.enable');
  const documentNode = await send('DOM.getDocument');
  const platformFonts = {};
  for (const [name,selector,expected] of [['heading','#contact-heading','Poppins'],['body','.contact-intro p','Open Sans']]) {
    const {nodeId}=await send('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector});
    const {fonts}=await send('CSS.getPlatformFontsForNode',{nodeId});
    assert.ok(fonts.some(f=>f.isCustomFont&&f.familyName.includes(expected)));
    platformFonts[name]=fonts.map(f=>({family:f.familyName,custom:f.isCustomFont}));
  }
  report.resources={...resources,platformFonts};
  await click(); assert.equal(posts, 0);
  await fill({ email: 'not-an-email' }); await click(); assert.equal(posts, 0);
  await fill({ email: 'a@b' }); await click(); await until(`document.querySelector('#contact-status').dataset.state==='error'`); assert.equal(posts, 0);
  report.scenarios.push('validation and encryption failure block transmission');
  await fill(); replyStatus = 500; await click(); await click(); await until(`document.querySelector('#contact-status').dataset.state==='error'`);
  assert.equal(posts, 1); assert.equal(await evaluate(`document.getElementById('contact-message').value`), values.message);
  const decoded = await decrypt({ message: await readMessage({ armoredMessage: lastCiphertext }), decryptionKeys: fixture.privateKey });
  assert.deepEqual(JSON.parse(decoded.data), values);
  report.scenarios.push('network body has only three allowlisted fields; all four exact values decrypt with ephemeral test key');
  replyStatus = 200; await click(); await until(`document.querySelector('#contact-status').dataset.state==='success'`);
  assert.equal(posts, 2); assert.equal(await evaluate(`document.getElementById('contact-message').value`), '');
  report.scenarios.push('failure preserves values; duplicate click sends once; acceptance clears values');
  await fill(); await evaluate(`document.getElementById('contact-bot-field').value='bot'`); await click(); await until(`document.querySelector('#contact-status').dataset.state==='error'`); assert.equal(posts, 2);
  report.scenarios.push('filled honeypot blocks submission');
  mode = productionConfig.public_key_path && productionConfig.public_key_fingerprint ? 'actual-public-key' : 'ready';
  await navigate(); await until(`!document.querySelector('.contact-submit').disabled`);
  await evaluate(`document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode()))).then(()=>true)`);
  report.dimensions = [];
  for (const width of [1280, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: width < 500 }); await delay(100);
    const size = await evaluate(`(()=>{const rects=['.brand-area','#nav','.header-donate','.social-header-icons'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}});let overlap=false;for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)overlap=true}return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,labels:[...document.querySelectorAll('.contact-field label')].every(e=>!!document.getElementById(e.htmlFor)),headerOverlap:overlap,navCurrent:document.querySelector('#nav a[aria-current=page]')?.textContent,buttonHeight:document.querySelector('.contact-submit').getBoundingClientRect().height}})()`);
    assert.ok(size.scrollWidth <= size.width); assert.ok(size.labels); assert.equal(size.headerOverlap,false); assert.equal(size.navCurrent,'Contacto'); assert.ok(size.buttonHeight>=44); report.dimensions.push(size);
    const {cssContentSize}=await send('Page.getLayoutMetrics');
    const shot = await send('Page.captureScreenshot', { format: 'png',captureBeyondViewport:true,clip:{x:0,y:0,width:Math.min(cssContentSize.width,width),height:cssContentSize.height,scale:1} }); await writeFile(resolve(output, `contact-${width}.png`), Buffer.from(shot.data, 'base64'));
  }
  await evaluate(`document.querySelector('form[name="contacto-cifrado"]').submit()`); await delay(200);
  assert.equal(posts, 2);
  assert.ok(cspViolations.some(v=>v.directive==='form-action'));
  report.scenarios.push('CSP reports and blocks native submission while allowing encrypted fetch');
  await send('Emulation.setScriptExecutionDisabled', { value: true }); await navigate(); await fill();
  assert.equal(await evaluate(`document.querySelector('.contact-submit').disabled`), true);
  await evaluate(`document.getElementById('contact-name').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await evaluate(`document.querySelector('form[name="contacto-cifrado"]').submit()`); await delay(300);
  assert.equal(posts, 2); report.scenarios.push('JavaScript disabled and attempted native submission: zero additional POSTs under CSP');
  assert.deepEqual(cspViolations.filter(v=>v.directive!=='form-action'), []);
  assert.ok(cspViolations.some(v=>v.directive==='form-action'));
  assert.deepEqual(resourceFailures, []);
  report.csp={unexpectedViolations:0,nativeSubmissionBlocked:true,encryptedFetchAllowed:true,missingResources:resourceFailures};
  assert.equal(external, 0); if (transportError) throw transportError;
  report.scenarios.push('zero external requests, no real network form calls');
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { socket?.close(); browser.kill(); }
