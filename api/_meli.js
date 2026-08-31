// api/_meli.js
// Helpers compartidos de MercadoLibre + Supabase.
// Vercel ignora los archivos de /api que empiezan con "_": no es un endpoint,
// es la libreria que usan meli-auth, meli-callback, meli-refresh, meli-check,
// market y analyze para no repetir (ni desincronizar) la misma logica.

export const MELI_API = 'https://api.mercadolibre.com';
export const MELI_AUTH = 'https://auth.mercadolibre.com.ar/authorization';

// ------------------------------------------------------------
// Credenciales de la app de MeLi
// En el proyecto conviven dos juegos de nombres (MELI_APP_ID/MELI_SECRET_KEY y
// MELI_CLIENT_ID/MELI_CLIENT_SECRET). Antes cada endpoint leia uno solo, asi
// que segun cual estuviera cargada en Vercel fallaba la conexion, el refresco
// o las busquedas, sin decir por que. Aca se aceptan los dos.
// ------------------------------------------------------------
export function meliCreds() {
  const clientId = process.env.MELI_APP_ID || process.env.MELI_CLIENT_ID || '';
  const clientSecret = process.env.MELI_SECRET_KEY || process.env.MELI_CLIENT_SECRET || '';
  const faltan = [];
  if (!clientId) faltan.push('MELI_APP_ID (o MELI_CLIENT_ID)');
  if (!clientSecret) faltan.push('MELI_SECRET_KEY (o MELI_CLIENT_SECRET)');
  return { clientId, clientSecret, ok: !!(clientId && clientSecret), faltan };
}

// Origen publico desde el que se sirve la app (para volver del OAuth).
export function appOrigin(req) {
  if (process.env.APP_ORIGIN) return String(process.env.APP_ORIGIN).replace(/\/+$/, '');
  const h = (req && req.headers) || {};
  const host = h['x-forwarded-host'] || h.host;
  const proto = h['x-forwarded-proto'] || 'https';
  if (host) return proto + '://' + host;
  return 'https://productfinder-ia.vercel.app';
}

// redirect_uri del OAuth. Tiene que ser IDENTICA en la URL de autorizacion y en
// el canje del code, y estar registrada en el panel de la app de MercadoLibre.
// Se deriva del host real del request para que funcione tambien en un dominio
// propio o en un deploy de preview; MELI_REDIRECT_URI la fuerza si hace falta.
export function meliRedirectUri(req) {
  if (process.env.MELI_REDIRECT_URI) return String(process.env.MELI_REDIRECT_URI).trim();
  return appOrigin(req) + '/api/meli-callback';
}

