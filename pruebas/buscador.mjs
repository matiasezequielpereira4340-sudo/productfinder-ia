// pruebas/buscador.mjs
// Se corre con: npm run test:buscador
//
// Buscador de oportunidades (/api/analyze) y su pre-analisis nocturno, con
// fetch simulado. El mock replica lo MEDIDO con el token real el 20/10/2026:
// /products/search, /products/{id}/items (404 si no hay ofertas), /trends,
// /categories, /users (sin ventas de 60 dias) y /listing_prices responden;
// /sites/MLA/search, /highlights, /items, /reviews y /visits dan 403.
// Apify (rotacion) se simula con su API: arrancar corrida, estado, dataset y
// uso del ciclo; los vendidos vienen en rangos ("+100 vendidos") como en la
// realidad.
process.env.SUPABASE_SERVICE_KEY = 'supa-de-prueba';
process.env.APIFY_TOKEN = 'apify-de-prueba';
process.env.SESSION_SECRET = 'secreto-de-prueba';
process.env.CRON_SECRET = 'cron-de-prueba';

let fallos = 0, oks = 0;
function chequear(n, c, extra) {
  console.log((c ? '  ok    ' : '  FALLA ') + n + (extra != null ? ' -> ' + extra : ''));
  if (c) oks++; else fallos++;
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

// ---- Mercado simulado -----------------------------------------------------
const MERCADO = {
  'comedero antivoracidad perro': { total: 1331, precio: 25900, cat: 'MLA32277', dom: 'MLA-CAT_AND_DOG_DRINKERS_AND_FEEDERS' },
  'juguete dispensador premios perro': { total: 5198, precio: 22000, cat: 'MLA417978', dom: 'MLA-TREAT_DISPENSING_PET_TOYS' },
  'cepillo quita pelos mascotas': { total: 6125, precio: 12500, cat: 'MLA81645', dom: 'MLA-PET_BRUSHES', full: true }
};
const TRENDS = {
  MLA32277: ['dispensador comida automatico perro', 'comedero antivoracidad perro grande', 'comederos para perros'],
  MLA417978: ['lickimat', 'juguete dispensador perro'],
  MLA81645: ['cepillo quita pelusas para ropa']
};
let llamadas = { apify: 0, apifyRuns: 0, prohibidas: 0, supaPost: [], meli: 0, conDominio: 0, sinDominio: 0 };
// ---- Supabase en memoria (tablas nuevas) ---------------------------------
const TABLAS = { buscador_vendidos: [], apify_gasto: [], buscador_sin_ofertas: [], buscador_busquedas: [] };
let secuencia = 1;
function filtrar(filas, u) {
  const qs = new URL(u).searchParams;
  let out = filas.slice();
  for (const [k, v] of qs.entries()) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const m = /^(eq|neq|gte|in)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, val] = m;
    if (op === 'eq') out = out.filter(f => String(f[k]) === val);
    if (op === 'neq') out = out.filter(f => String(f[k]) !== val);
    if (op === 'gte') out = out.filter(f => String(f[k] || '') >= val);
    if (op === 'in') { const lista = val.slice(1, -1).split(',').map(x => x.replace(/^"|"$/g, '')); out = out.filter(f => lista.includes(String(f[k]))); }
  }
  const ord = qs.get('order');
  if (ord) { const [c, dir] = ord.split('.'); out.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
  return out;
}
function tabla(u, metodo, cuerpo) {
  const nombre = (/\/rest\/v1\/([a-z_]+)/.exec(u) || [])[1];
  const t = TABLAS[nombre];
  if (metodo === 'POST') {
    const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
    const creadas = filas.map(f => {
      const pk = nombre === 'buscador_sin_ofertas' ? 'producto_id' : null;
      if (pk) { const ya = t.find(x => x[pk] === f[pk]); if (ya) { Object.assign(ya, f); return ya; } }
      const nueva = Object.assign({ id: secuencia++, creado: new Date().toISOString() }, f);
      t.push(nueva); return nueva;
    });
    return json(creadas, 201);
  }
  if (metodo === 'PATCH') { filtrar(t, u).forEach(f => Object.assign(f, cuerpo)); return new Response(null, { status: 204 }); }
  return json(filtrar(t, u));
}
// ---- Apify simulado ----------------------------------------------------------
const CORRIDAS = {};
let usoApify = 0.5;   // USD ya usados en el ciclo
let cacheNicho = {};
let listaGuardada = [];
let tokensCorrida = new Set(['token-de-corrida-de-prueba-0123456789']);

