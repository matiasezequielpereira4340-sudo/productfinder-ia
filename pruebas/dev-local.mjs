// pruebas/dev-local.mjs
// Se corre con: npm run dev:local   (puerto: PORT, por defecto 3100)
//
// Servidor LOCAL para ver el buscador sin tocar nada real: sirve los HTML/JS
// del repo y ejecuta los handlers REALES de api/*.js (auth, analyze), pero con
// MercadoLibre y Supabase SIMULADOS en memoria. Los precios y la competencia
// son inventados por el simulador: sirve para probar la interfaz (admin,
// candado, pool, rotacion, "Forzar", badge "Nuevo", conteos), NO para decidir
// una compra. El banner lo aclara igual que en produccion; esto no es produccion.
//
// Usuarios de prueba (solo existen en este proceso):
//   admin:  matypereira / local1234
//   free:   free@demo.com / local1234
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3100);

Object.assign(process.env, {
  APP_USER: 'matypereira', APP_PASS: 'local1234', ADMIN_KEY: 'clave-admin-local', SESSION_SECRET: 'secreto-local-' + Date.now(),
  SUPABASE_SERVICE_KEY: 'supa-local', CRON_SECRET: 'cron-local', BUSCADOR_MELI_RPS: '200', VERCEL_ENV: 'development'
});
delete process.env.APIFY_TOKEN; delete process.env.VERCEL_TOKEN; delete process.env.VERCEL_PROJECT_ID;
// VERCEL_ENV=development usaria el prefijo "preview:" (escrituras aisladas):
// en local da igual, todo vive en memoria.
const { hashearClave } = await import('../api/_clave.js');
process.env.USERS_DB = JSON.stringify([{ username: 'free@demo.com', email: 'free@demo.com', password: hashearClave('local1234'), active: true, approved: true, premium: false, expiryDays: 120, createdAt: new Date().toISOString() }]);