export function cors(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', methods || 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ------------------------------------------------------------
// Supabase (REST con service key)
// ------------------------------------------------------------
export function supa() {
  const url = (process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  return { url, key, ok: !!key };
}

// Siempre devuelve un array: si Supabase contesta un error (falta la key, la
// tabla no existe) devuelve un objeto y el codigo viejo hacia rows[0] sobre el
// y concluia "no hay token", tapando el error real.
async function supaRows(path, init) {
  const { url, key, ok } = supa();
  if (!ok) throw new Error('SUPABASE_SERVICE_KEY no configurada');
  const r = await fetch(url + path, {
    ...(init || {}),
    headers: { apikey: key, Authorization: 'Bearer ' + key, ...((init && init.headers) || {}) }
  });
  const txt = await r.text();
  let body = null;
  try { body = txt ? JSON.parse(txt) : null; } catch (_) { body = txt; }
  if (!r.ok) {
    const msg = body && body.message ? body.message : String(txt).slice(0, 200);
    const err = new Error('Supabase ' + r.status + ': ' + msg);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return Array.isArray(body) ? body : [];
}

// El usuario con el que se entra a la app no siempre es el mismo con el que se
// conecto MercadoLibre: cuando se cambio APP_USER por un nombre nuevo, la
// conexion quedo guardada con el nombre viejo y todos los endpoints la
// buscaban con el nuevo, o sea "no conectado" aunque el token estuviera vivo.
// La tabla meli_user_aliases mapea alias -> user_id real; aca se resuelve una
// sola vez por proceso.
const _aliasCache = new Map();

export async function resolveUserId(userId) {
  if (!userId) return userId;
  const clave = String(userId);
  if (_aliasCache.has(clave)) return _aliasCache.get(clave);
  let real = clave;
  try {
    const rows = await supaRows('/rest/v1/meli_user_aliases?alias=eq.' +
      encodeURIComponent(clave) + '&select=user_id&limit=1');
    if (rows[0] && rows[0].user_id) real = String(rows[0].user_id);
  } catch (_) { /* si la tabla no existe, se usa el user_id tal cual */ }
  _aliasCache.set(clave, real);
  return real;
}

export async function getTokenRow(userId) {
  if (!userId) return null;
  const real = await resolveUserId(userId);
  const rows = await supaRows('/rest/v1/meli_tokens?user_id=eq.' +
    encodeURIComponent(real) + '&select=*&limit=1');
  return rows[0] || null;
}

export async function listTokenRows(limit) {
  return await supaRows('/rest/v1/meli_tokens?select=user_id,expires_at,updated_at&order=updated_at.desc&limit=' +
    (limit || 100));
}

// Upsert tolerante: si la tabla no tiene el UNIQUE(user_id) que necesita
// on_conflict, el upsert falla con 42P10. En ese caso hacemos UPDATE y, si no
// afecto ninguna fila, INSERT. Asi conectar la cuenta no depende de que el
// indice este creado en la base.
export async function saveTokenRow(data) {
  const { url, key, ok } = supa();
  if (!ok) throw new Error('SUPABASE_SERVICE_KEY no configurada');
  // Guardamos siempre con el user_id canonico, para no terminar con dos filas
  // (una por el alias y otra por el nombre real) que se pisan entre si.
  const canonico = await resolveUserId(data.user_id);
  const payload = {
    user_id: String(canonico),
    meli_user_id: String(data.meli_user_id || ''),
    access_token: data.access_token,
    expires_at: new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString(),
    updated_at: new Date().toISOString()
  };
  // Si MeLi no mando refresh_token nuevo, no pisamos el que ya estaba.
  if (data.refresh_token) payload.refresh_token = data.refresh_token;

  const base = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

  const up = await fetch(url + '/rest/v1/meli_tokens?on_conflict=user_id', {
    method: 'POST',
    headers: { ...base, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload)
  });
  if (up.ok) return { modo: 'upsert' };
  const errUpsert = (await up.text()).slice(0, 300);

  const patch = await fetch(url + '/rest/v1/meli_tokens?user_id=eq.' + encodeURIComponent(payload.user_id), {
    method: 'PATCH',
    headers: { ...base, Prefer: 'return=representation' },
    body: JSON.stringify(payload)
  });
  if (patch.ok) {
    const filas = await patch.json().catch(() => []);
    if (Array.isArray(filas) && filas.length) return { modo: 'update' };
  }

  const ins = await fetch(url + '/rest/v1/meli_tokens', {
    method: 'POST',
    headers: { ...base, Prefer: 'return=minimal' },
    body: JSON.stringify(payload)
  });
  if (ins.ok) return { modo: 'insert' };
  const errInsert = (await ins.text()).slice(0, 300);
  throw new Error('No pude guardar el token en Supabase. upsert: ' + errUpsert + ' | insert: ' + errInsert);
}

// ------------------------------------------------------------
// Tokens de MercadoLibre
// ------------------------------------------------------------
export async function exchangeCode(code, redirectUri) {
  const { clientId, clientSecret, ok, faltan } = meliCreds();
  if (!ok) throw new Error('Faltan credenciales de la app de MeLi: ' + faltan.join(', '));
  const r = await fetch(MELI_API + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    }).toString()
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    const detalle = data && (data.message || data.error_description || data.error) || ('HTTP ' + r.status);
    const err = new Error(String(detalle));
    err.meli = data;
    throw err;
  }
  return data;
}

export async function refreshWithToken(refreshToken) {
  const { clientId, clientSecret, ok, faltan } = meliCreds();
  if (!ok) throw new Error('Faltan credenciales de la app de MeLi: ' + faltan.join(', '));
  if (!refreshToken) throw new Error('La cuenta no tiene refresh_token guardado: hay que reconectarla');
  const r = await fetch(MELI_API + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    }).toString()
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    const detalle = (data && (data.message || data.error_description || data.error)) || ('HTTP ' + r.status);
    throw new Error('MercadoLibre rechazo el refresh_token: ' + detalle);
  }
  return data;
}

