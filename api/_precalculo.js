// api/_precalculo.js
// Pre-analisis nocturno del Buscador de oportunidades.
//
// Por que existe: el buscador solo mostraba datos si el visitante tenia
// MercadoLibre conectado o si alguien con MeLi habia corrido ese nicho en las
// ultimas 24 h. Para la mayoria de los visitantes eso era una pantalla de
// tarjetas vacias. Ahora un proceso de fondo usa la conexion OAuth del dueño
// de la app (BUSCADOR_MELI_USER, por defecto "matypereira") y deja todos los
// nichos pre-analizados en buscador_cache, con la API oficial y sin Apify.
//
// Este archivo NO es un endpoint: lo llama api/analyze.js (api/ ya tiene 12
// funciones, el tope del plan Hobby).

import { MELI_API, fetchJson, palabrasSignificativas, puntajeDeTitulo } from './_meli.js';
import { esMarca } from './_radar.js';
import { categoriaDe } from './_categorias.js';

export const MELI_USER_PRECALCULO = () => process.env.BUSCADOR_MELI_USER || 'matypereira';

// ------------------------------------------------------------
// Autorizacion
// ------------------------------------------------------------
// Vale cualquiera de estas: el cron de Vercel (CRON_SECRET), la ADMIN_KEY por
// header, la sesion firmada de admin, o un token de corrida de un solo uso
// guardado en Supabase (buscador_job_tokens) con vencimiento corto. El ultimo
// existe porque CRON_SECRET y ADMIN_KEY solo estan cargadas en produccion:
// sin el, el proceso no se puede correr a mano sobre un preview.
export async function tokenDeCorridaValido(token, supa) {
  if (!token || typeof token !== 'string' || token.length < 24 || !supa.key) return false;
  try {
    const r = await fetch(supa.url + '/rest/v1/buscador_job_tokens?token=eq.' + encodeURIComponent(token) +
      '&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&select=token&limit=1',
      { headers: { apikey: supa.key, Authorization: 'Bearer ' + supa.key } });
    if (!r.ok) return false;
    const filas = await r.json();
    return Array.isArray(filas) && filas.length === 1;
  } catch (e) { return false; }
}

// ------------------------------------------------------------
// Prueba de endpoints con el token real
// ------------------------------------------------------------
// Devuelve, por endpoint, el status HTTP y un resumen corto de lo que trae
// (nunca el token). Sirve para decidir que metricas son posibles.
function resumen(j) {
  if (j == null) return null;
  if (Array.isArray(j)) return { tipo: 'array', largo: j.length, primero: j[0] && typeof j[0] === 'object' ? Object.keys(j[0]).slice(0, 25) : j[0] };
  if (typeof j === 'object') {
    const o = { tipo: 'objeto', claves: Object.keys(j).slice(0, 30) };
    if (j.paging) o.paging = j.paging;
    if (Array.isArray(j.results)) { o.results = j.results.length; o.result0 = j.results[0] && typeof j.results[0] === 'object' ? Object.keys(j.results[0]).slice(0, 30) : j.results[0]; }
    if (Array.isArray(j.content)) { o.content = j.content.length; o.content0 = j.content[0]; }
    return o;
  }
  return j;
}

