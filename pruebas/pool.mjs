// pruebas/pool.mjs
// Se corre con: npm run test:pool
//
// Pool con rotacion semanal, perfil que cambia la seleccion, variantes de
// busqueda, conteo honesto y acceso de admin. MeLi y Supabase simulados en
// memoria: cualquier busqueda trae ofertas (precio ~4x el costo puesto del
// producto), salvo las que terminan en "sinofertas" o las de la lista SIN_DATOS.
process.env.SUPABASE_SERVICE_KEY = 'supa-de-prueba';
process.env.SESSION_SECRET = 'secreto-de-prueba';
process.env.CRON_SECRET = 'cron-de-prueba';
process.env.BUSCADOR_MELI_RPS = '1000';
process.env.APP_USER = 'matypereira';
process.env.APP_PASS = 'clave-de-prueba';
delete process.env.APIFY_TOKEN;

let fallos = 0, oks = 0;
function chequear(n, c, extra) {
  console.log((c ? '  ok    ' : '  FALLA ') + n + (extra != null ? ' -> ' + extra : ''));
  if (c) oks++; else fallos++;
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

const filas = {};           // buscador_cache en memoria
const VENDIDOS = [];        // buscador_vendidos en memoria
const SIN_DATOS = new Set(); // busquedas que MeLi no tiene (para probar reemplazo y variantes)
let precioDe = () => 20000;
let llamadasMeli = 0;
const qDe = u => decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || [])[1] || '').replace(/\+/g, ' ');
function idDe(q) { let h = 7; for (const c of q) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 'MLA' + (h % 90000000 + 10000000); }
const porId = {};
const catDeId = {};
// Categoria que "tiene" la busqueda en el simulador: la del dominio pedido, o la
// fijada para esa busqueda, o una generica. Asi el filtro por categoria del
// recolector funciona igual que con MeLi.
let catPara = () => 'MLAPOOL';

