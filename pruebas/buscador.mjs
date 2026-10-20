// pruebas/buscador.mjs
// Se corre con: npm run test:buscador
//
// Buscador de oportunidades (/api/analyze), con fetch simulado. Cubre los
// problemas que se vieron en produccion corriendo Mascotas, capital < 3000,
// sin experiencia, riesgo bajo:
//   A. "OPORTUNIDAD ALTA" con "Margen bajo, no conviene" en la misma tarjeta
//   B. tres margenes distintos (markup 222%, neto 40%, "dato real")
//   D. saturacion "Baja" con 1.331 productos y todo "Riesgo: Bajo"
//   E. demanda "Alta" sin ningun numero
//   F. sin links
//   G. el perfil no cambia nada
// y que el barrido NUNCA llame a Apify.
process.env.SUPABASE_SERVICE_KEY = 'supa-de-prueba';
process.env.SESSION_SECRET = 'secreto-de-prueba';

let fallos = 0, oks = 0;
function chequear(n, c, extra) {
  console.log((c ? '  ok    ' : '  FALLA ') + n + (extra != null ? ' -> ' + extra : ''));
  if (c) oks++; else fallos++;
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

// ---- Mercado simulado ----------------------------------------------------
// Precios parecidos a los que hay hoy en busquedas_cache para Mascotas.
function publicaciones(base, n, opts) {
  const o = opts || {};
  return Array.from({ length: n }, (_, k) => ({
    item_id: 'MLA' + (3000000000 + base + k), price: Math.round(base * (0.8 + (k % 7) * 0.07)),
    seller_id: o.unVendedor ? 111 : 1000 + k, category_id: 'MLA1081',
    official_store_id: o.oficiales && k % 2 === 0 ? 55 : null,
    shipping: { free_shipping: k % 3 === 0, logistic_type: o.full && k % 4 !== 0 ? 'fulfillment' : 'xd_drop_off' }
  }));
}
const MERCADO = {
  'comedero antivoracidad perro': { total: 1303, precio: 25900 },
  'cepillo quita pelos mascotas': { total: 4200, precio: 12500, full: true },
  'juguete gato plumas varita': { total: 2618, precio: 3900 }
};
let llamadas = { apify: 0, supaPost: [], listing: 0, trends: 0 };
let cacheNicho = null;
let listaGuardada = [];

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const metodo = (init && init.method) || 'GET';
  if (u.includes('apify.com')) { llamadas.apify++; return json({ error: 'no deberia llamarse' }, 500); }
  if (u.includes('dolarapi')) return json({ compra: 1480, venta: 1500, casa: 'bolsa' });
  if (u.includes('supabase.co')) {
    if (u.includes('/buscador_cache')) {
      if (metodo === 'POST') { llamadas.supaPost.push('buscador_cache'); cacheNicho = { ...JSON.parse(init.body) }; return new Response('', { status: 201 }); }
      return json(cacheNicho ? [cacheNicho] : []);
    }
    if (u.includes('/buscador_lista')) {
      if (metodo === 'POST') { listaGuardada.push(JSON.parse(init.body)); return new Response('', { status: 201 }); }
      if (metodo === 'DELETE') { listaGuardada = []; return new Response('', { status: 204 }); }
      return json(listaGuardada.map(x => ({ producto_key: x.producto_key, producto: x.producto, nicho: x.nicho })));
    }
    if (u.includes('/meli_tokens')) return json([{ access_token: 'tok', refresh_token: 'r', expires_at: new Date(Date.now() + 3600e3).toISOString() }]);
    if (u.includes('/meli_user_aliases')) return json([]);
    if (metodo !== 'GET') return new Response('', { status: 201 });
    return json([]);   // busquedas_cache vacio: se va a la API
  }
  if (u.includes('/sites/MLA/listing_prices')) {
    llamadas.listing++;
    return json([{ listing_type_id: 'gold_special', sale_fee_details: { percentage_fee: 15.5, fixed_fee: 0 } }]);
  }
  if (u.includes('/trends/MLA')) { llamadas.trends++; return json([{ keyword: 'comedero antivoracidad perro grande' }, { keyword: 'cucha perro' }]); }
  if (u.includes('/products/search')) {
    const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || [])[1] || '').replace(/\+/g, ' ');
    const m = MERCADO[q];
    if (!m) return json({ paging: { total: 0 }, results: [] });
    const off = Number((/offset=(\d+)/.exec(u) || [])[1] || 0);
    if (off > 0) return json({ paging: { total: m.total }, results: [] });
    return json({ paging: { total: m.total }, results: Array.from({ length: 8 }, (_, k) => ({ id: 'MLA' + (90000 + k) + q.length, name: q + ' modelo ' + k })) });
  }
  const mi = /\/products\/(MLA\d+)\/items/.exec(u);
  if (mi) {
    // cada producto de catalogo devuelve 3 publicaciones
    const qs = Object.keys(MERCADO).find(q => mi[1].endsWith(String(q.length)));
    const m = MERCADO[qs];
    const k = Number(mi[1].slice(3, 8)) - 90000;
    return json({ results: publicaciones(m.precio + k * 300, 3, { full: m.full }) });
  }
  const mp = /\/products\/(MLA\d+)$/.exec(u);
  if (mp) return json({ id: mp[1], name: Object.keys(MERCADO).find(q => mp[1].endsWith(String(q.length))) || 'x' });
  if (u.includes('domain_discovery')) return json([{ category_id: 'MLA1081', category_name: 'Comederos' }]);
  return json({}, 404);
};

