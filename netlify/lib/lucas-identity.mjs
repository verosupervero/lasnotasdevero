import { getUser, verifyRequestOrigin } from '@netlify/identity';

// Endpoint shapes follow the official SDK / netlify/gotrue source. Auth tokens never leave
// this server adapter. SDK login currently emits JS-readable cookies, so its documented
// HTTP endpoints are used with the runtime Cookie API to require HttpOnly instead.
export function createIdentityAdapter(origin, context, fetcher = fetch) {
  const base = `${origin}/.netlify/identity`;
  const jar = () => {
    if (!context?.cookies?.set || !context.cookies.get) throw Error('cookie runtime required');
    return context.cookies;
  };
  const cookies = tokens => {
    const store = jar();
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw Error('invalid provider response');
    for (const [name, value, maxAge] of [['nf_jwt', tokens.access_token, Math.min(3600, Math.max(60, Number(tokens.expires_in) || 3600))], ['nf_refresh', tokens.refresh_token, 604800]]) {
      store.set({ name, value, httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge });
    }
  };
  const clear = () => {
    for (const name of ['nf_jwt', 'nf_refresh']) jar().set({ name, value: '', maxAge: 0, httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  };
  async function call(path, body, { method = 'POST', token, form = false } = {}) {
    const response = await fetcher(`${base}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { ...(body ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), Referer: `${origin}/cuenta/`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) } : {})
    });
    if (!response.ok) throw Error('identity unavailable');
    if (response.status === 204) return {};
    return response.json();
  }
  return {
    getUser,
    verifyRequestOrigin,
    async login(email, password) {
      jar();
      const tokens = await call('/token', { grant_type: 'password', username: email, password }, { form: true });
      const user = await call('/user', null, { method: 'GET', token: tokens.access_token });
      if (!user.confirmed_at) throw Error('unconfirmed');
      cookies(tokens);
    },
    async signup(email, password) {
      jar();
      const settings = await call('/settings', null, { method: 'GET' });
      if (settings.autoconfirm !== false || settings.disable_signup === true) throw Error('confirmation configuration required');
      await call('/signup', { email, password });
    },
    async logout() {
      try { const token = jar().get('nf_jwt'); if (token) await call('/logout', null, { token }); } finally { clear(); }
    },
    async recover(email) { await call('/recover', { email }); },
    async verify(token, type) {
      jar();
      const tokens = await call('/verify', { token, type });
      const user = await call('/user', null, { method: 'GET', token: tokens.access_token });
      if (!user.confirmed_at) throw Error('unconfirmed');
      cookies(tokens);
      return { id: user.id, confirmedAt: user.confirmed_at };
    },
    async password(password) {
      const token = jar().get('nf_jwt');
      if (!token) throw Error('unauthenticated');
      await call('/user', { password }, { method: 'PUT', token });
    }
  };
}