globalThis.fetch = async (url, init) => {
  const u = String(url), metodo = (init && init.method) || 'GET';
  if (u.includes('dolarapi')) return json({ compra: 1480, venta: 1500, casa: 'bolsa' });
  if (u.includes('supabase.co')) {
    if (u.includes('/buscador_cache')) {
      if (metodo === 'POST') { const b = JSON.parse(init.body); filas[b.nicho] = b; return new Response('', { status: 201 }); }
      if (/select=nicho,created_at,v:/.test(u)) return json(Object.values(filas).map(f => ({ nicho: f.nicho, created_at: f.created_at, v: f.mercado.__v, parcial: f.mercado.__parcial, terminado: f.mercado.__terminado })));
      const n = decodeURIComponent((/nicho=eq\.([^&]*)/.exec(u) || [])[1] || '');
      return json(filas[n] ? [filas[n]] : []);
    }
    if (u.includes('/meli_tokens')) return json([{ access_token: 'tok', refresh_token: 'r', expires_at: new Date(Date.now() + 3600e3).toISOString() }]);
    if (u.includes('/buscador_vendidos')) {
      if (metodo === 'POST') { JSON.parse(init.body).forEach(f => VENDIDOS.push(Object.assign({ creado: new Date().toISOString() }, f))); return new Response('', { status: 201 }); }
      const inQ = /query=in\.\(([^)]*)\)/.exec(decodeURIComponent(u));
      const lista = inQ ? inQ[1].split(',').map(x => x.replace(/^"|"$/g, '')) : null;
      return json(VENDIDOS.filter(f => !lista || lista.includes(f.query)));
    }
    if (metodo !== 'GET') return new Response('', { status: 201 });
    return json([]);
  }
  if (u.includes('api.mercadolibre.com')) llamadasMeli++;
  if (/\/highlights\/|\/sites\/MLA\/search|\/items\?ids|\/reviews\//.test(u)) return json({}, 403);
  if (u.includes('/listing_prices')) return json([{ sale_fee_details: { percentage_fee: 15, fixed_fee: 0 } }]);
  if (/\/trends\/MLA\//.test(u)) return json([{ keyword: 'organizador cables magnetico' }, { keyword: 'samsung galaxy funda' }, { keyword: 'yerba mate 1kg' }, { keyword: 'soporte celular moto impermeable' }, { keyword: 'lampara escritorio recargable plegable' }]);
  if (/\/categories\//.test(u)) return json({ id: 'MLA1', name: 'Categoria', total_items_in_this_category: 5000 });
  if (u.includes('/products/search')) {
    const q = qDe(u), off = Number((/offset=(\d+)/.exec(u) || [])[1] || 0);
    if (off > 0 || SIN_DATOS.has(q) || /sinofertas$/.test(q)) return json({ paging: { total: 0 }, results: [] });
    return json({ paging: { total: 900 }, results: Array.from({ length: 6 }, (_, k) => { const id = idDe(q + k); porId[id] = q; catDeId[id] = catPara(q, u); return { id, name: q + ' modelo ' + k }; }) });
  }
  const mi = /\/products\/(MLA\d+)\/items/.exec(u);
  if (mi) {
    const q = porId[mi[1]];
    const p = precioDe(q);
    return json({ results: Array.from({ length: 3 }, (_, j) => ({ item_id: mi[1] + j, price: Math.round(p * (0.9 + j * 0.1)), seller_id: 100 + j + (mi[1].charCodeAt(5) % 7), category_id: catDeId[mi[1]] || null, shipping: { logistic_type: 'cross_docking' }, official_store_id: null })) });
  }
  return json({}, 404);
};


// Categorias: si _categorias-pool.js todavia esta vacio (antes de clasificar en
// MeLi), el simulador le asigna una categoria generica a todo el ampliado.
{
  const { CATEGORIAS_POOL } = await import('../api/_categorias-pool.js');
  const { CATEGORIAS } = await import('../api/_categorias-datos.js');
  const { EXTRA } = await import('../api/_pool-extra.js');
  if (!Object.keys(CATEGORIAS_POOL).length) Object.values(EXTRA).forEach(l => l.forEach(a => { if (!CATEGORIAS[a[1]]) CATEGORIAS_POOL[a[1]] = { cat: 'MLAPOOL', dom: 'MLA-POOL' }; }));
  const domCat = {};
  [CATEGORIAS, CATEGORIAS_POOL].forEach(m => Object.values(m).forEach(c => { if (c && c.dom) domCat[c.dom] = c.cat; }));
  catPara = (q, u) => {
    const dom = decodeURIComponent((/[?&]domain_id=([^&]*)/.exec(u) || [])[1] || '');
    if (dom && domCat[dom]) return domCat[dom];
    const c = CATEGORIAS[q] || CATEGORIAS_POOL[q];
    return c && c.cat ? c.cat : 'MLAPOOL';
  };
}
const { emitirToken, estadoSesion, esCliente, renovarSiHaceFalta } = await import('../api/_sesion.js');
const pool = await import('../api/_pool.js');
const op = await import('../api/_oportunidad.js');
const analyze = await import('../api/analyze.js');
const handler = analyze.default;
const auth = (await import('../api/auth.js')).default;
const CAT = analyze.__CATALOGO;

// Precio ~4x el costo puesto del producto del pool (asi todos tienen margen sano).
const indice = {};
Object.keys(CAT).forEach(k => pool.poolDe(k, CAT[k].productos, []).forEach(p => { indice[pool.normalizar(p.q)] = { p, k }; }));
precioDe = q => {
  const base = indice[pool.normalizar(q)] || Object.values(indice).find(x => pool.normalizar(q).startsWith(pool.normalizar(x.p.q).split(' ').slice(0, 2).join(' ')));
  if (!base) return 20000;
  return Math.round(op.costoImportacion(base.p, 1500, base.k).costoPuestoARS * 4);
};

function llamar(h, body, headers, metodo, url) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; }, json(o) { resolve({ status: this.statusCode, body: o }); return this; }, end() { resolve({ status: this.statusCode }); } };
    h({ method: metodo || 'POST', url: url || '/api/analyze', headers: headers || {}, body }, res);
  });
}
const cron = { authorization: 'Bearer cron-de-prueba', 'user-agent': 'vercel-cron/1.0' };
const perfil = (o) => Object.assign({ nicho: 'celulares', capital: 'medio', experiencia: 'media', canal: 'mercadolibre', riesgo: 'medio', user_id: '' }, o || {});
async function rondaCompleta(nicho, extra) {
  let r, n = 0;
  do { r = await llamar(handler, undefined, cron, 'GET', '/api/analyze?precalcular=tanda&solo=' + nicho + (n === 0 && extra ? extra : '')); n++; }
  while (r.body.procesados && r.body.procesados[0] && r.body.procesados[0].terminado === false && n < 10);
  return r;
}

