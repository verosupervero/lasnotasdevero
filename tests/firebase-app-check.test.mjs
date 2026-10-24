import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppCheckGate, validateAppCheckConfig } from '../assets/js/study-app-check.js';

// Synthetic strings only: these tests never load Firebase or contact any service.
const config = { enabled: true, provider: 'recaptcha-enterprise', siteKey: `6L${'x'.repeat(38)}` };
const app = () => ({ options: { projectId: 'lnv-test' } });
function fixture() {
  const calls = { load: 0, init: [], token: [] };
  const instance = {};
  let token = async () => ({ token: 'synthetic-app-check-token' });
  const sdk = {
    ReCaptchaEnterpriseProvider: class { constructor(siteKey) { this.siteKey = siteKey; } },
    initializeAppCheck(application, options) { calls.init.push({ application, options }); return instance; },
    getToken(...args) { calls.token.push(args); return token(); }
  };
  return { calls, instance, loadSdk: async () => { calls.load++; return sdk; }, setToken: value => { token = value; } };
}

test('absent and disabled App Check never imports SDK or requests a token', async () => {
  const f = fixture();
  for (const settings of [undefined, { enabled: false }]) {
    const gate = createAppCheckGate({ options: { projectId: 'lnv-data' } }, settings, f);
    await gate.ensure(); await gate.ensure();
  }
  assert.equal(f.calls.load, 0);
  assert.equal(f.calls.init.length, 0);
  assert.equal(f.calls.token.length, 0);
});

test('enabled config is closed, public and restricted to the two known Firebase projects', () => {
  assert.deepEqual(validateAppCheckConfig(config, 'lnv-test'), config);
  assert.deepEqual(validateAppCheckConfig(config, 'lnv-data'), config);
  for (const value of [null, [], true, { enabled: 'true' }, { ...config, debugToken: 'synthetic' }, { ...config, provider: 'custom' }, { ...config, siteKey: '<script>' }, { ...config, siteKey: 'x'.repeat(101) }, { ...config, siteKey: undefined }]) {
    assert.throws(() => validateAppCheckConfig(value, 'lnv-test'), /invalid-app-check-config/);
  }
  for (const project of ['demo-lasnotasdevero', 'other-test', 'lnv-data-other', 'lnv-test-other', '', undefined]) {
    assert.throws(() => validateAppCheckConfig(config, project), /invalid-app-check-config/);
  }
});

test('production project remains inert until explicit opt-in, with no SDK or network load during validation', () => {
  const productionApp = { options: { projectId: 'lnv-data' } }, f = fixture();
  createAppCheckGate(productionApp, undefined, f);
  createAppCheckGate(productionApp, { enabled: false }, f);
  createAppCheckGate(productionApp, config, f);
  assert.equal(f.calls.load, 0);
  assert.equal(f.calls.init.length, 0);
  assert.equal(f.calls.token.length, 0);
});

test('first protected access lazily initializes Enterprise with background refresh disabled', async () => {
  const application = app(), f = fixture(), gate = createAppCheckGate(application, config, f);
  assert.equal(f.calls.load, 0);
  await gate.ensure();
  assert.equal(f.calls.load, 1);
  assert.equal(f.calls.init.length, 1);
  assert.equal(f.calls.init[0].application, application);
  assert.equal(f.calls.init[0].options.provider.siteKey, config.siteKey);
  assert.equal(f.calls.init[0].options.isTokenAutoRefreshEnabled, false);
  assert.deepEqual(f.calls.token[0], [f.instance, false]);
});