// ---- Simulador de MeLi + Supabase -----------------------------------------
const filas = {};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const qDe = u => decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || [])[1] || '').replace(/\+/g, ' ');
const h = t => { let x = 2166136261; for (const c of String(t)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
const porId = {};
let precioDe = () => 20000;
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url), metodo = (init && init.method) || 'GET';
  if (u.includes('dolarapi')) return json({ compra: 1480, venta: 1500, casa: 'bolsa', nombre: 'Bolsa', fechaActualizacion: new Date().toISOString() });
  if (u.includes('supabase.co')) {
    if (u.includes('/buscador_cache')) {
      if (metodo === 'POST') { const b = JSON.parse(init.body); filas[b.nicho] = b; return new Response('', { status: 201 }); }
      if (/select=nicho,created_at,v:/.test(u)) return json(Object.values(filas).map(f => ({ nicho: f.nicho, created_at: f.created_at, v: f.mercado.__v, parcial: f.mercado.__parcial, terminado: f.mercado.__terminado })));
      const n = decodeURIComponent((/nicho=eq\.([^&]*)/.exec(u) || [])[1] || '');
      return json(filas[n] ? [filas[n]] : []);
    }
    if (u.includes('/meli_tokens')) return json([{ access_token: 'tok', refresh_token: 'r', expires_at: new Date(Date.now() + 3600e3).toISOString() }]);
    if (metodo !== 'GET') return new Response('', { status: 201 });
    return json([]);
  }
  if (u.includes('api.mercadolibre.com')) {
    if (/\/highlights\/|\/sites\/MLA\/search|\/items\?ids|\/reviews\//.test(u)) return json({}, 403);
    if (u.includes('/listing_prices')) return json([{ sale_fee_details: { percentage_fee: 15, fixed_fee: 0 } }]);
    if (/\/trends\/MLA\//.test(u)) return json(['organizador magnetico de cables', 'soporte celular moto impermeable', 'lampara escritorio recargable plegable', 'samsung galaxy funda', 'yerba mate 1kg', 'luz led sensor movimiento recargable'].map(k => ({ keyword: k })));
    if (/\/categories\//.test(u)) return json({ id: 'MLA1', name: 'Categoría simulada', total_items_in_this_category: 5000 });
    if (u.includes('/products/search')) {
      const q = qDe(u), off = Number((/offset=(\d+)/.exec(u) || [])[1] || 0);
      // ~1 de cada 5 busquedas "no existe" en el simulador: para ver variantes, reemplazos y el conteo honesto.
      if (off > 0 || h(q) % 5 === 0) return json({ paging: { total: 0 }, results: [] });
      return json({ paging: { total: 200 + h(q) % 4000 }, results: Array.from({ length: 6 }, (_, k) => { const id = 'MLA' + (h(q + k) % 90000000 + 10000000); porId[id] = q; return { id, name: q + ' modelo ' + k }; }) });
    }
    const mi = /\/products\/(MLA\d+)\/items/.exec(u);
    if (mi) {
      const q = porId[mi[1]], p = precioDe(q);
      return json({ results: Array.from({ length: 3 }, (_, j) => ({ item_id: mi[1] + j, price: Math.round(p * (0.85 + j * 0.12)), seller_id: 100 + (h(mi[1]) + j) % 9, category_id: null, shipping: { free_shipping: j === 0, logistic_type: j === 0 ? 'fulfillment' : 'cross_docking' }, official_store_id: null })) });
    }
    return json({}, 404);
  }
  if (u.includes('api.vercel.com') || u.includes('apify.com') || u.includes('anthropic.com')) return json({ error: 'deshabilitado en local' }, 503);
  return fetchReal(url, init);
};

const pool = await import('../api/_pool.js');
const op = await import('../api/_oportunidad.js');
const analyze = await import('../api/analyze.js');
const CAT = analyze.__CATALOGO;
const indice = {};
Object.keys(CAT).forEach(k => pool.poolDe(k, CAT[k].productos, []).forEach(p => { indice[pool.normalizar(p.q)] = { p, k }; }));
precioDe = q => {
  const n = pool.normalizar(q);
  const base = indice[n] || Object.values(indice).find(x => n.startsWith(pool.normalizar(x.p.q).split(' ').slice(0, 2).join(' ')));
  if (!base) return 15000 + h(q) % 20000;
  // Precio de 2,5x a 6x el costo puesto: margenes variados, como en la realidad.
  return Math.round(op.costoImportacion(base.p, 1500, base.k).costoPuestoARS * (2.5 + (h(q) % 35) / 10));
};

const handlers = {
  analyze: analyze.default,
  auth: (await import('../api/auth.js')).default
};

function adaptar(req, res, cuerpo) {
  const r = req;
  try { r.body = cuerpo ? JSON.parse(cuerpo) : undefined; } catch (e) { r.body = undefined; }
  const out = { statusCode: 200, setHeader(k, v) { res.setHeader(k, v); }, status(c) { this.statusCode = c; return this; },
    json(o) { res.writeHead(this.statusCode, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); return this; },
    end(x) { res.writeHead(this.statusCode); res.end(x); return this; } };
  return [r, out];
}
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const m = /^\/api\/([a-z-]+)/.exec(p);
  if (m) {
    const hd = handlers[m[1]];
    if (!hd) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'Endpoint deshabilitado en el servidor local: ' + m[1] })); }
    let cuerpo = '';
    req.on('data', c => { cuerpo += c; });
    req.on('end', () => { const [a, b] = adaptar(req, res, cuerpo); Promise.resolve(hd(a, b)).catch(e => { res.writeHead(500); res.end(String(e && e.stack || e)); }); });
    return;
  }
  let f = path.join(RAIZ, decodeURIComponent(p === '/' ? '/index.html' : p));
  if (!f.startsWith(RAIZ) || /node_modules|\.git/.test(f)) { res.writeHead(404); return res.end(); }
  fs.readFile(f, (e, data) => {
    if (e) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', async () => {
  console.log('Servidor local (datos SIMULADOS) en http://localhost:' + PORT);
  console.log('  admin: matypereira / local1234   ·   free: free@demo.com / local1234');
  // Pre-analisis de algunos rubros (la "semana anterior" son los 12 fijos de siempre).
  for (const k of ['celulares', 'tecnologia', 'mascotas', 'hogar']) {
    let n = 0, r;
    do {
      r = await new Promise(ok => { const [a, b] = adaptar({ method: 'GET', url: '/api/analyze?precalcular=tanda&solo=' + k, headers: { authorization: 'Bearer cron-local', 'user-agent': 'vercel-cron/1.0' } }, { setHeader() {}, writeHead() {}, end(x) { ok(JSON.parse(x)); } }, ''); handlers.analyze(a, b); });
    } while (r.procesados && r.procesados[0] && r.procesados[0].terminado === false && ++n < 6);
    const pr = r.procesados && r.procesados[0];
    console.log('  rubro ' + k + ': ' + (pr ? pr.conDatos + '/' + pr.objetivo + ' con datos, ' + pr.descartados + ' descartados, pool ' + pr.de : JSON.stringify(r).slice(0, 120)));
  }
});
