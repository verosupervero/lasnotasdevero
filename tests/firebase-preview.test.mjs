import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, relative, isAbsolute } from 'node:path';
import { parseArguments, validateConfig, previewToml, buildPreview, previewHandler } from '../scripts/preview-firebase.mjs';

const config = { apiKey: `AIza${'x'.repeat(35)}`, projectId: 'lnv-prueba', authDomain: 'lnv-prueba.firebaseapp.com', appId: '1:123456:web:abcdef0123456789', messagingSenderId: '123456' };
const productionConfig = { apiKey: `AIza${'p'.repeat(35)}`, projectId: 'lnv-data', authDomain: 'lnv-data.firebaseapp.com', appId: '1:999999:web:0123456789abcdef', messagingSenderId: '999999' };
const toml = `baseURL = "https://production.invalid/"\n[params]\nlucas_sync_enabled = false\nstudy_sync_enabled = false\nstudy_sync_provider = "firebase"\nstudy_private_storage = false\nstudy_app_check_enabled = false\n`;

test('requires an explicit separate project and config before doing work', () => {
  for (const args of [[], ['--project', 'lnv-prueba'], ['--config', 'test.json'], ['--config', 'x', '--project', 'x', '--port', '1314\nunsafe'], ['--config', 'x', '--project', 'x', '--port', '80'], ['--config', 'x', '--project', 'x', '--destination', 'public'], ['--config', 'x', '--config', 'y']]) assert.throws(() => parseArguments(args));
  assert.deepEqual(parseArguments(['--config', '.lucas-private/firebase-test.json', '--project', 'lnv-prueba', '--serve']), { config: '.lucas-private/firebase-test.json', project: 'lnv-prueba', serve: true, port: 1314 });
});

test('rejects production, emulators, inconsistent identity and non-public fields', () => {
  const invalid = [
    [config, 'lnv-data', productionConfig], [config, 'demo-test', productionConfig],
    [config, 'lnv-prueba', undefined], [{ ...config, authDomain: 'attacker.invalid' }, 'lnv-prueba', productionConfig],
    [{ ...config, projectId: 'another-project' }, 'lnv-prueba', productionConfig],
    [{ ...config, private_key: 'fake-private' }, 'lnv-prueba', productionConfig],
    [{ ...config, token: 'fake-token' }, 'lnv-prueba', productionConfig],
    [{ type: 'service_account', project_id: 'lnv-prueba' }, 'lnv-prueba', productionConfig],
    [{ enabled: true, firebase: config }, 'lnv-prueba', productionConfig],
    [{ enabled: false, firebase: config, credentials: {} }, 'lnv-prueba', productionConfig],
    [{ ...config, messagingSenderId: '999' }, 'lnv-prueba', productionConfig],
    [JSON.parse('{"__proto__":{},"apiKey":"fake"}'), 'lnv-prueba', productionConfig],
    [{ ...config, apiKey: productionConfig.apiKey }, 'lnv-prueba', productionConfig],
    [{ ...config, appId: productionConfig.appId, messagingSenderId: productionConfig.messagingSenderId }, 'lnv-prueba', productionConfig],
    [{ ...config, appId: '1:999999:web:aaaaaaaaaaaaaaaa', messagingSenderId: '999999' }, 'lnv-prueba', productionConfig]
  ];
  for (const values of invalid) assert.throws(() => validateConfig(...values));
  assert.deepEqual(validateConfig(config, 'lnv-prueba', productionConfig), config);
  assert.deepEqual(validateConfig({ enabled: false, firebase: config }, 'lnv-prueba', productionConfig), config);
});

test('enables privacy and synchronization only in temporary Hugo configuration', () => {
  const result = previewToml(toml, 1314);
  assert.match(result, /study_sync_enabled = true/);
  assert.match(result, /study_private_storage = true/);
  assert.match(result, /study_app_check_enabled = false/);
  assert.match(result, /baseURL = "http:\/\/localhost:1314\/"/);
  assert.match(toml, /study_sync_enabled = false/);
  assert.throws(() => previewToml(toml.replace('study_sync_enabled = false', ''), 1314), /configuración Hugo cambió/);
});

async function fixture(t) {
  const temporaryRoot = await realpath(tmpdir());
  const repository = await mkdtemp(resolve(temporaryRoot, 'firebase-preview-unit-'));
  t.after(async () => {
    assert.equal(dirname(repository), temporaryRoot);
    assert.ok(basename(repository).startsWith('firebase-preview-unit-'));
    assert.equal(await realpath(repository), repository);
    await rm(repository, { recursive: true, force: true });
  });
  for (const directory of ['static/config', 'config/_default', '.lucas-private', 'public']) await mkdir(resolve(repository, directory), { recursive: true });
  const production = JSON.stringify({ enabled: false, firebase: productionConfig });
  await writeFile(resolve(repository, 'static/config/firebase.json'), production);
  await writeFile(resolve(repository, 'config/_default/config.toml'), toml);
  await writeFile(resolve(repository, '.lucas-private/test.json'), JSON.stringify(config));
  await writeFile(resolve(repository, 'public/unchanged.txt'), 'preserved');
  return { repository, production, options: { config: '.lucas-private/test.json', project: 'lnv-prueba', port: 1314 } };
}

