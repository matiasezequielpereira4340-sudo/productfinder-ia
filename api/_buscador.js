// api/_buscador.js
// Capa de proveedor externo para las busquedas en MercadoLibre.
//
// Por que existe: MeLi cerro sus tres endpoints de busqueda a terceros
// (/sites/search 403, /products/{id}/items 404, /highlights 403) y ademas
// bloquea por IP a los servidores: las paginas publicas responden con
// /gz/account-verification, su muro de trafico sospechoso.
//
// La idea es pagar lo minimo: el proveedor externo se usa SOLO para obtener
// los IDs de publicacion; el precio, el vendedor, las ventas y el envio se
// siguen pidiendo gratis a la API oficial de MercadoLibre, que desde el
// servidor funciona sin problemas. Si el proveedor ya devuelve precios, se
// usan y se evita la segunda vuelta.
//
// Se elige proveedor con BUSCADOR_PROVEEDOR (apify | scrapingbee | scraperapi
// | off). Si no esta, se deduce de que credencial haya cargada.

import { extraerIdsMLA, hidratarItems, meliSlug } from './_meli.js';

export function proveedor() {
  const elegido = String(process.env.BUSCADOR_PROVEEDOR || '').trim().toLowerCase();
  if (elegido) return elegido;
  if (process.env.APIFY_TOKEN) return 'apify';
  if (process.env.SCRAPINGBEE_KEY) return 'scrapingbee';
  if (process.env.SCRAPERAPI_KEY) return 'scraperapi';
  return 'off';
}

// Solo booleanos: nunca se devuelve ninguna credencial.
export function estadoProveedor() {
  return {
    proveedor: proveedor(),
    apify_token: !!process.env.APIFY_TOKEN,
    apify_actor: process.env.APIFY_ACTOR || 'devcake~mercadolibre-scraper',
    apify_input_propio: !!process.env.APIFY_INPUT_JSON,
    scrapingbee_key: !!process.env.SCRAPINGBEE_KEY,
    scraperapi_key: !!process.env.SCRAPERAPI_KEY
  };
}

// "$ 12.345,67" / "12345.67" / 12345 -> 12345.67
export function aNumero(valor) {
  if (typeof valor === 'number') return isFinite(valor) && valor > 0 ? valor : null;
  if (typeof valor !== 'string') return null;
  let t = valor.replace(/[^\d.,]/g, '');
  if (!t) return null;
  // Formato es-AR: el punto separa miles y la coma decimales. "1.234" son mil
  // doscientos treinta y cuatro pesos, no uno con doscientos treinta y cuatro.
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  const n = parseFloat(t);
  return isFinite(n) && n > 0 ? n : null;
}

// Los actores de Apify no comparten nombres de campo. En vez de atarse a uno,
// se aceptan los alias habituales y, si no hay precio, se cae a la API oficial.
const ALIAS = {
  titulo: ['title', 'name', 'productName', 'product_name', 'titulo', 'nombre'],
  precio: ['price', 'priceValue', 'price_value', 'currentPrice', 'current_price', 'precio', 'salePrice'],
  vendidos: ['soldQuantity', 'sold_quantity', 'sold', 'sales', 'quantitySold', 'vendidos',
             'sold_quantity_text', 'soldQuantityText'],
  reputacion: ['vendor_reputation', 'sellerReputation', 'seller_reputation'],
  tienda: ['official_store', 'officialStore'],
  categoria: ['category_id', 'categoryId'],
  dominio: ['domain_id', 'domainId'],
  marca: ['brand', 'marca'],
  opiniones: ['reviews_count', 'reviewsCount'],
  stock: ['available_quantity', 'availableQuantity'],
  vendedor: ['sellerName', 'seller_name', 'sellerNickname', 'seller', 'vendedor', 'seller_id', 'sellerId'],
  enlace: ['url', 'link', 'permalink', 'itemUrl', 'productUrl', 'enlace'],
  id: ['itemId', 'item_id', 'ml_id', 'mlId', 'id', 'mlaId', 'productId']
};