const MC = (await import('../margen-core.js')).default;
const op = await import('../api/_oportunidad.js');
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
  // La formula que tenia margen.html antes de extraerla, copiada tal cual.
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
  chequear('mismo margen %', Math.abs(a.margen - b.margenPct) < 1e-9, b.margenPct.toFixed(2) + '%');
}

console.log('== 2. Veredicto coherente con el margen ==');
{
  const dem = { valor: 90, detalle: '' }, comp = { valor: 95, detalle: '' }, ries = { valor: 100, detalle: '' };
  for (const pct of [5, 14.9, 15, 25, 29.9, 30, 45]) {
    const ev = op.evaluar({ margenPct: pct, demanda: dem, competencia: comp, riesgo: ries, riesgoTolerancia: 'bajo' });
    const alta = ev.veredicto.nivel === 'alta';
    chequear('margen ' + pct + '% -> ' + ev.veredicto.label + ' / ' + ev.semaforo.label,
      (pct < 30 ? !alta : true) && (pct < 15 ? ev.veredicto.nivel === 'baja' && ev.semaforo.color === 'rojo' : true));
  }
  const sinDem = op.evaluar({ margenPct: 40, demanda: { valor: null, detalle: '' }, competencia: comp, riesgo: ries, riesgoTolerancia: 'medio' });
  chequear('sin dato de demanda nunca es "alta"', sinDem.veredicto.nivel !== 'alta', sinDem.veredicto.motivos.join(' '));
  chequear('sin demanda, su peso efectivo es 0', sinDem.componentes.find(c => c.clave === 'demanda').pesoEfectivo === 0);
  const suma = sinDem.componentes.reduce((a, c) => a + c.pesoEfectivo, 0);
  chequear('los pesos efectivos suman ~100', Math.abs(suma - 100) <= 1, suma);
}

console.log('== 3. Saturacion recalibrada ==');
{
  const c = op.puntajeCompetencia({ totalCatalogo: 1331, muestra: 20, pctFull: 10, pctOficiales: 0, top10: 10, vendedoresTop10: 9 });
  chequear('1.331 productos ya no es "Baja"', op.saturacionDe(c.valor) !== 'Baja', op.saturacionDe(c.valor) + ' (' + c.valor + ')');
  const d = op.puntajeCompetencia({ totalCatalogo: 1331, muestra: 20, pctFull: 70, pctOficiales: 30, top10: 10, vendedoresTop10: 2 });
  chequear('Full + oficiales + concentracion empeoran la competencia', d.valor < c.valor, d.valor + ' < ' + c.valor);
}

console.log('== 4. Certificaciones ==');
{
  const cert = p => op.certificaciones(p, 'x').map(c => c.codigo).join(',');
  chequear('enchufe wifi -> ENACOM', /enacom/.test(cert({ nombre: 'Enchufe inteligente WiFi', q: 'enchufe inteligente wifi' })));
  chequear('pava electrica -> Seguridad Electrica', /electrica/.test(cert({ nombre: 'Pava eléctrica de viaje', q: 'pava electrica viaje portatil' })));
  chequear('molde silicona -> INAL', /inal/.test(cert({ nombre: 'Moldes de silicona', q: 'moldes silicona reposteria set' })));
  chequear('juguete en mascotas NO es certificacion de juguetes',
    op.certificaciones({ nombre: 'Juguete de plumas para gato', q: 'juguete gato plumas varita' }, 'mascotas').length === 0);
  chequear('juguete infantil -> juguetes', /juguetes/.test(cert({ nombre: 'Juguete apilable', q: 'juguete apilable silicona bebe' })));
}