test('builds an isolated unique output and never changes production settings/public', async t => {
  const f = await fixture(t), calls = [];
  const execute = async (command, args, options) => calls.push({ command, args, options });
  const destination = await buildPreview(f.options, { repository: f.repository, execute });
  const destination2 = await buildPreview(f.options, { repository: f.repository, execute });
  assert.notEqual(destination, destination2);
  const child = relative(resolve(f.repository, '.contact-test-output/firebase-preview'), destination);
  assert.ok(!isAbsolute(child) && !child.startsWith('..'));
  assert.equal(calls[0].command, process.execPath);
  assert.match(calls[0].args[0], /build-firebase\.mjs$/);
  assert.equal(calls[1].command, 'hugo');
  assert.equal(calls[1].args[calls[1].args.indexOf('--destination') + 1], destination);
  assert.ok(calls[1].args.includes('--configDir'));
  assert.match(await readFile(calls[1].args[1], 'utf8'), /study_private_storage = true/);
  assert.ok(Object.keys(calls[1].options.env).every(key => !key.toUpperCase().startsWith('HUGO_')));
  assert.deepEqual(JSON.parse(await readFile(resolve(destination, 'config/firebase.json'), 'utf8')), { enabled: true, firebase: config });
  assert.equal(await readFile(resolve(f.repository, 'static/config/firebase.json'), 'utf8'), f.production);
  assert.equal(await readFile(resolve(f.repository, 'config/_default/config.toml'), 'utf8'), toml);
  assert.equal(await readFile(resolve(f.repository, 'public/unchanged.txt'), 'utf8'), 'preserved');
});

test('invalid or production config never invokes a build; failed build never writes enabled config', async t => {
  const f = await fixture(t); let calls = 0;
  const execute = async () => { calls++; throw Error('build fixture failure'); };
  await assert.rejects(buildPreview({ ...f.options, project: 'lnv-data' }, { repository: f.repository, execute }), /producción/);
  assert.equal(calls, 0);
  await writeFile(resolve(f.repository, '.lucas-private/test.json'), 'const firebaseConfig = {};');
  await assert.rejects(buildPreview(f.options, { repository: f.repository, execute }), /JSON válido/);
  assert.equal(calls, 0);
  await writeFile(resolve(f.repository, '.lucas-private/test.json'), JSON.stringify(config));
  await assert.rejects(buildPreview(f.options, { repository: f.repository, execute }), /build fixture failure/);
  assert.equal(calls, 1);
  assert.equal(await readFile(resolve(f.repository, 'static/config/firebase.json'), 'utf8'), f.production);
});

test('valid optional App Check is copied only into the separate lnv-test preview', async t => {
  const f = await fixture(t), calls = [];
  const firebase = { ...config, projectId: 'lnv-test', authDomain: 'lnv-test.firebaseapp.com' };
  const appCheck = { enabled: true, provider: 'recaptcha-enterprise', siteKey: `6L${'x'.repeat(38)}` };
  await writeFile(resolve(f.repository, f.options.config), JSON.stringify({ enabled: false, firebase, appCheck }));
  const destination = await buildPreview({ ...f.options, project: 'lnv-test' }, { repository: f.repository, execute: async (command, args) => { calls.push({ command, args }); } });
  assert.deepEqual(JSON.parse(await readFile(resolve(destination, 'config/firebase.json'), 'utf8')), { enabled: true, firebase, appCheck });
  assert.match(await readFile(calls[1].args[1], 'utf8'), /study_app_check_enabled = true/);
  assert.equal(await readFile(resolve(f.repository, 'static/config/firebase.json'), 'utf8'), f.production);
  assert.equal(await readFile(resolve(f.repository, 'config/_default/config.toml'), 'utf8'), toml);
});

test('missing keys, debug config and App Check outside lnv-test fail before running builds', async t => {
  const f = await fixture(t);
  const firebase = { ...config, projectId: 'lnv-test', authDomain: 'lnv-test.firebaseapp.com' };
  const appCheck = { enabled: true, provider: 'recaptcha-enterprise', siteKey: `6L${'x'.repeat(38)}` };
  let calls = 0;
  const execute = async () => { calls++; };
  for (const [settings, target] of [
    [{ ...appCheck, siteKey: undefined }, firebase],
    [{ ...appCheck, debugToken: 'synthetic' }, firebase],
    [appCheck, config],
    [{ ...appCheck, siteKey: 'invalid key' }, firebase]
  ]) {
    await writeFile(resolve(f.repository, f.options.config), JSON.stringify({ enabled: false, firebase: target, appCheck: settings }));
    await assert.rejects(buildPreview({ ...f.options, project: target.projectId }, { repository: f.repository, execute }), /invalid-app-check-config/);
  }
  assert.equal(calls, 0);
});

test('local server handler blocks rebinding, traversal, writes and directory listings without network', async t => {
  const f = await fixture(t), handler = previewHandler(resolve(f.repository, 'public'), 1314);
  await mkdir(resolve(f.repository, 'public/empty'));
  const request = async (url, method = 'GET', host = 'localhost:1314') => {
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); }, end(data) { this.data = data; } };
    await handler({ url, method, headers: { host } }, response);
    return response;
  };
  assert.equal((await request('/unchanged.txt')).data.toString(), 'preserved');
  assert.equal((await request('/unchanged.txt', 'HEAD')).data, undefined);
  assert.equal((await request('/unchanged.txt')).headers['Cache-Control'], 'no-store');
  assert.equal((await request('/unchanged.txt', 'GET', 'attacker.invalid:1314')).status, 403);
  assert.equal((await request('/unchanged.txt', 'POST')).status, 405);
  for (const path of ['/../static/config/firebase.json', '/%2e%2e/static/config/firebase.json', '/%2e%2e%5cstatic', '/empty/', '/%', '/%00']) assert.equal((await request(path)).status, 404);
});