// Token vigente de un usuario. Renueva si vence en menos de 5 minutos.
// Devuelve el token o null; nunca tira, para que un endpoint pueda seguir
// con datos parciales. El motivo queda en .motivo del objeto devuelto.
export async function getUserToken(userId) {
  try {
    const row = await getTokenRow(userId);
    if (!row) return { token: null, motivo: 'sin_conexion' };
    const venceMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (venceMs && venceMs - Date.now() > 5 * 60 * 1000) {
      return { token: row.access_token, motivo: 'ok', meli_user_id: row.meli_user_id };
    }
    const data = await refreshWithToken(row.refresh_token);
    await saveTokenRow({
      user_id: row.user_id || userId,
      meli_user_id: row.meli_user_id || data.user_id,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in || 21600
    });
    return { token: data.access_token, motivo: 'refrescado', meli_user_id: row.meli_user_id || data.user_id };
  } catch (e) {
    return { token: null, motivo: 'error', error: String((e && e.message) || e).slice(0, 300) };
  }
}

// ------------------------------------------------------------
// Busqueda de mercado
// ------------------------------------------------------------
export async function fetchJson(url, token, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 6000);
  try {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) return { ok: false, status: r.status, json: null };
    return { ok: true, status: r.status, json: await r.json().catch(() => null) };
  } catch (_) {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(t);
  }
}

// Busqueda sobre el catalogo de MercadoLibre.
// /sites/MLA/search (busqueda libre) devuelve 403 desde que MeLi la cerro a
// terceros, incluso con token de usuario. El catalogo sigue abierto:
//   /products/search        -> productos que matchean el termino
//   /products/{id}/items    -> las publicaciones reales de ese producto,
//                              con precio, vendedor, vendidos y envio
//   /products/{id}          -> buy_box_winner, como respaldo
// Se piden en paralelo y con presupuesto de tiempo, porque en serie una sola
// busqueda se comia los 10 s de la funcion y el request moria sin respuesta.
export async function catalogSearch(product, token, opts) {
  const o = opts || {};
  const maxProductos = o.maxProductos || 8;
  const deadline = Date.now() + (o.budgetMs || 6500);
  if (!token) return null;

  const q = encodeURIComponent(product);
  const busq = await fetchJson(
    MELI_API + '/products/search?status=active&site_id=MLA&limit=10&q=' + q, token, 5000);
  if (!busq.ok || !busq.json) return null;
  const catalogo = Array.isArray(busq.json.results) ? busq.json.results : [];
  if (!catalogo.length) return null;

  const total = (busq.json.paging && busq.json.paging.total) || catalogo.length;
  const ids = catalogo.slice(0, maxProductos).map(x =>
    (typeof x === 'string') ? x : (x && (x.id || x.catalog_product_id || x.product_id))
  ).filter(Boolean);
  const nombres = {};
  catalogo.forEach(x => { if (x && x.id) nombres[x.id] = x.name || ''; });

  const porProducto = await Promise.all(ids.map(async (id) => {
    if (Date.now() > deadline) return [];
    const titulo = nombres[id] || product;
    const items = await fetchJson(MELI_API + '/products/' + id + '/items?limit=10', token, 4000);
    if (items.ok && items.json && Array.isArray(items.json.results) && items.json.results.length) {
      return items.json.results
        .filter(it => it && typeof it.price === 'number' && it.price > 0)
        .map(it => ({
          id: it.item_id || it.id || id,
          title: titulo,
          price: it.price,
          sold_quantity: it.sold_quantity || 0,
          seller: { id: it.seller_id || null, nickname: it.seller_id ? ('Vendedor ' + it.seller_id) : '' },
          shipping: { free_shipping: !!(it.shipping && it.shipping.free_shipping) }
        }));
    }
    if (Date.now() > deadline) return [];
    const det = await fetchJson(MELI_API + '/products/' + id, token, 4000);
    const bb = det.ok && det.json ? det.json.buy_box_winner : null;
    if (bb && typeof bb.price === 'number' && bb.price > 0) {
      return [{
        id: bb.item_id || id,
        title: (det.json && det.json.name) || titulo,
        price: bb.price,
        sold_quantity: bb.sold_quantity || 0,
        seller: { id: bb.seller_id || null, nickname: bb.seller_id ? ('Vendedor ' + bb.seller_id) : '' },
        shipping: { free_shipping: !!(bb.shipping && bb.shipping.free_shipping) }
      }];
    }
    return [];
  }));

  const results = porProducto.flat();
  if (!results.length) return null;
  return {
    fuente: 'meli-catalogo',
    total,
    results,
    categoryName: (catalogo[0] && (catalogo[0].domain_id || '').split('-').pop()) || ''
  };
}