export async function probarEndpoints(token, q, itemForzado) {
  const consulta = q || 'comedero antivoracidad perro';
  const out = [];
  async function probar(nombre, url, extraer) {
    const t0 = Date.now();
    const r = await fetchJson(url, token, 8000);
    const fila = { endpoint: nombre, url: url.replace(MELI_API, ''), status: r.status, ok: r.ok, ms: Date.now() - t0, resumen: resumen(r.json) };
    if (r.ok && extraer) { try { fila.dato = extraer(r.json); } catch (e) { fila.dato = 'error extrayendo: ' + e.message; } }
    out.push(fila);
    return r.ok ? r.json : null;
  }
  const qq = encodeURIComponent(consulta);
  await probar('users/me', MELI_API + '/users/me', j => ({ id: j.id, site: j.site_id }));
  const search = await probar('sites/search', MELI_API + '/sites/MLA/search?q=' + qq + '&limit=50',
    j => ({ total: j.paging && j.paging.total, primeros: (j.results || []).slice(0, 3).map(x => ({ id: x.id, sold: x.sold_quantity, cat: x.category_id, seller: x.seller && x.seller.id, logistic: x.shipping && x.shipping.logistic_type, oficial: x.official_store_id })) }));
  const cat = await probar('products/search', MELI_API + '/products/search?status=active&site_id=MLA&limit=10&q=' + qq,
    j => ({ total: j.paging && j.paging.total, ids: (j.results || []).slice(0, 3).map(x => x.id) }));
  const prodIds = (cat && cat.results || []).map(x => x.id).slice(0, 8);
  const prodId = prodIds[0];
  let itemId = null, sellerId = null, catId = null;
  // /products/{id}/items: se recorren varios productos de catalogo, porque
  // los que no tienen ofertas activas devuelven 404.
  for (const pid of prodIds) {
    const pit = await probar('products/{id}/items ' + pid, MELI_API + '/products/' + pid + '/items?limit=10',
      j => (j.results || []).slice(0, 3).map(x => ({ item: x.item_id, seller: x.seller_id, cat: x.category_id, logistic: x.shipping && x.shipping.logistic_type, oficial: x.official_store_id, sold: x.sold_quantity, keys: Object.keys(x).slice(0, 40) })));
    const r0 = pit && pit.results && pit.results[0];
    if (r0) { itemId = r0.item_id; sellerId = r0.seller_id; catId = r0.category_id; break; }
  }
  if (prodId) {
    await probar('products/{id}', MELI_API + '/products/' + prodId, j => ({ name: j.name, domain: j.domain_id, buy_box: !!j.buy_box_winner, bbkeys: j.buy_box_winner ? Object.keys(j.buy_box_winner) : null }));
    await probar('highlights/product', MELI_API + '/highlights/MLA/product/' + prodId, j => j);
  }
  if (itemForzado) { itemId = itemForzado; }
  if (!itemId && search && search.results && search.results[0]) { itemId = search.results[0].id; catId = search.results[0].category_id; sellerId = search.results[0].seller && search.results[0].seller.id; }
  const dd = await probar('domain_discovery', MELI_API + '/sites/MLA/domain_discovery/search?limit=3&q=' + qq, j => j.slice(0, 3).map(x => ({ cat: x.category_id, nombre: x.category_name })));
  if (!catId && Array.isArray(dd) && dd[0]) catId = dd[0].category_id;
  if (catId) {
    await probar('highlights/category', MELI_API + '/highlights/MLA/category/' + catId, j => ({ query_data: j.query_data, content: (j.content || []).slice(0, 5) }));
    await probar('trends/category', MELI_API + '/trends/MLA/' + catId, j => j.slice(0, 5));
    await probar('categories/{id}', MELI_API + '/categories/' + catId, j => ({ nombre: j.name, total_items: j.total_items_in_this_category, path: (j.path_from_root || []).map(x => x.id) }));
    await probar('listing_prices', MELI_API + '/sites/MLA/listing_prices?price=25000&listing_type_id=gold_special&category_id=' + catId, j => (Array.isArray(j) ? j[0] : j).sale_fee_details);
  }
  await probar('trends/site', MELI_API + '/trends/MLA', j => j.slice(0, 3));
  if (itemId) {
    await probar('items/{id}', MELI_API + '/items/' + itemId, j => ({ sold: j.sold_quantity, created: j.date_created, cat: j.category_id, logistic: j.shipping && j.shipping.logistic_type }));
    await probar('items?ids', MELI_API + '/items?ids=' + itemId + '&attributes=id,sold_quantity,date_created,category_id,shipping,official_store_id', j => j);
    await probar('reviews/item', MELI_API + '/reviews/item/' + itemId, j => ({ paging: j.paging, rating_average: j.rating_average, reviews: (j.reviews || []).length }));
    await probar('visits/items', MELI_API + '/visits/items?ids=' + itemId, j => j);
    await probar('items/visits/time_window', MELI_API + '/items/' + itemId + '/visits/time_window?last=30&unit=day', j => ({ total: j.total_visits, date_from: j.date_from }));
  }
  if (!sellerId && itemForzado) sellerId = null;
  if (sellerId) {
    await probar('users/{seller}', MELI_API + '/users/' + sellerId, j => ({ nick: j.nickname, rep: j.seller_reputation && j.seller_reputation.transactions && j.seller_reputation.transactions.total, level: j.seller_reputation && j.seller_reputation.level_id }));
  }
  return { consulta, prodId, itemId, catId, sellerId, endpoints: out };
}

