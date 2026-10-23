import { MAX_BODY_BYTES, STORE_NAME, ownerHash, publicEnvelope, trustedOrigin } from '../lib/lucas-sync-config.mjs';
import { exactKeys, validBase, validProgress, readBoundedJSON } from '../lib/lucas-progress-validation.mjs';
import { allowRequest, mutateProgress, strongRead } from '../lib/lucas-progress-store.mjs';

const response = (body, status = 200, extra = {}) => Response.json(body, { status, headers: {
  'Cache-Control': 'no-store, private', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", ...extra
} });
const failure = status => response({ error: status === 429 ? 'rate_limited' : status === 503 ? 'unavailable' : status === 401 ? 'unauthorized' : 'request_refused' }, status);
const email = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const password = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
const confirmed = user => typeof user?.id === 'string' && user.id.length > 0 && user.id.length <= 200 && typeof user.confirmedAt === 'string' && Number.isFinite(Date.parse(user.confirmedAt));

export function createLucasHandler({ env = process.env, identity: injectedIdentity, store: injectedStore, catalog: injectedCatalog, now = Date.now, rateLimit = 30 } = {}) {
  return async (request, context) => {
    // Fail closed BEFORE importing/initializing auth or storage, even for malformed requests.
    if (env.LUCAS_SYNC_ENABLED !== 'true') return failure(503);
    try {
      const origin = trustedOrigin(env), url = new URL(request.url);
      if (url.origin !== origin || url.search || !url.pathname.startsWith('/api/lucas/')) return failure(400);
      const route = url.pathname.slice('/api/lucas/'.length);
      const routes = { session: ['GET'], progress: ['GET', 'PUT', 'DELETE'], export: ['GET'], 'auth/login': ['POST'], 'auth/signup': ['POST'], 'auth/logout': ['POST'], 'auth/recover': ['POST'], 'auth/verify': ['POST'], 'auth/password': ['POST'] };
      if (!Object.hasOwn(routes, route)) return failure(404);
      if (!routes[route].includes(request.method)) return failure(405);
      const identity = injectedIdentity || (await import('../lib/lucas-identity.mjs')).createIdentityAdapter(origin, context);
      let body;
      if (request.method !== 'GET') {
        if (request.headers.get('origin') !== origin) return failure(403);
        identity.verifyRequestOrigin(request, { allowedOrigins: [origin] });
        body = await readBoundedJSON(request);
      }
      if (route.startsWith('auth/')) {
        const action = route.slice(5);
        try {
          if (action === 'login' || action === 'signup') {
            if (!exactKeys(body, ['email', 'password']) || !email(body.email) || !password(body.password)) return failure(400);
            if (action === 'signup') {
              // Same generic response for duplicate/unavailable accounts. No user enumeration.
              try { await identity.signup(body.email, body.password); } catch { /* No details escape. */ }
              return response({ ok: true, confirmationRequired: true }, 202);
            }
            await identity.login(body.email, body.password);
          } else if (action === 'logout') {
            if (!exactKeys(body, [])) return failure(400);
            await identity.logout();
          } else if (action === 'recover') {
            if (!exactKeys(body, ['email']) || !email(body.email)) return failure(400);
            try { await identity.recover(body.email); } catch { /* Same response for existing/missing accounts. */ }
            return response({ ok: true }, 202);
          } else if (action === 'verify') {
            if (!exactKeys(body, ['token', 'type']) || !['signup', 'recovery'].includes(body.type) || typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{16,2048}$/.test(body.token)) return failure(400);
            const verified = await identity.verify(body.token, body.type);
            if (!confirmed(verified)) return failure(401);
            return response({ ok: true, subject: verified.id });
          } else if (action === 'password') {
            const account = await identity.getUser(request);
            if (!exactKeys(body, ['password']) || !password(body.password) || !confirmed(account)) return failure(401);
            if (request.headers.get('x-lucas-account') !== account.id) return response({ error: 'session_changed' }, 401);
            await identity.password(body.password);
          }
          return response({ ok: true });
        } catch { return failure(401); }
      }
      const user = await identity.getUser(request);
      if (route === 'session') return response(confirmed(user) ? { authenticated: true, subject: user.id } : { authenticated: false });
      if (!confirmed(user)) return failure(401);
      // Account guard prevents an old tab from syncing A's local progress after another tab logs into B.
      // It is ONLY a consistency guard. The storage owner ALWAYS comes from verified getUser().
      if (request.headers.get('x-lucas-account') !== user.id) return response({ error: 'session_changed' }, 401);
      const store = injectedStore || (await import('@netlify/blobs')).getStore({ name: STORE_NAME, consistency: 'strong' });
      const key = ownerHash(user.id);
      if (!await allowRequest(store, key, now(), rateLimit)) return failure(429);
      if (request.method === 'GET') {
        const envelope = publicEnvelope((await strongRead(store, key))?.data);
        return response(envelope, 200, route === 'export' ? { 'Content-Disposition': 'attachment; filename="lucas-progreso.json"' } : {});
      }
      const remove = request.method === 'DELETE';
      if (!exactKeys(body, remove ? ['revision', 'generation'] : ['revision', 'generation', 'progress']) || !validBase(body)) return failure(400);
      if (!remove) {
        const catalog = injectedCatalog || (await import('../generated/lucas-catalog.mjs')).default;
        if (!validProgress(body.progress, catalog, now()) || Buffer.byteLength(JSON.stringify(body.progress)) > MAX_BODY_BYTES) return failure(400);
      }
      const result = await mutateProgress(store, key, body, remove, now());
      return response(result.body, result.status);
    } catch (error) {
      return failure([400, 403, 413, 415].includes(error?.status) ? error.status : 503);
    }
  };
}

export default createLucasHandler();
export const config = {
  path: '/api/lucas/*',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