function qDe(u) { return decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || [])[1] || '').replace(/\+/g, ' '); }

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const metodo = (init && init.method) || 'GET';
  if (u.includes('apify.com')) {
    llamadas.apify++;
    if (u.includes('/users/me/limits')) return json({ data: { current: { monthlyUsageUsd: usoApify }, limits: { maxMonthlyUsageUsd: 5 } } });
    if (u.includes('/users/me')) return json({ data: { username: 'prueba', plan: { id: 'FREE' } } });
    if (/\/acts\/[^/]+\/runs/.test(u) && metodo === 'POST') {
      llamadas.apifyRuns++;
      const input = JSON.parse(init.body);
      const id = 'run' + llamadas.apifyRuns;
      CORRIDAS[id] = { input, ds: 'ds' + llamadas.apifyRuns };
      return json({ data: { id, defaultDatasetId: CORRIDAS[id].ds, status: 'READY' } }, 201);
    }
    const mr = /\/actor-runs\/(run\d+)/.exec(u);
    if (mr) {
      const c = CORRIDAS[mr[1]];
      const n = String(c.input.productIds || '').split(',').filter(Boolean).length;
      return json({ data: { id: mr[1], status: 'SUCCEEDED', defaultDatasetId: c.ds, startedAt: 'x', usageTotalUsd: 0.04 + n * 0.004, stats: {} } });
    }
    const md = /\/datasets\/(ds\d+)\/items/.exec(u);
    if (md) {
      const c = Object.values(CORRIDAS).find(x => x.ds === md[1]);
      const ids = String(c.input.productIds || '').split(',').filter(Boolean);
      const semana = Number(md[1].slice(2));   // la 2.a corrida "vendio" mas
      return json(ids.map((id, k) => ({ item_id: id, name: 'item ' + k, price: 20000,
        sold_quantity_text: '+' + (semana > 1 ? 250 : 100) + ' vendidos', reviews_count: 10 + (semana > 1 ? 4 : 0) * (k + 1), reviews_rating: 4.6 })));
    }
    if (/\/datasets\/ds\d+$/.test(u.split('?')[0])) return json({ data: { itemCount: 1 } });
    return json({}, 404);
  }
  if (u.includes('dolarapi')) return json({ compra: 1480, venta: 1500, casa: 'bolsa' });
  if (u.includes('supabase.co')) {
    if (u.includes('/buscador_job_tokens')) {
      const t = decodeURIComponent((/token=eq\.([^&]*)/.exec(u) || [])[1] || '');
      return json(tokensCorrida.has(t) ? [{ token: t }] : []);
    }
    if (u.includes('/buscador_cache')) {
      if (metodo === 'POST') { const b = JSON.parse(init.body); llamadas.supaPost.push(b.nicho); cacheNicho[b.nicho] = b; return new Response('', { status: 201 }); }
      if (/select=nicho,created_at,v:/.test(u)) return json(Object.values(cacheNicho).map(f => ({ nicho: f.nicho, created_at: f.created_at, v: f.mercado.__v })));
      const n = decodeURIComponent((/nicho=eq\.([^&]*)/.exec(u) || [])[1] || '');
      return json(cacheNicho[n] ? [cacheNicho[n]] : []);
    }
    if (u.includes('/buscador_lista')) {
      if (metodo === 'POST') { listaGuardada.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }
      return json(listaGuardada.map(x => ({ producto_key: x.producto_key, producto: x.producto, nicho: x.nicho })));
    }
    if (/\/rest\/v1\/(buscador_vendidos|apify_gasto|buscador_sin_ofertas|buscador_busquedas)/.test(u)) return tabla(u, metodo, init && init.body ? JSON.parse(init.body) : null);
    if (u.includes('/meli_tokens')) return json([{ access_token: 'tok', refresh_token: 'r', expires_at: new Date(Date.now() + 3600e3).toISOString() }]);
    if (metodo !== 'GET') return new Response('', { status: 201 });
    return json([]);
  }
  if (u.includes('api.mercadolibre.com')) llamadas.meli++;
  if (/\/sites\/MLA\/search|\/highlights\/|\/items\/MLA|\/items\?ids|\/reviews\/|\/visits\//.test(u)) { llamadas.prohibidas++; return json({ error: 'forbidden' }, 403); }
  if (u.includes('/sites/MLA/listing_prices')) return json([{ listing_type_id: 'gold_special', sale_fee_details: { percentage_fee: 16.5, fixed_fee: 0 } }]);
  const mt = /\/trends\/MLA\/(MLA\d+)/.exec(u);
  if (mt) return json((TRENDS[mt[1]] || []).map(k => ({ keyword: k })));
  const mc = /\/categories\/(MLA\d+)/.exec(u);
  if (mc) return json({ id: mc[1], name: mc[1] === 'MLA32277' ? 'Comederos' : 'Categoria ' + mc[1], total_items_in_this_category: 46943 });
  const mu = /\/users\/(\d+)/.exec(u);
  if (mu) {
    const id = Number(mu[1]);
    return json({ id, seller_reputation: { level_id: '5_green', power_seller_status: id % 3 === 0 ? 'platinum' : (id % 3 === 1 ? 'gold' : null), transactions: { total: 5000, completed: 4800 } } });
  }
  if (u.includes('/products/search')) {
    const q = qDe(u), m = MERCADO[q];
    const off = Number((/offset=(\d+)/.exec(u) || [])[1] || 0);
    const dom = decodeURIComponent((/[?&]domain_id=([^&]*)/.exec(u) || [])[1] || '');
    if (dom) llamadas.conDominio++; else llamadas.sinDominio++;
    // Con domain_id, MeLi solo devuelve productos de ese dominio.
    if (!m || off > 0 || (dom && dom !== m.dom)) return json({ paging: { total: m && !(dom && dom !== m.dom) ? m.total : 0 }, results: [] });
    return json({ paging: { total: m.total }, results: Array.from({ length: 10 }, (_, k) => ({ id: 'MLA' + (90000 + k) + String(Object.keys(MERCADO).indexOf(q)).padStart(2, '0'), name: q + ' modelo ' + k, domain_id: m.dom })) });
  }
  const mi = /\/products\/(MLA\d+)\/items/.exec(u);
  if (mi) {
    const q = Object.keys(MERCADO)[Number(mi[1].slice(-2))];
    const k = Number(mi[1].slice(3, 8)) - 90000;
    if (!q || k % 3 === 2) return json({ message: 'not found' }, 404);   // algunos sin ofertas
    const m = MERCADO[q];
    return json({ results: Array.from({ length: 3 }, (_, j) => ({
      item_id: 'MLA' + (3000000000 + k * 10 + j), price: Math.round(m.precio * (0.85 + ((k + j) % 6) * 0.06)),
      seller_id: 1000 + ((k + j) % 7), category_id: m.cat, official_store_id: j === 0 && k === 0 ? 55 : null,
      shipping: { free_shipping: j === 0, logistic_type: m.full && j < 2 ? 'fulfillment' : 'cross_docking' }
    })) });
  }
  return json({}, 404);
};

