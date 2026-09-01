// api/_fuentes.js
// Fuentes de descubrimiento que NO son MercadoLibre.
//
// Por que existen: el Radar sale hoy de /trends de MeLi, que dice que se busca
// mas dentro de MercadoLibre. Eso deja afuera lo que se esta vendiendo en otro
// lado y todavia no llego. TikTok Shop Brasil muestra que se vende hoy alla,
// con unidades; Google Trends dice si un termino crece fuera de MeLi.
//
// Las dos cuestan plata, asi que NADA se corre solo. Cada consulta la dispara
// el usuario apretando un boton que dice lo que va a gastar, y el resultado se
// cachea para no volver a pagarlo. La cuenta es chica ($5/mes) y el Radar
// necesita ese credito para medir competencia: si estas fuentes se corrieran
// en cada visita, se lo comen en un dia.
//
// Actores y precios medidos contra la API de Apify el 2026-09-01:
//   devcake~tiktok-shop-data-scraper   arranque $0.00005 + $0.002 por result
//   vnx0~google-trends-scraper         $0.0012 por result, sin costo de arranque
// Se eligieron por ser los mas baratos CON precio publicado en su modelo por
// evento; varios de los mas usados no publican el precio por resultado, y con
// el credito contado no se corre a ciegas. Se pueden cambiar por env sin tocar
// codigo, por si suben de precio o dejan de andar.

import { supa } from './_meli.js';
import { arrancarCorrida, estadoCorrida, itemsDeCorrida, aNumero, aVendidos } from './_buscador.js';

const ACTOR_TIKTOK = () => (process.env.APIFY_ACTOR_TIKTOK || 'devcake~tiktok-shop-data-scraper').replace('/', '~');
const ACTOR_TRENDS = () => (process.env.APIFY_ACTOR_TRENDS || 'vnx0~google-trends-scraper').replace('/', '~');

// Cuanto sale cada consulta, con los precios de arriba. Se muestra en el boton
// antes de gastar: que el numero lo vea quien paga, no que aparezca despues.
export function costoEstimado(fuente, items) {
  const n = items || 30;
  if (fuente === 'tiktok') return 0.00005 + n * 0.002;
  if (fuente === 'trends') return n * 0.0012;
  return null;
}

// ------------------------------------------------------------
// Corrida generica con cache. Misma mecanica que la de MercadoLibre:
// cache -> cosechar corrida pendiente -> arrancar una nueva.
// Devuelve {pendiente:true} mientras corre; el frontend reintenta.
// ------------------------------------------------------------
const VIGENCIA_CORRIDA_MS = 15 * 60 * 1000;

async function filaCache(clave) {
  try {
    const { url, key, ok } = supa();
    if (!ok) return null;
    const r = await fetch(url + '/rest/v1/busquedas_cache?termino=eq.' +
      encodeURIComponent(clave) + '&select=*&limit=1',
      { headers: { apikey: key, Authorization: 'Bearer ' + key } });
    if (!r.ok) return null;
    const filas = await r.json();
    return (Array.isArray(filas) && filas[0]) || null;
  } catch (_) { return null; }
}

async function guardarFila(clave, campos) {
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
      body: JSON.stringify(Object.assign({
        termino: clave, created_at: new Date().toISOString()
      }, campos))
    });
  } catch (_) { /* el cache no puede romper la consulta */ }
}

function horasCache() {
  const h = parseInt(process.env.FUENTES_CACHE_HORAS || '72', 10);
  return isFinite(h) && h >= 0 ? h : 72;
}