// ------------------------------------------------------------
// Recolector por producto (solo endpoints que responden con el token)
// ------------------------------------------------------------
// Probado el 20/10/2026 con la cuenta 207450852, desde Vercel:
//   OK  /products/search, /products/{id}/items, /products/{id},
//       /trends/MLA/{cat}, /categories/{cat}, /users/{id}, /listing_prices
//   403 /sites/MLA/search, /highlights/MLA/category|product, /items/{id},
//       /items?ids= (403 por item ajeno), /reviews/item, /visits/items,
//       /items/{id}/visits/time_window
// Por eso no hay vendidos, reseñas ni visitas por publicacion con la API
// oficial: la rotacion (vendidos reales) sale de Apify, ver api/_rotacion.js.

// 5: respaldo por categoria padre y paginas extra de catalogo (datoAproximado).
export const VERSION_MERCADO = 5;
// El formato 4 tiene los mismos campos (solo le falta datoAproximado): se sigue
// MOSTRANDO mientras el proceso nocturno lo regenera, asi subir la version no
// deja todos los rubros en "Pendientes" durante la semana que tarda la vuelta.
export const VERSION_MERCADO_LECTURA_MIN = 4;
const CATALOGO_PAGINAS = 2;          // 2 x 10 productos de catalogo
const MAX_PRODUCTOS_CON_ITEMS = 12;  // a cuantos productos se les piden ofertas (medido: ~70% da 404, sin ofertas)
const OFERTAS_OBJETIVO = 15;
const MIN_OFERTAS = 3;               // menos que esto, el producto va a Pendientes
const PAGINAS_EXTRA = 2;             // paginas de /products/search de respaldo
const MAX_ITEMS_EXTRA = 8;
// Umbral para pedir las paginas extra. MEDIDO 19/11/2026 en celulares (preview):
// con el umbral en OFERTAS_OBJETIVO (15) se pidieron 42 paginas y ~100 /items
// extra para 18 productos, la tanda llego a 49,9 s y se corto; los 4 productos
// que las paginas rescataron tenian todos menos de 3 ofertas. Con 6 se conservan
// esos rescates sin pagarlo en cada producto. BUSCADOR_OBJETIVO_RESPALDO=15
// vuelve al umbral original.
const OBJETIVO_RESPALDO = () => Math.max(MIN_OFERTAS, Number(process.env.BUSCADOR_OBJETIVO_RESPALDO || 6));           // tope de /products/{id}/items en el respaldo
const VENDEDORES_TOP = 5;