console.log('== A. Acceso: sesion, admin y "ver como free" ==');
{
  const tAdmin = emitirToken({ user: 'matypereira', role: 'admin', premium: true });
  const tUserMaty = emitirToken({ user: ' Matypereira ', role: 'user', premium: false });
  const tComun = emitirToken({ user: 'cliente@x.com', role: 'user', premium: false });
  chequear('admin es cliente', esCliente(tAdmin));
  chequear('matypereira con rol user (login por la lista) igual es admin y cliente', esCliente(tUserMaty) && estadoSesion(tUserMaty).role === 'admin');
  chequear('usuario comun sin premium no es cliente', !esCliente(tComun));
  // Token vencido: se arma uno valido con exp en el pasado.
  const crypto = await import('node:crypto');
  const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const cuerpo = b64(JSON.stringify({ u: 'matypereira', r: 'admin', p: true, exp: Date.now() - 1000 }));
  const vencido = cuerpo + '.' + b64(crypto.createHmac('sha256', 'secreto-de-prueba').update(cuerpo).digest());
  chequear('token vencido -> sesion "invalida" (no "ausente")', estadoSesion(vencido).estado === 'invalida');
  const s = await llamar(auth, undefined, { authorization: 'Bearer ' + vencido }, 'GET', '/api/auth?sesion=1');
  chequear('GET /api/auth?sesion=1 informa el vencimiento', s.status === 200 && s.body.estado === 'invalida', JSON.stringify(s.body));
  const s2 = await llamar(auth, undefined, { authorization: 'Bearer ' + tAdmin }, 'GET', '/api/auth?sesion=1');
  chequear('con token valido: estado valida y rol admin', s2.body.estado === 'valida' && s2.body.role === 'admin');
  const casi = (() => { const c = b64(JSON.stringify({ u: 'matypereira', r: 'admin', p: true, exp: Date.now() + 2 * 86400e3 })); return c + '.' + b64(crypto.createHmac('sha256', 'secreto-de-prueba').update(c).digest()); })();
  chequear('token por vencer (2 dias): se renueva', !!renovarSiHaceFalta(casi));
  chequear('token nuevo: no se renueva', !renovarSiHaceFalta(tAdmin));
}

{
  // Sin ADMIN_KEY (como en un preview): el login funciona y la gestion de usuarios NO queda abierta.
  const k = process.env.ADMIN_KEY; delete process.env.ADMIN_KEY;
  const authSinKey = (await import('../api/auth.js?sinkey=' + Date.now())).default;
  const lg = await llamar(authSinKey, { username: 'Matypereira ', password: 'clave-de-prueba', action: 'login' }, {}, 'POST', '/api/auth');
  chequear('sin ADMIN_KEY: login de admin funciona (usuario sin distinguir mayusculas)', lg.status === 200 && lg.body.role === 'admin' && !!lg.body.token, lg.status + ' ' + lg.body.role);
  const us = await llamar(authSinKey, undefined, {}, 'GET', '/api/users');
  chequear('sin ADMIN_KEY: /api/users NO queda abierto', us.status === 500 || us.status === 401, us.status);
  if (k) process.env.ADMIN_KEY = k;
}