// Segunda via de precios reales, para cuando el catalogo no los da.
// /products/{id}/items puede venir vacio, pero estos tres endpoints siguen
// abiertos con token de usuario:
//   /sites/MLA/domain_discovery/search -> la categoria real del termino
//   /highlights/MLA/category/{cat}     -> los items mas vendidos de esa categoria
//   /items?ids=...                     -> precio, vendedor, vendidos y envio
// Despues se filtran por titulo, asi lo que se muestra son publicaciones del
// producto buscado y no "lo mas vendido de la categoria" disfrazado.
export async function highlightsSearch(product, token, opts) {
  if (!token) return null;
  const o = opts || {};
  const deadline = Date.now() + (o.budgetMs || 6500);
  const q = encodeURIComponent(product);

  const dom = await fetchJson(MELI_API + '/sites/MLA/domain_discovery/search?limit=3&q=' + q, token, 4000);
  const cats = (dom.ok && Array.isArray(dom.json))
    ? dom.json.map(d => d && d.category_id).filter(Boolean) : [];
  if (!cats.length) return null;

  const nombreCat = (dom.json[0] && (dom.json[0].category_name || dom.json[0].domain_name)) || '';
  const hl = await fetchJson(MELI_API + '/highlights/MLA/category/' + cats[0], token, 4000);
  const contenido = (hl.ok && hl.json && Array.isArray(hl.json.content)) ? hl.json.content : [];
  const ids = contenido
    .filter(c => c && c.id && (!c.type || c.type === 'ITEM'))
    .map(c => c.id).slice(0, 40);
  if (!ids.length) return null;

  // /items?ids= acepta de a 20.
  const lotes = [];
  for (let i = 0; i < ids.length; i += 20) lotes.push(ids.slice(i, i + 20));
  const atributos = 'id,title,price,sold_quantity,seller_id,shipping,category_id';
  const respuestas = await Promise.all(lotes.map(l => {
    if (Date.now() > deadline) return { ok: false, json: null };
    return fetchJson(MELI_API + '/items?ids=' + l.join(',') + '&attributes=' + atributos, token, 5000);
  }));

  const items = [];
  for (const r of respuestas) {
    if (!r.ok || !Array.isArray(r.json)) continue;
    for (const fila of r.json) {
      const b = fila && (fila.body || fila);
      if (b && typeof b.price === 'number' && b.price > 0 && b.title) items.push(b);
    }
  }
  if (!items.length) return null;

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const palabras = norm(product).split(/\s+/).filter(w => w.length > 2);
  const conTodas = items.filter(it => { const t = norm(it.title); return palabras.every(w => t.includes(w)); });
  const conAlguna = items.filter(it => { const t = norm(it.title); return palabras.some(w => t.includes(w)); });

  // Si nada del ranking habla del producto, no forzamos: mejor sin dato que un
  // dato de otra cosa.
  const elegidos = conTodas.length >= 3 ? conTodas : (conAlguna.length >= 3 ? conAlguna : []);
  if (!elegidos.length) return null;

  return {
    fuente: conTodas.length >= 3 ? 'meli-destacados' : 'meli-destacados-parcial',
    // No hay total de publicaciones por esta via: se deja en null a proposito
    // para que la saturacion no se calcule sobre una muestra de 40 items.
    total: null,
    muestra: elegidos.length,
    categoryName: nombreCat,
    results: elegidos.map(it => ({
      id: it.id,
      title: it.title,
      price: it.price,
      sold_quantity: it.sold_quantity || 0,
      seller: { id: it.seller_id || null, nickname: it.seller_id ? ('Vendedor ' + it.seller_id) : '' },
      shipping: { free_shipping: !!(it.shipping && it.shipping.free_shipping) }
    }))
  };
}