console.log('== 5. /api/analyze Mascotas, perfil bajo ==');
const perfilBajo = { nicho: 'mascotas', capital: 'bajo', experiencia: 'ninguna', canal: 'mercadolibre', riesgo: 'bajo', user_id: 'u1' };
const admin = { authorization: 'Bearer ' + emitirToken({ user: 'u1', role: 'admin' }) };
const r1 = await llamar(perfilBajo, admin);
chequear('responde 200', r1.status === 200, r1.status + ' ' + JSON.stringify(r1.body).slice(0, 200));
const prods = r1.body.products || [];
// BUSCADOR_DUMP=archivo.json guarda la respuesta para mirarla en el navegador.
if (process.env.BUSCADOR_DUMP) (await import('node:fs')).writeFileSync(process.env.BUSCADOR_DUMP, JSON.stringify(r1.body));
const comedero = prods.find(p => p.query === 'comedero antivoracidad perro');
chequear('Apify: cero llamadas', llamadas.apify === 0, llamadas.apify);
chequear('trajo el comedero con precio real', comedero && comedero.precioVentaARS > 0, comedero && comedero.precioVentaARS);
if (comedero) {
  console.log('    comedero: ' + comedero.veredicto.label + ' | score ' + comedero.score + ' | margen ' + comedero.margen + '% ($' +
    comedero.margenNeto.netoARS + ') | ' + comedero.semaforo.label + ' | demanda ' + comedero.demanda + ' | sat ' + comedero.saturacion);
  chequear('un solo margen: neto sobre precio', comedero.margen === comedero.margenNeto.pct);
  const d = comedero.margenNeto.desglose;
  chequear('la ganancia por unidad descuenta comision, IVA, IIBB y envio',
    Math.abs(d.precio - d.costo - d.comision - d.envio - d.iibb - d.iva - d.devoluciones - comedero.margenNeto.netoARS) <= 3);
  chequear('comision real de la categoria (15,5%)', comedero.canal.comisionReal && comedero.canal.comisionPct === 15.5);
  chequear('costo con fuente "estimado por categoria"', comedero.costo.fuente === 'estimado por categoría');
  chequear('veredicto y semaforo no se contradicen',
    !(comedero.veredicto.nivel === 'alta' && comedero.semaforo.color !== 'verde'));
  chequear('demanda por tendencia de MeLi, con texto', /tendencia/i.test(comedero.demanda) && /comedero antivoracidad perro grande/.test(comedero.demandaDetalle), comedero.demanda);
  chequear('competencia con min/mediana/max', comedero.competencia.precioMin <= comedero.competencia.precioMediana && comedero.competencia.precioMediana <= comedero.competencia.precioMax);
  chequear('% Full medido', comedero.competencia.pctFull != null, comedero.competencia.pctFull + '%');
  chequear('% oficiales medido', comedero.competencia.pctOficiales != null, comedero.competencia.pctOficiales + '%');
  chequear('concentracion top 10', comedero.competencia.vendedoresTop10 != null, comedero.competencia.vendedoresTop10);
  const L = comedero.links;
  chequear('link listado MeLi con guiones', L.meli === 'https://listado.mercadolibre.com.ar/comedero-antivoracidad-perro', L.meli);
  chequear('link publicacion', /^https:\/\/articulo\.mercadolibre\.com\.ar\/MLA-\d+-_JM$/.test(L.publicacion || ''), L.publicacion);
  chequear('link Alibaba en ingles', L.alibaba === 'https://www.alibaba.com/trade/search?SearchText=slow%20feeder%20dog%20bowl', L.alibaba);
  chequear('link 1688', /^https:\/\/s\.1688\.com\/selloffer\/offer_search\.htm\?keywords=/.test(L.s1688));
  chequear('link Google Trends AR', L.tendencia === 'https://trends.google.com/trends/explore?geo=AR&q=comedero%20antivoracidad%20perro');
  chequear('desglose de score con 4 componentes y peso', comedero.componentes.length === 4 && comedero.componentes.every(c => typeof c.peso === 'number'));
  chequear('capacidad de compra calculada', comedero.capacidad.moq > 0 && comedero.capacidad.unidadesPosibles > 0,
    'MOQ ' + comedero.capacidad.moq + ', puede traer ' + comedero.capacidad.unidadesPosibles);
}
const vacio = (r1.body.products || []).find(p => p.veredicto.nivel === 'sin_dato');
const sinDatoNoDiceAlta = (r1.body.products || []).every(p => p.score != null || p.demanda === 'Sin dato');
chequear('sin datos no inventa "Alta"', sinDatoNoDiceAlta);
chequear('cache del nicho guardado', llamadas.supaPost.includes('buscador_cache'));
chequear('TOP PICK nunca es un "no conviene"', prods.filter(p => p.topPick).every(p => p.veredicto.nivel !== 'baja'));