const MC = (await import('../margen-core.js')).default;
const op = await import('../api/_oportunidad.js');
const pre = await import('../api/_precalculo.js');
const { emitirToken } = await import('../api/_sesion.js');
const handler = (await import('../api/analyze.js')).default;

function llamar(body, headers, metodo, url) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; }, json(o) { resolve({ status: this.statusCode, body: o }); return this; }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: metodo || 'POST', url: url || '/api/analyze', headers: headers || {}, body }, res);
  });
}

console.log('== 1. margen-core = la cuenta de MargenClear ==');
{
  function vieja(precio, costo, g, envio, empaque) {
    const comTot = g.base * (1 + g.iva / 100) + g.cuotas;
    const com = precio * comTot / 100, iibb = precio * g.iibb / 100, perc = precio * g.perc / 100, otros = precio * g.otros / 100;
    const tot = costo + com + iibb + perc + otros + envio + empaque;
    const dev = precio * g.dev / 100 * 0.3;
    const neta = precio - tot - dev;
    const real = neta - (neta > 0 ? neta * g.gan / 100 : 0);
    return { real, margen: real / precio * 100 };
  }
  const g = { base: 13.5, iva: 21, cuotas: 5.5, iibb: 3, perc: 1, otros: 0.5, dev: 2, gan: 35 };
  const a = vieja(45000, 12000, g, 1500, 800);
  const b = MC.calcularUnidad({ precio: 45000, costo: 12000, comisionBasePct: 13.5, ivaComisionPct: 21, cargoCuotasPct: 5.5,
    iibbPct: 3, percAfipPct: 1, otrosVarPct: 0.5, envio: 1500, empaque: 800, devolucionesPct: 2, impGananciasPct: 35 });
  chequear('misma ganancia real que la formula vieja', Math.abs(a.real - b.ganReal) < 1e-6, Math.round(b.ganReal));
  chequear('mismo margen %', Math.abs(a.margen - b.margenPct) < 1e-9);
}

console.log('== 2. Veredicto coherente y pesos ==');
{
  const dem = { valor: 90, detalle: '' }, rot = { valor: 90, detalle: '' }, sat = { valor: 10, detalle: '' }, ries = { valor: 100, detalle: '' };
  // (la rotacion pendiente se prueba en la seccion 15)
  for (const pct of [5, 14.9, 15, 29.9, 30, 45]) {
    const ev = op.evaluar({ margenPct: pct, demanda: dem, rotacion: rot, saturacion: sat, riesgo: ries, riesgoTolerancia: 'medio' });
    chequear('margen ' + pct + '% -> ' + ev.veredicto.label + ' / ' + ev.semaforo.label,
      (pct < 30 ? ev.veredicto.nivel !== 'alta' : true) && (pct < 15 ? ev.veredicto.nivel === 'baja' && ev.semaforo.color === 'rojo' : true));
  }
  const p = op.PESOS.medio;
  chequear('demanda + rotacion + saturacion = 70%', p.demanda + p.rotacion + p.saturacion === 70);
  chequear('margen 20%, riesgo 10%', p.margen === 20 && p.riesgo === 10);
  const satAlta = op.evaluar({ margenPct: 40, demanda: dem, rotacion: rot, saturacion: { valor: 80, detalle: '' }, riesgo: ries, riesgoTolerancia: 'medio' });
  chequear('saturacion alta nunca es "alta"', satAlta.veredicto.nivel !== 'alta', satAlta.veredicto.motivos.join(' '));
  const demBaja = op.evaluar({ margenPct: 40, demanda: { valor: 30, detalle: '' }, rotacion: rot, saturacion: sat, riesgo: ries, riesgoTolerancia: 'medio' });
  chequear('demanda baja nunca es "alta"', demBaja.veredicto.nivel !== 'alta');
  const rotBaja = op.evaluar({ margenPct: 40, demanda: dem, rotacion: { valor: 20, nivel: 'Baja', numero: '≥ 14 vendidos', detalle: '' }, saturacion: sat, riesgo: ries, riesgoTolerancia: 'medio' });
  chequear('rotacion medida baja nunca es "alta" y lo dice', rotBaja.veredicto.nivel !== 'alta' && rotBaja.veredicto.motivos.some(m => /Rotación baja/.test(m)), rotBaja.veredicto.motivos.join(' '));
}