// Cliente con contador de llamadas, reintento unico ante 429 y concurrencia
// limitada: el barrido nocturno hace miles de llamadas y no tiene que pegarle
// a MeLi en rafaga.
// MEDIDO 20/10/2026: a ~50 llamadas/s MeLi devolvio 429 (6 de 1.026) y, minutos
// despues, a ~12/s otra vez (27 de 377). El limite real no esta publicado, asi
// que el ritmo es adaptativo: arranca en BUSCADOR_MELI_RPS (8/s por defecto) y
// cada 429 duplica la espera entre llamadas (hasta 1 por segundo) ademas de
// reintentar. Cada 50 respuestas sanas seguidas acelera un poco.
export function crearCliente(token, opts) {
  const o = opts || {};
  const estado = { llamadas: 0, porEndpoint: {}, errores: {}, limitado: 0, intervaloFinalMs: 0 };
  let activos = 0;
  const cola = [];
  const MAX = o.concurrencia || 4;
  const RPS = Math.max(1, Number(o.rps || process.env.BUSCADOR_MELI_RPS || 8));
  const BASE = Math.round(1000 / RPS);
  let intervalo = BASE, sanas = 0;
  let proximaSalida = 0;
  function liberar() { activos--; const sig = cola.shift(); if (sig) sig(); }
  async function turno() {
    const ahora = Date.now();
    const espera = Math.max(0, proximaSalida - ahora);
    proximaSalida = Math.max(ahora, proximaSalida) + intervalo;
    if (espera) await new Promise(z => setTimeout(z, espera));
  }
  // Plazo duro: pasado o.deadline no se llama mas a MeLi (la funcion tiene 60 s
  // y un nicho a 8 llamadas/s tarda ~30-40 s).
  async function get(nombre, url, timeoutMs) {
    if (o.deadline && Date.now() > o.deadline) { estado.cortadasPorTiempo = (estado.cortadasPorTiempo || 0) + 1; return { ok: false, status: 0, json: null, cortada: true }; }
    if (activos >= MAX) await new Promise(r => cola.push(r));
    activos++;
    try {
      for (let intento = 0; intento < 3; intento++) {
        await turno();
        estado.llamadas++;
        estado.porEndpoint[nombre] = (estado.porEndpoint[nombre] || 0) + 1;
        const r = await fetchJson(url, token, timeoutMs || 6000);
        if (r.status === 429) {
          estado.limitado++; sanas = 0;
          intervalo = Math.min(1000, intervalo * 2);
          await new Promise(z => setTimeout(z, 2000 * (intento + 1)));
          continue;
        }
        if (++sanas >= 50 && intervalo > BASE) { intervalo = Math.max(BASE, Math.round(intervalo * 0.8)); sanas = 0; }
        if (!r.ok) estado.errores[nombre + ' ' + r.status] = (estado.errores[nombre + ' ' + r.status] || 0) + 1;
        return r;
      }
      return { ok: false, status: 429, json: null };
    } finally { liberar(); }
  }
  return { get, estado, cacheCategorias: new Map(), cacheRutas: new Map(), intervaloActual: () => intervalo };
}

