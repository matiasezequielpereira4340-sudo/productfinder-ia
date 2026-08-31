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
  vendidos: ['soldQuantity', 'sold_quantity', 'sold', 'sales', 'quantitySold', 'vendidos'],
  vendedor: ['sellerName', 'seller_name', 'sellerNickname', 'seller', 'vendedor', 'seller_id', 'sellerId'],
  enlace: ['url', 'link', 'permalink', 'itemUrl', 'productUrl', 'enlace'],
  id: ['itemId', 'item_id', 'id', 'mlaId', 'productId']
};

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

  return {
    id,
    title: String(tomar(fila, ALIAS.titulo) || ''),
    price: aNumero(tomar(fila, ALIAS.precio)),
    sold_quantity: parseInt(String(tomar(fila, ALIAS.vendidos) || '0').replace(/[^\d]/g, ''), 10) || 0,
    seller: { id: vendedor || null, nickname: vendedor ? String(vendedor) : '' },
    shipping: { free_shipping: !!(fila.shipping && (fila.shipping.free_shipping || fila.shipping.freeShipping)) || !!fila.freeShipping }
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
    queries: [product],
    search: product,
    query: product,
    keyword: product,
    maxItems,
    country: 'AR',
    site: 'MLA'
  };
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
  const input = inputDeActor(product, minimoItems(o.maxItems));
  const url = 'https://api.apify.com/v2/acts/' + encodeURIComponent(actorId()) +
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
    results: elegidos
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