// Slug del listado publico de MercadoLibre ("auriculares bluetooth" ->
// "auriculares-bluetooth"). Saca acentos en vez de borrar la letra.
export function meliSlug(product) {
  return String(product || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// Tercera via, y la que queda cuando el catalogo y los destacados fallan:
//   1. Del listado publico se sacan SOLO los IDs de publicacion. Un ID es un
//      MLA seguido de numeros: sobrevive a cualquier rediseño del HTML, al
//      contrario de scrapear precios y titulos de las clases CSS.
//   2. Los numeros (precio, vendedor, vendidos, envio) salen de /items?ids=,
//      la API oficial. Nada de precios leidos del HTML.
// Si MercadoLibre bloquea el listado desde el server, devuelve null y la
// cadena sigue con la ultima opcion.
export async function publicIdsSearch(product, token, opts) {
  const o = opts || {};
  const deadline = Date.now() + (o.budgetMs || 7000);
  const html = await fetchListadoHtml(product, o.timeoutMs || 6000);
  if (!html || !html.texto) return null;

  const ids = extraerIdsMLA(html.texto).slice(0, o.maxIds || 40);
  if (!ids.length) return null;

  const items = await hidratarItems(ids, token, deadline);
  if (!items.length) return null;

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const palabras = norm(product).split(/\s+/).filter(w => w.length > 2);
  const conTodas = items.filter(it => { const t = norm(it.title); return palabras.every(w => t.includes(w)); });
  const elegidos = conTodas.length >= 3 ? conTodas : items;

  return {
    fuente: 'meli-listado+items',
    total: html.total || null,
    muestra: elegidos.length,
    categoryName: html.categoria || '',
    results: elegidos.map(it => ({
      id: it.id,
      title: it.title,
      price: it.price,
      sold_quantity: it.sold_quantity || 0,
      seller: { id: it.seller_id || null, nickname: it.seller_id ? ('Vendedor ' + it.seller_id) : '' },
      shipping: { free_shipping: !!(it.shipping && it.shipping.free_shipping) }
    }))
  };
}

// Las direcciones publicas donde MercadoLibre lista resultados. Se prueban en
// orden hasta que una traiga IDs: si le ponen un muro anti-bot a una, puede
// que otra siga sirviendo HTML.
export function candidatosDeListado(product) {
  const slug = meliSlug(product);
  const q = encodeURIComponent(product);
  return [
    'https://listado.mercadolibre.com.ar/' + slug,
    'https://www.mercadolibre.com.ar/jm/search?as_word=' + q,
    'https://listado.mercadolibre.com.ar/' + slug + '_DisplayType_LF',
    'https://www.mercadolibre.com.ar/ofertas?q=' + q
  ];
}

// Un navegador de verdad manda mas que el User-Agent. Sin estas cabeceras
// MercadoLibre devuelve una pagina intermedia en vez de los resultados.
const CABECERAS_NAVEGADOR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

export async function traerPagina(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 6000);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: CABECERAS_NAVEGADOR });
    const texto = r.ok ? await r.text() : '';
    return { status: r.status, urlFinal: r.url || url, texto };
  } catch (_) {
    return { status: 0, urlFinal: url, texto: '' };
  } finally {
    clearTimeout(t);
  }
}

// Devuelve la primera pagina publica que realmente traiga IDs de publicacion.
export async function fetchListadoHtml(product, timeoutMs) {
  for (const url of candidatosDeListado(product)) {
    const pag = await traerPagina(url, timeoutMs);
    if (!pag.texto || !extraerIdsMLA(pag.texto).length) continue;
    let total = 0;
    const m = pag.texto.match(/([\d][\d.,]*)\s*resultados/i);
    if (m) total = parseInt(String(m[1]).replace(/[^0-9]/g, ''), 10) || 0;
    let categoria = '';
    const h1 = pag.texto.match(/<h1[^>]*>([^<]{3,80})<\/h1>/i);
    if (h1) categoria = h1[1].trim();
    return { status: pag.status, url, texto: pag.texto, total, categoria };
  }
  return null;
}

// Extraer IDs de publicacion del HTML.
// La version anterior agarraba cualquier "MLA" seguido de 8 o mas digitos y se
// traia ids de tracking y de promociones: MLA96631608403 (13 digitos) o
// MLA108324869725 (15), que /items?ids= rechaza. Un item real tiene 9 a 11
// digitos y aparece en la URL del articulo o como item_id en los JSON
// embebidos. Los /p/MLA... quedan afuera a proposito: son productos de
// catalogo, no publicaciones.
const PATRONES_ITEM = [
  /articulo\.mercadolibre\.com\.ar\/MLA-(\d{9,11})-/g,
  /\/MLA-(\d{9,11})-/g,
  /"item_id"\s*:\s*"MLA(\d{9,11})"/g,
  /"itemId"\s*:\s*"MLA(\d{9,11})"/g,
  /"id"\s*:\s*"MLA(\d{9,11})"/g
];

export function extraerIdsMLA(html) {
  const texto = String(html || '');
  const vistos = new Set();
  const ids = [];
  for (const patron of PATRONES_ITEM) {
    patron.lastIndex = 0;
    let m;
    while ((m = patron.exec(texto)) !== null) {
      const id = 'MLA' + m[1];
      if (!vistos.has(id)) { vistos.add(id); ids.push(id); }
    }
  }
  return ids;
}