function mediana(arr) {
  const s = arr.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// /categories/{id}: nombre, total y ruta desde la raiz. Una vez por corrida.
function infoCategoria(cli, catId) {
  if (!catId) return Promise.resolve(null);
  if (!cli.cacheRutas) cli.cacheRutas = new Map();
  if (cli.cacheRutas.has(catId)) return cli.cacheRutas.get(catId);
  const p = cli.get('categories', MELI_API + '/categories/' + catId).then(ca => ca.ok && ca.json ? {
    nombre: ca.json.name || null,
    totalPublicaciones: typeof ca.json.total_items_in_this_category === 'number' ? ca.json.total_items_in_this_category : null,
    ruta: Array.isArray(ca.json.path_from_root) ? ca.json.path_from_root.map(x => x && x.id).filter(Boolean) : null
  } : null).catch(() => null);
  cli.cacheRutas.set(catId, p);
  return p;
}

// Categoria padre (penultimo eslabon de path_from_root), o null si es raiz.
async function padreDe(cli, catId) {
  const info = await infoCategoria(cli, catId);
  const r = info && info.ruta;
  if (!r || r.length < 2) return null;
  return { id: r[r.length - 2], nombre: null };
}

// Ofertas de categorias hermanas: las que cuelgan del mismo padre que la
// categoria fijada. Se mira la ruta de cada categoria distinta (pocas por
// producto, y cacheadas por corrida).
async function ofertasDeHermanas(cli, ofertas, fija, padreId) {
  const otras = Array.from(new Set(ofertas.filter(o => o.category_id && o.category_id !== fija.cat).map(o => o.category_id)));
  const ok = new Set();
  await Promise.all(otras.map(async c => {
    const info = await infoCategoria(cli, c);
    if (info && Array.isArray(info.ruta) && info.ruta.indexOf(padreId) > -1) ok.add(c);
  }));
  return ofertas.filter(o => ok.has(o.category_id));
}

// Datos de la categoria: tendencias (con posicion) y total de publicaciones.
// Se piden una vez por categoria y por corrida.
async function datosCategoria(cli, catId) {
  if (!catId) return null;
  if (cli.cacheCategorias.has(catId)) return cli.cacheCategorias.get(catId);
  const p = (async () => {
    const [tr, ca] = await Promise.all([
      cli.get('trends/category', MELI_API + '/trends/MLA/' + catId),
      infoCategoria(cli, catId)
    ]);
    const tendencias = tr.ok && Array.isArray(tr.json) ? tr.json.map(x => x && x.keyword).filter(Boolean) : null;
    return {
      id: catId,
      nombre: ca ? ca.nombre : null,
      totalPublicaciones: ca ? ca.totalPublicaciones : null,
      tendencias
    };
  })();
  cli.cacheCategorias.set(catId, p);
  return p;
}
export { datosCategoria };

// Posicion del producto en las tendencias de su categoria (/trends/MLA/{cat}).
// Coincide solo si TODAS las palabras significativas de la busqueda en
// tendencia estan en el producto (minimo 2), y la busqueda no tiene marca.
// Medido con datos reales: con una regla mas laxa "collar led perro" coincidia
// con "collar traductor para perro" y "soporte tablet escritorio" con
// "soporte tablet auto".
export function posicionEnTendencias(q, lista) {
  if (!Array.isArray(lista) || !lista.length) return null;
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const ignorar = new Set(['de', 'para', 'con', 'set', 'pack', 'mini', 'y', 'la', 'el', 'en', 'sin', 'los', 'las', 'del', 'por', 'x']);
  const raiz = w => w.replace(/s$/, '');
  const sig = t => Array.from(new Set(norm(t).split(/[^a-z0-9ñ]+/).filter(w => w.length > 2 && !ignorar.has(w)).map(raiz)));
  const Q = new Set(sig(q));
  if (Q.size < 2) return null;
  for (let i = 0; i < lista.length; i++) {
    const K = sig(lista[i]);
    if (K.length < 2 || esMarca(lista[i])) continue;
    const comunes = K.filter(w => Q.has(w)).length;
    if (comunes === K.length) {
      // "exacto": la busqueda en tendencia cubre la mayor parte del producto.
      // "generico": es la busqueda general del rubro ("comederos para perros"
      // para un comedero antivoracidad): demanda de la categoria, no del item.
      return { keyword: lista[i], posicion: i + 1, total: lista.length,
        tipo: comunes / Q.size >= 0.75 ? 'exacto' : 'generico' };
    }
  }
  return null;
}

// ------------------------------------------------------------
// Productos de catalogo sin ofertas (404): se saltean 30 dias
// ------------------------------------------------------------
// MEDIDO 20/10/2026: ~70% de las llamadas a /products/{id}/items daban 404
// (productos de catalogo sin ofertas activas). Se guardan y no se repiten.
const DIAS_SIN_OFERTAS = 30;
function supaEnv() {
  return { url: process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co', key: process.env.SUPABASE_SERVICE_KEY || '' };
}
export async function conocidosSinOfertas(ids) {
  const { url, key } = supaEnv();
  if (!key || !ids.length) return new Set();
  try {
    const desde = new Date(Date.now() - DIAS_SIN_OFERTAS * 86400e3).toISOString();
    const r = await fetch(url + '/rest/v1/buscador_sin_ofertas?select=producto_id&visto=gte.' + encodeURIComponent(desde) +
      '&producto_id=in.(' + ids.map(encodeURIComponent).join(',') + ')', { headers: { apikey: key, Authorization: 'Bearer ' + key } });
    if (!r.ok) return new Set();
    return new Set((await r.json()).map(f => f.producto_id));
  } catch (e) { return new Set(); }
}
export async function anotarSinOfertas(ids) {
  const { url, key } = supaEnv();
  if (!key || !ids.length) return;
  try {
    await fetch(url + '/rest/v1/buscador_sin_ofertas?on_conflict=producto_id', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(ids.map(id => ({ producto_id: id, visto: new Date().toISOString() })))
    });
  } catch (e) {}
}

export async function analizarProducto(cliReal, prod) {
  // Si a este producto le cortaron alguna llamada por tiempo, sus datos estan
  // incompletos (menos ofertas de las que hay): se devuelve null y lo retoma la
  // tanda siguiente, en vez de guardarlo como analizado.
  let huboCorte = false;
  const cli = Object.assign(Object.create(cliReal), {
    get: (...a) => cliReal.get(...a).then(r => { if (r && r.cortada) huboCorte = true; return r; })
  });
  const r = await analizarProductoInterno(cli, prod);
  return huboCorte ? null : r;
}

async function analizarProductoInterno(cli, prod) {
  const q = prod.q;
  // Categoria y dominio de MeLi fijados para el producto (api/_categorias-datos.js).
  // Con dominio, /products/search trae solo productos de ese dominio: ya no
  // entran geles faciales cuando se busca un gel limpiador de teclado.
  const fija = categoriaDe(prod);
  const filtroDominio = fija && fija.dom ? '&domain_id=' + encodeURIComponent(fija.dom) : '';
  // Dentro del dominio muchos productos de catalogo no tienen ofertas (404):
  // se mira una pagina mas para llegar a las ofertas comparables.
  const buscar = (texto, filtro) => Promise.all(Array.from({ length: CATALOGO_PAGINAS + (filtro ? 1 : 0) }, (_, k) =>
    cli.get('products/search', MELI_API + '/products/search?status=active&site_id=MLA&limit=10&offset=' + (k * 10) + '&q=' + encodeURIComponent(texto) + filtro)));
  const vacia = ps => ps.every(r => !r.ok || !r.json || !(r.json.results || []).length);
  // 1. Catalogo: total y productos.
  let paginas = await buscar(q, filtroDominio);
  let sinFiltroYa = !filtroDominio;
  // Dentro del dominio, una busqueda larga puede no traer nada: se prueba
  // sacando palabras del final, nunca menos de 2. Si igual no trae nada (hay
  // dominios que /products/search casi no indexa), se busca sin el filtro y
  // las ofertas de otra categoria se descartan igual mas abajo.
  if (filtroDominio) {
    let pal = q.split(/\s+/);
    while (vacia(paginas) && pal.length > 2) { pal = pal.slice(0, -1); paginas = await buscar(pal.join(' '), filtroDominio); }
    if (vacia(paginas)) { paginas = await buscar(q, ''); sinFiltroYa = true; }
  }
  let catalogoTotal = null;
  const catalogo = [];
  const vistos = new Set();
  for (const r of paginas) {
    if (!r.ok || !r.json) continue;
    if (catalogoTotal == null && r.json.paging && typeof r.json.paging.total === 'number') catalogoTotal = r.json.paging.total;
    for (const x of (r.json.results || [])) if (x && x.id && !vistos.has(x.id)) { vistos.add(x.id); catalogo.push({ id: x.id, name: x.name || '' }); }
  }
  if (!catalogo.length) return null;
  // Solo los productos de catalogo cuyo nombre se parece de verdad al buscado
  // (puntaje >= 0,5 de las palabras significativas). /products/search mezcla
  // parecidos: para "comedero antivoracidad" trae comederos automaticos de
  // $85.000. Si no quedan 3, se baja la vara a cualquier coincidencia.
  const palabras = palabrasSignificativas(q);
  const puntuados = catalogo.map(c => ({ c, p: puntajeDeTitulo(c.name, palabras) }));
  let base = puntuados.filter(x => x.p >= 0.5);
  if (base.length < 3) base = puntuados.filter(x => x.p > 0);
  if (base.length < 3) base = puntuados;
  // Los que ya dieron 404 en los ultimos 30 dias no se vuelven a pedir.
  const sin404 = await conocidosSinOfertas(base.map(x => x.c.id));
  cli.estado.salteados404 = (cli.estado.salteados404 || 0) + sin404.size;
  const ordenados = base.filter(x => !sin404.has(x.c.id)).sort((a, b) => b.p - a.p).map(x => x.c).slice(0, MAX_PRODUCTOS_CON_ITEMS);

  // 2. Ofertas activas por producto de catalogo (404 = sin ofertas).
  const ofertas = [];
  const nuevos404 = [];
  const pedidos = new Set();
  let conOfertas = 0, revisados = 0;
  async function pedirOfertas(lista, tope, hasta) {
    let n = 0;
    for (let i = 0; i < lista.length && n < tope && hasta(); i += 4) {
      const lote = lista.slice(i, i + 4).filter(c => !pedidos.has(c.id)).slice(0, tope - n);
      if (!lote.length) continue;
      lote.forEach(c => pedidos.add(c.id));
      n += lote.length;
      const rs = await Promise.all(lote.map(c => cli.get('products/items', MELI_API + '/products/' + c.id + '/items?limit=10')));
      rs.forEach((r, k) => {
        revisados++;
        if (r.status === 404) nuevos404.push(lote[k].id);
        const items = r.ok && r.json && Array.isArray(r.json.results) ? r.json.results : [];
        if (items.length) conOfertas++;
        items.filter(it => it && typeof it.price === 'number' && it.price > 0).forEach(it => ofertas.push({
          id: it.item_id, title: lote[k].name, price: it.price,
          seller: { id: it.seller_id || null },
          shipping: { free_shipping: !!(it.shipping && it.shipping.free_shipping),
            logistic_type: it.shipping && typeof it.shipping.logistic_type === 'string' ? it.shipping.logistic_type : null },
          official_store_id: it.official_store_id || null,
          category_id: it.category_id || null,
          catalog_product_id: lote[k].id
        }));
      });
    }
  }
  await pedirOfertas(ordenados, MAX_PRODUCTOS_CON_ITEMS, () => ofertas.length < OFERTAS_OBJETIVO);

  // Con categoria fijada se descartan las ofertas de otras categorias, y la
  // demanda y la comision salen de la categoria correcta. Si quedan menos de
  // 3, se usan de respaldo las de categorias hermanas (mismo padre en
  // path_from_root) en vez de descartarlas: el producto sale con
  // datoAproximado.
  let padre = null, padreBuscado = false;
  const validas = () => ofertas.filter(o => !esMarca(o.title || ''));
  async function filtrar() {
    if (!fija) return { usadas: ofertas.slice(), exactas: ofertas.length, respaldo: 0 };
    const exactas = ofertas.filter(o => o.category_id === fija.cat);
    const nExactas = exactas.filter(o => !esMarca(o.title || '')).length;
    if (nExactas >= MIN_OFERTAS) return { usadas: exactas, exactas: exactas.length, respaldo: 0 };
    if (!padreBuscado) { padreBuscado = true; padre = await padreDe(cli, fija.cat); }
    if (!padre) return { usadas: exactas, exactas: exactas.length, respaldo: 0 };
    const hermanas = await ofertasDeHermanas(cli, ofertas, fija, padre.id);
    return { usadas: exactas.concat(hermanas), exactas: exactas.length, respaldo: hermanas.length };
  }
  const util = f => f.usadas.filter(o => !esMarca(o.title || '')).length;
  const exactasAntes = fija ? ofertas.filter(o => o.category_id === fija.cat && !esMarca(o.title || '')).length : validas().length;
  let f = await filtrar();
  let rescate = null;
  if (exactasAntes < MIN_OFERTAS && util(f) >= MIN_OFERTAS) rescate = 'categoriaPadre';

  // Si siguen sin llegar a OFERTAS_OBJETIVO: 2 paginas mas de catalogo (con y
  // sin dominio) antes de rendirse. Los productos nuevos pasan por el mismo
  // filtro de nombre; el tope de /items extra cuida el tiempo de la funcion.
  let paginasExtra = 0;
  if (util(f) < OBJETIVO_RESPALDO()) {
    const yaPaginas = CATALOGO_PAGINAS + (filtroDominio ? 1 : 0);
    const urls = [];
    if (!(filtroDominio && sinFiltroYa)) for (let k = 0; k < PAGINAS_EXTRA; k++) urls.push(filtroDominio + '&offset=' + ((yaPaginas + k) * 10));
    // Sin dominio: si la busqueda inicial ya fue sin filtro, se sigue desde
    // donde quedo; si no, se piden las primeras paginas sin el filtro.
    if (filtroDominio) for (let k = 0; k < PAGINAS_EXTRA; k++) urls.push('&offset=' + ((sinFiltroYa ? CATALOGO_PAGINAS + k : k) * 10));
    const rs = await Promise.all(urls.map(extra => cli.get('products/search', MELI_API + '/products/search?status=active&site_id=MLA&limit=10&q=' + encodeURIComponent(q) + extra)));
    paginasExtra = rs.length;
    const nuevos = [];
    for (const r of rs) {
      if (!r.ok || !r.json) continue;
      for (const x of (r.json.results || [])) if (x && x.id && !vistos.has(x.id)) { vistos.add(x.id); nuevos.push({ id: x.id, name: x.name || '' }); }
    }
    const pn = nuevos.map(c => ({ c, p: puntajeDeTitulo(c.name, palabras) })).filter(x => x.p > 0);
    const sin404b = await conocidosSinOfertas(pn.map(x => x.c.id));
    const extra = pn.filter(x => !sin404b.has(x.c.id)).sort((a, b) => b.p - a.p).map(x => x.c);
    if (extra.length) {
      const antes = util(f);
      await pedirOfertas(extra, MAX_ITEMS_EXTRA, () => true);
      f = await filtrar();
      if (antes < MIN_OFERTAS && util(f) >= MIN_OFERTAS && !rescate) rescate = 'paginasExtra';
    }
  }
  if (nuevos404.length) await anotarSinOfertas(nuevos404);
  ofertas.length = 0;
  f.usadas.forEach(o => ofertas.push(o));
  const datoAproximado = f.respaldo > 0;
  cli.estado.pasos = cli.estado.pasos || { categoriaPadre: 0, paginasExtra: 0, aproximados: 0, paginasPedidas: 0 };
  if (rescate) cli.estado.pasos[rescate]++;
  if (datoAproximado) cli.estado.pasos.aproximados++;
  cli.estado.pasos.paginasPedidas += paginasExtra;
  const respaldo = { exactas: f.exactas, deCategoriasHermanas: f.respaldo, categoriaPadre: padre ? padre.id : null, paginasExtra, rescate };
  if (!ofertas.length) {
    return { v: VERSION_MERCADO, catalogoTotal, catalogoRevisados: revisados, conOfertas: 0, results: [], respaldo };
  }

  // 3. Categoria (la mas repetida) y comision real.
  const cuenta = {};
  let catId = null;
  for (const o of ofertas) if (o.category_id) { cuenta[o.category_id] = (cuenta[o.category_id] || 0) + 1; if (!catId || cuenta[o.category_id] > cuenta[catId]) catId = o.category_id; }
  if (fija) catId = fija.cat;
  const precioRef = Math.round(mediana(ofertas.map(o => o.price)));
  // (Ya no se piden /users: la rotacion sale de vendidos reales, ver _rotacion.js.)
  const [cat, lp] = await Promise.all([
    datosCategoria(cli, catId),
    cli.get('listing_prices', MELI_API + '/sites/MLA/listing_prices?price=' + precioRef + '&listing_type_id=gold_special' + (catId ? '&category_id=' + catId : ''))
  ]);
  let comision = null;
  if (lp.ok && lp.json) {
    const t = Array.isArray(lp.json) ? lp.json[0] : lp.json;
    const d = t && t.sale_fee_details;
    if (d && Number(d.percentage_fee) > 0) comision = { porcentaje: Number(d.percentage_fee), cargoFijo: Math.round(Number(d.fixed_fee) || 0), precioConsultado: precioRef };
  }
  return {
    v: VERSION_MERCADO,
    catalogoTotal, catalogoRevisados: revisados, conOfertas,
    results: ofertas,
    categoria: cat ? { id: cat.id, nombre: cat.nombre, totalPublicaciones: cat.totalPublicaciones, tendenciasRevisadas: cat.tendencias ? cat.tendencias.length : null } : null,
    categoryName: cat && cat.nombre || null,
    tendencia: cat ? posicionEnTendencias(q, cat.tendencias) : null,
    comision,
    datoAproximado,
    respaldo,
    guardadoEn: new Date().toISOString()
  };
}

export async function analizarNicho(cli, productos) {
  const out = {};
  for (let i = 0; i < productos.length; i += 4) {
    const lote = productos.slice(i, i + 4);
    const rs = await Promise.all(lote.map(p => analizarProducto(cli, p).catch(() => null)));
    lote.forEach((p, k) => { out[p.q] = rs[k]; });
  }
  return out;
}
