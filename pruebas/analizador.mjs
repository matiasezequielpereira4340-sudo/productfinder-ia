// pruebas/analizador.mjs
// Se corre con: npm run test:analizador
//
// Sin red: fetch esta mockeado. Hace correr el codigo REAL de
// api/herramientas.js, _sesion.js y _meli.js contra un Supabase y una API de
// MercadoLibre falsos, para no volver a mostrar "no encontre la publicacion"
// cuando el problema fue el token.

process.env.SESSION_SECRET = 'secreto-de-prueba';
process.env.SUPABASE_URL = 'http://supa.test';
process.env.SUPABASE_SERVICE_KEY = 'service-key-de-prueba';

const { emitirToken } = await import('../api/_sesion.js');
const { default: handler } = await import('../api/herramientas.js');

// ---- Estado del mock ----
let modoItem = 'ok';          // ok | 403 | 404 | 500
const llamadasMeli = [];      // { url, auth }
const consultasTokens = [];   // user_id pedidos a meli_tokens
const TOKENS = { ana: 'TOK_ANA', beto: 'TOK_BETO' };

function resp(status, cuerpo) {
  return new Response(cuerpo == null ? '' : JSON.stringify(cuerpo), {
    status, headers: { 'content-type': 'application/json' }
  });
}

globalThis.fetch = async function (recurso, opciones) {
  const url = String(typeof recurso === 'string' ? recurso : recurso.url);
  const h = (opciones && opciones.headers) || {};
  const auth = h.Authorization || h.authorization || null;

  if (url.startsWith('http://supa.test')) {
    if (url.includes('/meli_user_aliases')) return resp(200, []);
    if (url.includes('/meli_tokens')) {
      const m = url.match(/user_id=eq\.([^&]+)/);
      const u = m ? decodeURIComponent(m[1]) : '';
      consultasTokens.push(u);
      if (!TOKENS[u]) return resp(200, []);
      return resp(200, [{ user_id: u, meli_user_id: 999, access_token: TOKENS[u],
        refresh_token: 'r', expires_at: new Date(Date.now() + 5 * 3600 * 1000).toISOString() }]);
    }
    if (url.includes('/listing_analyses')) {
      if (opciones && opciones.method === 'POST') return resp(201, null);
      return resp(200, []);
    }
    return resp(404, { message: 'tabla desconocida' });
  }

  if (url.startsWith('https://api.mercadolibre.com')) {
    llamadasMeli.push({ url, auth });
    // Sin token, MeLi hoy contesta 403 a todo.
    if (!auth) return resp(403, { blocked_by: 'PolicyAgent' });
    const p = new URL(url).pathname;
    if (p === '/items/MLA123456789') {
      if (modoItem === '403') return resp(403, { blocked_by: 'PolicyAgent' });
      if (modoItem === '404') return resp(404, { message: 'Item not found' });
      if (modoItem === '500') return resp(500, { message: 'boom' });
      return resp(200, {
        id: 'MLA123456789', title: 'Auriculares Bluetooth Inalambricos Tws 5.3 Negro', price: 25000,
        currency_id: 'ARS', category_id: 'MLA3697', seller_id: 42, condition: 'new', sold_quantity: 10,
        date_created: new Date(Date.now() - 60 * 86400000).toISOString(),
        permalink: 'https://articulo.mercadolibre.com.ar/MLA-123456789',
        pictures: [{ secure_url: 'https://x/1.jpg', max_size: '1200x1200' }, { max_size: '1200x1200' }],
        shipping: { free_shipping: true, logistic_type: 'fulfillment' },
        attributes: [{ id: 'BRAND', value_name: 'Genérica' }]
      });
    }
    if (p === '/items/MLA123456789/description') return resp(200, { plain_text: 'Descripcion\n- punto 1\n- punto 2' });
    if (p === '/users/42') return resp(200, { seller_reputation: { level_id: '5_green', power_seller_status: 'gold' } });
    if (p === '/categories/MLA3697/attributes') return resp(200, [{ id: 'BRAND', tags: { required: true } }, { id: 'MODEL', tags: {} }]);
    if (p === '/highlights/MLA/category/MLA3697') return resp(200, { content: [
      { id: 'MLA111', type: 'ITEM' }, { id: 'MLAP1', type: 'PRODUCT' }, { id: 'MLA222', type: 'ITEM' }] });
    if (p === '/items' && url.includes('ids=')) return resp(200, [
      { code: 200, body: { id: 'MLA111', title: 'Top uno de la categoria con titulo largo', price: 20000, sold_quantity: 500, shipping: { free_shipping: true, logistic_type: 'fulfillment' }, status: 'active', permalink: 'https://articulo.mercadolibre.com.ar/MLA-111' } },
      { code: 200, body: { id: 'MLA222', title: 'Top dos', price: 30000, sold_quantity: 200, shipping: { free_shipping: false }, status: 'active' } }
    ]);
    if (p === '/sites/MLA/domain_discovery/search') return resp(200, [{ category_id: 'MLA3697' }]);
    if (p === '/products/search') return resp(200, { results: [] });
    if (p === '/users/999/items/search') return resp(200, { results: [] });
    if (p === '/sites/MLA/listing_prices') return resp(200, [
      { listing_type_id: 'gold_special', listing_type_name: 'Clásica', sale_fee_details: { percentage_fee: 14.5, fixed_fee: 0 } },
      { listing_type_id: 'gold_pro', listing_type_name: 'Premium', sale_fee_details: { percentage_fee: 18.5, fixed_fee: 0 } }
    ]);
    if (p.startsWith('/sites/MLA/search')) throw new Error('No se debe usar /sites/MLA/search: ' + url);
    return resp(404, { message: 'no mockeado: ' + p });
  }

  throw new Error('Red real no permitida en la prueba: ' + url);
};

