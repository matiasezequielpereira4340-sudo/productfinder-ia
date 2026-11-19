// pruebas/descubrir.mjs
// Se corre con: npm run test:descubrir
//
// 1) Respaldo de ofertas en analizarProducto: categoria padre y paginas extra.
// 2) Descubrimiento: filtros, validacion de la ficha, pool de 20, desactivacion.
// 3) Front: decodificacion del token (exp) y sesion vencida.
// Sin red: MeLi se simula con un cliente falso y Supabase no esta configurado.
delete process.env.SUPABASE_SERVICE_KEY;

import fs from 'node:fs';
import vm from 'node:vm';

let fallos = 0, oks = 0;
function chequear(n, c, extra) {
  console.log((c ? '  ok    ' : '  FALLA ') + n + (extra != null ? ' -> ' + extra : ''));
  if (c) oks++; else fallos++;
}

const { analizarProducto, VERSION_MERCADO, VERSION_MERCADO_LECTURA_MIN } = await import('../api/_precalculo.js');
const D = await import('../api/_descubrir.js');
const { evaluarProducto } = await import('../api/_oportunidad.js');

// ---- MeLi simulado ---------------------------------------------------------
// Producto con categoria fijada MLA_HOJA (padre MLA_PADRE). Las ofertas vienen
// casi todas de una categoria hermana (MLA_HERMANA, mismo padre) y alguna de
// otro rubro (MLA_OTRO, otro padre).
function cliFalso(escenario) {
  const llamadas = [];
  const estado = { llamadas: 0, porEndpoint: {}, errores: {}, limitado: 0 };
  const rutas = { MLA_HOJA: ['MLA_RAIZ', 'MLA_PADRE', 'MLA_HOJA'], MLA_HERMANA: ['MLA_RAIZ', 'MLA_PADRE', 'MLA_HERMANA'], MLA_OTRO: ['MLA_RAIZ2', 'MLA_X', 'MLA_OTRO'] };
  async function get(nombre, url) {
    estado.llamadas++; llamadas.push(url);
    const u = new URL(url);
    if (u.pathname === '/products/search') {
      const off = Number(u.searchParams.get('offset') || 0);
      const conDom = u.searchParams.has('domain_id');
      const ids = escenario.catalogo(off, conDom);
      return { ok: true, status: 200, json: { paging: { total: 500 }, results: ids.map(id => ({ id, name: 'cable usb c trenzado 100w ' + id })) } };
    }
    let m = /^\/products\/([^/]+)\/items$/.exec(u.pathname);
    if (m) {
      const its = escenario.items(m[1]);
      if (!its) return { ok: false, status: 404, json: null };
      return { ok: true, status: 200, json: { results: its } };
    }
    m = /^\/categories\/(.+)$/.exec(u.pathname);
    if (m) return { ok: true, status: 200, json: { name: 'Cat ' + m[1], total_items_in_this_category: 100, path_from_root: (rutas[m[1]] || [m[1]]).map(id => ({ id })) } };
    if (u.pathname.startsWith('/trends/')) return { ok: true, status: 200, json: [{ keyword: 'cable usb c' }] };
    if (u.pathname.includes('listing_prices')) return { ok: true, status: 200, json: [{ sale_fee_details: { percentage_fee: 15, fixed_fee: 1000 } }] };
    return { ok: false, status: 403, json: null };
  }
  return { get, estado, cacheCategorias: new Map(), cacheRutas: new Map(), llamadas };
}
const item = (id, cat, price) => ({ item_id: id, price, seller_id: 's' + id, category_id: cat, shipping: { free_shipping: false, logistic_type: 'xd_drop_off' } });
const PROD = { nombre: 'Cable USB-C trenzado 100W', q: 'cable usb c 100w trenzado', keyword_en: '100w braided usb c cable', volCm3: 150, costoMin: 1.2, costoMax: 3.5, pesoG: 70, nota: 'x', cat: 'MLA_HOJA', dom: 'MLA-USB_CABLES' };