console.log('== 3. Saturacion relativa a la demanda ==');
{
  const c = { totalCatalogo: 5000, muestra: 20, vendedoresDistintos: 12, top10: 10, vendedoresTop10: 6, pctFull: 20, pctOficiales: 0 };
  const conDemanda = op.puntajeSaturacion(c, 90), sinDemanda = op.puntajeSaturacion(c, 30);
  chequear('misma oferta: con demanda alta satura menos', conDemanda.valor < sinDemanda.valor, conDemanda.valor + ' < ' + sinDemanda.valor);
  chequear('tiene numero y como se calcula', !!conDemanda.numero && /demanda/.test(conDemanda.como));
}

console.log('== 4. Tendencias: coincidencia estricta ==');
{
  chequear('"cepillo quita pelos" NO coincide con "cepillo quita pelusas para ropa"', !pre.posicionEnTendencias('cepillo quita pelos mascotas', TRENDS.MLA1));
  const t = pre.posicionEnTendencias('juguete dispensador premios perro', TRENDS.MLA417978);
  chequear('"juguete dispensador premios perro" coincide (#2)', t && t.posicion === 2 && t.tipo === 'exacto', JSON.stringify(t));
  chequear('"collar led" NO coincide con "collar traductor para perro"', !pre.posicionEnTendencias('collar led perro recargable', ['collar traductor para perro']));
  chequear('busquedas con marca no cuentan', !pre.posicionEnTendencias('aro luz celular clip', ['aro de luz gadnic']));
  const g = pre.posicionEnTendencias('comedero antivoracidad perro', ['comederos para perros']);
  chequear('la busqueda general del rubro cuenta como generica', g && g.tipo === 'generico', JSON.stringify(g));
}

console.log('== 5. Certificaciones ==');
{
  const cert = p => op.certificaciones(p, 'x').map(c => c.codigo).join(',');
  chequear('enchufe wifi -> ENACOM', /enacom/.test(cert({ nombre: 'Enchufe inteligente WiFi', q: 'enchufe inteligente wifi' })));
  chequear('juguete en mascotas NO es certificacion de juguetes',
    op.certificaciones({ nombre: 'Juguete de plumas para gato', q: 'juguete gato plumas varita' }, 'mascotas').length === 0);
}

console.log('== 6. Pre-analisis: autorizacion ==');
{
  const sin = await llamar(undefined, {}, 'GET', '/api/analyze?precalcular=tanda&solo=mascotas');
  chequear('sin credencial -> 401', sin.status === 401);
  const malo = await llamar(undefined, {}, 'GET', '/api/analyze?precalcular=tanda&run=token-trucho-0123456789012345');
  chequear('token de corrida inexistente -> 401', malo.status === 401);
}

console.log('== 7. Pre-analisis: tanda de Mascotas con CRON_SECRET (+ rotacion con Apify) ==');
const cron = { authorization: 'Bearer cron-de-prueba', 'user-agent': 'vercel-cron/1.0' };
const t1 = await llamar(undefined, cron, 'GET', '/api/analyze?precalcular=tanda&solo=mascotas');
chequear('responde 200', t1.status === 200, t1.status + ' ' + JSON.stringify(t1.body).slice(0, 160));
chequear('proceso mascotas', t1.body.procesados && t1.body.procesados[0] && t1.body.procesados[0].nicho === 'mascotas');
chequear('guardo el cache', llamadas.supaPost.includes('mascotas'));
chequear('informa llamadas por endpoint', t1.body.llamadas > 0 && t1.body.porEndpoint['products/items'] > 0, t1.body.llamadas + ' llamadas');
chequear('ya no pide /users (el proxy de MercadoLider se saco)', !t1.body.porEndpoint['users']);
chequear('cero llamadas a endpoints que dan 403', llamadas.prohibidas === 0, llamadas.prohibidas);
chequear('anoto los 404 para saltearlos 30 dias', TABLAS.buscador_sin_ofertas.length > 0, TABLAS.buscador_sin_ofertas.length);
const enc = t1.body.procesados[0].rotacionEncolada;
chequear('encolo el top 3 del nicho para rotacion', enc && enc.encolados === 3, JSON.stringify(enc));
chequear('UNA corrida de Apify para toda la cola', llamadas.apifyRuns === 1, llamadas.apifyRuns);
const input1 = CORRIDAS.run1 && CORRIDAS.run1.input;
chequear('por productIds, enriquecida, sin busqueda por termino', input1 && input1.productIds && input1.enrichDetailPage === true && !input1.queries,
  input1 && input1.productIds.split(',').length + ' publicaciones');
chequear('anoto la reserva en apify_gasto con origen propio', TABLAS.apify_gasto.some(g => g.origen === 'buscador:rotacion' && g.estado === 'arrancada'));
chequear('quedan corridas por cosechar -> el cron encadena', t1.body.pendientes > 0 && t1.body.encadenada === true);
const t2 = await llamar(undefined, cron, 'GET', '/api/analyze?precalcular=tanda&solo=mascotas');
chequear('segunda tanda: nicho fresco no se rehace', t2.body.procesados.length === 0);
chequear('cosecho los vendidos', t2.body.rotacion.cosecha && t2.body.rotacion.cosecha.cosechadas === 3, JSON.stringify(t2.body.rotacion.cosecha && t2.body.rotacion.cosecha.costos));
const cos = TABLAS.buscador_vendidos.filter(f => f.estado === 'cosechada');
chequear('guardo vendidos (piso del rango), reseñas, fecha y costo real por producto',
  cos.length === 3 && cos.every(f => f.vendidos_total > 0 && f.reviews_total > 0 && f.medido_en && f.costo_usd > 0),
  cos.map(f => f.vendidos_total + ' vend / USD ' + f.costo_usd).join(', '));
