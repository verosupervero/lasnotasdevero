// This isolated page has no analytics, iframe, external assets or SDK storage.
// Strip email tokens before any request. They are sent only to our verification API.
(() => {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  let token = hash.get('confirmation_token') || query.get('confirmation_token');
  let type = 'signup';
  if (!token) { token = hash.get('recovery_token') || query.get('recovery_token'); type = 'recovery'; }
  if (!token && query.has('token') && ['signup', 'recovery'].includes(query.get('type'))) { token = query.get('token'); type = query.get('type'); }
  history.replaceState(null, '', location.pathname);
  const result = document.querySelector('#account-result');
  const form = document.querySelector('#account-password');
  let verifiedSubject;
  async function post(path, body, expectedAccount) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 12000);
    try {
      const response = await fetch(`/api/lucas/auth/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(expectedAccount ? { 'X-Lucas-Account': expectedAccount } : {}) }, body: JSON.stringify(body), signal: abort.signal });
      if (!response.ok) throw Error('request');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  if (!token || token.length > 4096) {
    result.textContent = 'El enlace no es válido. Volvé a la guía para ingresar o solicitar otro correo.';
    token = undefined;
    return;
  }
  const verification = post('verify', { token, type });
  token = undefined;
  verification.then(async (verified) => {
    if (type === 'recovery') {
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 12000);
      try {
        const response = await fetch('/api/lucas/session', { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: abort.signal });
        if (!response.ok) throw Error('session');
        const session = await response.json();
        if (!session.authenticated || typeof session.subject !== 'string' || !session.subject || session.subject !== verified.subject) throw Error('session');
        verifiedSubject = session.subject;
      } finally { clearTimeout(timer); }
      result.textContent = 'Ingresá una nueva contraseña.'; form.hidden = false;
    }
    else result.textContent = 'Correo confirmado. Ya podés volver a la guía y elegir el avance de tu cuenta.';
  }).catch(() => { result.textContent = 'No pudimos verificar el enlace. Puede haber vencido o haber sido utilizado. Solicitá otro desde la guía.'; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = form.elements.password.value;
    form.elements.password.value = '';
    const button = form.querySelector('button'); button.disabled = true;
    try {
      if (!verifiedSubject) throw Error('session');
      await post('password', { password }, verifiedSubject);
      verifiedSubject = undefined;
      form.hidden = true; result.textContent = 'Contraseña actualizada. Podés volver a la guía.';
    }
    catch { result.textContent = 'No pudimos actualizar la contraseña. Intentá nuevamente.'; }
    finally { button.disabled = false; }
  });
})();
