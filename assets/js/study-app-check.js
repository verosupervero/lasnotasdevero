// App Check requires explicit opt-in and one of the site's two known projects.
// No SDK import, reCAPTCHA script or token request occurs until ensure().
const gates = new WeakMap();
export function validateAppCheckConfig(config, projectId) {
  if (config === undefined) return undefined;
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(key => !['enabled', 'provider', 'siteKey'].includes(key))
    || typeof config.enabled !== 'boolean') throw Error('invalid-app-check-config');
  if (!config.enabled) return undefined;
  if (!['lnv-test', 'lnv-data'].includes(projectId) || config.provider !== 'recaptcha-enterprise'
    || typeof config.siteKey !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(config.siteKey)) throw Error('invalid-app-check-config');
  return { enabled: true, provider: 'recaptcha-enterprise', siteKey: config.siteKey };
}

export function createAppCheckGate(app, config, { loadSdk = () => import('firebase/app-check') } = {}) {
  const settings = validateAppCheckConfig(config, app?.options?.projectId);
  if (!settings) return { ensure: async () => {} };
  const existing = gates.get(app);
  if (existing) {
    if (existing.siteKey !== settings.siteKey) throw Error('app-check-config-changed');
    return existing.gate;
  }
  let sdk, instance, pending;
  const gate = {
    ensure() {
      if (pending) return pending;
      pending = (async () => {
        // Never accept a debug-token bypass in either real Firebase project.
        if (globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN !== undefined && globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN !== false) throw Error('app-check-debug-disabled');
        sdk ||= await loadSdk();
        instance ||= sdk.initializeAppCheck(app, {
          provider: new sdk.ReCaptchaEnterpriseProvider(settings.siteKey),
          isTokenAutoRefreshEnabled: false
        });
        const result = await sdk.getToken(instance, false);
        if (!result || typeof result.token !== 'string' || !result.token) throw Error('app-check-token-unavailable');
      })().catch(error => {
        // The Enterprise provider wraps HTTP failures in initial-throttle and
        // throttled errors. Only their original HTTP status identifies quota
        // exhaustion or denial; a network outage is not an exhausted quota.
        if (['appCheck/fetch-status-error', 'appCheck/initial-throttle', 'appCheck/throttled'].includes(error?.code)
          && [403, 429].includes(error?.customData?.httpStatus)) {
          throw Object.assign(new Error('app-check-request-rejected', { cause: error }), { status: error.customData.httpStatus });
        }
        throw error;
      }).finally(() => { pending = undefined; });
      return pending;
    }
  };
  gates.set(app, { siteKey: settings.siteKey, gate });
  return gate;
}