console.log('== B. Ronda semanal del pool (celulares) ==');
const r1 = await rondaCompleta('celulares');
const p1 = r1.body.procesados[0];
chequear('ronda terminada y guardada', p1 && p1.terminado && p1.guardado, p1 && (p1.conDatos + '/' + p1.objetivo + ' con datos, pool ' + p1.de));
chequear('pool del rubro >= 40', p1.de >= 40, p1.de);
const f1 = filas.celulares.mercado;
chequear('fila formato 2 con seleccion, historial y ronda', f1.__formato === 2 && f1.__seleccion.length === pool.OBJETIVO_RONDA() && f1.__historial.rondas.length >= 1 && f1.__ronda.id);
chequear('descubrimiento: solo tendencias aceptables (sin marcas ni alimentos)', (f1.__descubrimiento.nuevos || []).every(q => !/samsung|yerba/.test(q)), JSON.stringify(f1.__descubrimiento.nuevos));
const base12 = new Set(CAT.celulares.productos.map(p => p.q));
const repetidosPrimera = f1.__seleccion.filter(p => base12.has(p.q)).length;
chequear('la primera ronda evita los 12 fijos que se venian mostrando', repetidosPrimera === 0, repetidosPrimera + ' de los 12 viejos');

// Admin ve todo, sin candado.
const tAdmin = { authorization: 'Bearer ' + emitirToken({ user: 'matypereira', role: 'admin', premium: true }) };
const vAdmin = await llamar(handler, perfil(), tAdmin);
chequear('admin: 12 productos, esCliente true, esAdmin true', vAdmin.body.products.length === 12 && vAdmin.body.esCliente === true && vAdmin.body.esAdmin === true, vAdmin.body.products.length);
chequear('primera ronda: todos "nuevo"', vAdmin.body.products.every(p => p.nuevo === true), vAdmin.body.nuevosPrimeraVez);
const vFree = await llamar(handler, perfil({ verComoFree: true }), tAdmin);
chequear('admin con "ver como free": candado (3 y esCliente false)', vFree.body.products.length === 3 && vFree.body.esCliente === false && vFree.body.verComoFree === true);
const vAnon = await llamar(handler, perfil({ verComoFree: false }), {});
chequear('sin sesion: 3 productos y sesion "ausente"', vAnon.body.products.length === 3 && vAnon.body.sesion === 'ausente');
const tComun = { authorization: 'Bearer ' + emitirToken({ user: 'x@y.com', role: 'user', premium: true }) };
const vPrem = await llamar(handler, perfil({ verComoFree: true }), tComun);
chequear('un no-admin no puede pedir "ver como free" (se ignora)', vPrem.body.verComoFree === false && vPrem.body.products.length === 12);

console.log('== C. El perfil cambia la seleccion ==');
const qs = r => r.body.products.map(p => p.query);
const bajo = await llamar(handler, perfil({ capital: 'bajo' }), tAdmin);
const medio = await llamar(handler, perfil({ capital: 'medio' }), tAdmin);
const alto = await llamar(handler, perfil({ capital: 'alto' }), tAdmin);
const dif = (a, b) => qs(a).filter(q => qs(b).indexOf(q) < 0).length;
chequear('capital bajo vs alto: al menos 4 de 12 productos distintos', dif(bajo, alto) >= 4, dif(bajo, alto) + ' distintos');
chequear('capital medio vs alto: no identicos (productos u orden)', dif(medio, alto) > 0 || qs(medio).join() !== qs(alto).join(), dif(medio, alto) + ' distintos, orden ' + (qs(medio).join() === qs(alto).join() ? 'igual' : 'distinto'));
const sinExp = await llamar(handler, perfil({ experiencia: 'ninguna' }), tAdmin);
chequear('experiencia "ninguna": ningun producto con certificaciones', sinExp.body.products.every(p => !(p.certificaciones || []).length), 'fuera: ' + JSON.stringify(sinExp.body.filtradosPorPerfil));
const riesgoBajo = await llamar(handler, perfil({ riesgo: 'bajo' }), tAdmin);
chequear('riesgo bajo: ningun producto de riesgo Alto', riesgoBajo.body.products.every(p => p.riesgo !== 'Alto'));
chequear('conteo honesto: conDatoReal = productos que se muestran a un cliente', sinExp.body.conDatoReal === sinExp.body.products.length, sinExp.body.conDatoReal + ' de objetivo ' + sinExp.body.objetivo);

