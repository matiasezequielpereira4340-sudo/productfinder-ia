// pruebas/crons.mjs
// Se corre con: npm run test:crons
//
// Los dos crons de vercel.json (/api/meli-refresh?all=1 y
// /api/market?cosechar=1). Vercel los llama con
// "Authorization: Bearer $CRON_SECRET" y user-agent "vercel-cron/1.0".
// Con CRON_SECRET cargada tiene que valer SOLO el secreto: el user-agent se
// falsifica con un curl. Sin red: fetch esta mockeado y falla todo lo externo.

process.env.SESSION_SECRET = 'secreto-de-prueba';
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.SUPABASE_URL = 'http://supa.test';
delete process.env.ADMIN_KEY;

globalThis.fetch = async (url) => {
  const u = String(url);
  // meli_tokens vacio: los handlers terminan rapido despues de autorizar.
  if (u.startsWith('http://supa.test')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
};

const { cronAdmitido } = await import('../api/_sesion.js');
const { default: refresh } = await import('../api/meli-refresh.js');
const { default: market } = await import('../api/market.js');

function llamar(handler, query, headers) {
  const req = { method: 'GET', query, headers: headers || {}, body: {} };
  return new Promise(ok => {
    const res = {
      statusCode: 200, cuerpo: null,
      setHeader() {}, status(c) { this.statusCode = c; return this; },
      json(o) { this.cuerpo = o; ok(this); return this; }, end() { ok(this); return this; }
    };
    Promise.resolve(handler(req, res)).catch(e => { res.statusCode = 999; res.cuerpo = String(e); ok(res); });
  });
}

let fallas = 0, pasadas = 0;
function check(n, c, extra) {
  if (c) { pasadas++; console.log('  ok    ' + n); }
  else { fallas++; console.log('  FALLA ' + n + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 200) : '')); }
}

const UA = { 'user-agent': 'vercel-cron/1.0' };
const crons = [
  ['meli-refresh?all=1', refresh, { all: '1' }],
  ['market?cosechar=1', market, { cosechar: '1' }]
];

console.log('Con CRON_SECRET cargada');
process.env.CRON_SECRET = 'cron-secreto-123';
for (const [nombre, h, q] of crons) {
  let r = await llamar(h, q, { ...UA });
  check(nombre + ': solo user-agent de Vercel -> 401', r.statusCode === 401, r.statusCode);
  r = await llamar(h, q, {});
  check(nombre + ': sin nada -> 401', r.statusCode === 401, r.statusCode);
  r = await llamar(h, q, { authorization: 'Bearer otro' , ...UA });
  check(nombre + ': secreto equivocado -> 401', r.statusCode === 401, r.statusCode);
  r = await llamar(h, q, { authorization: 'Bearer cron-secreto-123', ...UA });
  check(nombre + ': Bearer $CRON_SECRET (lo que manda Vercel) -> pasa', r.statusCode !== 401, [r.statusCode, r.cuerpo]);
}
check('cronAdmitido: UA solo no alcanza', cronAdmitido({ headers: UA }) === false);

console.log('Sin CRON_SECRET (cierre escalonado)');
delete process.env.CRON_SECRET;
for (const [nombre, h, q] of crons) {
  let r = await llamar(h, q, { ...UA });
  check(nombre + ': user-agent de Vercel -> pasa', r.statusCode !== 401, r.statusCode);
  r = await llamar(h, q, {});
  check(nombre + ': sin nada -> 401', r.statusCode === 401, r.statusCode);
}

console.log('\n' + pasadas + ' ok, ' + fallas + ' fallas');
process.exit(fallas ? 1 : 0);
