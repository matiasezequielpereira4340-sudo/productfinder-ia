// pruebas/buscador.mjs
// Se corre con: npm run test:buscador
//
// Buscador de oportunidades (/api/analyze) y su pre-analisis nocturno, con
// fetch simulado. El mock replica lo MEDIDO con el token real el 20/10/2026:
// /products/search, /products/{id}/items (404 si no hay ofertas), /trends,
// /categories, /users (sin ventas de 60 dias) y /listing_prices responden;
// /sites/MLA/search, /highlights, /items, /reviews y /visits dan 403.
process.env.SUPABASE_SERVICE_KEY = 'supa-de-prueba';
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
  'comedero antivoracidad perro': { total: 1331, precio: 25900, cat: 'MLA32277' },
  'juguete dispensador premios perro': { total: 5198, precio: 22000, cat: 'MLA417978' },
  'cepillo quita pelos mascotas': { total: 6125, precio: 12500, cat: 'MLA1', full: true }
};
const TRENDS = {
  MLA32277: ['dispensador comida automatico perro', 'comedero antivoracidad perro grande', 'comederos para perros'],
  MLA417978: ['lickimat', 'juguete dispensador perro'],
  MLA1: ['cepillo quita pelusas para ropa']
};
let llamadas = { apify: 0, prohibidas: 0, supaPost: [], meli: 0 };
let cacheNicho = {};
let listaGuardada = [];
let tokensCorrida = new Set(['token-de-corrida-de-prueba-0123456789']);

function qDe(u) { return decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || [])[1] || '').replace(/\+/g, ' '); }

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const metodo = (init && init.method) || 'GET';
  if (u.includes('apify.com')) { llamadas.apify++; return json({}, 500); }
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
    if (!m || off > 0) return json({ paging: { total: m ? m.total : 0 }, results: [] });
    return json({ paging: { total: m.total }, results: Array.from({ length: 10 }, (_, k) => ({ id: 'MLA' + (90000 + k) + String(q.length).padStart(2, '0'), name: q + ' modelo ' + k })) });
  }
  const mi = /\/products\/(MLA\d+)\/items/.exec(u);
  if (mi) {
    const largo = Number(mi[1].slice(-2));
    const q = Object.keys(MERCADO).find(x => x.length === largo);
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

console.log('== 7. Pre-analisis: tanda de Mascotas con CRON_SECRET ==');
const cron = { authorization: 'Bearer cron-de-prueba', 'user-agent': 'vercel-cron/1.0' };
const t1 = await llamar(undefined, cron, 'GET', '/api/analyze?precalcular=tanda&solo=mascotas');
chequear('responde 200', t1.status === 200, t1.status + ' ' + JSON.stringify(t1.body).slice(0, 160));
chequear('proceso mascotas', t1.body.procesados && t1.body.procesados[0] && t1.body.procesados[0].nicho === 'mascotas');
chequear('guardo el cache', llamadas.supaPost.includes('mascotas'));
chequear('informa llamadas por endpoint', t1.body.llamadas > 0 && t1.body.porEndpoint['products/items'] > 0, t1.body.llamadas + ' llamadas');
chequear('cero llamadas a Apify', llamadas.apify === 0);
chequear('cero llamadas a endpoints que dan 403', llamadas.prohibidas === 0, llamadas.prohibidas);
const t2 = await llamar(undefined, cron, 'GET', '/api/analyze?precalcular=tanda&solo=mascotas');
chequear('segunda tanda: el nicho ya esta fresco, no se rehace', t2.body.procesados.length === 0 && t2.body.pendientes === 0);

console.log('== 8. /api/analyze sin sesion: datos del pre-analisis ==');
const perfilBajo = { nicho: 'mascotas', capital: 'bajo', experiencia: 'ninguna', canal: 'mercadolibre', riesgo: 'bajo', user_id: '' };
const meliAntes = llamadas.meli;
const r1 = await llamar(perfilBajo, {});
if (process.env.BUSCADOR_DUMP) (await import('node:fs')).writeFileSync(process.env.BUSCADOR_DUMP, JSON.stringify(r1.body));
chequear('responde 200 sin sesion ni MeLi', r1.status === 200);
chequear('no consulta MeLi (sale del cache)', llamadas.meli === meliAntes && r1.body.desdeCache === true);
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
    chequear(k + ': nivel + numero + como', m && /Alta|Media|Baja/.test(m.nivel) && m.numero && m.numero !== '\u2014' && m.como && m.como.length > 40, m && (m.nivel + ' · ' + m.numero));
  });
  chequear('demanda por tendencia de la categoria', /#\d+ de \d+/.test(M.demanda.numero), M.demanda.detalle);
  chequear('rotacion por MercadoLider (MeLi no da ventas de 60 dias)', /MercadoLíder/.test(M.rotacion.numero), M.rotacion.detalle);
  const pesoTop = comedero.componentes.filter(c => ['demanda', 'rotacion', 'saturacion'].includes(c.clave)).reduce((a, c) => a + c.peso, 0);
  const total = comedero.componentes.reduce((a, c) => a + c.peso, 0);
  chequear('en el score, las 3 metricas pesan ~70%', Math.abs(pesoTop / total - 0.7) < 0.06, Math.round(pesoTop / total * 100) + '%');
  chequear('un solo margen (neto sobre precio)', comedero.margen === comedero.margenNeto.pct);
  chequear('link publicacion armado', /^https:\/\/articulo\.mercadolibre\.com\.ar\/MLA-\d+-_JM$/.test(comedero.links.publicacion || ''), comedero.links.publicacion);
}
chequear('TOP PICK nunca es un "no conviene"', prods.filter(p => p.topPick).every(p => p.veredicto.nivel !== 'baja'));