console.log('== D/E. Forzar: ronda nueva, rotacion y badge "Nuevo" ==');
const antes = new Set(f1.__seleccion.map(p => p.q));
const r2 = await rondaCompleta('celulares', '&forzar=1');
// forzar solo vale para admin, no para el cron: se pide como admin.
const rf = await llamar(handler, undefined, tAdmin, 'GET', '/api/analyze?precalcular=tanda&solo=celulares&forzar=1');
let pf = rf.body.procesados[0], n = 0;
while (pf && pf.terminado === false && n++ < 10) { const x = await llamar(handler, undefined, tAdmin, 'GET', '/api/analyze?precalcular=tanda&solo=celulares'); pf = x.body.procesados[0] || pf; if (!x.body.procesados.length) break; }
chequear('el cron no puede forzar (la ronda fresca no se rehace)', !r2.body.procesados.length || r2.body.procesados[0].ronda.id === f1.__ronda.id);
const f2 = filas.celulares.mercado;
chequear('admin forzo: ronda nueva', f2.__ronda.id !== f1.__ronda.id && f2.__ronda.motivo === 'forzada');
// Con 24 por ronda y un pool de ~40 no alcanzan los ineditos: la regla es que
// entren TODOS los que nunca se mostraron antes de repetir alguno.
const vistosR1 = new Set(f1.__historial.vistos);
const ineditos = f2.__descartados.map(d => d.q).concat(f2.__seleccion.map(p => p.q));
const poolR2 = pool.poolElegible('celulares', CAT.celulares.productos, f2.__descubiertos);
const ineditosPool = poolR2.filter(p => !vistosR1.has(p.q)).map(p => p.q);
const faltan = ineditosPool.filter(q => ineditos.indexOf(q) < 0);
const repetidos = f2.__seleccion.filter(p => antes.has(p.q)).length;
const fijosR2 = new Set(f2.__fijos || []);
const repetidosNoFijos = f2.__seleccion.filter(p => antes.has(p.q) && !fijosR2.has(p.q)).length;
if (ineditosPool.length >= f2.__objetivo) chequear('ronda nueva: con ineditos de sobra, solo repite los fijos (medicion en curso)', repetidosNoFijos === 0 && repetidos === fijosR2.size && fijosR2.size <= 6, ineditosPool.length + ' ineditos, ' + repetidos + ' repetidos = ' + fijosR2.size + ' fijos');
else chequear('ronda nueva: entran todos los ineditos antes de repetir', faltan.length === 0, (ineditosPool.length) + ' ineditos en el pool, faltaron ' + faltan.length);
console.log('        (repetidos de la ronda anterior: ' + repetidos + ' de ' + f2.__seleccion.length + ', porque el pool tiene ' + poolR2.length + ')');
const v2 = await llamar(handler, perfil(), tAdmin);
chequear('banner: nuevos vs semana anterior = los que no estaban', v2.body.nuevosVsAnterior === v2.body.products.filter(p => !antes.has(p.query)).length, v2.body.nuevosVsAnterior);
const vistosAntes = new Set(f1.__historial.vistos);
chequear('badge "Nuevo" solo en los que entran por primera vez', v2.body.products.every(p => p.nuevo === !vistosAntes.has(p.query)),
  v2.body.nuevosPrimeraVez + ' de ' + v2.body.products.length + ' nuevos (el resto: ya se habian mostrado antes)');