chequear('sin pendientes al final', t2.body.pendientes === 0);

console.log('== 8. /api/analyze sin sesion: datos del pre-analisis ==');
const perfilBajo = { nicho: 'mascotas', capital: 'bajo', experiencia: 'ninguna', canal: 'mercadolibre', riesgo: 'bajo', user_id: '' };
const meliAntes = llamadas.meli, apifyAntes = llamadas.apifyRuns;
const r1 = await llamar(perfilBajo, {});
if (process.env.BUSCADOR_DUMP) (await import('node:fs')).writeFileSync(process.env.BUSCADOR_DUMP, JSON.stringify(r1.body));
chequear('responde 200 sin sesion ni MeLi', r1.status === 200);
chequear('no consulta MeLi ni Apify (sale del cache)', llamadas.meli === meliAntes && llamadas.apifyRuns === apifyAntes && r1.body.desdeCache === true);
chequear('registra la busqueda (prioridad nocturna)', TABLAS.buscador_busquedas.some(b => b.nicho === 'mascotas'));
const prods = r1.body.products || [];
chequear('solo productos con datos como tarjeta', prods.length > 0 && prods.every(p => !p.sinDatos && p.metricas), prods.length);
chequear('el resto va a pendientes (solo nombre y links)', (r1.body.pendientes || []).length > 0 &&
  r1.body.pendientes.every(x => x.nombre && x.links && x.links.meli && x.score === undefined), (r1.body.pendientes || []).length);
chequear('limite gratis: 3 tarjetas como mucho', prods.length <= 3);
const comedero = prods.find(p => p.query === 'comedero antivoracidad perro') ||
  (await llamar({ ...perfilBajo }, { authorization: 'Bearer ' + emitirToken({ user: 'u1', role: 'admin' }) })).body.products.find(p => p.query === 'comedero antivoracidad perro');