console.log('== 1. Respaldo por categoria padre ==');
{
  const cli = cliFalso({
    catalogo: (off, conDom) => off === 0 ? ['P1', 'P2', 'P3'] : [],
    items: id => ({ P1: [item('a1', 'MLA_HOJA', 9000), item('a2', 'MLA_HERMANA', 9500)], P2: [item('b1', 'MLA_HERMANA', 9900), item('b2', 'MLA_HERMANA', 10500)], P3: [item('c1', 'MLA_OTRO', 50000)] })[id]
  });
  const m = await analizarProducto(cli, PROD);
  chequear('version de mercado subio a 5', VERSION_MERCADO === 5 && VERSION_MERCADO_LECTURA_MIN === 4);
  chequear('con 1 oferta exacta se suman las de la categoria hermana', m.results.length === 4, m.results.length);
  chequear('la de otra rama (otro padre) se descarta igual', !m.results.some(o => o.category_id === 'MLA_OTRO'));
  chequear('marca datoAproximado', m.datoAproximado === true);
  chequear('respaldo cuenta exactas y hermanas', m.respaldo.exactas === 1 && m.respaldo.deCategoriasHermanas === 3 && m.respaldo.categoriaPadre === 'MLA_PADRE', JSON.stringify(m.respaldo));
  chequear('rescate atribuido al paso categoriaPadre', m.respaldo.rescate === 'categoriaPadre' && cli.estado.pasos.categoriaPadre === 1);
  const e = evaluarProducto(PROD, 'celulares', m, { capital: 'bajo', experiencia: 'ninguna', canal: 'mercadolibre', riesgo: 'medio' }, 1500, null);
  chequear('la tarjeta sale (no Pendientes) y lleva datoAproximado', !e.sinDatos && e.datoAproximado === true, e.motivoSinDatos);
}
{
  const cli = cliFalso({
    catalogo: () => ['P1'],
    items: () => [item('a1', 'MLA_HOJA', 9000), item('a2', 'MLA_HOJA', 9100), item('a3', 'MLA_HOJA', 9200), item('a4', 'MLA_HERMANA', 9300)]
  });
  const m = await analizarProducto(cli, PROD);
  chequear('con 3 exactas NO se usan hermanas ni se marca aproximado', m.results.length === 3 && m.datoAproximado === false);
}

console.log('== 2. Paginas extra de catalogo ==');
{
  // Paginas 0-2 con dominio: productos sin ofertas (404). Mas paginas: P9 con ofertas.
  const cli = cliFalso({
    catalogo: (off, conDom) => conDom ? (off < 30 ? ['Q' + off] : ['P9']) : (off === 0 ? ['P8'] : []),
    items: id => ({ P9: [item('x1', 'MLA_HOJA', 9000), item('x2', 'MLA_HOJA', 9100)], P8: [item('y1', 'MLA_HOJA', 9300)] })[id] || null
  });
  const m = await analizarProducto(cli, PROD);
  const extra = cli.llamadas.filter(u => u.includes('/products/search') && (/offset=30|offset=40/.test(u) || !u.includes('domain_id')));
  chequear('pide 2 paginas mas con dominio y 2 sin dominio', extra.length === 4, extra.length);
  chequear('las ofertas de las paginas extra suman (3 exactas)', m.results.length === 3, m.results.length);
  chequear('rescate atribuido a paginasExtra', m.respaldo.rescate === 'paginasExtra', m.respaldo.rescate);
  chequear('los 404 no impiden seguir', m.catalogoRevisados >= 5, m.catalogoRevisados);
}

console.log('== 3. Descubrimiento: filtros y validacion ==');
chequear('servicio no se importa', D.esNoImportable('reparacion de celulares', 'celulares'));
chequear('usado no se importa', D.esNoImportable('celular usado', 'celulares'));
chequear('alimento no se importa', D.esNoImportable('yerba mate organica', 'mate'));
chequear('vehiculo entero no se importa', D.esNoImportable('motos 2024', 'motos'));
chequear('un accesorio de moto si', !D.esNoImportable('soporte celular moto', 'celulares'));
chequear('mismo producto con otras palabras', D.mismoProducto('soporte celular auto magnetico', 'soporte magnetico para celular de auto'));
chequear('productos distintos', !D.mismoProducto('soporte celular auto', 'funda celular silicona'));
const fichaOk = { keyword: 'cargador inalambrico 3 en 1', importable: true, motivo: 'generico', nombre: 'Cargador inalámbrico 3 en 1', q: 'cargador inalambrico 3 en 1', keyword_en: '3 in 1 wireless charger', volCm3: 900, costoMin: 6, costoMax: 14, pesoG: 300, nota: 'Ticket medio' };
chequear('ficha valida pasa', D.validarFicha(fichaOk, 'celulares').ok);
chequear('importable=false se descarta', !D.validarFicha(Object.assign({}, fichaOk, { importable: false }), 'celulares').ok);
chequear('costoMax < costoMin se descarta', !D.validarFicha(Object.assign({}, fichaOk, { costoMax: 2 }), 'celulares').ok);
chequear('volumen absurdo se descarta', !D.validarFicha(Object.assign({}, fichaOk, { volCm3: 900000 }), 'celulares').ok);
chequear('densidad imposible se descarta', !D.validarFicha(Object.assign({}, fichaOk, { volCm3: 20, pesoG: 2000 }), 'celulares').ok);
chequear('marca en el nombre se descarta', !D.validarFicha(Object.assign({}, fichaOk, { nombre: 'Cargador Samsung original', q: 'cargador samsung' }), 'celulares').ok);
chequear('q de una palabra se descarta', !D.validarFicha(Object.assign({}, fichaOk, { q: 'cargador' }), 'celulares').ok);
chequear('campo que no es numero se descarta', !D.validarFicha(Object.assign({}, fichaOk, { pesoG: '300' }), 'celulares').ok);