chequear('fecha real de los datos en la respuesta', !!v2.body.datosDe && !isNaN(Date.parse(v2.body.datosDe)), v2.body.datosDe);

console.log('== 1. Fijos por medicion de ventas + medicion de fondo ==');
{
  // 3 productos de la ronda actual con medicion (1 con dos, 1 con una, 1 en cola).
  const sel = filas.celulares.mercado.__seleccion.map(p => p.q);
  const hace = d => new Date(Date.now() - d * 86400e3).toISOString();
  VENDIDOS.push({ query: sel[5], estado: 'cosechada', vendidos_total: 900, medido_en: hace(1), creado: hace(1), items: [] });
  VENDIDOS.push({ query: sel[5], estado: 'cosechada', vendidos_total: 700, medido_en: hace(8), creado: hace(8), items: [] });
  VENDIDOS.push({ query: sel[7], estado: 'cosechada', vendidos_total: 300, medido_en: hace(2), creado: hace(2), items: [] });
  VENDIDOS.push({ query: sel[9], estado: 'en_cola', creado: hace(1) });
  const f = pool.elegirFijos(filas.celulares.mercado.__seleccion, { [sel[5]]: { cosechadas: [{ vendidos_total: 900 }, {}], ultimo: { estado: 'cosechada' } }, [sel[7]]: { cosechadas: [{ vendidos_total: 300 }], ultimo: { estado: 'cosechada' } }, [sel[9]]: { cosechadas: [], ultimo: { estado: 'en_cola' } } }, 6);
  chequear('elegirFijos: ordena 2 mediciones > 1 > en curso', f.map(x => x.q).join() === [sel[5], sel[7], sel[9]].join() && f.every(x => x.fijo), f.map(x => x.motivoFijo).join(' / '));
  let r = await llamar(handler, undefined, tAdmin, 'GET', '/api/analyze?precalcular=tanda&solo=celulares&forzar=1'), n = 0;
  while (r.body.procesados[0] && r.body.procesados[0].terminado === false && n++ < 10) r = await llamar(handler, undefined, tAdmin, 'GET', '/api/analyze?precalcular=tanda&solo=celulares');
  const f3 = filas.celulares.mercado;
  chequear('la ronda nueva mantiene primero los medidos (fijos)', [sel[5], sel[7]].every(q => f3.__fijos.includes(q) && f3.__seleccion.some(p => p.q === q)) && f3.__fijos.length <= 6, f3.__fijos.length + ' fijos');
  const v = await llamar(handler, perfil(), tAdmin);
  chequear('la tarjeta del fijo lo dice ("Se mantiene")', v.body.products.filter(p => p.fijo).every(p => p.motivoFijo), v.body.products.filter(p => p.fijo).length + ' fijos en pantalla');
  chequear('llamadas de la ronda guardadas', f3.__llamadas > 0 && f3.__tandas >= 1, f3.__llamadas + ' llamadas en ' + f3.__tandas + ' tandas');
  // Rotacion con todo lo analizado: prioridad (fijos + top 3) y fondo.
  const rot = await import('../api/_rotacion.js');
  process.env.SUPABASE_SERVICE_KEY = 'supa-de-prueba';
  const ranking = f3.__seleccion.map((p, i) => ({ q: 'prueba fondo ' + p.q, puntaje: 100 - i, itemIds: ['MLA1' + i, 'MLA2' + i, 'MLA3' + i, 'MLA4' + i, 'MLA5' + i], fijo: !!p.fijo, prioridad: !!p.fijo || i < 3 }));
  const antesV = VENDIDOS.length;
  const e = await rot.encolar('celulares', ranking);
  const nuevos = VENDIDOS.slice(antesV);
  chequear('se encola TODO lo analizado (no solo el top 3)', nuevos.length >= 20, nuevos.length + ' encolados, ' + e.prioridad + ' con prioridad');
  chequear('el fondo usa menos publicaciones por producto (cuesta menos)', nuevos.filter(x => /^fondo/.test(x.motivo)).every(x => x.item_ids.length === 3) && nuevos.filter(x => /^prioridad/.test(x.motivo)).every(x => x.item_ids.length === 5));
}

