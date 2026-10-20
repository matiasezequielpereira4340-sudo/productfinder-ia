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

import { MELI_API, fetchJson } from './_meli.js';

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