console.log('== 6. Cache: segunda consulta y perfil distinto ==');
const antes = { listing: llamadas.listing };
const r2 = await llamar({ ...perfilBajo, canal: 'mayorista', capital: 'premium', experiencia: 'alta', riesgo: 'alto' }, admin);
chequear('segunda consulta sale del cache', r2.body.desdeCache === true && llamadas.listing === antes.listing);
chequear('informa la antiguedad', typeof r2.body.edadHoras === 'number', r2.body.edadHoras + ' h');
const comedero2 = r2.body.products.find(p => p.query === 'comedero antivoracidad perro');
chequear('el canal cambia el precio (mayorista)', comedero2.precioVentaARS < comedero.precioVentaARS, comedero2.precioVentaARS + ' < ' + comedero.precioVentaARS);
chequear('el riesgo cambia los pesos', comedero2.componentes[0].peso !== comedero.componentes[0].peso);

console.log('== 7. Perfil: capital y experiencia ==');
{
  const prod = { nombre: 'Medidor láser de distancia', q: 'medidor laser distancia', costoMin: 3, costoMax: 8, pesoG: 150 };
  const merc = { results: publicaciones(60000, 12).map(x => ({ id: x.item_id, title: 'medidor laser distancia', price: x.price, seller: { id: x.seller_id },
    shipping: x.shipping, official_store_id: null })), total: 900, comision: { porcentaje: 14, cargoFijo: 0 }, tendencia: null };
  const bajo = op.evaluarProducto(prod, 'herramientas', merc, { capital: 'bajo', experiencia: 'ninguna', canal: 'mercadolibre', riesgo: 'medio' }, 1500);
  const prem = op.evaluarProducto(prod, 'herramientas', merc, { capital: 'premium', experiencia: 'ninguna', canal: 'mercadolibre', riesgo: 'medio' }, 1500);
  chequear('con capital bajo el pedido minimo no alcanza', bajo.capacidad.alcanza === false,
    'MOQ ' + bajo.capacidad.moq + ' = USD ' + bajo.capacidad.inversionMoqUSD + ' vs presupuesto USD ' + bajo.capacidad.presupuestoUSD);
  chequear('y eso baja el score', bajo.score < prem.score, bajo.score + ' < ' + prem.score);
  const wifi = { nombre: 'Enchufe inteligente WiFi', q: 'enchufe inteligente wifi', costoMin: 2.5, costoMax: 5, pesoG: 60 };
  const sinExp = op.evaluarProducto(wifi, 'domotica', merc, { capital: 'premium', experiencia: 'ninguna', canal: 'mercadolibre', riesgo: 'medio' }, 1500);
  const exp = op.evaluarProducto(wifi, 'domotica', merc, { capital: 'premium', experiencia: 'alta', canal: 'mercadolibre', riesgo: 'medio' }, 1500);
  chequear('sin experiencia + ENACOM baja el puntaje', sinExp.score < exp.score, sinExp.score + ' < ' + exp.score);
}

console.log('== 8. Marcas fuera de la muestra ==');
{
  const m = op.limpiarMuestra([{ title: 'Comedero Xiaomi', price: 100 }, { title: 'Comedero lento', price: 100 }, { title: 'Comedero Disney Stitch', price: 100 }]);
  chequear('saca marca y licencia', m.length === 1, m.map(x => x.title).join(', '));
}

console.log('== 9. Mi lista ==');
{
  const sin = await llamar({ accion: 'lista_guardar', key: 'mascotas::x', producto: { nombre: 'x' } }, {});
  chequear('sin sesion -> 401 requiereSesion (el front usa localStorage)', sin.status === 401 && sin.body.requiereSesion);
  const ok = await llamar({ accion: 'lista_guardar', key: 'mascotas::comedero', nicho: 'mascotas', producto: { nombre: 'Comedero', margen: 30 } }, admin);
  chequear('con sesion guarda', ok.status === 200 && listaGuardada.length === 1 && listaGuardada[0].user_id === 'u1');
  const leer = await llamar(undefined, admin, 'GET', '/api/analyze?lista=1');
  chequear('y la lee', leer.body.ok && leer.body.items.length === 1);
}

console.log('\n' + oks + ' ok, ' + fallos + ' fallas');
process.exit(fallos ? 1 : 0);