test('concurrent access shares one request and recreating a provider reuses its app gate', async () => {
  const application = app(), f = fixture();
  let finish;
  f.setToken(() => new Promise(resolve => { finish = resolve; }));
  const first = createAppCheckGate(application, config, f);
  assert.equal(createAppCheckGate(application, config, f), first);
  const a = first.ensure(), b = first.ensure();
  assert.equal(a, b);
  await Promise.resolve();
  finish({ token: 'synthetic' });
  await Promise.all([a, b]);
  assert.equal(f.calls.token.length, 1);
  await Promise.resolve();
  f.setToken(async () => ({ token: 'synthetic-cached' }));
  await first.ensure();
  assert.equal(f.calls.load, 1);
  assert.equal(f.calls.init.length, 1);
  assert.equal(f.calls.token.length, 2);
  assert.throws(() => createAppCheckGate(application, { ...config, siteKey: `6L${'y'.repeat(38)}` }, f), /config-changed/);
});

test('failed token request fails closed, permits explicit retry and preserves SDK instance', async () => {
  const f = fixture(), gate = createAppCheckGate(app(), config, f);
  f.setToken(async () => { throw Error('synthetic-network-failure'); });
  await assert.rejects(gate.ensure(), /synthetic-network-failure/);
  f.setToken(async () => ({ token: 'synthetic-retry' }));
  await gate.ensure();
  assert.equal(f.calls.load, 1);
  assert.equal(f.calls.init.length, 1);
  assert.equal(f.calls.token.length, 2);
});

test('load failures permit explicit retry and empty tokens never bypass the gate', async () => {
  const f = fixture();
  let attempts = 0;
  const gate = createAppCheckGate(app(), config, { loadSdk: () => {
    if (++attempts === 1) throw Error('synthetic-sdk-failure');
    return f.loadSdk();
  } });
  await assert.rejects(gate.ensure(), /synthetic-sdk-failure/);
  f.setToken(async () => ({ token: '' }));
  await assert.rejects(gate.ensure(), /token-unavailable/);
  f.setToken(async () => ({ token: 'synthetic-ready' }));
  await gate.ensure();
  assert.equal(attempts, 2);
  assert.equal(f.calls.init.length, 1);
});

test('debug bypasses are rejected before SDK import', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'FIREBASE_APPCHECK_DEBUG_TOKEN');
  const f = fixture(), gate = createAppCheckGate(app(), config, f);
  try {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    await assert.rejects(gate.ensure(), /debug-disabled/);
    assert.equal(f.calls.load, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, 'FIREBASE_APPCHECK_DEBUG_TOKEN', original);
    else delete globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN;
  }
});

test('real SDK HTTP quota and denial shapes preserve 429 and 403 without automatic retries', async () => {
  for (const code of ['appCheck/fetch-status-error', 'appCheck/initial-throttle', 'appCheck/throttled']) {
    for (const httpStatus of [429, 403]) {
      const f = fixture(), gate = createAppCheckGate(app(), config, f);
      const original = Object.assign(Error('synthetic-sdk-http-error'), { code, customData: { httpStatus, time: '00m:01s' } });
      f.setToken(async () => { throw original; });
      await assert.rejects(gate.ensure(), error => error.status === httpStatus && error.cause === original);
      assert.equal(f.calls.token.length, 1);
    }
  }
});

test('SDK outages and non-HTTP errors never become quota errors', async () => {
  for (const shape of [
    { code: 'appCheck/fetch-network-error', customData: { originalErrorMessage: 'synthetic-offline' } },
    { code: 'appCheck/fetch-parse-error' },
    { code: 'appCheck/recaptcha-error' },
    { code: 'appCheck/fetch-status-error', customData: { httpStatus: 503 } },
    { code: 'appCheck/initial-throttle', customData: { httpStatus: 503, time: '00m:01s' } },
    { code: 'appCheck/throttled', customData: { httpStatus: 503, time: '00m:01s' } },
    { code: 'appCheck/fetch-network-error', customData: { httpStatus: 429 } },
    { code: 'appCheck/throttled', customData: { httpStatus: '429' } }
  ]) {
    const f = fixture(), gate = createAppCheckGate(app(), config, f);
    const original = Object.assign(Error('synthetic-sdk-outage'), shape);
    f.setToken(async () => { throw original; });
    await assert.rejects(gate.ensure(), error => error === original && error.status !== 429);
    assert.equal(f.calls.token.length, 1);
  }
});