console.log('== 3. Costo en llamadas: ronda de 15 vs 24 (simulador) ==');
{
  const medir = async obj => { let r = await llamar(handler, undefined, tAdmin, 'GET', '/api/analyze?precalcular=tanda&solo=tecnologia&forzar=1&objetivo=' + obj), n = 0;
    while (r.body.procesados[0] && r.body.procesados[0].terminado === false && n++ < 10) r = await llamar(handler, undefined, tAdmin, 'GET', '/api/analyze?precalcular=tanda&solo=tecnologia&objetivo=' + obj);
    return filas.tecnologia.mercado.__llamadas; };
  const a = await medir(15), b = await medir(24);
  chequear('objetivo= (admin) cambia el tamaño de la ronda', filas.tecnologia.mercado.__objetivo === 24);
  console.log('        simulador: 15 -> ' + a + ' llamadas, 24 -> ' + b + ' llamadas (' + (b / a).toFixed(2) + 'x)');
}

console.log('== R. 20 rubros: mapeo, eliminados y rubro de origen ==');
{
  const R = await import('../api/_rubros.js');
  chequear('20 rubros, todos los 65 viejos mapeados', Object.keys(CAT).length === 20 && Object.keys(R.ALIAS).length === 65 - 20 + 20, Object.keys(CAT).length + ' rubros, ' + Object.keys(R.ALIAS).length + ' alias');
  const v = await llamar(handler, perfil({ nicho: 'fitness' }), tAdmin);
  chequear('link viejo (fitness) abre Deportes sin aviso de aproximado', v.body.nicho === 'deportes' && v.body.nichoAproximado === false);
  const s2 = await llamar(handler, perfil({ nicho: 'sexshop' }), tAdmin);
  chequear('rubro eliminado (sexshop) abre Belleza sin aviso', s2.body.nicho === 'belleza' && s2.body.nichoAproximado === false);
  const todos = Object.keys(CAT).flatMap(k => pool.poolDe(k, CAT[k].productos, []));
  const eliminados = new Set(Object.keys(R.ELIMINADOS));
  chequear('ningun producto de sexshop, vinos, electrodomesticos, suplementos u ortopedia en el pool', todos.every(p => !eliminados.has(p.rubroOrigen)), todos.filter(p => eliminados.has(p.rubroOrigen)).length);
  const jug = pool.poolDe('juguetes', CAT.juguetes.productos, []);
  const exigen = o => jug.filter(p => p.rubroOrigen === o && op.certificaciones(p, 'juguetes').some(c => c.codigo === 'juguetes')).length;
  chequear('juguetes: coleccionables y drones NO exigen la certificacion de juguetes', exigen('coleccionables') === 0 && exigen('drones') === 0 && exigen('juguetes') > 0, 'juguetes ' + exigen('juguetes') + ', coleccionables ' + exigen('coleccionables') + ', drones ' + exigen('drones'));
  const zap = pool.poolDe('moda', CAT.moda.productos, []).find(p => p.rubroOrigen === 'calzado');
  chequear('derecho de importacion por rubro de origen (calzado 35%)', op.costoImportacion(zap, 1500, 'moda').diPct === 35);
  chequear('celulares, mascotas y foto/video con ~80 candidatos', ['celulares', 'mascotas', 'fotografia'].every(k => pool.poolDe(k, CAT[k].productos, []).length >= 80),
    ['celulares', 'mascotas', 'fotografia'].map(k => k + ' ' + pool.poolDe(k, CAT[k].productos, []).length).join(', '));
  const g = await llamar(handler, undefined, {}, 'GET', '/api/analyze');
  chequear('GET /api/analyze: 20 rubros + alias para el front', g.body.nichos.length === 20 && g.body.alias && g.body.alias.fitness === 'deportes');
}