console.log('== 9. Nicho sin pre-analisis ni MeLi: nada inventado ==');
{
  const r = await llamar({ ...perfilBajo, nicho: 'tecnologia' }, {});
  chequear('0 tarjetas', r.body.products.length === 0 && r.body.conDatoReal === 0);
  chequear('sin TOP PICK', r.body.products.every(p => !p.topPick));
}

console.log('== 10. Capital: pedido de prueba de 50 u y riesgo ==');
{
  const prod = { nombre: 'Medidor láser de distancia', q: 'medidor laser distancia', costoMin: 3, costoMax: 8, pesoG: 150 };
  const ofertas = Array.from({ length: 12 }, (_, k) => ({ id: 'MLA' + (5000 + k), title: 'medidor laser distancia', price: 55000 + k * 1000,
    seller: { id: k % 6 }, shipping: { logistic_type: 'cross_docking' }, official_store_id: null }));
  const merc = { results: ofertas, catalogoTotal: 900, catalogoRevisados: 10, conOfertas: 5, comision: { porcentaje: 14, cargoFijo: 0 },
    tendencia: { keyword: 'medidor laser', posicion: 3, total: 20, tipo: 'exacto' }, categoria: { nombre: 'Medidores', tendenciasRevisadas: 20 },
    vendedores: [{ lider: 'gold', transacciones: 3000 }, { lider: null, transacciones: 200 }] };
  const pf = { capital: 'bajo', experiencia: 'ninguna', canal: 'mercadolibre', riesgo: 'medio' };
  const r = op.evaluarProducto(prod, 'herramientas', merc, pf, 1500);
  chequear('MOQ no entra pero la prueba de 50 u si', r.capacidad.escenario === 'prueba', 'prueba USD ' + r.capacidad.prueba.inversionUSD);
  chequear('si no entra el MOQ, el riesgo no es "Bajo"', r.riesgo !== 'Bajo', r.riesgo);
  const ok = op.evaluarProducto(prod, 'herramientas', merc, { ...pf, capital: 'premium' }, 1500);
  chequear('con capital suficiente el riesgo es Bajo', ok.riesgo === 'Bajo');
  chequear('el capital cambia el score', ok.score > r.score, ok.score + ' > ' + r.score);
  const sinMuestra = op.evaluarProducto(prod, 'herramientas', { ...merc, results: ofertas.slice(0, 2) }, pf, 1500);
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

console.log('\n' + oks + ' ok, ' + fallos + ' fallas');
process.exit(fallos ? 1 : 0);