// ---- req/res falsos ----
function llamar({ body, sesion, method }) {
  const headers = {};
  if (sesion) headers.authorization = 'Bearer ' + sesion;
  const req = { method: method || 'POST', headers, body: body || {}, query: {} };
  return new Promise((ok) => {
    const res = {
      statusCode: 200, cuerpo: null, _h: {},
      setHeader(k, v) { this._h[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { this.cuerpo = o; ok(this); return this; },
      end() { ok(this); return this; }
    };
    Promise.resolve(handler(req, res)).catch(e => { res.statusCode = 999; res.cuerpo = { excepcion: String(e) }; ok(res); });
  });
}

let fallas = 0, pasadas = 0;
function check(nombre, cond, extra) {
  if (cond) { pasadas++; console.log('  ok   ' + nombre); }
  else { fallas++; console.log('  FALLA ' + nombre + (extra ? '\n        ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
function reset() { llamadasMeli.length = 0; consultasTokens.length = 0; modoItem = 'ok'; }

const URL_ITEM = 'https://articulo.mercadolibre.com.ar/MLA-123456789-auriculares-_JM';
const sesAna = emitirToken({ user: 'ana', role: 'user', premium: false });
const sesSinMeli = emitirToken({ user: 'carla', role: 'user', premium: false });
const NO_ENCONTRE = /no encontr/i;

console.log('Analizador de publicaciones');

// 1) Sin sesion
reset();
let r = await llamar({ body: { url: URL_ITEM } });
check('sin sesion -> 401 sin_sesion', r.statusCode === 401 && r.cuerpo.codigo === 'sin_sesion', r.cuerpo);
check('sin sesion -> no le pega a MeLi', llamadasMeli.length === 0, llamadasMeli);

// 1b) Sesion falsificada (firma invalida) = sin sesion
reset();
r = await llamar({ body: { url: URL_ITEM }, sesion: sesAna.split('.')[0] + '.firmaTrucha' });
check('sesion con firma invalida -> 401 sin_sesion', r.statusCode === 401 && r.cuerpo.codigo === 'sin_sesion', r.cuerpo);

// 2) Sesion sin token de MeLi
reset();
r = await llamar({ body: { url: URL_ITEM }, sesion: sesSinMeli });
check('sesion sin MeLi -> 401 sin_meli', r.statusCode === 401 && r.cuerpo.codigo === 'sin_meli', r.cuerpo);
check('sesion sin MeLi -> busca el token de "carla"', consultasTokens.includes('carla'), consultasTokens);

// 3) MeLi 403
reset(); modoItem = '403';
r = await llamar({ body: { url: URL_ITEM }, sesion: sesAna });
check('MeLi 403 -> codigo meli_rechazo', r.cuerpo && r.cuerpo.codigo === 'meli_rechazo', r.cuerpo);
check('MeLi 403 -> NO dice "no encontre"', !NO_ENCONTRE.test(r.cuerpo.error || ''), r.cuerpo);

// 4) MeLi 404
reset(); modoItem = '404';
r = await llamar({ body: { url: URL_ITEM }, sesion: sesAna });
check('MeLi 404 -> "no existe o esta finalizada"', r.statusCode === 404 && r.cuerpo.codigo === 'no_existe' && /no existe/i.test(r.cuerpo.error), r.cuerpo);

// 4b) MeLi 500
reset(); modoItem = '500';
r = await llamar({ body: { url: URL_ITEM }, sesion: sesAna });
check('MeLi 500 -> "no respondio", no "no encontre"', r.cuerpo.codigo === 'meli_caido' && /no respondi/i.test(r.cuerpo.error) && !NO_ENCONTRE.test(r.cuerpo.error), r.cuerpo);

// 5) Camino feliz
reset();
r = await llamar({ body: { url: URL_ITEM }, sesion: sesAna });
const secs = ['titulo', 'fotos', 'descripcion', 'atributos', 'envio', 'precio', 'condicion', 'reputacion'];
check('camino feliz -> 200 con scoreTotal', r.statusCode === 200 && r.cuerpo.ok && typeof r.cuerpo.scoreTotal === 'number', r.cuerpo);
check('camino feliz -> las 8 secciones', r.cuerpo.secciones && secs.every(k => r.cuerpo.secciones[k] && typeof r.cuerpo.secciones[k].score === 'number'));
check('camino feliz -> comparativa por highlights (2 items, sin el PRODUCT)', Array.isArray(r.cuerpo.topCategoria) && r.cuerpo.topCategoria.length === 2 && r.cuerpo.comparacion && r.cuerpo.comparacion.muestra === 2, r.cuerpo.topCategoria);
check('camino feliz -> todas las llamadas a MeLi llevan Authorization: Bearer TOK_ANA',
  llamadasMeli.length >= 5 && llamadasMeli.every(c => c.auth === 'Bearer TOK_ANA'), llamadasMeli);
check('camino feliz -> no usa /sites/MLA/search', !llamadasMeli.some(c => c.url.includes('/sites/MLA/search')));
check('camino feliz -> userId del informe = usuario de la sesion', r.cuerpo.userId === 'ana', r.cuerpo.userId);

// 6) userId del body NO elige el token
reset();
r = await llamar({ body: { url: URL_ITEM, userId: 'beto' }, sesion: sesAna });
check('userId "beto" en el body -> igual usa el token de "ana"', r.statusCode === 200 && llamadasMeli.every(c => c.auth === 'Bearer TOK_ANA'), llamadasMeli);
check('userId en el body -> nunca se consulta meli_tokens de "beto"', !consultasTokens.includes('beto'), consultasTokens);
reset();
r = await llamar({ body: { url: URL_ITEM, userId: 'ana' } });
check('userId "ana" en el body SIN sesion -> 401 sin_sesion', r.statusCode === 401 && r.cuerpo.codigo === 'sin_sesion' && llamadasMeli.length === 0, r.cuerpo);

// 7) Ejemplo
console.log('Publicacion de ejemplo');
reset();
r = await llamar({ body: { accion: 'ejemplo' } });
check('ejemplo sin sesion -> sin_sesion', r.cuerpo.codigo === 'sin_sesion', r.cuerpo);
reset();
r = await llamar({ body: { accion: 'ejemplo' }, sesion: sesSinMeli });
check('ejemplo sin MeLi -> sin_meli', r.cuerpo.codigo === 'sin_meli', r.cuerpo);
reset();
r = await llamar({ body: { accion: 'ejemplo' }, sesion: sesAna });
check('ejemplo conectado -> url de una publicacion viva', r.cuerpo.ok && /MLA-111/.test(r.cuerpo.url), r.cuerpo);
check('ejemplo -> con token y sin /sites/MLA/search', llamadasMeli.every(c => c.auth === 'Bearer TOK_ANA') && !llamadasMeli.some(c => c.url.includes('/sites/MLA/search?')), llamadasMeli);

// 8) Comisiones
console.log('Comisiones');
reset();
r = await llamar({ body: { accion: 'comisiones', precio: 100000 } });
check('comisiones sin sesion -> ok:false sin_meli y sin llamar a MeLi', r.cuerpo.ok === false && r.cuerpo.motivo === 'sin_meli' && llamadasMeli.length === 0, r.cuerpo);
reset();
r = await llamar({ body: { accion: 'comisiones', precio: 100000 }, sesion: sesSinMeli });
check('comisiones sin MeLi -> ok:false sin_meli', r.cuerpo.ok === false && r.cuerpo.motivo === 'sin_meli', r.cuerpo);
reset();
r = await llamar({ body: { accion: 'comisiones', precio: 100000 }, sesion: sesAna });
check('comisiones conectado -> reales con el token del usuario', r.cuerpo.ok && r.cuerpo.clasica.porcentaje === 14.5 && r.cuerpo.conToken && llamadasMeli.every(c => c.auth === 'Bearer TOK_ANA'), r.cuerpo);
check('comisiones -> nunca pide meli_tokens sin usuario', !consultasTokens.includes('') && !consultasTokens.includes('null'), consultasTokens);

console.log('\n' + pasadas + ' ok, ' + fallas + ' fallas');
process.exit(fallas ? 1 : 0);
