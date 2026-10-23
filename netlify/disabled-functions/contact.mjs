// Archived retired plaintext endpoint. Not deployed as part of static hosting.
// Do not read, log, store or forward request bodies.
// The encrypted contact page submits directly to Netlify Forms.
export default function retiredContactEndpoint() {
  return Response.json(
    { ok: false, error: 'Este mecanismo de contacto ya no está disponible.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const config = {
  path: '/api/contacto',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