chequear('el comedero tiene datos', !!comedero);
if (comedero) {
  const M = comedero.metricas;
  ['demanda', 'rotacion', 'saturacion'].forEach(k => {
    const m = M[k];
    chequear(k + ': nivel + numero + como', m && /Alta|Media|Baja/.test(m.nivel) && m.numero && m.numero !== '—' && m.como && m.como.length > 40, m && (m.nivel + ' · ' + m.numero));
  });
  chequear('demanda por tendencia de la categoria', /#\d+ de \d+/.test(M.demanda.numero), M.demanda.detalle);
  chequear('rotacion: vendidos reales acumulados (1 medicion)', /vendidos/.test(M.rotacion.numero) && /segunda medición/.test(M.rotacion.detalle), M.rotacion.detalle);
  const pesoTop = comedero.componentes.filter(c => ['demanda', 'rotacion', 'saturacion'].includes(c.clave)).reduce((a, c) => a + c.peso, 0);
  const total = comedero.componentes.reduce((a, c) => a + c.peso, 0);
  chequear('en el score, las 3 metricas pesan ~70%', Math.abs(pesoTop / total - 0.7) < 0.06, Math.round(pesoTop / total * 100) + '%');
  chequear('un solo margen (neto sobre precio)', comedero.margen === comedero.margenNeto.pct);
  chequear('costo maritimo: volumen y logistica en la respuesta', comedero.costo.volCm3 === 2500 && comedero.costo.logisticaUSD > 0 && comedero.costo.derechosUSD > 0,
    'vol ' + comedero.costo.volCm3 + ' cm3, log USD ' + comedero.costo.logisticaUSD + ', costo USD ' + comedero.costo.costoUSD);
  chequear('link publicacion armado', /^https:\/\/articulo\.mercadolibre\.com\.ar\/MLA-\d+-_JM$/.test(comedero.links.publicacion || ''), comedero.links.publicacion);
}
chequear('TOP PICK nunca es un "no conviene"', prods.filter(p => p.topPick).every(p => p.veredicto.nivel !== 'baja'));

console.log('== 14. Rotacion: segunda medicion -> ventas por mes ==');
{
  // La primera medicion pasa a ser de hace 7 dias y se vuelve a analizar el nicho.
  const hace7 = new Date(Date.now() - 7 * 86400e3).toISOString();
  TABLAS.buscador_vendidos.forEach(f => { f.creado = hace7; f.medido_en = hace7; });
  const corte = new Date(Date.now() + 1000).toISOString();
  const t3 = await llamar(undefined, cron, 'GET', '/api/analyze?precalcular=tanda&solo=mascotas&antes=' + encodeURIComponent(corte));
  chequear('re-encola los mismos 3 (pasaron mas de 6 dias)', t3.body.procesados[0] && t3.body.procesados[0].rotacionEncolada.encolados === 3);
  chequear('segunda corrida de Apify', llamadas.apifyRuns === 2);
  await llamar(undefined, cron, 'GET', '/api/analyze?precalcular=tanda&solo=mascotas');
  const r = await llamar(undefined, {}, 'GET', '/api/analyze?nicho=mascotas&capital=premium&experiencia=alta&canal=mercadolibre&riesgo=medio');
  const p = r.body.products.find(x => x.metricas && x.metricas.rotacion && /ventas\/mes/.test(x.metricas.rotacion.numero));
  chequear('rotacion = ventas por mes entre dos mediciones', !!p, p && p.metricas.rotacion.detalle);
  if (p) chequear('usa reseñas exactas x vendidos/reseña (los rangos casi no se mueven)', /reseñas/.test(p.metricas.rotacion.como));
  const v = op.ventasEntreMediciones(
    { medido_en: '2026-10-27T00:00:00Z', items: [{ id: 'A', vendidos: 100, reviews: 14 }] },
    { medido_en: '2026-10-20T00:00:00Z', items: [{ id: 'A', vendidos: 100, reviews: 10 }] });
  chequear('cuenta: 4 reseñas x (100/14) en 7 dias = ~122/mes', v && v.ventasMes === Math.round(4 * (100 / 14) / 7 * 30), v && v.ventasMes);
}

console.log('== 15. Rotacion: tope mensual de USD ==');
{
  const rot = await import('../api/_rotacion.js');
  usoApify = 4.99;   // casi todo el presupuesto de USD 5 usado
  TABLAS.buscador_vendidos.push({ id: secuencia++, query: 'producto de prueba tope', nicho: 'x', estado: 'en_cola', item_ids: ['MLA1', 'MLA2'], creado: new Date().toISOString() });
  const antesRuns = llamadas.apifyRuns;
  const r = await rot.arrancarCola({ repartir: false });
  chequear('no arranca corrida', !r.arrancada && llamadas.apifyRuns === antesRuns, r.motivo);
  const fila = TABLAS.buscador_vendidos.find(f => f.query === 'producto de prueba tope');
  chequear('marca el producto sin presupuesto', fila.estado === 'sin_presupuesto', fila.motivo);
  const h = await rot.historialDe(['producto de prueba tope']);
  const m = op.puntajeRotacion(h['producto de prueba tope']);
  chequear('la tarjeta dice "pendiente (tope mensual alcanzado)"', m.valor == null && m.pendiente === 'tope mensual alcanzado', m.detalle);
  const ev = op.evaluar({ margenPct: 45, demanda: { valor: 90, detalle: '' }, rotacion: m, saturacion: { valor: 10, detalle: '' }, riesgo: { valor: 100, detalle: '' }, riesgoTolerancia: 'medio' });
  chequear('rotacion pendiente nunca es "Oportunidad alta"', ev.veredicto.nivel !== 'alta', ev.veredicto.motivos.join(' '));
  usoApify = 0.5;
}

console.log('== 16. Agenda: 10 nichos por noche, prioridad a los buscados ==');
{
  const { agendaDeNichos } = await import('../api/analyze.js');
  const ahora = Date.now(), dia = 86400e3;
  const claves = ['a', 'b', 'c', 'd', 'e'];
  const v = (await import('../api/_precalculo.js')).VERSION_MERCADO;
  const fechas = {
    a: { creado: new Date(ahora - 2 * dia).toISOString(), v },   // fresco
    b: { creado: new Date(ahora - 4 * dia).toISOString(), v },   // 4 dias, buscado
    c: { creado: new Date(ahora - 8 * dia).toISOString(), v },   // vencido
    d: { creado: new Date(ahora - 5 * dia).toISOString(), v }    // 5 dias, no buscado
  };
  const cola = agendaDeNichos(claves, fechas, { b: 3 }, { ahora });
  chequear('primero el buscado (aunque tenga 4 dias)', cola[0] === 'b', cola.join(','));
  chequear('despues los vencidos (sin datos primero)', cola[1] === 'e' && cola[2] === 'c', cola.join(','));
  chequear('no rehace los frescos ni los de 5 dias sin busquedas', cola.indexOf('a') < 0 && cola.indexOf('d') < 0);
}

console.log('== 17. 404: no se repiten durante 30 dias ==');
{
  const sin = TABLAS.buscador_sin_ofertas.map(f => f.producto_id);
  const ya = await pre.conocidosSinOfertas(sin.slice(0, 3).concat(['MLA-nuevo']));
  chequear('los conoce', ya.size === 3 && !ya.has('MLA-nuevo'));
  TABLAS.buscador_sin_ofertas.forEach(f => { f.visto = new Date(Date.now() - 31 * 86400e3).toISOString(); });
  const vencidos = await pre.conocidosSinOfertas(sin.slice(0, 3));
  chequear('a los 30 dias se vuelven a probar', vencidos.size === 0);
}

console.log('== 18. Flete maritimo consolidado y tributos aparte ==');
{
  const c = MC.costoImportacion({ fobUSD: 2.75, volCm3: 2500, fleteUsdM3: 450, diPct: 20, usdArs: 1500 });
  chequear('logistica = 2.500 cm3 x USD 450/m3 = USD 1,13', c.logisticaUSD === 1.13, c.logisticaUSD);
  chequear('costo = FOB + logistica + derechos 20% + tasa 3% (sin 1,85)', Math.abs(c.costoUSD - (2.75 + 1.125) * 1.23) < 0.02, c.costoUSD);
  chequear('IVA + IVA adicional como credito, Ganancias + IIBB como pagos a cuenta', c.creditoIvaUSD > 0 && c.pagosACuentaUSD > 0 && Math.abs(c.desembolsoUSD - (c.costoUSD + c.creditoIvaUSD + c.pagosACuentaUSD)) < 0.02);
  const k = op.costoImportacion({ costoMin: 1.5, costoMax: 4, volCm3: 2500 }, 1500, 'juguetes');
  chequear('derecho de importacion por rubro (juguetes 35%)', k.diPct === 35);
}

console.log('== 19. Margen: con menos de 5 precios no se calcula ni entra al score ==');
{
  const ofertas = n => Array.from({ length: n }, (_, j) => ({ id: 'MLA77' + j, title: 'organizador generico ' + j, price: 20000 + j * 500,
    seller: { id: 500 + j }, shipping: { free_shipping: false, logistic_type: 'cross_docking' }, official_store_id: null, category_id: 'MLA1', catalog_product_id: 'MLA9' + j }));
  const prod = { nombre: 'Organizador', q: 'organizador generico', costoMin: 2, costoMax: 3, volCm3: 1000, pesoG: 200 };
  const perfil = { capital: 'medio', experiencia: 'ninguna', canal: 'mercadolibre', riesgo: 'medio' };
  const cuatro = op.evaluarProducto(prod, 'hogar', { results: ofertas(4), catalogoTotal: 300 }, perfil, 1500, null);
  chequear('4 precios: sin margen', cuatro.margen === null && cuatro.margenNeto.pocosPrecios === 4, JSON.stringify(cuatro.margenNeto));
  chequear('4 precios: la tarjeta dice "Margen: pocos precios para calcular (4)"', cuatro.semaforo.label === 'Margen: pocos precios para calcular (4)', cuatro.semaforo.label);
  const cm = cuatro.componentes.find(c => c.clave === 'margen');
  chequear('4 precios: el margen no entra al score (peso efectivo 0)', cm.valor === null && cm.pesoEfectivo === 0 && cuatro.score != null, 'score ' + cuatro.score);
  chequear('4 precios: nunca "alta" y lo dice', cuatro.veredicto.nivel !== 'alta' && cuatro.veredicto.motivos.some(m => /pocos precios/.test(m)), cuatro.veredicto.label);
  const cinco = op.evaluarProducto(prod, 'hogar', { results: ofertas(5), catalogoTotal: 300 }, perfil, 1500, null);
  chequear('5 precios: margen calculado y en el score', typeof cinco.margen === 'number' && cinco.componentes.find(c => c.clave === 'margen').pesoEfectivo > 0, cinco.margen + '%');
  const ev = op.evaluar({ margenPct: null, pocosPrecios: 3, demanda: { valor: 90, detalle: '' }, rotacion: { valor: 90, detalle: '' },
    saturacion: { valor: 10, detalle: '' }, riesgo: { valor: 100, detalle: '' }, riesgoTolerancia: 'medio' });
  chequear('metricas perfectas sin margen: score sin margen y nunca "alta"', ev.score >= 70 && ev.veredicto.nivel === 'media', ev.score + ' ' + ev.veredicto.nivel);
}

console.log('== 20. Categoria de MeLi fijada a mano por producto ==');
{
  const fuente = (await import('node:fs')).readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
  chequear('gel limpiador de teclado: Kits de Limpieza (MLA72688), no Desmaquillantes', (await import('../api/_categorias-datos.js')).CATEGORIAS['gel limpiador teclado reutilizable'].cat === 'MLA72688');
  const cli = pre.crearCliente('tok-prueba');
  const bien = await pre.analizarProducto(cli, { q: 'comedero antivoracidad perro', cat: 'MLA32277' });
  chequear('con la categoria correcta: ofertas y demanda de esa categoria', bien.results.length > 0 && bien.results.every(o => o.category_id === 'MLA32277') && bien.categoria && bien.categoria.id === 'MLA32277');
  const otra = await pre.analizarProducto(cli, { q: 'comedero antivoracidad perro', cat: 'MLA999999' });
  chequear('ofertas de otra categoria se descartan (va a Pendientes)', otra.results.length === 0, otra.results.length);
}

console.log('== 21. Categoria y dominio fijados para todo el catalogo; busqueda filtrada ==');
{
  const { CATEGORIAS } = await import('../api/_categorias-datos.js');
  const fuente = (await import('node:fs')).readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
  const qs = [...fuente.matchAll(/q:'([^']+)'/g)].map(m => m[1]);
  const faltan = qs.filter(q => !CATEGORIAS[q]);
  chequear('los 780 productos de los 65 nichos tienen categoria o estan marcados para revision', qs.length === 780 && faltan.length === 0, qs.length + ' productos, faltan ' + faltan.length);
  const fijas = Object.values(CATEGORIAS).filter(c => c.cat);
  chequear('cada categoria fijada tiene id y dominio de MeLi', fijas.every(c => /^MLA\d+$/.test(c.cat) && /^MLA-[A-Z0-9_]+$/.test(c.dom)), fijas.length + ' fijadas');
  chequear('las dudosas quedan para revision, sin categoria inventada', Object.values(CATEGORIAS).filter(c => c.revisar).every(c => !c.cat));
  const cat = await import('../api/_categorias.js');
  chequear('categoriaDe usa el archivo (gel de teclado -> kits de limpieza de computadoras)', cat.categoriaDe({ q: 'gel limpiador teclado reutilizable' }).dom === 'MLA-COMPUTER_CLEANING_KITS');
  const cli = pre.crearCliente('tok-prueba');
  const antes = llamadas.conDominio;
  const r = await pre.analizarProducto(cli, { q: 'comedero antivoracidad perro' });
  chequear('/products/search se pide con domain_id del producto', llamadas.conDominio > antes && r.results.length > 0 && r.categoria.id === 'MLA32277');
  const largo = await pre.analizarProducto(cli, { q: 'comedero antivoracidad perro grande', cat: 'MLA32277', dom: 'MLA-CAT_AND_DOG_DRINKERS_AND_FEEDERS' });
  chequear('dentro del dominio, si no trae nada se sacan palabras del final', largo && largo.results.length > 0, largo && largo.results.length);
  const ajeno = await pre.analizarProducto(cli, { q: 'comedero antivoracidad perro', cat: 'MLA32277', dom: 'MLA-OTRO_DOMINIO' });
  chequear('un dominio que no corresponde no trae productos de otro rubro', !ajeno || ajeno.results.length === 0);
}

console.log('== 9. Nicho sin pre-analisis ni MeLi: nada inventado ==');
{
  const r = await llamar({ ...perfilBajo, nicho: 'tecnologia' }, {});
  chequear('0 tarjetas', r.body.products.length === 0 && r.body.conDatoReal === 0);
  chequear('sin TOP PICK', r.body.products.every(p => !p.topPick));
}

console.log('== 10. Capital: pedido de prueba de 50 u y riesgo ==');
{
  // FOB 2-3 USD (MOQ tipico 200) y 3.000 cm3: el desembolso por unidad (con IVA
  // y percepciones) es ~USD 7, asi que 200 u no entran en USD 1.200 y 50 si.
  const prod = { nombre: 'Organizador', q: 'organizador prueba', costoMin: 2, costoMax: 3, pesoG: 300, volCm3: 3000 };
  const ofertas = Array.from({ length: 12 }, (_, k) => ({ id: 'MLA' + (5000 + k), title: 'organizador prueba', price: 25000 + k * 500,
    seller: { id: k % 6 }, shipping: { logistic_type: 'cross_docking' }, official_store_id: null }));
  const merc = { results: ofertas, catalogoTotal: 900, catalogoRevisados: 10, conOfertas: 5, comision: { porcentaje: 14, cargoFijo: 0 },
    tendencia: { keyword: 'organizador prueba', posicion: 3, total: 20, tipo: 'exacto' }, categoria: { nombre: 'Org', tendenciasRevisadas: 20 } };
  const hist = { ultimo: { estado: 'cosechada' }, cosechadas: [{ vendidos_total: 1200, items: [{}, {}], medido_en: new Date().toISOString() }] };
  const pf = { capital: 'bajo', experiencia: 'ninguna', canal: 'mercadolibre', riesgo: 'medio' };
  const r = op.evaluarProducto(prod, 'hogar', merc, pf, 1500, hist);
  chequear('MOQ no entra pero la prueba de 50 u si', r.capacidad.escenario === 'prueba',
    'MOQ ' + r.capacidad.moq + ' = USD ' + r.capacidad.inversionMoqUSD + ' / prueba USD ' + r.capacidad.prueba.inversionUSD);
  chequear('si no entra el MOQ, el riesgo no es "Bajo"', r.riesgo !== 'Bajo', r.riesgo);
  const ok = op.evaluarProducto(prod, 'hogar', merc, { ...pf, capital: 'premium' }, 1500, hist);
  chequear('con capital suficiente el riesgo es Bajo', ok.riesgo === 'Bajo');
  chequear('el capital cambia el score', ok.score > r.score, ok.score + ' > ' + r.score);
  const sinMuestra = op.evaluarProducto(prod, 'hogar', { ...merc, results: ofertas.slice(0, 2) }, pf, 1500, hist);
  chequear('menos de 3 ofertas -> sinDatos (pendiente, sin tarjeta)', sinMuestra.sinDatos === true);
}

console.log('== 11. Marcas fuera de la muestra ==');
{
  const m = op.limpiarMuestra([{ title: 'Comedero Xiaomi', price: 100 }, { title: 'Comedero lento', price: 100 }, { title: 'Comedero Disney Stitch', price: 100 }]);
  chequear('saca marca y licencia', m.length === 1);
}

console.log('== 12. Mi lista ==');
{
  const admin = { authorization: 'Bearer ' + emitirToken({ user: 'u1', role: 'admin' }) };
  const sin = await llamar({ accion: 'lista_guardar', key: 'mascotas::x', producto: { nombre: 'x' } }, {});
  chequear('sin sesion -> 401 (el front usa localStorage)', sin.status === 401 && sin.body.requiereSesion);
  const ok = await llamar({ accion: 'lista_guardar', key: 'mascotas::comedero', nicho: 'mascotas', producto: { nombre: 'Comedero' } }, admin);
  chequear('con sesion guarda', ok.status === 200 && listaGuardada.length === 1);
}

console.log('== 13. GET ?nicho= (solo cache, nunca MeLi) ==');
{
  const antes = llamadas.meli;
  const g = await llamar(undefined, {}, 'GET', '/api/analyze?nicho=mascotas&capital=bajo&experiencia=ninguna&canal=mercadolibre&riesgo=bajo');
  chequear('responde con productos del cache', g.status === 200 && g.body.products.length > 0 && g.body.desdeCache);
  chequear('sin llamadas a MeLi', llamadas.meli === antes);
  const sin = await llamar(undefined, {}, 'GET', '/api/analyze?nicho=tecnologia');
  chequear('nicho sin cache: 0 productos y 0 llamadas', sin.body.products.length === 0 && llamadas.meli === antes);
}

console.log('\n' + oks + ' ok, ' + fallos + ' fallas');
process.exit(fallos ? 1 : 0);