export async function corridaCacheada(cfg) {
  const { clave, actor, input, normalizar, limite } = cfg;
  const horas = horasCache();

  const fila = await filaCache(clave);

  // 1. Cache vigente: gratis.
  if (fila && Array.isArray(fila.resultados) && fila.resultados.length && horas) {
    const vence = new Date(fila.created_at).getTime() + horas * 3600 * 1000;
    if (Date.now() < vence) {
      return { items: fila.resultados, desdeCache: true, guardadoEn: fila.created_at };
    }
  }

  // 2. Hay una corrida en vuelo: se cosecha, no se arranca otra. Arrancar una
  //    segunda mientras la primera corre seria pagar dos veces lo mismo.
  if (fila && fila.run_id) {
    const desde = fila.run_desde ? new Date(fila.run_desde).getTime() : 0;
    const vigente = !!desde && (Date.now() - desde) < VIGENCIA_CORRIDA_MS;
    if (vigente) {
      const est = await estadoCorrida(fila.run_id);
      if (est.estado === 'RUNNING' || est.estado === 'READY') return { pendiente: true };
      if (est.estado === 'SUCCEEDED') {
        const crudo = await itemsDeCorrida(est.datasetId || fila.dataset_id, { limite: limite || 60 });
        const items = (crudo || []).map(normalizar).filter(Boolean);
        if (items.length) {
          await guardarFila(clave, { fuente: cfg.fuente, resultados: items, run_id: null,
            dataset_id: null, run_estado: 'SUCCEEDED' });
          return { items, desdeCache: false };
        }
        // Termino bien pero sin nada util: se informa, no se reintenta sola.
        await guardarFila(clave, { fuente: cfg.fuente, resultados: [], run_id: null, run_estado: 'VACIA' });
        return { items: [], vacia: true };
      }
      return { error: 'La consulta anterior termino en ' + est.estado };
    }
  }

  // 3. Arrancar. Esto es lo unico que cuesta.
  try {
    const corrida = await arrancarCorrida(null, { actor, input, timeoutMs: 12000 });
    await guardarFila(clave, {
      fuente: cfg.fuente, resultados: [], run_id: corrida.runId,
      dataset_id: corrida.datasetId || null, run_estado: corrida.estado || 'RUNNING',
      run_desde: new Date().toISOString()
    });
    return { pendiente: true, arrancada: true };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 200) };
  }
}

// ------------------------------------------------------------
// TikTok Shop Brasil
// ------------------------------------------------------------
// Que se vende hoy en Brasil, con unidades. Es la fuente que mas se parece a
// "producto ganador": no es interes de busqueda, es venta.
export function normalizarTikTok(f) {
  if (!f || typeof f !== 'object') return null;
  const titulo = f.title || f.product_name || f.name || f.productName || '';
  if (!titulo) return null;
  const vendidos = aVendidos(f.sold_count != null ? f.sold_count
    : (f.sales != null ? f.sales : (f.sold_quantity != null ? f.sold_quantity : f.sold_text)));
  return {
    titulo: String(titulo).slice(0, 140),
    vendidos,
    precio: aNumero(f.price != null ? f.price : (f.sale_price != null ? f.sale_price : f.min_price)),
    moneda: f.currency || 'BRL',
    tienda: (f.shop_name || f.seller_name || (f.shop && f.shop.name) || null),
    puntaje: typeof f.rating === 'number' ? f.rating : null,
    url: f.url || f.product_url || f.link || null
  };
}

export async function tiktokShopBR(consulta, opts) {
  const q = String(consulta || '').trim().slice(0, 60);
  if (!q) return { error: 'falta el termino' };
  const n = Math.min(Math.max(parseInt((opts && opts.items) || 30, 10), 10), 50);
  return await corridaCacheada({
    clave: 'tiktok-br::' + q.toLowerCase(),
    fuente: 'tiktok-shop-br',
    actor: ACTOR_TIKTOK(),
    limite: n,
    // Los actores no comparten nombres de campo: se mandan los alias y el que
    // sobra lo ignora el actor. Mismo criterio que con el de MercadoLibre.
    input: { keyword: q, search: q, query: q, keywords: [q],
      region: 'BR', country: 'BR', maxItems: n, limit: n },
    normalizar: normalizarTikTok
  });
}

// ------------------------------------------------------------
// Google Trends
// ------------------------------------------------------------
// Dice si un termino crece FUERA de MercadoLibre. Sirve para separar lo que
// sube de verdad de lo que solo se movio dentro de MeLi.
export function normalizarTrend(f) {
  if (!f || typeof f !== 'object') return null;
  const termino = f.query || f.keyword || f.term || f.title || f.topic || '';
  if (!termino) return null;
  // Google marca lo que explota como "Breakout" en vez de un porcentaje.
  const bruto = f.value != null ? f.value : (f.growth != null ? f.growth : f.increase);
  const explota = /breakout/i.test(String(bruto || '')) || /breakout/i.test(String(f.formattedValue || ''));
  const num = explota ? null : aNumero(bruto);
  return {
    termino: String(termino).slice(0, 80),
    crecimiento: num,
    explota,
    tipo: f.type || f.rankingType || null
  };
}

export async function googleTrends(keyword, opts) {
  const q = String(keyword || '').trim().slice(0, 60);
  if (!q) return { error: 'falta el termino' };
  const geo = String((opts && opts.geo) || 'AR').toUpperCase().slice(0, 2);
  return await corridaCacheada({
    clave: 'gtrends::' + geo + '::' + q.toLowerCase(),
    fuente: 'google-trends',
    actor: ACTOR_TRENDS(),
    limite: 40,
    input: { searchTerms: [q], keywords: [q], query: q, geo,
      timeRange: 'today 12-m', isPublic: false },
    normalizar: normalizarTrend
  });
}