// "+100 vendidos" -> 100. "+5mil vendidos" -> 5000. MeLi abrevia los miles y
// un parseInt pelado leia "5mil" como 5, que es 1000 veces menos.
export function aVendidos(valor) {
  if (typeof valor === 'number') return valor > 0 ? Math.round(valor) : 0;
  const t = String(valor || '').toLowerCase();
  if (!t) return 0;
  const m = t.match(/([\d.,]+)\s*(mil|k)?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  if (!isFinite(n)) return 0;
  if (m[2]) n *= 1000;
  return Math.round(n);
}

function tomar(obj, claves) {
  for (const c of claves) {
    if (obj && obj[c] !== undefined && obj[c] !== null && obj[c] !== '') return obj[c];
  }
  return null;
}

export function normalizarFila(fila) {
  if (!fila || typeof fila !== 'object') return null;
  const enlace = tomar(fila, ALIAS.enlace);
  const idBruto = tomar(fila, ALIAS.id);
  let id = null;
  const desdeId = String(idBruto || '').match(/MLA-?(\d{9,11})/);
  const desdeEnlace = String(enlace || '').match(/MLA-?(\d{9,11})/);
  if (desdeId) id = 'MLA' + desdeId[1];
  else if (desdeEnlace) id = 'MLA' + desdeEnlace[1];

  const vendedorBruto = tomar(fila, ALIAS.vendedor);
  const vendedor = (vendedorBruto && typeof vendedorBruto === 'object')
    ? (vendedorBruto.nickname || vendedorBruto.name || vendedorBruto.id || null)
    : vendedorBruto;

  // Reputacion y tienda oficial dicen contra quien se compite: no es lo mismo
  // pelearle a un revendedor que a una tienda oficial platinum.
  const rep = tomar(fila, ALIAS.reputacion);
  const tienda = tomar(fila, ALIAS.tienda);

  return {
    id,
    title: String(tomar(fila, ALIAS.titulo) || ''),
    price: aNumero(tomar(fila, ALIAS.precio)),
    sold_quantity: aVendidos(tomar(fila, ALIAS.vendidos)),
    seller: { id: vendedor || null, nickname: vendedor ? String(vendedor) : '' },
    shipping: { free_shipping: !!(fila.shipping && (fila.shipping.free_shipping || fila.shipping.freeShipping)) || !!fila.freeShipping },
    reputacion: (rep && typeof rep === 'object') ? (rep.power_seller_status || rep.level || null) : (rep || null),
    tienda_oficial: !!(tienda && (tienda.is_official || tienda.id)),
    category_id: tomar(fila, ALIAS.categoria) || null,
    domain_id: tomar(fila, ALIAS.dominio) || null,
    marca: tomar(fila, ALIAS.marca) || null,
    opiniones: parseInt(String(tomar(fila, ALIAS.opiniones) || '0'), 10) || 0,
    stock: parseInt(String(tomar(fila, ALIAS.stock) || '0'), 10) || 0
  };
}

// ------------------------------------------------------------
// Apify
// ------------------------------------------------------------
async function correrApify(product, opts) {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { error: 'APIFY_TOKEN no configurado' };
  const actor = (process.env.APIFY_ACTOR || 'devcake~mercadolibre-scraper').replace('/', '~');
  // El actor rechaza menos de 48 ("Field input.maxItems must be >= 48"), asi
  // que ese es el piso. Cada corrida cuesta lo que cueste ese lote entero:
  // pedir menos no sale mas barato, por eso conviene el cache de arriba.
  const minimo = parseInt(process.env.APIFY_MIN_ITEMS || '48', 10);
  const maxItems = Math.max(minimo, opts.maxItems || 0);

  // El input cambia de actor en actor. APIFY_INPUT_JSON permite adaptarlo sin
  // tocar codigo: {{q}} se reemplaza por el termino y {{max}} por el limite.
  let input;
  if (process.env.APIFY_INPUT_JSON) {
    try {
      input = JSON.parse(process.env.APIFY_INPUT_JSON
        .replace(/\{\{q\}\}/g, product.replace(/"/g, '\\"'))
        .replace(/\{\{max\}\}/g, String(maxItems)));
    } catch (e) {
      return { error: 'APIFY_INPUT_JSON no es JSON valido' };
    }
  } else {
    // "queries" es el campo que pide devcake~mercadolibre-scraper (lo dijo el
    // propio actor: "Field input.queries is required"). Los demas van como
    // alias para los actores que usan otro nombre; los que sobran se ignoran.
    input = {
      queries: [product],
      search: product,
      query: product,
      keyword: product,
      maxItems,
      country: 'AR',
      site: 'MLA'
    };
  }

  const url = 'https://api.apify.com/v2/acts/' + encodeURIComponent(actor) +
    '/run-sync-get-dataset-items?token=' + encodeURIComponent(token) +
    '&timeout=' + Math.round((opts.timeoutMs || 45000) / 1000) + '&format=json';

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 45000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctrl.signal
    });
    const texto = await r.text();
    if (!r.ok) {
      return {
        error: 'Apify HTTP ' + r.status + ': ' + texto.slice(0, 200),
        // El input no lleva credenciales: el token va en la URL.
        input_enviado: Object.keys(input)
      };
    }
    let datos;
    try { datos = JSON.parse(texto); } catch (_) { return { error: 'Apify no devolvio JSON' }; }
    if (!Array.isArray(datos)) return { error: 'Apify devolvio ' + typeof datos };
    return { filas: datos };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------
// Corridas asincronicas de Apify
// Medido en produccion: una corrida tarda MAS de 50 s, o sea que esperarla
// dentro del request es imposible (la funcion tiene 60 s y el usuario no va a
// mirar una pantalla en blanco un minuto). Entonces: se arranca la corrida, se
// guarda el id, se contesta enseguida, y el resultado se levanta despues.
// ------------------------------------------------------------
function inputDeActor(product, maxItems) {
  if (process.env.APIFY_INPUT_JSON) {
    return JSON.parse(process.env.APIFY_INPUT_JSON
      .replace(/\{\{q\}\}/g, product.replace(/"/g, '\\"'))
      .replace(/\{\{max\}\}/g, String(maxItems)));
  }
  return {
    // enrichDetailPage viene prendido de fabrica y se cobra aparte: $0.004 por
    // item contra $0.001 del resultado pelado. Apagarlo abarata la busqueda
    // cinco veces, pero no se sabe que campos se pierden hasta medirlo, asi
    // que por ahora queda como estaba y se cambia por env.
    enrichDetailPage: enriquecer(),
    queries: [product],
    search: product,
    query: product,
    keyword: product,
    maxItems,
    country: 'AR',
    site: 'MLA'
  };
}

// APIFY_ENRIQUECER=0 apaga la pagina de detalle. Default: prendido, que es lo
// que hace hoy, para no cambiar el comportamiento sin haberlo medido.
export function enriquecer() {
  const v = String(process.env.APIFY_ENRIQUECER || '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  return true;
}

function actorId() {
  return (process.env.APIFY_ACTOR || 'devcake~mercadolibre-scraper').replace('/', '~');
}

function minimoItems(pedido) {
  const minimo = parseInt(process.env.APIFY_MIN_ITEMS || '48', 10);
  return Math.max(minimo, pedido || 0);
}

// Arranca la corrida y devuelve el id. No espera a que termine.
export async function arrancarCorrida(product, opts) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN no configurado');
  const o = opts || {};
  // Por defecto arranca el actor de MercadoLibre con su input. Otras fuentes
  // (TikTok Shop, Google Trends) pasan su propio actor e input: la corrida, el
  // sondeo y la lectura del dataset son iguales para todos.
  const actor = o.actor || actorId();
  const input = o.input || inputDeActor(product, minimoItems(o.maxItems));
  const url = 'https://api.apify.com/v2/acts/' + encodeURIComponent(actor) +
    '/runs?token=' + encodeURIComponent(token);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs || 12000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctrl.signal
    });
    const texto = await r.text();
    if (!r.ok) {
      const e = new Error('Apify HTTP ' + r.status + ': ' + texto.slice(0, 200));
      e.input_enviado = Object.keys(input);
      throw e;
    }
    const j = JSON.parse(texto);
    const datos = j && j.data;
    if (!datos || !datos.id) throw new Error('Apify no devolvio id de corrida');
    return { runId: datos.id, datasetId: datos.defaultDatasetId || null, estado: datos.status };
  } finally {
    clearTimeout(t);
  }
}

// Estado de una corrida ya arrancada. No cuesta una corrida nueva.
export async function estadoCorrida(runId, opts) {
  const token = process.env.APIFY_TOKEN;
  if (!token || !runId) return { estado: 'sin-token' };
  const o = opts || {};
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs || 8000);
  try {
    const r = await fetch('https://api.apify.com/v2/actor-runs/' + encodeURIComponent(runId) +
      '?token=' + encodeURIComponent(token), { signal: ctrl.signal });
    if (!r.ok) return { estado: 'error-' + r.status };
    const j = await r.json();
    const d = (j && j.data) || {};
    return { estado: d.status || 'desconocido', datasetId: d.defaultDatasetId || null };
  } catch (_) {
    return { estado: 'sin-respuesta' };
  } finally {
    clearTimeout(t);
  }
}