// Cuantos IDs aporta cada patron: si MercadoLibre cambia el formato de sus
// links se ve aca, sin tener que leer 600 KB de HTML a mano.
export function idsPorPatron(html) {
  const texto = String(html || '');
  const salida = {};
  PATRONES_ITEM.forEach((patron, i) => {
    patron.lastIndex = 0;
    const encontrados = new Set();
    let m;
    while ((m = patron.exec(texto)) !== null) encontrados.add('MLA' + m[1]);
    salida['patron_' + i] = encontrados.size;
  });
  return salida;
}

// /items?ids= acepta de a 20 y devuelve [{code, body}].
export async function hidratarItems(ids, token, deadline) {
  const atributos = 'id,title,price,sold_quantity,seller_id,shipping,category_id,status';
  const lotes = [];
  for (let i = 0; i < ids.length; i += 20) lotes.push(ids.slice(i, i + 20));
  const respuestas = await Promise.all(lotes.map(l => {
    if (deadline && Date.now() > deadline) return { ok: false, json: null };
    return fetchJson(MELI_API + '/items?ids=' + l.join(',') + '&attributes=' + atributos, token, 5000);
  }));
  const items = [];
  for (const r of respuestas) {
    if (!r.ok || !Array.isArray(r.json)) continue;
    for (const fila of r.json) {
      const b = fila && (fila.body || fila);
      if (b && b.title && typeof b.price === 'number' && b.price > 0) items.push(b);
    }
  }
  return items;
}

// ------------------------------------------------------------
// Cadena unica de busqueda de publicaciones
// La usan el analizador (market) y el recomendador (analyze), para que no haya
// dos versiones distintas de "como se busca en MercadoLibre".
//
// Estado medido en produccion el 31/08/2026:
//   /sites/MLA/search        403 (cerrado a terceros)
//   /products/{id}/items     404
//   /products/{id} buy_box   null
//   /highlights/{categoria}  403
//   listado publico + /items?ids=  <- la via que queda
//
// El orden se mantiene por si MeLi reabre alguno, pero se recuerda cual anduvo:
// probar tres vias muertas por cada producto se comia el tiempo de la funcion.
// ------------------------------------------------------------
const _viaEstado = { preferida: null, fallos: {} };

export async function buscarPublicaciones(product, token, opts) {
  if (!token || !product) return null;
  const o = opts || {};
  const vias = {
    catalogo: () => catalogSearch(product, token, { maxProductos: o.maxProductos || 6, budgetMs: o.budgetMs || 5000 }),
    destacados: () => highlightsSearch(product, token, { budgetMs: o.budgetMs || 5000 }),
    listado: () => publicIdsSearch(product, token, { budgetMs: o.budgetMs || 6000, maxIds: o.maxIds || 40 }),
    // Ultima, porque es la unica que cuesta plata: solo se paga cuando ninguna
    // via gratuita respondio.
    proveedor: async () => {
      const mod = await import('./_buscador.js');
      return await mod.buscarConProveedor(product, token, {
        maxItems: o.maxIds || 25,
        budgetMs: o.budgetMs || 8000,
        timeoutMs: o.timeoutProveedorMs || 25000
      });
    }
  };
  // El orden es de mejor a peor dato (el catalogo trae total de publicaciones,
  // el listado tambien, los destacados no) y no se altera: lo unico que se
  // recuerda es cual esta muerta, para no reintentarla por cada producto.
  const orden = ['catalogo', 'destacados', 'listado', 'proveedor'];
  for (const nombre of orden) {
    const fallos = _viaEstado.fallos[nombre] || 0;
    // Se saltea la via que ya fallo dos veces, siempre que otra este andando.
    // El tope de 4 cubre el caso de que no ande ninguna. Si MeLi reabre una,
    // el proximo cold start la vuelve a probar.
    if (fallos >= 2 && (_viaEstado.preferida || fallos >= 4)) continue;
    try {
      const r = await vias[nombre]();
      if (r && r.results && r.results.length) {
        _viaEstado.preferida = nombre;
        return r;
      }
      _viaEstado.fallos[nombre] = (_viaEstado.fallos[nombre] || 0) + 1;
    } catch (_) {
      _viaEstado.fallos[nombre] = (_viaEstado.fallos[nombre] || 0) + 1;
    }
  }
  return null;
}

export function viaDeBusquedaUsada() {
  return { preferida: _viaEstado.preferida, fallos: { ..._viaEstado.fallos } };
}