console.log('== 4. Pool: 12 fijos + descubiertos, tope 20 ==');
{
  const ahora = Date.parse('2026-11-19T12:00:00Z');
  const fijos = Array.from({ length: 12 }, (_, i) => ({ nombre: 'F' + i, q: 'fijo ' + i }));
  const dias = n => new Date(ahora - n * 86400e3).toISOString();
  const desc = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, nombre: 'Viejo ' + i, q: 'viejo ' + i, descubierto_en: dias(40 + i), activo: true })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: 200 + i, nombre: 'Reciente ' + i, q: 'reciente ' + i, descubierto_en: dias(2 + i * 4), activo: true })),
    { id: 300, nombre: 'Repite fijo', q: 'fijo 3', descubierto_en: dias(1), activo: true },
    { id: 301, nombre: 'Inactivo', q: 'inactivo x', descubierto_en: dias(1), activo: false }
  ];
  const l = D.armarLista(fijos, desc, { ahora });
  chequear('tope de 20', l.length === 20, l.length);
  chequear('primero los descubiertos de los ultimos 30 dias', l.slice(0, 6).every(p => /^reciente/.test(p.q)));
  chequear('entran los 12 fijos', fijos.every(f => l.some(p => p.q === f.q)));
  chequear('los viejos llenan lo que sobra (2)', l.filter(p => /^viejo/.test(p.q)).length === 2);
  chequear('un descubierto que repite un fijo o inactivo no entra', !l.some(p => p.descubiertoId === 300 || p.descubiertoId === 301));
  chequear('NUEVO solo los de 14 dias o menos', l.filter(p => p.nuevo).map(p => p.q).join(',') === 'reciente 0,reciente 1,reciente 2,reciente 3', l.filter(p => p.nuevo).map(p => p.q).join(','));
}

console.log('== 5. Front: token vencido ==');
{
  const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const ini = src.indexOf('// ===== Sesion vencida =====');
  const fin = src.indexOf('// Cualquier fetch a /api/');
  const almacen = {};
  const ctx = { localStorage: { getItem: k => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: k => { delete almacen[k]; } },
    atob: s => Buffer.from(s, 'base64').toString('binary'), document: { getElementById: () => ({ textContent: '' }) }, setTimeout, Date, JSON, String,
    currentRole: 'admin', sessionExpiry: null, setupTopbar() {}, pantalla: null, window: {} };
  ctx.showScreen = id => { ctx.pantalla = id; };
  vm.createContext(ctx);
  vm.runInContext(src.slice(ini, fin), ctx);
  const tok = exp => Buffer.from(JSON.stringify({ u: 'admin', r: 'admin', p: true, exp })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.firma';
  Object.assign(almacen, { pf_user: 'admin', pf_role: 'admin', pf_premium: '1', pf_token: tok(Date.now() + 86400e3) });
  chequear('token vigente: no vencido', ctx.pfTokenVencido() === false);
  almacen.pf_token = tok(Date.now() - 1000);
  chequear('token con exp pasado: vencido', ctx.pfTokenVencido() === true);
  delete almacen.pf_token;
  chequear('logueado sin token: vencido', ctx.pfTokenVencido() === true);
  almacen.pf_token = 'basura';
  chequear('token ilegible: vencido', ctx.pfTokenVencido() === true);
  ctx.pfSesionOk();
  chequear('sesion vencida borra pf_token/pf_role/pf_premium/pf_expiry', !('pf_token' in almacen) && !('pf_role' in almacen) && !('pf_premium' in almacen) && !('pf_expiry' in almacen));
  chequear('y manda a la pantalla de login', ctx.pantalla === 'loginScreen');
  chequear('el mensaje es el pedido', ctx.PF_MSG_SESION_VENCIDA === 'Tu sesión venció, volvé a entrar', ctx.PF_MSG_SESION_VENCIDA);
  Object.keys(almacen).forEach(k => delete almacen[k]); almacen.pf_role = 'guest'; almacen.pf_user = 'Invitado';
  chequear('un invitado sin token no se considera vencido', ctx.pfTokenVencido() === false);
}

console.log('\n' + oks + ' ok, ' + fallos + ' fallas');
process.exit(fallos ? 1 : 0);