console.log('== D. Sin datos: variantes y reemplazo ==');
{
  const prod = { nombre: 'Funda de silicona con anillo', q: 'funda silicona anillo sinofertas', costoMin: 1, costoMax: 2.5, volCm3: 200, pesoG: 50 };
  const vs = pool.variantesDe(prod);
  chequear('2-3 variantes (sinonimo / mas generica / nucleo)', vs.length >= 2 && vs.length <= 3, JSON.stringify(vs));
  const pre = await import('../api/_precalculo.js');
  const cli = pre.crearCliente('tok', { rps: 1000 });
  const r = await pool.analizarConVariantes(cli, prod, pre.analizarProducto, { nichoKey: 'celulares', usdArs: 1500 });
  chequear('si la busqueda original no trae datos, una variante si', !!r.consulta && r.consulta !== prod.q && r.intentos.length >= 2, r.consulta + ' (' + r.intentos.length + ' intentos)');
  // Reemplazo: un rubro donde la mitad del pool no tiene datos igual llega al objetivo.
  pool.poolDe('mascotas', CAT.mascotas.productos, []).forEach((p, i) => { if (i % 2 === 0) { SIN_DATOS.add(p.q); pool.variantesDe(p).forEach(v => SIN_DATOS.add(v)); } });
  const rm = await rondaCompleta('mascotas');
  const pm = rm.body.procesados[0];
  const fm = filas.mascotas.mercado;
  chequear('con la mitad sin datos: reemplaza con el pool', fm.__seleccion.length > 0 && fm.__descartados.length > 0, fm.__seleccion.length + ' con datos, ' + fm.__descartados.length + ' descartados');
  const vm = await llamar(handler, perfil({ nicho: 'mascotas' }), tAdmin);
  chequear('el numero mostrado es el real (sin pendientes inventados)', vm.body.products.length === vm.body.conDatoReal && vm.body.pendientes.length === 0 && vm.body.descartadosSinDatos === fm.__descartados.length,
    vm.body.products.length + ' mostrados, ' + vm.body.descartadosSinDatos + ' descartados');
}

console.log('== F. Formato viejo y preview ==');
{
  // Una fila del formato viejo (12 fijos) se sigue leyendo como antes.
  const viejo = { __v: 4 };
  filas.hogar = { nicho: 'hogar', mercado: viejo, created_at: new Date().toISOString() };
  const v = await llamar(handler, perfil({ nicho: 'hogar' }), tAdmin);
  chequear('fila del formato viejo: responde sin romper (formato 1)', v.status === 200 && v.body.formato === 1);
  // Preview: escribe en filas "preview:" y no toca la de produccion.
  process.env.VERCEL_ENV = 'preview';
  const antesProd = JSON.stringify(filas.celulares);
  const x = await llamar(handler, undefined, tAdmin, 'GET', '/api/analyze?precalcular=tanda&solo=celulares&forzar=1');
  chequear('preview: escribe en "preview:celulares"', Object.keys(filas).some(k => k.indexOf('preview:celulares') === 0), Object.keys(filas).filter(k => k.startsWith('preview')).join(','));
  chequear('preview: la fila de produccion queda igual', JSON.stringify(filas.celulares) === antesProd);
  delete process.env.VERCEL_ENV;
  chequear('preview nunca usa Apify', x.body.procesados[0] && x.body.procesados[0].rotacionEncolada == null);
}

console.log('\n' + oks + ' ok, ' + fallos + ' fallas');
process.exit(fallos ? 1 : 0);