// Filas ya normalizadas de una corrida terminada.
export async function itemsDeCorrida(datasetId, opts) {
  const token = process.env.APIFY_TOKEN;
  if (!token || !datasetId) return [];
  const o = opts || {};
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs || 12000);
  try {
    const r = await fetch('https://api.apify.com/v2/datasets/' + encodeURIComponent(datasetId) +
      '/items?token=' + encodeURIComponent(token) + '&format=json&clean=true&limit=' + (o.limite || 60),
      { signal: ctrl.signal });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (_) {
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Convierte las filas crudas del actor en el formato de la app. Si el actor no
// trajo precios, se completan gratis con la API oficial de MercadoLibre.
export async function armarResultado(product, filas, meliToken, opts) {
  const o = opts || {};
  let resultados = (filas || []).map(normalizarFila).filter(x => x && x.title);
  const conPrecio = resultados.filter(x => x.price > 0);

  if (!conPrecio.length && meliToken) {
    const ids = resultados.map(x => x.id).filter(Boolean).slice(0, o.maxItems || 40);
    if (ids.length) {
      const oficiales = await hidratarItems(ids, meliToken, Date.now() + (o.budgetMs || 8000));
      resultados = oficiales.map(it => ({
        id: it.id,
        title: it.title,
        price: it.price,
        sold_quantity: it.sold_quantity || 0,
        seller: { id: it.seller_id || null, nickname: it.seller_id ? ('Vendedor ' + it.seller_id) : '' },
        shipping: { free_shipping: !!(it.shipping && it.shipping.free_shipping) }
      }));
    }
  } else {
    resultados = conPrecio;
  }
  if (!resultados.length) return null;

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const palabras = norm(product).split(/\s+/).filter(w => w.length > 2);
  const conTodas = resultados.filter(it => { const t = norm(it.title); return palabras.every(w => t.includes(w)); });
  const elegidos = conTodas.length >= 3 ? conTodas : resultados;

  return {
    fuente: 'proveedor-apify',
    total: null,
    muestra: elegidos.length,
    categoryName: '',
    competencia: medirCompetencia(elegidos),
    results: elegidos
  };
}

// MercadoLibre no dice cuantas publicaciones hay para un termino, asi que
// "saturado" no se puede medir contando. Lo que si se puede medir, y con datos
// que ya se pagaron, es como esta repartida la venta entre los que ya estan.
// Un mercado donde tres vendedores se llevan el 90% esta tomado aunque haya
// cien publicaciones; uno donde la venta esta repartida tiene lugar aunque
// haya muchas. Todos estos numeros salen de la muestra, no del mercado entero:
// quien los lea tiene que saberlo, por eso viaja "muestra" al lado.
export function medirCompetencia(items) {
  const lista = (items || []).filter(Boolean);
  if (!lista.length) return null;

  const porVendedor = new Map();
  for (const it of lista) {
    const v = (it.seller && (it.seller.nickname || it.seller.id)) || 'sin-nombre';
    const a = porVendedor.get(v) || { vendedor: v, publicaciones: 0, vendidos: 0, oficial: false, reputacion: null };
    a.publicaciones++;
    a.vendidos += it.sold_quantity || 0;
    if (it.tienda_oficial) a.oficial = true;
    if (!a.reputacion && it.reputacion) a.reputacion = it.reputacion;
    porVendedor.set(v, a);
  }
  const vendedores = [...porVendedor.values()].sort((a, b) => b.vendidos - a.vendidos);
  const ventasTotales = vendedores.reduce((s, v) => s + v.vendidos, 0);
  const top3 = vendedores.slice(0, 3).reduce((s, v) => s + v.vendidos, 0);

  // Sin ventas informadas no se puede hablar de concentracion: se dice y listo.
  const concentracion = ventasTotales > 0 ? Math.round((top3 / ventasTotales) * 100) : null;

  const conMarca = lista.filter(i => i.marca).length;
  const categorias = {};
  for (const it of lista) if (it.category_id) categorias[it.category_id] = (categorias[it.category_id] || 0) + 1;
  const catDominante = Object.entries(categorias).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    muestra: lista.length,
    vendedores_distintos: vendedores.length,
    concentracion_top3: concentracion,
    ventas_en_la_muestra: ventasTotales,
    tiendas_oficiales: vendedores.filter(v => v.oficial).length,
    platinum: vendedores.filter(v => String(v.reputacion || '').includes('platinum')).length,
    con_marca: conMarca,
    categoria_dominante: catDominante ? { id: catDominante[0], publicaciones: catDominante[1] } : null,
    lideres: vendedores.slice(0, 5)
  };
}

// ------------------------------------------------------------
// Proxies de HTML (ScrapingBee / ScraperAPI)
// Traen la pagina de listado desde una IP que MeLi no bloquea. De ahi salen
// solo los IDs; los numeros los pone la API oficial.
// ------------------------------------------------------------
async function traerHtmlPorProxy(product, opts) {
  const destino = 'https://listado.mercadolibre.com.ar/' + meliSlug(product);
  let url;
  if (proveedor() === 'scrapingbee') {
    const key = process.env.SCRAPINGBEE_KEY;
    if (!key) return { error: 'SCRAPINGBEE_KEY no configurada' };
    url = 'https://app.scrapingbee.com/api/v1/?api_key=' + encodeURIComponent(key) +
      '&url=' + encodeURIComponent(destino) + '&render_js=false&country_code=ar';
  } else {
    const key = process.env.SCRAPERAPI_KEY;
    if (!key) return { error: 'SCRAPERAPI_KEY no configurada' };
    url = 'https://api.scraperapi.com/?api_key=' + encodeURIComponent(key) +
      '&url=' + encodeURIComponent(destino) + '&country_code=ar';
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 30000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const html = await r.text();
    if (!r.ok) return { error: 'Proxy HTTP ' + r.status };
    return { html };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------
// Punto de entrada
// meliToken es el de la cuenta conectada, para hidratar por la API oficial.
// ------------------------------------------------------------
export async function buscarConProveedor(product, meliToken, opts) {
  const o = opts || {};
  const cual = proveedor();
  if (cual === 'off') return null;

  let filas = [];
  let idsHtml = [];
  let totalHtml = null;

  if (cual === 'apify') {
    const r = await correrApify(product, o);
    if (r.error) {
      const e = new Error(r.error);
      e.proveedor = 'apify';
      e.input_enviado = r.input_enviado;
      throw e;
    }
    filas = r.filas || [];
  } else if (cual === 'scrapingbee' || cual === 'scraperapi') {
    const r = await traerHtmlPorProxy(product, o);
    if (r.error) { const e = new Error(r.error); e.proveedor = cual; throw e; }
    idsHtml = extraerIdsMLA(r.html).slice(0, o.maxItems || 40);
    const m = String(r.html).match(/([\d][\d.,]*)\s*resultados/i);
    if (m) totalHtml = parseInt(String(m[1]).replace(/[^0-9]/g, ''), 10) || null;
  } else {
    return null;
  }

  let resultados = filas.map(normalizarFila).filter(x => x && x.title);
  const conPrecio = resultados.filter(x => x.price > 0);

  // Si el proveedor no trajo precios, se completan con la API oficial usando
  // los IDs. Es la parte gratis del esquema.
  if (!conPrecio.length && meliToken) {
    const ids = idsHtml.length
      ? idsHtml
      : resultados.map(x => x.id).filter(Boolean).slice(0, o.maxItems || 40);
    if (ids.length) {
      const oficiales = await hidratarItems(ids, meliToken, Date.now() + (o.budgetMs || 8000));
      resultados = oficiales.map(it => ({
        id: it.id,
        title: it.title,
        price: it.price,
        sold_quantity: it.sold_quantity || 0,
        seller: { id: it.seller_id || null, nickname: it.seller_id ? ('Vendedor ' + it.seller_id) : '' },
        shipping: { free_shipping: !!(it.shipping && it.shipping.free_shipping) }
      }));
    }
  } else {
    resultados = conPrecio;
  }

  if (!resultados.length) return null;

  // Quedarse con lo que realmente habla del producto buscado.
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const palabras = norm(product).split(/\s+/).filter(w => w.length > 2);
  const conTodas = resultados.filter(it => { const t = norm(it.title); return palabras.every(w => t.includes(w)); });
  const elegidos = conTodas.length >= 3 ? conTodas : resultados;

  return {
    fuente: 'proveedor-' + cual,
    total: totalHtml,
    muestra: elegidos.length,
    categoryName: '',
    results: elegidos
  };
}

// ------------------------------------------------------------
// Diagnostico de la cuenta de Apify
// Read-only: solo consulta, no corre ningun actor y por lo tanto no gasta un
// centavo. Sirve para saber que actors hay disponibles de verdad y cuanto
// cobra cada uno, en vez de elegirlos de memoria desde el marketplace.
// ------------------------------------------------------------
async function apifyGet(ruta, timeoutMs) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN no configurado');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
  try {
    const sep = ruta.includes('?') ? '&' : '?';
    const r = await fetch('https://api.apify.com/v2' + ruta + sep + 'token=' + encodeURIComponent(token),
      { signal: ctrl.signal });
    const texto = await r.text();
    if (!r.ok) return { ok: false, status: r.status, detalle: texto.slice(0, 200) };
    try { return { ok: true, status: r.status, json: JSON.parse(texto) }; }
    catch (_) { return { ok: false, status: r.status, detalle: 'respuesta no JSON' }; }
  } catch (e) {
    return { ok: false, status: 0, detalle: String((e && e.message) || e).slice(0, 150) };
  } finally {
    clearTimeout(t);
  }
}

// Lo que cobra un actor, que es lo que decide si entra en el presupuesto.
function precioDeActor(a) {
  const p = (a && (a.currentPricingInfo || (Array.isArray(a.pricingInfos) ? a.pricingInfos[0] : null))) || null;
  if (!p) return 'sin precio publicado';
  const modelo = p.pricingModel || 'desconocido';
  if (modelo === 'PRICE_PER_DATASET_ITEM') {
    const usd = p.pricePerUnitUsd != null ? p.pricePerUnitUsd : (p.unitPriceUsd != null ? p.unitPriceUsd : null);
    return usd != null ? ('$' + (usd * 1000).toFixed(2) + ' por 1000 resultados') : 'por resultado';
  }
  if (modelo === 'FLAT_PRICE_PER_MONTH') {
    const usd = p.pricePerUnitUsd != null ? p.pricePerUnitUsd : null;
    return usd != null ? ('alquiler de $' + usd + '/mes') : 'alquiler mensual';
  }
  if (modelo === 'FREE') return 'gratis (pagas solo el computo)';
  // Con PAY_PER_EVENT el modelo solo no dice nada: el precio esta en cada
  // evento que el actor cobra. Sin esto, "PAY_PER_EVENT" y "gratis" se leen
  // igual, y con el credito contado eso importa.
  if (modelo === 'PAY_PER_EVENT') {
    const ev = (p.pricingPerEvent && p.pricingPerEvent.actorChargeEvents) || {};
    const partes = Object.keys(ev).slice(0, 4).map(k => {
      const e = ev[k] || {};
      const usd = e.eventPriceUsd;
      return (e.eventTitle || k) + ': ' + (usd != null ? '$' + usd : 'sin precio');
    });
    return partes.length ? ('por evento -> ' + partes.join(' | ')) : 'por evento (sin detalle)';
  }
  return modelo;
}

// Que devuelve el actor, campo por campo, mirando el dataset de una corrida
// que YA se pago. Leer un dataset no cuesta nada, asi que esto es gratis.
// Sirve para saber si el actor informa el total de publicaciones del termino,
// que es el dato que falta para poder decir si un producto esta saturado.
export async function inspeccionarUltimaCorrida(filtroActor) {
  const r = await apifyGet('/actor-runs?limit=10&desc=true', 12000);
  if (!r.ok) return { error: 'Apify ' + r.status + ': ' + (r.detalle || '') };
  const corridas = (r.json && r.json.data && r.json.data.items) || [];

  // Cuando hay varias fuentes corriendo, "la ultima" no alcanza: hay que poder
  // pedir la de un actor puntual. Se filtra por el id interno del actor, que
  // es lo unico que trae el listado de corridas.
  const filtro = String(filtroActor || '').trim();
  const candidatas = filtro
    ? corridas.filter(c => String(c.actId || '').includes(filtro))
    : corridas;

  const ok = candidatas.find(c => c.status === 'SUCCEEDED' && c.defaultDatasetId);
  if (!ok) {
    // Si no hay ninguna exitosa, igual sirve saber que paso con las que hubo.
    return {
      error: 'no hay corridas terminadas con exito para inspeccionar',
      filtro: filtro || null,
      ultimas: corridas.slice(0, 10).map(c => ({
        actor: c.actId, estado: c.status, arrancada: c.startedAt,
        items: (c.stats && c.stats.outputItemCount) != null ? c.stats.outputItemCount : null
      }))
    };
  }

  const ds = await apifyGet('/datasets/' + encodeURIComponent(ok.defaultDatasetId) +
    '/items?limit=2&format=json', 12000);
  const filas = (ds.ok && Array.isArray(ds.json)) ? ds.json : [];

  // Tambien la info del dataset: itemCount dice cuantos trajo en total.
  const meta = await apifyGet('/datasets/' + encodeURIComponent(ok.defaultDatasetId), 10000);

  return {
    // El listado de todas ayuda a ver cual es cual cuando hay varias fuentes.
    ultimas: corridas.slice(0, 10).map(c => ({
      actor: c.actId, estado: c.status,
      items: (c.stats && c.stats.outputItemCount) != null ? c.stats.outputItemCount : null
    })),
    corrida: { id: ok.id, actor: ok.actId, terminada: ok.finishedAt, items: (meta.ok && meta.json && meta.json.data && meta.json.data.itemCount) || null },
    campos: filas[0] ? Object.keys(filas[0]) : [],
    // Cualquier campo que suene a total de resultados es lo que buscamos.
    posibles_totales: filas[0]
      ? Object.keys(filas[0]).filter(k => /total|count|results|found|paging|quantity/i.test(k))
          .map(k => k + ' = ' + JSON.stringify(filas[0][k]).slice(0, 60))
      : [],
    fila_muestra: filas[0] ? JSON.parse(JSON.stringify(filas[0], (k, v) =>
        typeof v === 'string' && v.length > 90 ? v.slice(0, 90) + '...' : v)) : null
  };
}

// El esquema de entrada de un actor: que campos acepta y cuales prenden cosas
// que se cobran aparte. El actor de MercadoLibre cobra "Details" como evento
// propio ($0.004 por item, contra $0.001 del resultado pelado), asi que apagar
// el enriquecimiento abarata la busqueda cinco veces. Esto se lee del build
// publicado: es gratis y no corre nada.
export async function esquemaDeActor(id) {
  const actor = String(id || '').replace('/', '~');
  if (!/^[\w.-]+~[\w.-]+$/.test(actor)) return { error: 'id de actor invalido' };

  const a = await apifyGet('/acts/' + encodeURIComponent(actor), 12000);
  if (!a.ok) return { error: 'Apify ' + a.status + ': ' + (a.detalle || '') };
  const d = (a.json && a.json.data) || {};
  const buildId = d.taggedBuilds && d.taggedBuilds.latest && d.taggedBuilds.latest.buildId;
  if (!buildId) return { error: 'el actor no publica un build', actor };

  const b = await apifyGet('/actor-builds/' + encodeURIComponent(buildId), 12000);
  if (!b.ok) return { error: 'Apify build ' + b.status + ': ' + (b.detalle || '') };
  let esquema = (b.json && b.json.data && b.json.data.inputSchema) || null;
  if (typeof esquema === 'string') { try { esquema = JSON.parse(esquema); } catch (_) { esquema = null; } }
  if (!esquema || !esquema.properties) return { error: 'el build no trae esquema de entrada', actor };

  const props = esquema.properties;
  const campos = Object.keys(props).map(k => {
    const p = props[k] || {};
    return {
      campo: k,
      tipo: p.type || '?',
      por_defecto: p.default !== undefined ? p.default : (p.prefill !== undefined ? p.prefill : null),
      // Los valores validos, cuando el campo es de opciones. Sin esto no se
      // sabe que se le puede mandar, y un valor inventado tumba la corrida.
      opciones: Array.isArray(p.enum) ? p.enum.slice(0, 8) : null,
      titulo: String(p.title || '').slice(0, 60)
    };
  });

  // Los que suenan a "traeme tambien el detalle", que es lo que se cobra aparte.
  const sospechosos = campos.filter(c =>
    /detail|enrich|full|extend|deep|description|review|extra|complete/i.test(c.campo + ' ' + c.titulo));

  return {
    actor,
    requeridos: Array.isArray(esquema.required) ? esquema.required : [],
    total_campos: campos.length,
    encienden_el_detalle: sospechosos,
    campos
  };
}

export async function buscarActors(consulta, limite) {
  const r = await apifyGet('/store?limit=' + (limite || 8) + '&search=' + encodeURIComponent(consulta), 15000);
  if (!r.ok) return { error: 'Apify ' + r.status + ': ' + (r.detalle || ''), consulta };
  const items = (r.json && r.json.data && Array.isArray(r.json.data.items)) ? r.json.data.items : [];
  return {
    consulta,
    encontrados: items.length,
    actors: items.map(a => ({
      // Este es el id que se pone en APIFY_ACTOR.
      id: (a.username || '') + '~' + (a.name || ''),
      titulo: String(a.title || '').slice(0, 70),
      precio: precioDeActor(a),
      corridas_totales: (a.stats && a.stats.totalRuns) || null,
      exito_pct: (a.stats && a.stats.publicActorRunStats30Days && a.stats.publicActorRunStats30Days.SUCCEEDED != null)
        ? a.stats.publicActorRunStats30Days.SUCCEEDED : null
    }))
  };
}

// Cuanto credito queda: define cuantas keywords puede mirar el radar.
export async function estadoCuentaApify() {
  const [usuario, limites] = await Promise.all([
    apifyGet('/users/me', 10000),
    apifyGet('/users/me/limits', 10000)
  ]);
  const salida = {};
  if (usuario.ok && usuario.json && usuario.json.data) {
    const d = usuario.json.data;
    salida.plan = (d.plan && (d.plan.id || d.plan.description)) || null;
    salida.usuario = d.username || null;   // el nombre de la cuenta, no el token
  } else {
    salida.error_usuario = 'Apify ' + usuario.status + ': ' + (usuario.detalle || '');
  }
  if (limites.ok && limites.json && limites.json.data) {
    const d = limites.json.data;
    salida.uso_mensual_usd = d.current && d.current.monthlyUsageUsd != null ? d.current.monthlyUsageUsd : null;
    salida.tope_mensual_usd = d.limits && d.limits.maxMonthlyUsageUsd != null ? d.limits.maxMonthlyUsageUsd : null;
    if (salida.uso_mensual_usd != null && salida.tope_mensual_usd != null) {
      salida.credito_restante_usd = Math.round((salida.tope_mensual_usd - salida.uso_mensual_usd) * 100) / 100;
    }
  }
  return salida;
}
