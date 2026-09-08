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

// Margen con el que se renueva el token antes de que venza.
//
// Estaba en 5 minutos y no alcanza. Una corrida del proveedor tarda mas de 50 s
// en arrancar y se cosecha en la consulta SIGUIENTE, con la hidratacion de
// items despues: un token con 6 minutos de vida pasaba el filtro y se moria en
// el medio. Y una corrida que se pierde por token vencido ya se pago.
const MARGEN_TOKEN_MS = Math.max(60, parseInt(process.env.MELI_MARGEN_TOKEN_SEG || '600', 10)) * 1000;

// Token vigente de un usuario. Renueva si le queda menos que MARGEN_TOKEN_MS.
// Devuelve el token o null; nunca tira, para que un endpoint pueda seguir
// con datos parciales. El motivo queda en .motivo del objeto devuelto.
export async function getUserToken(userId) {
  let row = null;
  try {
    row = await getTokenRow(userId);
    if (!row) return { token: null, motivo: 'sin_conexion' };
    const venceMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (venceMs && venceMs - Date.now() > MARGEN_TOKEN_MS) {
      return { token: row.access_token, motivo: 'ok', meli_user_id: row.meli_user_id,
               venceEn: Math.round((venceMs - Date.now()) / 1000) };
    }
    const data = await refreshWithToken(row.refresh_token);
    await saveTokenRow({
      user_id: row.user_id || userId,
      meli_user_id: row.meli_user_id || data.user_id,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in || 21600
    });
    return { token: data.access_token, motivo: 'refrescado', meli_user_id: row.meli_user_id || data.user_id,
             venceEn: data.expires_in || 21600 };
  } catch (e) {
    const detalle = String((e && e.message) || e).slice(0, 300);
    // El refresh fallo. Si el token guardado TODAVIA no vencio, se usa igual:
    // antes se devolvia null y se perdia un token que servia, que es como se
    // pierde una cosecha ya pagada por un error transitorio de MeLi.
    const venceMs = row && row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (row && row.access_token && venceMs > Date.now() + 30 * 1000) {
      console.warn('[meli] el refresh fallo (' + detalle + ') pero el token vigente sirve ' +
                   Math.round((venceMs - Date.now()) / 1000) + ' s mas: se usa ese.');
      return { token: row.access_token, motivo: 'refresh_fallo_token_vigente', error: detalle,
               meli_user_id: row.meli_user_id, venceEn: Math.round((venceMs - Date.now()) / 1000) };
    }
    console.error('[meli] no hay token utilizable para ' + userId + ': ' + detalle);
    return { token: null, motivo: 'error', error: detalle };
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
// Umbrales. La asimetria es deliberada y esta pensada, no calibrada al medio:
// los dos errores NO cuestan lo mismo.
//   Falso 'existe'   -> arma un precio de referencia con productos equivocados.
//                       Malo, pero queda VISIBLE en pantalla (el ratio se
//                       muestra siempre) y el usuario lo puede desconfiar.
//   Falso 'noExiste'  -> le dice que un producto no tiene mercado. Invisible,
//                       no vuelve a mirarlo nunca, y no deja rastro para
//                       auditar despues.
// Por eso el piso es bajo y hay una banda intermedia: en la duda no se afirma
// ausencia, se admite que no se sabe.
//
// CALIBRADOS CONTRA DATOS REALES (8/9/2026). Hasta esta fecha los dos numeros
// salian de fixtures escritos a mano. Ahora salen de 693 titulos reales de
// MercadoLibre Argentina, traidos por el proveedor pago:
//
//   18 positivos  (cada termino contra SUS titulos): min 0.2630, mediana 1.0000
//   306 negativos (cada termino contra los titulos de los otros 17, que es
//                  exactamente lo que devuelve MeLi cuando sirve rescate):
//                  mediana 0.0000, p95 0.1030, p99 0.3750, max 0.6458.
//                  81% da exactamente 0.
//
// ALTO 0.35 -> 0.40. Con 0.35 pasaban como "existe" tres cruces que comparten
// UNA sola palabra generica ("bomba solar" contra titulos de "boyero solar",
// "parasol auto" contra "rastreador gps auto" y al reves), las tres en 0.3750.
// Con 0.40 esos tres caen y NO se pierde ningun positivo: siguen siendo 17 de
// 18. Los unicos cruces que quedan arriba de 0.40 son pares que de verdad son
// el mismo producto con otro nombre (rastreador gps auto / rastreador veicular,
// boyero / electrificador de alambrados), o sea que dar alto ahi es correcto.
//
// BAJO se queda en 0.15. El positivo real mas bajo es 0.2630, asi que subirlo
// a 0.20 recortaria el margen justo contra el error caro (ver asimetria arriba).
//
// El unico positivo que no llega a "existe" es "electrificador de alambrados"
// (0.2630), y no es problema de umbral: MeLi devuelve publicaciones que dicen
// "boyero", que es como se le llama al mismo aparato en Argentina. Eso se
// arregla con sinonimos, no moviendo el numero.
export const RELEVANCIA_UMBRAL_ALTO = Number(process.env.RELEVANCIA_UMBRAL_ALTO || 0.40);
export const RELEVANCIA_UMBRAL_BAJO = Number(process.env.RELEVANCIA_UMBRAL_BAJO || 0.15);
// Nombre viejo, para no romper import existentes.
export const RELEVANCIA_MINIMA = RELEVANCIA_UMBRAL_BAJO;

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
  // El orden se conserva: el peso depende de la posicion en la consulta.
  return [...new Set(p)];
}

// ¿La palabra aparece SOLO como cola de una palabra mas larga?
// "cables" dentro de "pasacables" es eso. Es un match debil: cuenta si hay
// otras coincidencias, pero no alcanza por si solo.
function soloComoSufijo(titulo, palabra) {
  let desde = 0, hubo = false;
  for (;;) {
    const k = titulo.indexOf(palabra, desde);
    if (k === -1) break;
    hubo = true;
    const anterior = k > 0 ? titulo[k - 1] : '';
    // Empieza en frontera de palabra: es un match limpio.
    if (!anterior || !/[a-z0-9]/.test(anterior)) return false;
    desde = k + 1;
  }
  return hubo;
}

// Puntaje 0..1 de una publicacion: que fraccion de las palabras significativas
// de la consulta aparece en su titulo.
//
// Ponderado y no binario porque los vendedores titulan por la keyword de mayor
// volumen, no por la frase del comprador: un proyector portatil real se publica
// como "Mini Proyector Full Hd 1080p Wifi Bluetooth Android", con "proyector" y
// sin "portatil". Con una regla de "al menos 2 palabras" ese titulo puntuaba
// CERO y un producto que si se vende terminaba clasificado como inexistente.
// Ponderado da 0.5: cuenta a medias, que es lo que corresponde. El rescate
// (bujias contra proyector) sigue dando 0.
// Variantes de una palabra que cuentan como la misma. Solo singular/plural:
// medido, "cables" no matcheaba "Cable Utp Cat6" y una consulta de una sola
// palabra significativa se hundia por eso. Es la misma clase de falso
// "noExiste" invisible que se quiere evitar.
function variantesDe(w) {
  const v = [w];
  if (w.length > 4 && w.endsWith('es')) v.push(w.slice(0, -2));
  if (w.length > 4 && w.endsWith('s')) v.push(w.slice(0, -1));
  return v.filter(x => x.length >= 4);
}

// Peso por posicion. En castellano rioplatense el sustantivo nucleo va
// primero y los modificadores despues ("proyector portatil", "organizador de
// cables magnetico de silicona"): el nucleo define el producto, los
// modificadores aparecen en muchisimos titulos.
//
// Sin esto, el ratio caia solo por agregar palabras, y el largo de la consulta
// NO lo elige el usuario: lo produce nombrarProductos(), que devuelve 2 a 4
// palabras segun lo que le salga a Haiku. O sea que dos productos igual de
// buenos caian en bandas distintas porque la traduccion de uno salio mas
// verbosa. Ese sesgo no es ruido: esta correlacionado con un paso automatico
// del propio sistema.
const PESOS_POSICION = [1.0, 0.6, 0.3];
function pesoDe(i) { return PESOS_POSICION[i] != null ? PESOS_POSICION[i] : 0.3; }

export function puntajeDeTitulo(titulo, palabras) {
  const t = normalizarTitulo(titulo);
  if (!t || !palabras.length) return 0;

  const encontradas = [];
  let pesoEncontrado = 0, pesoTotal = 0;
  palabras.forEach((w, i) => {
    const peso = pesoDe(i);
    pesoTotal += peso;
    const hit = variantesDe(w).find(v => t.includes(v));
    if (hit) { encontradas.push(hit); pesoEncontrado += peso; }
  });
  if (!encontradas.length || !pesoTotal) return 0;

  // Guarda de sufijo: si la UNICA coincidencia es la cola de otra palabra
  // ("cables" dentro de "pasacables"), no cuenta.
  //
  // SOLO se aplica cuando la consulta tiene dos o mas palabras significativas.
  // Medido: con una sola palabra, toda coincidencia es "la unica", asi que la
  // guarda se aplicaba siempre y hundia la consulta entera. "cables de red"
  // caia de 0.300 a 0.100 y volteaba a noExiste un producto que se vende.
  if (palabras.length >= 2 && encontradas.length === 1 && soloComoSufijo(t, encontradas[0])) return 0;

  return pesoEncontrado / pesoTotal;
}

// Tres estados. La banda del medio existe para no afirmar ausencia en la duda.
export function estadoDeRelevancia(ratio) {
  if (ratio == null) return 'existe';
  if (ratio >= RELEVANCIA_UMBRAL_ALTO) return 'existe';
  if (ratio < RELEVANCIA_UMBRAL_BAJO) return 'noExiste';
  return 'dudoso';
}

// Devuelve el ratio (promedio de los puntajes de la muestra), el estado, y los
// items que se usan para calcular precios.
//
// Para PRECIOS el corte es distinto y a proposito mas inclusivo: entra todo lo
// que tenga puntaje > 0. Lo que rompia produccion eran las bujias, que puntuan
// 0; un accesorio que comparte una palabra ensucia un poco la mediana pero eso
// se ve en pantalla, mientras que descartarlo de mas no se ve.
export function relevanciaPorTitulo(query, results) {
  const lista = Array.isArray(results) ? results : [];
  const palabras = palabrasSignificativas(query);
  const base = { relevantes: 0, muestra: 0, ratio: null, items: [], palabras, puntajes: [], estado: 'existe' };
  if (!lista.length) return base;
  if (!palabras.length) {
    return { ...base, relevantes: lista.length, muestra: lista.length, ratio: 1, items: lista, estado: 'existe' };
  }

  const puntajes = lista.map(it => puntajeDeTitulo(it && (it.title || it.titulo), palabras));
  const ratio = puntajes.reduce((a, b) => a + b, 0) / puntajes.length;
  const items = lista.filter((_, k) => puntajes[k] > 0);

  return {
    relevantes: items.length,
    muestra: lista.length,
    ratio,
    items,
    palabras,
    puntajes,
    estado: estadoDeRelevancia(ratio)
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
    relevancia: { relevantes: rel.relevantes, muestra: rel.muestra, ratio: rel.ratio, palabras: rel.palabras, estado: rel.estado },
    titulosMuestra: results.slice(0, 5).map(x => x && x.title),
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
    relevancia: { relevantes: rel.relevantes, muestra: rel.muestra, ratio: rel.ratio, palabras: rel.palabras, estado: rel.estado },
    titulosMuestra: items.slice(0, 5).map(x => x && x.title),
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
    relevancia: { relevantes: rel.relevantes, muestra: rel.muestra, ratio: rel.ratio, palabras: rel.palabras, estado: rel.estado },
    titulosMuestra: items.slice(0, 5).map(x => x && x.title),
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
// Diagnostico: cuantos IDs saca cada patron. Quedo referenciando
// PATRONES_ITEM, que dejo de existir cuando los patrones se pasaron a
// construirse por sitio. En ESM eso es un ReferenceError, no un undefined:
// tiraba abajo el endpoint ?catalogo entero con "PATRONES_ITEM is not defined".
export function idsPorPatron(html, site) {
  const texto = String(html || '');
  const pref = sitio(site).id;
  const salida = {};
  patronesItem(pref).forEach((patron, i) => {
    patron.lastIndex = 0;
    const encontrados = new Set();
    let m;
    while ((m = patron.exec(texto)) !== null) encontrados.add(pref + m[1]);
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
  return await leerFilaCache(product, 'MLA');
}

async function leerFilaCache(product, site) {
  try {
    const filas = await supaRows('/rest/v1/busquedas_cache?termino=eq.' +
      encodeURIComponent(claveDeBusqueda(product, site)) + '&select=*&limit=1');
    return filas[0] || null;
  } catch (e) {
    // Silencioso, esto hacia que una corrida ya en curso no se viera y se
    // arrancara otra: se paga dos veces la misma busqueda.
    console.error('[cache] no pude leer la fila de "' + product + '": ' +
                  String((e && e.message) || e).slice(0, 200));
    return null;
  }
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

// Cuanto tiempo se sigue intentando cosechar una corrida ya arrancada.
//
// Estaba en 15 minutos y era absurdamente corto. Medido: los datasets de Apify
// siguen vivos un mes despues (13 de 13 corridas del 1 al 5 de septiembre
// tenian su dataset disponible el 8 de octubre). Con la ventana de 15 minutos,
// una corrida que terminaba cuando el usuario ya se habia ido quedaba fuera de
// alcance para siempre: se pagaba y no se cosechaba nunca.
//
// Subir la ventana no arriesga nada: si la corrida fallo, cosecharCorrida
// devuelve null y el flujo sigue de largo y arranca otra. Lo unico que agrega
// es una consulta de estado, que es gratis.
const VIGENCIA_CORRIDA_MS = Math.max(1, Number(process.env.CORRIDA_VIGENTE_HORAS || 168)) * 3600 * 1000;

function corridaVigente(fila) {
  if (!fila || !fila.run_id) return false;
  const desde = fila.run_desde ? new Date(fila.run_desde).getTime() : 0;
  return !!desde && (Date.now() - desde) < VIGENCIA_CORRIDA_MS;
}

// Registra la corrida paga recien arrancada. La firma lleva site igual que
// guardarCache y leerFilaCache: antes referenciaba un 'site' que no era
// parametro ni existia a nivel modulo, o sea ReferenceError en cada llamada.
//
// Devuelve true/false: quien la llama TIENE que mirar el resultado. Si esto
// falla, la corrida pagada queda sin run_id y no se puede cosechar nunca.
// Chequeo barato y previo: ¿se puede escribir en busquedas_cache? Si la
// respuesta es no, no tiene sentido arrancar una corrida paga: no se va a
// poder anotar el run_id y la plata se tira.
async function puedoRegistrarCorrida() {
  const { url, key, ok } = supa();
  if (!ok) return false;
  try {
    // HEAD contra la tabla: no escribe nada y dice si las credenciales sirven.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    try {
      const r = await fetch(url + '/rest/v1/busquedas_cache?select=termino&limit=1',
        { method: 'HEAD', signal: ctrl.signal,
          headers: { apikey: key, Authorization: 'Bearer ' + key } });
      if (!r.ok) console.error('[proveedor] busquedas_cache no acepta lectura: HTTP ' + r.status);
      return r.ok;
    } finally { clearTimeout(t); }
  } catch (e) {
    console.error('[proveedor] no pude verificar busquedas_cache: ' + String((e && e.message) || e).slice(0, 160));
    return false;
  }
}

async function guardarPendiente(product, corrida, site) {
  try {
    const { url, key, ok } = supa();
    if (!ok) {
      console.error('[proveedor] no puedo registrar la corrida ' + (corrida && corrida.runId) +
                    ': falta SUPABASE_SERVICE_KEY. La corrida se pago y no se va a poder cosechar.');
      return false;
    }
    const r = await fetch(url + '/rest/v1/busquedas_cache?on_conflict=termino', {
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
    if (!r.ok) {
      const cuerpo = await r.text().catch(() => '');
      console.error('[proveedor] Supabase rechazo el registro de la corrida ' + (corrida && corrida.runId) +
                    ': HTTP ' + r.status + ' ' + cuerpo.slice(0, 200) +
                    '. La corrida se pago y no se va a poder cosechar.');
      return false;
    }
    return true;
  } catch (e) {
    // Este catch era silencioso y es el que escondio el ReferenceError durante
    // toda la vida del bug. Una corrida paga que no se puede registrar tiene
    // que gritar.
    console.error('[proveedor] fallo el registro de la corrida ' + (corrida && corrida.runId) +
                  ': ' + String((e && e.message) || e).slice(0, 200) +
                  '. La corrida se pago y no se va a poder cosechar.');
    return false;
  }
}

// Levanta el resultado de una corrida que ya termino. No arranca ninguna
// corrida nueva, asi que no cuesta plata.
async function cosecharCorrida(product, fila, token, site) {
  try {
    const bus = await import('./_buscador.js');
    const est = await bus.estadoCorrida(fila.run_id);
    if (est.estado !== 'SUCCEEDED') {
      return est.estado === 'RUNNING' || est.estado === 'READY' ? { pendiente: true } : null;
    }
    const filas = await bus.itemsDeCorrida(est.datasetId || fila.dataset_id, { limite: 60 });
    const r = await bus.armarResultado(product, filas, token, { maxItems: 40 });
    if (!r || !r.results.length) return null;
    // El site iba sin pasar: funcionaba por accidente porque sitio(undefined)
    // cae en MLA, que es el unico sitio donde corre el proveedor. Se pasa
    // explicito para que no muerda si eso cambia.
    await guardarCache(product, r, site);
    return r;
  } catch (e) {
    // Silencioso, y del otro lado hay una corrida YA PAGADA: si la cosecha
    // falla sin decir nada, la plata se perdio y nadie se entera.
    console.error('[proveedor] fallo la cosecha de la corrida ' + (fila && fila.run_id) +
                  ' para "' + product + '": ' + String((e && e.message) || e).slice(0, 200));
    return null;
  }
}

async function guardarCache(product, r, site) {
  if (!horasDeCache() || !r || !r.results || !r.results.length) return;
  try {
    const { url, key, ok } = supa();
    if (!ok) return;
    const resp = await fetch(url + '/rest/v1/busquedas_cache?on_conflict=termino', {
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
    if (!resp.ok) {
      const cuerpo = await resp.text().catch(() => '');
      console.error('[cache] Supabase rechazo el guardado de "' + product + '": HTTP ' +
                    resp.status + ' ' + cuerpo.slice(0, 200));
    }
  } catch (e) {
    // No puede romper la busqueda, pero tampoco puede ser mudo: cuando el
    // resultado viene de una corrida PAGA, no guardarlo significa volver a
    // pagarla la proxima vez.
    console.error('[cache] no pude guardar el resultado de "' + product + '" (' +
                  (r && r.fuente) + '): ' + String((e && e.message) || e).slice(0, 200));
  }
}

// Corridas pagas que quedaron anotadas y sin cosechar. Una corrida sin cosechar
// es plata ya gastada esperando a que alguien vuelva a buscar el mismo termino:
// si nadie lo hace antes de que venza la retencion del dataset, se perdio.
export async function corridasPendientes(limite) {
  const { url, key, ok } = supa();
  if (!ok) return { ok: false, error: 'falta SUPABASE_SERVICE_KEY', filas: [] };
  const n = Math.min(100, Math.max(1, parseInt(limite, 10) || 30));
  try {
    const r = await fetch(url + '/rest/v1/busquedas_cache' +
      '?select=termino,fuente,run_id,dataset_id,run_estado,run_desde,resultados' +
      '&run_id=not.is.null&order=run_desde.desc&limit=' + n,
      { headers: { apikey: key, Authorization: 'Bearer ' + key } });
    if (!r.ok) {
      const cuerpo = await r.text().catch(() => '');
      return { ok: false, error: 'HTTP ' + r.status + ' ' + cuerpo.slice(0, 200), filas: [] };
    }
    const filas = await r.json().catch(() => []);
    return { ok: true, filas: Array.isArray(filas) ? filas : [] };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200), filas: [] };
  }
}

// RETENCION. El problema no es recuperar lo viejo: es que una corrida que
// termina cuando ya nadie esta mirando no se cosecha nunca, porque la cosecha
// solo pasa si alguien vuelve a buscar el mismo termino. Esto barre todas las
// pendientes y guarda las que ya terminaron, sin depender de eso.
//
// No arranca ninguna corrida: leer un dataset ya producido es gratis.
export async function cosecharPendientes(token, opts) {
  const o = opts || {};
  const { filas, ok, error } = await corridasPendientes(o.limite || 30);
  if (!ok) return { ok: false, error, cosechadas: 0, detalle: [] };
  const detalle = [];
  let cosechadas = 0;
  for (const f of filas) {
    // Ya tiene resultados guardados: no hay nada que cosechar.
    const yaTiene = Array.isArray(f.resultados) && f.resultados.length > 0;
    if (yaTiene) { detalle.push({ termino: f.termino, run_id: f.run_id, estado: 'ya-cosechada' }); continue; }
    // TikTok Shop y Google Trends tienen su propio formato de fila, asi que los
    // cosecha _fuentes.js. Antes se los salteaba con "otra-fuente" y quedaban
    // corridas pagas sin levantar: medido, 5 de 13.
    if (f.fuente !== 'proveedor-apify') {
      try {
        const fu = await import('./_fuentes.js');
        const r2 = await fu.cosecharFilaPendiente(f);
        detalle.push({ termino: f.termino, run_id: f.run_id, fuente: f.fuente, ...r2 });
        if (r2 && r2.estado === 'cosechada') cosechadas++;
      } catch (e) {
        detalle.push({ termino: f.termino, run_id: f.run_id, fuente: f.fuente,
                       estado: 'error', nota: String((e && e.message) || e).slice(0, 160) });
      }
      continue;
    }
    const r = await cosecharCorrida(f.termino, f, token, 'MLA');
    if (r && r.results && r.results.length) {
      cosechadas++;
      detalle.push({ termino: f.termino, run_id: f.run_id, estado: 'cosechada', publicaciones: r.results.length });
    } else if (r && r.pendiente) {
      detalle.push({ termino: f.termino, run_id: f.run_id, estado: 'todavia-corriendo' });
    } else {
      detalle.push({ termino: f.termino, run_id: f.run_id, estado: 'sin-datos',
                     nota: 'la corrida no terminó bien o el dataset ya no está' });
    }
  }
  return { ok: true, revisadas: filas.length, cosechadas, detalle };
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
    const cosechado = await cosecharCorrida(product, fila, token, site);
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

      // ---- FRENO 0: barrido masivo. -------------------------------------
      // Redundante con el orden de arriba, a proposito. Si alguna vez alguien
      // vuelve a meter 'proveedor' en la lista sin mirar, esto sigue frenando.
      if (o.sinPago) {
        return {
          sinPago: true, results: [], fuente: 'sin-datos-gratis',
          aviso: 'Competencia sin datos: MercadoLibre no permite consultarla gratis.'
        };
      }

      // ---- FRENO 1: sesion. ----------------------------------------------
      // El gate va SOLO sobre esta via, no sobre el endpoint. Las tres vias
      // gratuitas siguen abiertas para cualquiera: el demo publico de la
      // portada tiene que seguir funcionando igual que siempre. Lo unico que
      // se cierra es lo que cuesta plata.
      if (!o.puedeGastar) {
        return {
          requiereSesion: true, results: [], fuente: 'requiere-sesion',
          aviso: 'Para traer publicaciones reales de MercadoLibre necesitas iniciar sesion.'
        };
      }

      const mod = await import('./_buscador.js');
      const gas = await import('./_gasto.js');

      // ANTES de gastar: si no se va a poder registrar la corrida, no se
      // arranca. Una corrida que no queda anotada se paga igual y no se puede
      // cosechar nunca, que es exactamente lo que estuvo pasando.
      if (!(await puedoRegistrarCorrida())) {
        console.error('[proveedor] no arranco la corrida para "' + product +
                      '": no puedo escribir en busquedas_cache, asi que no la podria cosechar.');
        return null;
      }

      // ---- FRENO 2: tope diario. -----------------------------------------
      // Se RESERVA el cupo antes de arrancar, no se anota despues: si se
      // contara despues, dos requests simultaneos leerian el mismo numero y
      // pasarian los dos. La reserva ya ocupa lugar en el contador.
      const items = mod.itemsPorCorrida(o.maxIds || 48);
      const cupo = await gas.reservarCorrida({
        termino: product, site, items,
        enriquecido: mod.enriquecer(),
        origen: o.origen || 'busqueda'
      });
      if (!cupo.ok) {
        // Nunca un error generico: el usuario tiene que entender que paso y
        // cuando se le habilita de nuevo.
        const reinicio = cupo.reinicio;
        const aviso = cupo.motivo === 'tope'
          ? ('Se alcanzo el tope diario de busquedas pagas en MercadoLibre (' +
             cupo.usadas + ' de ' + cupo.tope + ' usadas hoy). Se reinicia a la ' +
             'medianoche de Argentina.')
          : ('No puedo verificar cuantas busquedas pagas se usaron hoy, asi que ' +
             'freno el gasto por las dudas. Volve a intentar en un rato.');
        console.warn('[gasto] corrida frenada para "' + product + '": ' + cupo.motivo +
                     ' (usadas ' + cupo.usadas + '/' + cupo.tope + ')');
        return {
          topeAlcanzado: true, results: [], fuente: 'tope-diario', aviso,
          gasto: { usadas: cupo.usadas, tope: cupo.tope, reinicio, motivo: cupo.motivo }
        };
      }

      let corrida;
      try {
        corrida = await mod.arrancarCorrida(product, { maxItems: o.maxIds || 48 });
      } catch (e) {
        // No arranco: se libera el cupo. Si no, un error de Apify consumiria
        // corridas del dia sin haber traido nada.
        await gas.anularReserva(cupo.id, 'no arranco: ' + String((e && e.message) || e).slice(0, 150));
        throw e;
      }
      await gas.anotarArranque(cupo.id, corrida);

      // Y despues de arrancar: si igual no se pudo anotar, se aborta para
      // cortar el gasto en vez de dejarla corriendo a ciegas.
      const anotada = await guardarPendiente(product, corrida, site);
      if (!anotada) {
        await mod.abortarCorrida(corrida && corrida.runId);
        await gas.anularReserva(cupo.id, 'abortada: no se pudo registrar en busquedas_cache');
        throw new Error('corrida ' + (corrida && corrida.runId) +
                        ' arrancada pero no registrada: se aborto para no gastar de gusto');
      }
      return {
        pendiente: true, results: [], fuente: 'preparando', runId: corrida.runId,
        gasto: { usadas: cupo.usadas, tope: cupo.tope, restantes: cupo.restantes,
                 costoEstimadoUsd: cupo.costoEstimado }
      };
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
  //
  // opts.sinPago saca la via paga de la lista ENTERA. No es un guard adentro de
  // la via: es que la via no esta. La diferencia importa: un barrido masivo
  // como /api/analyze evalua 12 productos por consulta, y ahi la unica garantia
  // que sirve es que sea imposible por diseño llegar a pagar, no que alguien se
  // acuerde de pasar el flag correcto.
  const orden = o.sinPago
    ? ['listado', 'destacados', 'catalogo']
    : ['listado', 'destacados', 'catalogo', 'proveedor'];
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
      // Frenos de gasto (sin sesion, o tope diario alcanzado). No son fallas
      // de la via: la via anda, lo que pasa es que no se la deja gastar. Si se
      // contaran como falla, dos frenos seguidos la marcarian como muerta y
      // quedaria salteada aun cuando el usuario se loguee.
      if (r && (r.requiereSesion || r.topeAlcanzado || r.sinPago)) { est.fallos[nombre] = 0; return r; }
      // Corte por tiempo: no es culpa de la via, no se la penaliza.
      if (r && r.sinTiempo) return r;
      est.fallos[nombre] = fallos + 1;
    } catch (e) {
      // Este catch es el que se comio el ReferenceError de guardarPendiente
      // durante toda la vida del bug: la via "fallaba" y nadie sabia por que.
      console.error('[busqueda] la via "' + nombre + '" fallo para "' + product +
                    '" (' + site + '): ' + String((e && e.message) || e).slice(0, 200));
      est.fallos[nombre] = fallos + 1;
    }
  }
  // Barrido masivo sin via paga: ninguna gratuita contesto. Devolver null seria
  // "no pude consultar" a secas; con el flag se puede decir POR QUE y mandar al
  // usuario al Market Reader, que es donde el dato si se trae.
  if (o.sinPago) {
    return {
      sinPago: true, results: [], fuente: 'sin-datos-gratis',
      aviso: 'Competencia sin datos: MercadoLibre no permite consultarla gratis.'
    };
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
// ------------------------------------------------------------
// Registro de relevancia
//
// El umbral esta calibrado contra titulos que se escribieron a mano imitando
// los de MercadoLibre, porque no hay salida a internet desde donde corre esto.
// Eso alcanza para arrancar y no alcanza para quedarse: la unica forma de
// afinarlo es mirar consultas reales. Cada medicion se guarda con la consulta,
// las palabras, el ratio, el estado y los primeros 5 titulos devueltos, y se
// leen con GET /api/market?relevancia=1 (con ADMIN_KEY).
//
// Se guarda en memoria siempre (sobrevive mientras viva el lambda) y ademas en
// Supabase si la tabla existe. Nunca puede romper una busqueda.
// ------------------------------------------------------------
const _relevanciaLog = [];
const RELEVANCIA_LOG_MAX = 200;

// Resultado de la ULTIMA escritura a Supabase. Sin esto se trabaja a ciegas:
// la tabla podia quedar en cero durante dias sin que nada lo dijera.
let _ultimaEscritura = { intentada: false, ok: null, error: null, ts: null, status: null };

export function estadoEscrituraRelevancia() {
  const { key, url } = supa();
  return {
    ..._ultimaEscritura,
    // No se expone la key, solo si esta cargada y con que nombre se la busca.
    envVarEsperada: 'SUPABASE_SERVICE_KEY',
    keyPresente: !!key,
    urlSupabase: url,
    enMemoria: _relevanciaLog.length,
    pendientesSinEscribir: _pendientes.length
  };
}

// Buffer de filas pendientes de escribir. No se escribe una por una: una
// consulta de exploracion llama a contarPublicaciones hasta 4 veces, y cuatro
// inserts esperados en serie se comian el presupuesto de tiempo del request.
// Se juntan y se mandan todas en un solo POST al final, con flushRelevancia().
let _pendientes = [];

// Registrar es sincronico y barato: solo arma la fila y la encola.
export function registrarRelevancia(entrada) {
  let fila = null;
  try {
    fila = {
      ts: new Date().toISOString(),
      query: String(entrada.query || '').slice(0, 160),
      site: entrada.site || null,
      palabras: entrada.palabras || [],
      ratio: entrada.ratio != null ? Number(Number(entrada.ratio).toFixed(4)) : null,
      estado: entrada.estado || null,
      muestra: entrada.muestra || 0,
      relevantes: entrada.relevantes || 0,
      titulos: (entrada.titulos || []).filter(Boolean).slice(0, 5).map(t => String(t || '').slice(0, 120)),
      umbrales: { alto: RELEVANCIA_UMBRAL_ALTO, bajo: RELEVANCIA_UMBRAL_BAJO }
    };
    _relevanciaLog.unshift(fila);
    if (_relevanciaLog.length > RELEVANCIA_LOG_MAX) _relevanciaLog.length = RELEVANCIA_LOG_MAX;
    _pendientes.push(fila);
  } catch (e) {
    _ultimaEscritura = { intentada: true, ok: false, error: 'no pude armar la fila: ' + String((e && e.message) || e).slice(0, 120), ts: new Date().toISOString(), status: null };
  }
  return fila;
}

// Escribe TODO lo encolado en un solo POST, y se espera.
//
// El await no es opcional: antes esto era fire-and-forget y en un lambda de
// Vercel la funcion devuelve la respuesta y el runtime congela el proceso
// antes de que salga el insert. Se pierde en silencio, que es exactamente por
// lo que la tabla quedaba en cero aunque nada "fallara".
//
// Lo llama el handler una vez por request, antes de responder.
export async function flushRelevancia() {
  if (!_pendientes.length) return _ultimaEscritura;
  const filas = _pendientes;
  _pendientes = [];

  const { url, key, ok } = supa();
  if (!ok) {
    _ultimaEscritura = { intentada: true, ok: false, ts: new Date().toISOString(), status: null, filas: filas.length,
      error: 'falta SUPABASE_SERVICE_KEY en el entorno: el log queda solo en memoria y se pierde en cada cold start' };
    console.warn('[relevancia] ' + _ultimaEscritura.error);
    return _ultimaEscritura;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    let r;
    try {
      // PostgREST acepta un array: un solo viaje para las N filas del request.
      r = await fetch(url + '/rest/v1/relevancia_log', {
        method: 'POST', signal: ctrl.signal,
        headers: { apikey: key, Authorization: 'Bearer ' + key,
                   'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(filas)
      });
    } finally { clearTimeout(t); }
    if (!r.ok) {
      const cuerpo = await r.text().catch(() => '');
      _ultimaEscritura = { intentada: true, ok: false, status: r.status, ts: new Date().toISOString(), filas: filas.length,
        error: 'Supabase respondio ' + r.status + ': ' + cuerpo.slice(0, 200) };
      console.warn('[relevancia] insert fallo: ' + _ultimaEscritura.error);
    } else {
      _ultimaEscritura = { intentada: true, ok: true, status: r.status, ts: new Date().toISOString(), filas: filas.length, error: null };
    }
  } catch (e) {
    _ultimaEscritura = { intentada: true, ok: false, status: null, ts: new Date().toISOString(), filas: filas.length,
      error: String((e && e.message) || e).slice(0, 200) };
    console.warn('[relevancia] insert fallo: ' + _ultimaEscritura.error);
  }
  return _ultimaEscritura;
}

export function leerRelevanciaLog(n) {
  return _relevanciaLog.slice(0, n || 50);
}

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
      sinCache: !!o.sinCache,
      // Sin esto, el conteo por sitio se saltearia el gate de sesion y el
      // tope diario: la via paga es la misma.
      puedeGastar: !!o.puedeGastar,
      origen: o.origen || 'conteo'
    });
  } catch (e) {
    return { ...vacio, motivo: 'error consultando ' + st.id + ': ' + String((e && e.message) || e).slice(0, 120) };
  }

  if (!r) return { ...vacio, motivo: 'MercadoLibre ' + st.pais + ' no respondio (bloqueo o sin resultados legibles)' };
  if (r.sinTiempo) return { ...vacio, sinTiempo: true, motivo: 'no alcanzo el tiempo para consultar ' + st.pais };
  if (r.pendiente) return { ...vacio, motivo: 'la busqueda todavia se esta preparando' };
  // Frenos de gasto: no se pudo consultar, y el motivo no es de MercadoLibre.
  // Va como ok:false / publicaciones:null, o sea "no pude consultar", jamas
  // como cero publicaciones.
  if (r.sinPago) return { ...vacio, sinPago: true, motivo: r.aviso || 'esta consulta no usa la via paga' };
  if (r.requiereSesion) return { ...vacio, requiereSesion: true, motivo: r.aviso || 'hace falta iniciar sesion para esta consulta' };
  if (r.topeAlcanzado) return { ...vacio, topeAlcanzado: true, gasto: r.gasto || null, motivo: r.aviso || 'tope diario de busquedas pagas alcanzado' };

  const results = Array.isArray(r.results) ? r.results : [];
  const rel = r.relevancia || null;
  // Se registra SIEMPRE, con relevancia o sin ella. El "if (rel)" de antes
  // descartaba justo los casos que mas hacen falta para calibrar: cuando la
  // via no devuelve nada no hay objeto relevancia, y esa es exactamente la
  // consulta que hay que poder mirar despues.
  registrarRelevancia({
    query: product, site: st.id,
    palabras: rel ? rel.palabras : palabrasSignificativas(product),
    ratio: rel ? rel.ratio : null,
    estado: rel ? (rel.estado || estadoDeRelevancia(rel.ratio)) : 'sin-datos',
    muestra: rel ? rel.muestra : 0,
    relevantes: rel ? rel.relevantes : 0,
    titulos: (r.titulosMuestra || results.map(x => x && x.title))
  });

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

  // Ratio ponderado: promedio de cuanto coincide cada titulo con la consulta.
  const ratio = rel && rel.ratio != null ? rel.ratio : null;
  // CUATRO estados posibles, nunca un booleano:
  //   'existe'   -> ratio >= UMBRAL_ALTO
  //   'dudoso'   -> ratio entre BAJO y ALTO. NO afirma ausencia.
  //   'noExiste' -> ratio < UMBRAL_BAJO
  //   null       -> no se pudo consultar
  const estado = estadoDeRelevancia(ratio);

  if (estado === 'noExiste' || estado === 'dudoso') {
    const dudoso = estado === 'dudoso';
    return { ...vacio, ok: true, estado,
             // En 'dudoso' NO se pone publicaciones en cero: no se esta
             // afirmando que no haya, se esta diciendo que no se sabe.
             publicaciones: dudoso ? null : 0,
             muestra: results.length,
             relevantes: rel.relevantes, muestraDevuelta: rel.muestra, ratio,
             precioMediano: dudoso ? mediana : null,
             fuente: r.fuente || null,
             motivo: dudoso
               ? ('MercadoLibre devolvio resultados parcialmente relacionados (relevancia ' + ratio.toFixed(2) +
                  '): no puedo confirmar si tu producto exacto se vende aca')
               : ('relevancia ' + ratio.toFixed(2) + ' sobre ' + rel.muestra +
                  ' publicaciones: ninguna habla del producto buscado (minimo ' + RELEVANCIA_UMBRAL_BAJO + ')') };
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
