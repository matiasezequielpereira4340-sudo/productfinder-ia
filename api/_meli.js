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

// Cabeceras para la API de Anthropic.
// Medido en produccion: con la key de la cuenta, los tres modelos devuelven el
// mismo 400 -- "anthropic-workspace-id is required when authenticating with an
// identity-linked API key". No es el modelo ni el request: la key esta
// vinculada a una identidad y exige que se diga en que workspace actua.
// El id se saca de la consola de Anthropic y se carga en ANTHROPIC_WORKSPACE_ID.
export function anthropicHeaders() {
  const h = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY || '',
    'anthropic-version': '2023-06-01'
  };
  const ws = process.env.ANTHROPIC_WORKSPACE_ID;
  if (ws) h['anthropic-workspace-id'] = String(ws).trim();
  return h;
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

// El dolar del dia, para no calcular margenes con una cotizacion vieja. Si el
// vendedor cargo su propio tipo de cambio, ese manda. Vive aca y no en un
// endpoint porque lo usan las ventas y el stock, y en Vercel cada archivo de
// /api que no empieza con "_" cuenta contra el limite de funciones del plan.
export async function tipoDeCambio(userId) {
  try {
    const filas = await supaRows('/rest/v1/clientes?user_id=eq.' +
      encodeURIComponent(userId) + '&select=tipo_cambio_usd&limit=1');
    const propio = filas[0] && parseFloat(filas[0].tipo_cambio_usd);
    if (propio && propio > 0) return { valor: propio, fuente: 'propio' };
  } catch (_) {}
  try {
    const r = await fetch('https://dolarapi.com/v1/dolares/tarjeta');
    if (r.ok) {
      const j = await r.json();
      if (j && j.venta > 0) return { valor: j.venta, fuente: 'dolar tarjeta del dia' };
    }
  } catch (_) {}
  return { valor: parseFloat(process.env.USD_ARS) || 1500, fuente: 'valor por defecto' };
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
// ------------------------------------------------------------
// Sitios de MercadoLibre
// Toda la cadena de busqueda estaba clavada en MLA: el dominio del listado
// publico, el prefijo de los IDs y el site_id del catalogo. Para poder mirar
// si un producto se vende en Brasil o Mexico (el mejor proxy que hay para
// Argentina cuando aca no existe) hace falta parametrizar eso por sitio.
// ------------------------------------------------------------
export const SITIOS = {
  MLA: { id: 'MLA', pais: 'Argentina', dominio: 'mercadolibre.com.ar', listado: 'listado.mercadolibre.com.ar', idioma: 'es-AR' },
  MLB: { id: 'MLB', pais: 'Brasil',    dominio: 'mercadolivre.com.br', listado: 'lista.mercadolivre.com.br',   idioma: 'pt-BR' },
  MLM: { id: 'MLM', pais: 'Mexico',    dominio: 'mercadolibre.com.mx', listado: 'listado.mercadolibre.com.mx', idioma: 'es-MX' }
};

export function sitio(id) {
  return SITIOS[String(id || 'MLA').toUpperCase()] || SITIOS.MLA;
}

// ------------------------------------------------------------
// Relevancia por titulo
//
// MercadoLibre casi nunca devuelve cero. Ante una busqueda sin coincidencias
// sirve resultados DE RESCATE y los presenta como normales: medido en
// produccion, "qwzxvbnmklpoiuy asdfghjk zzz" devuelve "78 resultados" con 48
// publicaciones de bujias NGK y repuestos de moto, sin ningun aviso. Los
// marcadores rescue/zrp/intervention del HTML no sirven de senal: aparecen
// tambien en busquedas con resultados reales, son strings del bundle.
//
// O sea que el CONTEO de MeLi no dice nada para un termino de nicho. Lo que si
// dice es cuantas de las publicaciones devueltas tienen que ver con lo que se
// busco. Esa es la unica senal confiable, y se calcula en un solo lugar: antes
// esta logica estaba duplicada en highlightsSearch, publicIdsSearch y dos
// puntos de _buscador.js, y en tres de esos cuatro el fallback devolvia la
// lista COMPLETA sin filtrar cuando no habia coincidencias suficientes, que es
// exactamente como se colaban los resultados de rescate.
// ------------------------------------------------------------
export const RELEVANCIA_MINIMA = Number(process.env.RELEVANCIA_MINIMA || 0.25);

function normalizarTitulo(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Palabras de la consulta que sirven para decidir. >3 caracteres; si la
// consulta no tiene ninguna tan larga ("gel uv", "faja"), se baja el corte en
// vez de quedarse sin palabras y declarar todo irrelevante.
export function palabrasSignificativas(query) {
  const t = normalizarTitulo(query).split(/\s+/).filter(Boolean);
  let p = t.filter(w => w.length > 3);
  if (!p.length) p = t.filter(w => w.length > 2);
  if (!p.length) p = t;
  return p;
}

// Cuantas palabras de la consulta tiene que contener un titulo para contar
// como relevante.
//
// Calibrado, no elegido a ojo. Con "al menos una" el ratio se satura y deja
// pasar accesorios: para "proyector portatil" contaba un cable HDMI y una
// pantalla de proyeccion (ratio 1.00), y para "organizador de cables
// magnetico de silicona" contaba un soporte magnetico de celular y una funda
// de silicona (0.70). Exigiendo DOS palabras en consultas de dos o mas, los
// mismos casos dan 0.80 y 0.40, que describen mejor lo que hay, y el caso de
// rescate sigue dando 0.00. El tope de 2 evita que una consulta larga se
// vuelva imposible de satisfacer.
function palabrasRequeridas(palabras) {
  return Math.min(2, palabras.length);
}

// Devuelve { relevantes, muestra, ratio, items } donde items son SOLO las
// publicaciones relevantes.
export function relevanciaPorTitulo(query, results) {
  const lista = Array.isArray(results) ? results : [];
  const palabras = palabrasSignificativas(query);
  if (!lista.length) return { relevantes: 0, muestra: 0, ratio: null, items: [], palabras, requeridas: 0 };
  if (!palabras.length) return { relevantes: lista.length, muestra: lista.length, ratio: 1, items: lista, palabras, requeridas: 0 };

  const requeridas = palabrasRequeridas(palabras);
  const items = lista.filter(it => {
    const t = normalizarTitulo(it && (it.title || it.titulo));
    let n = 0;
    for (const w of palabras) { if (t.includes(w)) n++; if (n >= requeridas) return true; }
    return false;
  });
  return {
    relevantes: items.length,
    muestra: lista.length,
    ratio: lista.length ? items.length / lista.length : null,
    items,
    palabras,
    requeridas
  };
}

export async function catalogSearch(product, token, opts) {
  const o = opts || {};
  const maxProductos = o.maxProductos || 8;
  const deadline = Date.now() + (o.budgetMs || 6500);
  if (!token) return null;

  const site = sitio(o.site).id;
  const q = encodeURIComponent(product);
  const busq = await fetchJson(
    MELI_API + '/products/search?status=active&site_id=' + site + '&limit=10&q=' + q, token, 5000);
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
  // El catalogo tampoco filtraba: /products/search devuelve productos que
  // MercadoLibre considera parecidos, que no es lo mismo que el producto
  // buscado.
  const rel = relevanciaPorTitulo(product, results);
  return {
    fuente: 'meli-catalogo',
    total,
    totalEsPostRescate: true,
    relevancia: { relevantes: rel.relevantes, muestra: rel.muestra, ratio: rel.ratio, palabras: rel.palabras },
    relevanciaCero: rel.muestra > 0 && rel.relevantes === 0,
    results: rel.items,
    // domain_id.split('-').pop() devolvia "PROJECTORS": el slug interno, en
    // ingles. Ademas de mostrarse mal, rompia el regex de comision del front
    // (no matcheaba "electronica" y aplicaba 15% en vez de 16,5%). El nombre
    // real de la categoria, en castellano, lo da domain_discovery.
    categoryName: await nombreDeCategoria(product, token, catalogo[0], site)
  };
}

// Nombre de la categoria en castellano, como lo llama MercadoLibre Argentina.
// Si domain_discovery no responde se devuelve cadena vacia: el front sabe
// mostrar "sin dato", y es preferible a un slug en ingles que despues se usa
// para elegir la comision.
export async function nombreDeCategoria(product, token, productoCatalogo, site) {
  try {
    const q = encodeURIComponent(product);
    const s = sitio(site).id;
    const dom = await fetchJson(MELI_API + '/sites/' + s + '/domain_discovery/search?limit=1&q=' + q, token, 3500);
    const d0 = dom.ok && Array.isArray(dom.json) && dom.json[0] ? dom.json[0] : null;
    const n = d0 && (d0.category_name || d0.domain_name);
    if (n) return String(n);
  } catch (_) {}
  // Respaldo: el nombre del producto de catalogo dice mas que el slug del
  // domain_id, pero nunca se devuelve el slug en ingles.
  const nombre = productoCatalogo && productoCatalogo.name;
  return nombre ? String(nombre) : '';
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

  const site = sitio(o.site).id;
  const dom = await fetchJson(MELI_API + '/sites/' + site + '/domain_discovery/search?limit=3&q=' + q, token, 4000);
  const cats = (dom.ok && Array.isArray(dom.json))
    ? dom.json.map(d => d && d.category_id).filter(Boolean) : [];
  if (!cats.length) return null;

  const nombreCat = (dom.json[0] && (dom.json[0].category_name || dom.json[0].domain_name)) || '';
  const hl = await fetchJson(MELI_API + '/highlights/' + site + '/category/' + cats[0], token, 4000);
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

  // Misma funcion que el resto de las vias. De aca salio la idea: este era el
  // unico camino que ya filtraba por titulo, justamente "para no mostrar lo mas
  // vendido de la categoria disfrazado".
  const rel = relevanciaPorTitulo(product, items);
  const elegidos = rel.items;

  return {
    fuente: 'meli-destacados',
    relevancia: { relevantes: rel.relevantes, muestra: rel.muestra, ratio: rel.ratio, palabras: rel.palabras },
    relevanciaCero: rel.muestra > 0 && rel.relevantes === 0,
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
  const site = sitio(o.site).id;
  const html = await fetchListadoHtml(product, o.timeoutMs || 6000, site, o.deadline);
  if (html && html.sinTiempo) return { sinTiempo: true, results: [] };
  if (!html) return null;
  // Cero real: se entro al listado y no habia publicaciones. Se devuelve como
  // resultado vacio, no como null, para que arriba se pueda distinguir de un
  // bloqueo.
  if (html.vacio) return { fuente: 'meli-listado+items', site, total: 0, muestra: 0, categoryName: '', results: [], vacioConfirmado: true };
  if (!html.texto) return null;

  const ids = extraerIdsItem(html.texto, site).slice(0, o.maxIds || 40);
  if (!ids.length) return null;

  const items = await hidratarItems(ids, token, deadline);
  if (!items.length) return null;

  // El fallback de antes ("si no hay 3 que coincidan, devolve TODO") era la
  // puerta por la que entraban los resultados de rescate de MercadoLibre.
  // Ahora se filtra siempre y se informa el ratio.
  const rel = relevanciaPorTitulo(product, items);
  const elegidos = rel.items;

  // El listado es ahora la via principal, asi que su categoryName es el que
  // termina eligiendo la comision de MeLi en el front. Si el HTML no la trae,
  // se pide a domain_discovery en vez de devolver vacio.
  const categoria = html.categoria || await nombreDeCategoria(product, token, null, site);

  return {
    fuente: 'meli-listado+items',
    site,
    // El total que informa MercadoLibre es POST-RESCATE: para un termino de
    // nicho puede decir 78 y ser todo de otra cosa. Viaja, pero rotulado.
    total: html.total || null,
    totalEsPostRescate: true,
    muestra: elegidos.length,
    relevancia: { relevantes: rel.relevantes, muestra: rel.muestra, ratio: rel.ratio, palabras: rel.palabras },
    // Se hidrataron publicaciones pero NINGUNA es del producto buscado: eso es
    // "no existe aca", y hay que devolverlo como respuesta, no como fallo de
    // la via (si no, se prueba la siguiente y se pierde el dato).
    relevanciaCero: rel.muestra > 0 && rel.relevantes === 0,
    categoryName: categoria || '',
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
export function candidatosDeListado(product, site) {
  const st = sitio(site);
  const slug = meliSlug(product);
  const q = encodeURIComponent(product);
  return [
    'https://' + st.listado + '/' + slug,
    'https://www.' + st.dominio + '/jm/search?as_word=' + q,
    'https://' + st.listado + '/' + slug + '_DisplayType_LF',
    'https://www.' + st.dominio + '/ofertas?q=' + q
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
// Clasifica una pagina que respondio 200 pero no trajo ningun ID.
// Hay dos motivos posibles y significan lo contrario:
//   'cero'          -> es la pagina de MercadoLibre y dice explicitamente que no hay nada
//   'bloqueada'     -> es un muro anti-bot, un challenge o una pagina intermedia
//   'indeterminada' -> es HTML de MercadoLibre pero sin items legibles (tipico
//                      de una pagina sin hidratar). No prueba nada.
// MercadoLibre sirve el muro anti-bot con HTTP 200 y cuerpo, asi que fiarse
// del status es exactamente como se cuela un cero falso. Ante la duda se
// devuelve 'bloqueada': es preferible decir "no pude consultar" que afirmar
// que un producto no existe.
export function clasificarPaginaListado(texto, site) {
  const t = String(texto || '');
  if (t.length < 2000) return 'bloqueada';           // una pagina real de MeLi pesa mucho mas

  const bajo = t.toLowerCase();

  // Muros conocidos. Si aparece alguno, no se llego al listado.
  const murosAntiBot = [
    'baxia-punish', 'captcha', 'recaptcha', 'px-captcha', 'datadome',
    'access denied', 'acceso denegado', 'acesso negado',
    'unusual traffic', 'trafico inusual',
    'are you a robot', 'verifica que eres', 'verifique que voce',
    'please enable javascript to continue', 'checking your browser'
  ];
  if (murosAntiBot.some(m => bajo.includes(m))) return 'bloqueada';

  // Frases con las que MercadoLibre dice explicitamente que no hay resultados,
  // en los tres sitios.
  const sinResultados = [
    'no hay publicaciones que coincidan',
    'no hay anuncios que coincidan',
    'no encontramos publicaciones',
    'nao ha publicacoes que correspondam',
    'nao encontramos publicacoes',
    'no results', 'sin resultados', 'sem resultados',
    'escribi el producto que quieras encontrar',
    'revisa la ortografia'
  ];
  const bajoSinTildes = bajo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (sinResultados.some(f => bajoSinTildes.includes(f))) return 'cero';

  // Sin frase explicita NO se concluye nada, y esto es a proposito.
  //
  // Medido en la pagina real: una busqueda de rescate devuelve 626 KB con el
  // header y el footer completos y el titulo "<termino> | MercadoLibre", pero
  // los resultados se renderizan del lado del cliente. Un fetch de servidor
  // puede recibir ese armazon sin los items: eso NO es un bloqueo, pero
  // tampoco es un cero. La version anterior de esta funcion devolvia 'cero'
  // justamente para ese caso (armazon + buscador presentes), o sea que una
  // pagina sin hidratar se contaba como "no hay publicaciones".
  //
  // Se devuelve 'indeterminada': ni cero ni bloqueo. Quien llama lo trata como
  // "no pude consultar", que es lo unico honesto. Igual el camino principal no
  // depende de esto: publicIdsSearch saca los IDs del texto CRUDO, asi que si
  // la pagina trae publicaciones las encuentra aunque el DOM no este hidratado.
  return 'indeterminada';
}

export async function fetchListadoHtml(product, timeoutMs, site, deadline) {
  const st = sitio(site);
  // Distingue "no hay publicaciones" de "no pude consultar": el punto 8 del
  // Market Reader decide cosas opuestas segun cual de las dos sea, asi que
  // confundirlas invierte el diagnostico.
  //
  // OJO: un HTTP 200 con cuerpo NO alcanza para decir que se llego. El muro
  // anti-bot de MercadoLibre responde 200. Por eso se clasifica el contenido.
  let ceroConfirmado = false;
  let sinTiempo = false;
  for (const url of candidatosDeListado(product, st.id)) {
    // Sin presupuesto de tiempo, cuatro URLs colgadas por pais x tres paises se
    // comen los 60 s de la funcion de Vercel. Cortar aca devuelve null, o sea
    // "no pude consultar": nunca un cero.
    if (deadline && Date.now() > deadline) { sinTiempo = true; break; }
    const restante = deadline ? Math.max(500, deadline - Date.now()) : (timeoutMs || 6000);
    const pag = await traerPagina(url, Math.min(timeoutMs || 6000, restante));
    const hayIds = pag.texto && extraerIdsItem(pag.texto, st.id).length;
    if (!hayIds) {
      // Solo 'cero' (frase explicita de MercadoLibre) confirma un vacio.
      // 'indeterminada' y 'bloqueada' se tratan igual: no pude consultar.
      if (pag.status >= 200 && pag.status < 400 && pag.texto &&
          clasificarPaginaListado(pag.texto, st.id) === 'cero') {
        ceroConfirmado = true;
      }
      continue;
    }
    let total = 0;
    // "resultados" en es-AR/es-MX, "resultados" tambien en pt-BR.
    const m = pag.texto.match(/([\d][\d.,]*)\s*resultados/i);
    if (m) total = parseInt(String(m[1]).replace(/[^0-9]/g, ''), 10) || 0;
    let categoria = '';
    const h1 = pag.texto.match(/<h1[^>]*>([^<]{3,80})<\/h1>/i);
    if (h1) categoria = h1[1].trim();
    return { status: pag.status, url, texto: pag.texto, total, categoria, site: st.id, alcanzado: true };
  }
  // Se llego a la pagina de resultados de MercadoLibre y dice que no hay nada:
  // eso es un CERO real. Cualquier otra cosa (muro, challenge, pagina que no
  // reconocemos) devuelve null = "no pude consultar".
  if (ceroConfirmado) return { status: 200, url: null, texto: '', total: 0, categoria: '', site: st.id, alcanzado: true, vacio: true };
  if (sinTiempo) return { sinTiempo: true, site: st.id };
  return null;
}

// Extraer IDs de publicacion del HTML.
// La version anterior agarraba cualquier "MLA" seguido de 8 o mas digitos y se
// traia ids de tracking y de promociones: MLA96631608403 (13 digitos) o
// MLA108324869725 (15), que /items?ids= rechaza. Un item real tiene 9 a 11
// digitos y aparece en la URL del articulo o como item_id en los JSON
// embebidos. Los /p/MLA... quedan afuera a proposito: son productos de
// catalogo, no publicaciones.
// Los patrones son los mismos en los tres sitios: solo cambia el prefijo del
// id (MLA / MLB / MLM). Se arman por sitio en vez de estar clavados.
function patronesItem(site) {
  const p = sitio(site).id;
  return [
    new RegExp('(?:articulo|produto)\\.[a-z.]+\\/' + p + '-(\\d{9,11})-', 'g'),
    new RegExp('\\/' + p + '-(\\d{9,11})-', 'g'),
    new RegExp('"item_id"\\s*:\\s*"' + p + '(\\d{9,11})"', 'g'),
    new RegExp('"itemId"\\s*:\\s*"' + p + '(\\d{9,11})"', 'g'),
    new RegExp('"id"\\s*:\\s*"' + p + '(\\d{9,11})"', 'g')
  ];
}

// Nombre viejo, que siguen usando _buscador.js y el diagnostico de market.js.
// Equivale a pedir los IDs de Argentina.
export function extraerIdsMLA(html) { return extraerIdsItem(html, 'MLA'); }

export function extraerIdsItem(html, site) {
  const texto = String(html || '');
  const pref = sitio(site).id;
  const vistos = new Set();
  const ids = [];
  for (const patron of patronesItem(pref)) {
    patron.lastIndex = 0;
    let m;
    while ((m = patron.exec(texto)) !== null) {
      const id = pref + m[1];
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
// MEDIDO 2026-09-01: /items?ids= devuelve 403 access_denied item por item
// ("Access to the requested resource is forbidden") para publicaciones de OTROS
// vendedores. Solo funciona con las propias. Antes esta era la via barata: el
// scraper daba los ids y la API oficial ponia precio, ventas y vendedor gratis.
// Ya no. Por eso hay que pagarle el enriquecimiento al scraper y por eso cada
// medicion de competencia sale ~$0.24 en vez de ~$0.048.
// No borrar las llamadas de abajo: con los items propios (stock, dashboard)
// siguen andando.
export async function hidratarItems(ids, token, deadline) {
  // available_quantity no se pedia, con lo cual el stock llegaba siempre vacio
  // aunque la API lo tenga. Es gratis pedirlo: viaja en la misma consulta.
  const atributos = 'id,title,price,sold_quantity,available_quantity,seller_id,shipping,category_id,status';
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
// OJO: el estado es POR SITIO. Cuando era uno solo y global, un 403 del
// listado de Mexico incrementaba el contador de fallos de "listado" y, a los
// dos, la via quedaba salteada tambien para Argentina: las busquedas argentinas
// empezaban a devolver "no pude consultar" por culpa de un bloqueo mexicano.
// En un lambda tibio de Vercel eso degrada solo con el uso.
const _viaEstadoPorSitio = {};
function viaEstado(site) {
  const k = sitio(site).id;
  if (!_viaEstadoPorSitio[k]) _viaEstadoPorSitio[k] = { preferida: null, fallos: {} };
  return _viaEstadoPorSitio[k];
}

// ------------------------------------------------------------
// Cache de busquedas
// Cada busqueda que termina en el proveedor externo cuesta plata, y el
// recomendador repite los mismos 12 terminos de un nicho en cada corrida. Con
// el cache, la segunda corrida del dia no gasta nada. Si la tabla no existe,
// todo sigue funcionando sin cache.
// ------------------------------------------------------------
// La clave lleva el sitio adelante salvo en Argentina, que se deja pelada
// para no invalidar el cache ya guardado. Sin esto, buscar "mini proyector" en
// Brasil pisaba el resultado de Argentina y viceversa.
function claveDeBusqueda(product, site) {
  const base = String(product || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const st = sitio(site).id;
  return st === 'MLA' ? base : (st.toLowerCase() + ':' + base);
}

// Cada busqueda que NO sale del cache cuesta ~$0.24 (el scraper cobra el
// enriquecimiento aparte y la API oficial ya no lo suple: da 403 en items
// ajenos). Con 12 horas, volver a mirar el mismo producto al dia siguiente se
// pagaba de nuevo. Una semana es razonable: como esta repartida la venta de un
// rubro no cambia de un dia para el otro, y la fecha de la medicion se muestra
// para que se sepa de cuando es.
function horasDeCache() {
  const h = parseFloat(process.env.BUSQUEDA_CACHE_HORAS || '168');
  return isFinite(h) && h >= 0 ? h : 168;
}

// Expuesta para el diagnostico: deja ver la corrida pendiente sin arrancar una.
export async function filaDeCache(product) {
  return await leerFilaCache(product);
}

async function leerFilaCache(product, site) {
  try {
    const filas = await supaRows('/rest/v1/busquedas_cache?termino=eq.' +
      encodeURIComponent(claveDeBusqueda(product, site)) + '&select=*&limit=1');
    return filas[0] || null;
  } catch (_) { return null; }
}

async function leerCache(product, site) {
  const horas = horasDeCache();
  if (!horas) return null;
  const f = await leerFilaCache(product, site);
  if (!f || !Array.isArray(f.resultados) || !f.resultados.length) return null;
  const vence = new Date(f.created_at).getTime() + horas * 3600 * 1000;
  if (Date.now() > vence) return null;
  return {
    fuente: f.fuente || 'cache',
    total: f.total != null ? f.total : null,
    categoryName: f.categoria || '',
    results: f.resultados,
    desdeCache: true,
    guardadoEn: f.created_at
  };
}

// Una corrida arrancada hace mas de 15 minutos se da por perdida.
function corridaVigente(fila) {
  if (!fila || !fila.run_id) return false;
  const desde = fila.run_desde ? new Date(fila.run_desde).getTime() : 0;
  return !!desde && (Date.now() - desde) < 15 * 60 * 1000;
}

async function guardarPendiente(product, corrida) {
  try {
    const { url, key, ok } = supa();
    if (!ok) return;
    await fetch(url + '/rest/v1/busquedas_cache?on_conflict=termino', {
      method: 'POST',
      headers: {
        apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        termino: claveDeBusqueda(product, site),
        fuente: 'proveedor-apify',
        resultados: [],
        run_id: corrida.runId,
        dataset_id: corrida.datasetId || null,
        run_estado: corrida.estado || 'RUNNING',
        run_desde: new Date().toISOString(),
        created_at: new Date().toISOString()
      })
    });
  } catch (_) { /* no puede romper la busqueda */ }
}

// Levanta el resultado de una corrida que ya termino. No arranca ninguna
// corrida nueva, asi que no cuesta plata.
async function cosecharCorrida(product, fila, token) {
  try {
    const bus = await import('./_buscador.js');
    const est = await bus.estadoCorrida(fila.run_id);
    if (est.estado !== 'SUCCEEDED') {
      return est.estado === 'RUNNING' || est.estado === 'READY' ? { pendiente: true } : null;
    }
    const filas = await bus.itemsDeCorrida(est.datasetId || fila.dataset_id, { limite: 60 });
    const r = await bus.armarResultado(product, filas, token, { maxItems: 40 });
    if (!r || !r.results.length) return null;
    await guardarCache(product, r);
    return r;
  } catch (_) { return null; }
}

async function guardarCache(product, r, site) {
  if (!horasDeCache() || !r || !r.results || !r.results.length) return;
  try {
    const { url, key, ok } = supa();
    if (!ok) return;
    await fetch(url + '/rest/v1/busquedas_cache?on_conflict=termino', {
      method: 'POST',
      headers: {
        apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        termino: claveDeBusqueda(product, site),
        fuente: r.fuente || null,
        total: typeof r.total === 'number' ? r.total : null,
        categoria: r.categoryName || null,
        resultados: r.results,
        run_id: null,
        dataset_id: null,
        run_estado: 'SUCCEEDED',
        created_at: new Date().toISOString()
      })
    });
  } catch (_) { /* el cache es una optimizacion, no puede romper la busqueda */ }
}

export async function buscarPublicaciones(product, token, opts) {
  if (!token || !product) return null;
  const o = opts || {};
  const site = sitio(o.site).id;

  // 1. Resultado ya cacheado.
  if (!o.sinCache) {
    const guardado = await leerCache(product, site);
    if (guardado) return guardado;
  }

  // 2. Corrida arrancada antes que ya pueda estar lista. Cosecharla no cuesta
  //    plata: la corrida ya se pago cuando se arranco.
  const fila = await leerFilaCache(product, site);
  if (corridaVigente(fila)) {
    const cosechado = await cosecharCorrida(product, fila, token);
    if (cosechado && cosechado.results) return cosechado;
    if (cosechado && cosechado.pendiente) return { pendiente: true, results: [], fuente: 'preparando' };
    // Si la corrida fallo, se sigue de largo y mas abajo se arranca otra.
  }
  const vias = {
    catalogo: () => catalogSearch(product, token, { site, deadline: o.deadline, maxProductos: o.maxProductos || 6, budgetMs: o.budgetMs || 5000 }),
    destacados: () => highlightsSearch(product, token, { site, deadline: o.deadline, budgetMs: o.budgetMs || 5000 }),
    listado: () => publicIdsSearch(product, token, { site, deadline: o.deadline, budgetMs: o.budgetMs || 6000, maxIds: o.maxIds || 40 }),
    // Ultima, porque es la unica que cuesta plata: solo se paga cuando ninguna
    // via gratuita respondio.
    //
    // Medido en produccion: una corrida del actor tarda mas de 50 s, o sea que
    // no entra en un request. Se arranca, se anota el id y se contesta
    // "preparando"; el resultado lo levanta la consulta siguiente sin volver a
    // pagar. Es la diferencia entre una pantalla colgada un minuto y una que
    // avisa y ya trae el dato al reintentar.
    proveedor: async () => {
      // El actor externo scrapea MercadoLibre Argentina. Para Brasil o Mexico
      // no aplica: se devuelve null en vez de pagar una corrida que no
      // responde lo que se pregunto.
      if (site !== 'MLA') return null;
      const mod = await import('./_buscador.js');
      const corrida = await mod.arrancarCorrida(product, { maxItems: o.maxIds || 48 });
      await guardarPendiente(product, corrida);
      return { pendiente: true, results: [], fuente: 'preparando' };
    }
  };
  // El orden va de mejor a peor DATO REAL, no de mejor a peor total.
  //
  // El catalogo iba primero porque traia paging.total, pero ese total cuenta
  // productos de catalogo, no publicaciones, y sus "competidores" salen de
  // /products/{id}/items: sin nickname, sin reputacion y con sold_quantity 0.
  // Medido en produccion daba muestra de 1, precioMin = precioMax y vendedores
  // "N/A". El listado publico saca los IDs del HTML y los hidrata con
  // /items?ids=, que si trae precio, vendedor, vendidos y envio reales: ese es
  // el dato que sirve para decidir una compra, asi que va primero.
  const orden = ['listado', 'destacados', 'catalogo', 'proveedor'];
  const est = viaEstado(site);
  for (const nombre of orden) {
    // Se acabo el presupuesto: se devuelve "sin tiempo", que aguas arriba es
    // "no pude consultar". Jamas un cero.
    if (o.deadline && Date.now() > o.deadline) return { sinTiempo: true, results: [] };
    const fallos = est.fallos[nombre] || 0;
    // Se saltea la via que ya fallo dos veces, siempre que otra este andando.
    // El tope de 4 cubre el caso de que no ande ninguna. Si MeLi reabre una,
    // el proximo cold start la vuelve a probar.
    if (fallos >= 2 && (est.preferida || fallos >= 4)) continue;
    try {
      const r = await vias[nombre]();
      if (r && r.pendiente) return r;
      if (r && r.results && r.results.length) {
        est.preferida = nombre;
        est.fallos[nombre] = 0;   // anduvo: se le limpia el historial
        await guardarCache(product, r, site);
        return r;
      }
      // Cero confirmado: se entro al listado y no hay publicaciones. Eso es un
      // dato, no una falla de la via: se devuelve tal cual, no se penaliza a la
      // via (se entro bien) y no se prueban las siguientes.
      if (r && r.vacioConfirmado) { est.fallos[nombre] = 0; return r; }
      // Se hidrataron publicaciones y ninguna era del producto: eso es la
      // respuesta ("no esta aca"), no una falla de la via. Si se siguiera de
      // largo, la via siguiente devolveria las mismas de rescate y el dato se
      // perderia.
      if (r && r.relevanciaCero) { est.fallos[nombre] = 0; return r; }
      // Corte por tiempo: no es culpa de la via, no se la penaliza.
      if (r && r.sinTiempo) return r;
      est.fallos[nombre] = fallos + 1;
    } catch (_) {
      est.fallos[nombre] = fallos + 1;
    }
  }
  return null;
}

export function viaDeBusquedaUsada(site) {
  const e = viaEstado(site);
  return { preferida: e.preferida, fallos: { ...e.fallos }, porSitio: _viaEstadoPorSitio };
}

// ------------------------------------------------------------
// Conteo de publicaciones por sitio
//
// Lo usa el modo "producto sin comparable" del Market Reader para mirar si
// algo se vende en Brasil o Mexico cuando no existe en Argentina.
//
// La distincion que importa, y que el resto del codigo NO puede perder:
//   ok:true,  publicaciones:0   -> se entro al listado y NO hay nada. Es un dato.
//   ok:false, publicaciones:null -> no se pudo consultar. NO es un dato.
// Tratar el segundo como cero invierte el diagnostico: "no se vende en ningun
// lado" cuando en realidad MercadoLibre nos bloqueo. Por eso nunca se
// devuelve 0 por defecto.
// ------------------------------------------------------------
export async function contarPublicaciones(product, token, site, opts) {
  const o = opts || {};
  const st = sitio(site);
  const vacio = {
    site: st.id, pais: st.pais, termino: product,
    ok: false, estado: null, publicaciones: null, muestra: 0,
    relevantes: null, muestraDevuelta: 0, ratio: null,
    precioMediano: null, ventasTop3: null, moneda: null,
    motivo: null, fuente: null
  };
  if (!product || !String(product).trim()) return { ...vacio, motivo: 'sin termino de busqueda' };
  if (!token) return { ...vacio, motivo: 'sin token de MercadoLibre' };

  let r = null;
  try {
    r = await buscarPublicaciones(product, token, {
      site: st.id,
      deadline: o.deadline,
      budgetMs: o.budgetMs || 6000,
      maxIds: o.maxIds || 40,
      sinCache: !!o.sinCache
    });
  } catch (e) {
    return { ...vacio, motivo: 'error consultando ' + st.id + ': ' + String((e && e.message) || e).slice(0, 120) };
  }

  if (!r) return { ...vacio, motivo: 'MercadoLibre ' + st.pais + ' no respondio (bloqueo o sin resultados legibles)' };
  if (r.sinTiempo) return { ...vacio, sinTiempo: true, motivo: 'no alcanzo el tiempo para consultar ' + st.pais };
  if (r.pendiente) return { ...vacio, motivo: 'la busqueda todavia se esta preparando' };

  const results = Array.isArray(r.results) ? r.results : [];
  const rel = r.relevancia || null;

  // Cero literal: MercadoLibre dijo explicitamente que no hay publicaciones.
  // Pasa poco (casi siempre sirve resultados de rescate), pero cuando pasa es
  // el mismo veredicto que relevancia cero: el producto no esta aca.
  if (r.vacioConfirmado || (!results.length && r.total === 0 && !rel)) {
    return { ...vacio, ok: true, estado: 'noExiste', publicaciones: 0, muestra: 0,
             relevantes: 0, muestraDevuelta: 0, ratio: null, fuente: r.fuente || null,
             motivo: 'se entro al listado y no hay publicaciones' };
  }

  // Relevancia cero: MercadoLibre devolvio publicaciones, pero NINGUNA es del
  // producto buscado. Este es el caso real de "no se vende aca", y el que de
  // verdad se va a dar en produccion: el conteo de MeLi es post-rescate.
  if (r.relevanciaCero && rel) {
    return { ...vacio, ok: true, estado: 'noExiste', publicaciones: 0, muestra: 0,
             relevantes: 0, muestraDevuelta: rel.muestra, ratio: 0, fuente: r.fuente || null,
             motivo: 'MercadoLibre devolvio ' + rel.muestra + ' publicaciones pero ninguna es de este producto (resultados de rescate)' };
  }

  if (!results.length) {
    return { ...vacio, motivo: 'MercadoLibre ' + st.pais + ' no devolvio publicaciones legibles' };
  }

  const precios = results.map(x => x && x.price).filter(p => typeof p === 'number' && p > 0).sort((a, b) => a - b);
  let mediana = null;
  if (precios.length) {
    const m = Math.floor(precios.length / 2);
    mediana = precios.length % 2 ? precios[m] : Math.round((precios[m - 1] + precios[m]) / 2);
  }
  const vendidos = results.map(x => (x && x.sold_quantity) || 0).sort((a, b) => b - a).slice(0, 3);
  const ventasTop3 = vendidos.length ? Math.round(vendidos.reduce((a, b) => a + b, 0) / vendidos.length) : null;

  // Ratio de relevancia: cuantas de las devueltas hablan del producto.
  const ratio = rel && rel.ratio != null ? rel.ratio : null;
  // Tres estados, nunca un booleano:
  //   'existe'   -> la consulta anduvo y el ratio llega al minimo
  //   'noExiste' -> la consulta anduvo y el ratio no llega
  //   null       -> no se pudo consultar
  const estado = (ratio == null) ? 'existe' : (ratio >= RELEVANCIA_MINIMA ? 'existe' : 'noExiste');

  if (estado === 'noExiste') {
    return { ...vacio, ok: true, estado: 'noExiste', publicaciones: 0, muestra: results.length,
             relevantes: rel.relevantes, muestraDevuelta: rel.muestra, ratio, fuente: r.fuente || null,
             motivo: 'solo ' + rel.relevantes + ' de ' + rel.muestra + ' publicaciones coinciden con la busqueda (ratio ' +
                     ratio.toFixed(2) + ', minimo ' + RELEVANCIA_MINIMA + ')' };
  }

  // La muestra esta topeada (30-40 ids), asi que "relevantes" satura y no
  // sirve para comparar mercados. El total que informa MeLi es post-rescate,
  // pero multiplicado por el ratio da una estimacion razonable de cuantas de
  // esas publicaciones son de verdad del producto. Viaja rotulada como
  // estimacion, y solo se usa donde hace falta un orden de magnitud.
  const totalCrudo = (typeof r.total === 'number' && r.total > 0) ? r.total : null;
  const estimadas = (totalCrudo != null && ratio != null)
    ? Math.max(rel ? rel.relevantes : 0, Math.round(totalCrudo * ratio))
    : (rel ? rel.relevantes : results.length);

  return {
    site: st.id, pais: st.pais, termino: product,
    ok: true,
    estado: 'existe',
    relevantesEstimadas: estimadas,
    relevantes: rel ? rel.relevantes : results.length,
    muestraDevuelta: rel ? rel.muestra : results.length,
    ratio,
    // El total que informa MercadoLibre es POST-RESCATE: para un termino de
    // nicho puede contar publicaciones que no son del producto. Viaja rotulado
    // y NO se usa para decidir si existe.
    publicaciones: (typeof r.total === 'number' && r.total > 0) ? r.total : null,
    totalEsPostRescate: !!r.totalEsPostRescate,
    muestra: results.length,
    precioMediano: mediana,
    ventasTop3,
    moneda: st.id === 'MLA' ? 'ARS' : (st.id === 'MLB' ? 'BRL' : 'MXN'),
    fuente: r.fuente || null,
    motivo: (typeof r.total === 'number' && r.total > 0) ? null : 'MercadoLibre no expone el total por esta via; se informa el tamano de la muestra'
  };
}
