// api/_fuentes.js
// Fuentes de descubrimiento que NO son MercadoLibre.
//
// Por que existen: el Radar sale hoy de /trends de MeLi, que dice que se busca
// mas dentro de MercadoLibre. Eso deja afuera lo que se esta vendiendo en otro
// lado y todavia no llego. TikTok Shop muestra que se vende hoy, con unidades
// reales; Google Trends dice si un termino crece fuera de MeLi.
//
// Aclaracion medida: la idea era TikTok Shop BRASIL, pero el unico actor
// barato que anda devuelve la tienda de Estados Unidos y no acepta cambiarlo.
// El pais se deduce de las urls y se informa; no se rotula de memoria.
//
// Las dos cuestan plata, asi que NADA se corre solo. Cada consulta la dispara
// el usuario apretando un boton que dice lo que va a gastar, y el resultado se
// cachea para no volver a pagarlo. La cuenta es chica ($5/mes) y el Radar
// necesita ese credito para medir competencia: si estas fuentes se corrieran
// en cada visita, se lo comen en un dia.
//
// Actores y precios medidos contra la API de Apify el 2026-09-01:
//   devcake~tiktok-shop-data-scraper    arranque $0.00005 + $0.002 por result
//   khadinakbar~google-trends-scraper   arranque $0.00005 + $0.005 por result
// El primer criterio fue el precio publicado, y salio mal: el actor de Trends
// mas barato (vnx0, $0.0012) resulto ser de "tendencias del dia" y contestaba
// cualquier cosa. Barato y equivocado no sirve. Se cambian por env sin tocar
// codigo, por si suben de precio o dejan de andar.

import { supa } from './_meli.js';
import { arrancarCorrida, estadoCorrida, itemsDeCorrida, aNumero, aVendidos } from './_buscador.js';

const ACTOR_TIKTOK = () => (process.env.APIFY_ACTOR_TIKTOK || 'devcake~tiktok-shop-data-scraper').replace('/', '~');
// MEDIDO 2026-09-01: vnx0~google-trends-scraper IGNORA el termino. Su titulo
// completo es "Google Trends Daily Scraper - Real-Time Trending Keywords API":
// devuelve lo que es tendencia hoy en el pais, no las busquedas relacionadas de
// un producto. Consultado "mini proyector" en AR contesto "lo celso", "javier
// milei", "clima mar del plata". Se eligio mirando el precio y no lo que hace.
// khadinakbar~google-trends-scraper si es de busquedas relacionadas: se llama
// "Interest, Regions & Queries". Sale $0.005 por resultado mas $0.00005 de
// arranque, unos $0.05 la consulta, contra los $0.012 del anterior. Mas caro,
// pero el anterior costaba menos porque contestaba otra cosa.
const ACTOR_TRENDS = () => (process.env.APIFY_ACTOR_TRENDS || 'khadinakbar~google-trends-scraper').replace('/', '~');

// Cuanto sale cada consulta, con los precios de arriba. Se muestra en el boton
// antes de gastar: que el numero lo vea quien paga, no que aparezca despues.
// Tope de resultados de Google Trends. El actor viene con 500 de fabrica y
// cobra $0.005 cada uno: dejarlo asi es $2,50 por consulta. Con 20 alcanza
// para ver que busca la gente alrededor del termino.
export const TOPE_TRENDS = parseInt(process.env.TRENDS_MAX_RESULTS || '20', 10) || 20;

export function costoEstimado(fuente, items) {
  const n = items || 30;
  if (fuente === 'tiktok') return 0.00005 + n * 0.002;
  // El de trends se calcula sobre el TOPE, no sobre lo que volvio: es lo que
  // se arriesga al apretar el boton, que es lo que hay que mostrar antes.
  if (fuente === 'trends') return 0.00005 + TOPE_TRENDS * 0.005;
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

// El actor entra en la clave. Sin eso, cambiar de actor seguia sirviendo lo
// guardado por el anterior: cuando se reemplazo el de Google Trends porque
// contestaba tendencias del dia, el cache seguia devolviendo "javier milei"
// para consultas de producto. Dos fuentes distintas no comparten cajon.
function claveConActor(clave, actor) {
  return clave + '@' + String(actor || '').split('~').pop().slice(0, 24);
}

// Por que fallo una corrida. Apify lo deja en statusMessage y en el log.
// Leerlo no cuesta nada y evita la siguiente corrida a ciegas, que si cuesta.
async function motivoDeFalla(runId) {
  try {
    const token = process.env.APIFY_TOKEN;
    if (!token || !runId) return null;
    const r = await fetch('https://api.apify.com/v2/actor-runs/' +
      encodeURIComponent(runId) + '?token=' + encodeURIComponent(token));
    if (!r.ok) return null;
    const j = await r.json();
    const d = (j && j.data) || {};
    const partes = [];
    if (d.statusMessage) partes.push(String(d.statusMessage).slice(0, 200));
    if (d.exitCode != null) partes.push('exitCode ' + d.exitCode);
    return partes.length ? partes.join(' | ') : null;
  } catch (_) { return null; }
}

export async function corridaCacheada(cfg) {
  const { actor, input, normalizar, limite } = cfg;
  const clave = claveConActor(cfg.clave, actor);
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
      // "FAILED" a secas no alcanza para arreglar nada: hay que ver que dijo
      // Apify. El motivo esta en la corrida, y leerlo es gratis.
      const motivo = await motivoDeFalla(fila.run_id);
      return { error: 'La consulta anterior termino en ' + est.estado +
        (motivo ? ': ' + motivo : ''), estado_corrida: est.estado };
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
// TikTok Shop
// ------------------------------------------------------------
// Que se vende hoy, con unidades. Es la fuente que mas se parece a "producto
// ganador": no es interes de busqueda, es venta. Ojo con el pais: ver arriba.
// MEDIDO 2026-09-01: este actor devuelve SIEMPRE TikTok Shop Estados Unidos.
// Se le paso apifyProxyCountryCode 'BR' y aun asi las 30 urls salieron con
// /us/ y los precios en USD. No tiene campo de region: es de EE.UU. y punto.
// Por eso el pais se DEDUCE de los datos y no se da por sentado: rotular
// datos reales con el pais equivocado es peor que no tenerlos.
function paisDeUrl(u) {
  const m = String(u || '').match(/shop\.tiktok\.com\/([a-z]{2})\//i);
  return m ? m[1].toUpperCase() : null;
}

export function normalizarTikTok(f) {
  if (!f || typeof f !== 'object') return null;
  const titulo = f.title || f.product_name || f.name || f.productName || '';
  if (!titulo) return null;
  const url = f.url || f.product_url || f.link || null;
  const vendidos = aVendidos(f.sold_count != null ? f.sold_count
    : (f.sales != null ? f.sales : (f.sold_quantity != null ? f.sold_quantity : f.sold_text)));
  return {
    titulo: String(titulo).slice(0, 140),
    vendidos,
    precio: aNumero(f.price != null ? f.price : (f.sale_price != null ? f.sale_price : f.min_price)),
    moneda: f.currency || null,
    tienda: (f.shop_name || f.seller_name || (f.shop && f.shop.name) || null),
    puntaje: typeof f.rating === 'number' ? f.rating : null,
    pais: paisDeUrl(url),
    url
  };
}

export async function tiktokShopBR(consulta, opts) {
  const q = String(consulta || '').trim().slice(0, 60);
  if (!q) return { error: 'falta el termino' };
  const n = Math.min(Math.max(parseInt((opts && opts.items) || 30, 10), 10), 50);
  const r = await corridaCacheada({
    clave: 'tiktok::' + q.toLowerCase(),
    fuente: 'tiktok-shop',
    actor: ACTOR_TIKTOK(),
    limite: n,
    // MEDIDO 2026-09-01: mandar alias no sirve con este actor. Se le mandaron
    // keyword/search/query/keywords y ninguno era el nombre real, asi que la
    // corrida termino en 11 segundos con el dataset vacio. El esquema dice que
    // los campos son searchKeywords y maxProducts.
    //
    // Y el pais NO es un campo: sale del proxy, que viene en "US". Sin cambiar
    // eso se scrapea TikTok Shop Estados Unidos, no Brasil, y el dato no sirve
    // para nada de lo que buscamos.
    //
    // sortBySoldCount existe y seria justo lo que queremos, pero el esquema no
    // publica que valores acepta y un valor invalido tumba la corrida. Se deja
    // en su default y se ordena por ventas del lado nuestro, que es gratis.
    input: {
      searchKeywords: [q],
      maxProducts: n,
      includeReviews: false,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        apifyProxyCountryCode: 'BR'
      }
    },
    normalizar: normalizarTikTok
  });
  if (r.error || r.pendiente || r.vacia) return r;

  // De que tienda salio esto en realidad. Se cuenta, no se supone.
  const paises = {};
  for (const p of r.items) if (p.pais) paises[p.pais] = (paises[p.pais] || 0) + 1;
  const dominante = Object.entries(paises).sort((a, b) => b[1] - a[1])[0];
  const monedas = [...new Set(r.items.map(p => p.moneda).filter(Boolean))];

  return Object.assign({}, r, {
    pais: dominante ? dominante[0] : null,
    monedas,
    reparto_paises: paises
  });
}

// ------------------------------------------------------------
// Google Trends
// ------------------------------------------------------------
// Dice si un termino crece FUERA de MercadoLibre. Sirve para separar lo que
// sube de verdad de lo que solo se movio dentro de MeLi.
// MEDIDO 2026-09-01 sobre el dataset: la fila trae keyword (el termino que se
// pregunto) y related_query (lo que la gente busca alrededor). Yo leia keyword,
// asi que las 7 filas salian con el mismo texto y distinto numero: parecia un
// dato y era el eco de la pregunta. El bueno es related_query.
export function normalizarTrend(f) {
  if (!f || typeof f !== 'object') return null;
  const semilla = String(f.keyword || f.query || '').trim();
  const termino = String(f.related_query || f.relatedQuery || f.query || f.term || f.title || f.topic || '').trim();
  if (!termino) return null;
  // Repetir la semilla no aporta nada: es la pregunta, no la respuesta.
  if (semilla && termino.toLowerCase() === semilla.toLowerCase()) return null;

  // Google marca lo que explota como "Breakout" en vez de un porcentaje.
  const formateado = String(f.formatted_value != null ? f.formatted_value : (f.formattedValue || ''));
  const bruto = f.value != null ? f.value : (f.growth != null ? f.growth : f.increase);
  const explota = /breakout/i.test(formateado) || /breakout/i.test(String(bruto || ''));
  const num = explota ? null : aNumero(bruto);

  return {
    termino: termino.slice(0, 80),
    semilla: semilla || null,
    crecimiento: num,
    explota,
    // "rising" es lo que viene subiendo; lo demas es lo que ya se busca mucho.
    subiendo: !!(f.is_rising || f.isRising),
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
    // MEDIDO 2026-09-01 contra el esquema, DESPUES de que una corrida fallara
    // por mandar timeRange en vez de timeframe.
    //
    // OJO CON maxResults: viene en 500 por defecto. A $0.005 el resultado, una
    // consulta con el default sale $2,50, o sea todo el credito del mes en un
    // solo click. Se acota a mano y el tope viaja en el costo estimado.
    //
    // dataTypes trae interest_over_time y related_queries. Solo interesa el
    // segundo: la serie de tiempo son decenas de filas que se cobran igual.
    input: {
      keywords: [q],
      geo,
      timeframe: 'today 12-m',
      dataTypes: ['related_queries'],
      maxResults: TOPE_TRENDS
    },
    normalizar: normalizarTrend
  });
}

// ------------------------------------------------------------
// Prueba: la misma busqueda de MercadoLibre pero SIN la pagina de detalle
// ------------------------------------------------------------
// enrichDetailPage viene prendido y se cobra aparte ($0.004 por item contra
// $0.001 del resultado pelado): apagarlo abarata la busqueda cinco veces. Lo
// que no se sabe es que campos se pierden. medirCompetencia necesita
// sold_quantity_text, vendor_reputation, official_store y category_id; si
// alguno sale de la pagina de detalle, apagarlo rompe la medicion.
//
// Esto corre UNA busqueda con el detalle apagado y reporta que campos vinieron
// y cuales de los que precisamos faltan. Corre por su propia clave de cache,
// asi que no toca lo que ve el usuario, y cuesta ~$0.048: menos que una
// busqueda normal, porque justamente no paga el detalle.
const CAMPOS_QUE_PRECISAMOS = [
  'price', 'seller', 'sold_quantity_text', 'vendor_reputation',
  'official_store', 'category_id', 'ml_id', 'available_quantity'
];

export async function pruebaSinEnriquecer(termino) {
  const q = String(termino || '').trim().slice(0, 60);
  if (!q) return { error: 'falta el termino' };
  const actor = (process.env.APIFY_ACTOR || 'devcake~mercadolibre-scraper').replace('/', '~');

  const r = await corridaCacheada({
    clave: 'sin-detalle::' + q.toLowerCase(),
    fuente: 'prueba-sin-detalle',
    actor,
    limite: 48,
    input: { queries: [q], country: 'AR', maxItems: 48, enrichDetailPage: false },
    // Se guarda la fila cruda tal cual, recortada: la gracia es ver que campos
    // llegan, no armar un resultado.
    normalizar: f => (f && typeof f === 'object') ? f : null
  });
  if (r.error || r.pendiente || r.vacia) return r;

  const filas = r.items || [];
  const presentes = new Set();
  for (const f of filas) for (const k of Object.keys(f)) {
    if (f[k] !== null && f[k] !== undefined && f[k] !== '') presentes.add(k);
  }
  const faltan = CAMPOS_QUE_PRECISAMOS.filter(c => !presentes.has(c));

  return {
    items: filas.length,
    desdeCache: !!r.desdeCache,
    costo_usd: 0.00005 + filas.length * 0.001,
    campos: [...presentes].sort(),
    precisamos: CAMPOS_QUE_PRECISAMOS,
    faltan,
    // El veredicto en una linea, que es lo que importa.
    veredicto: faltan.length
      ? 'NO se puede apagar: sin la pagina de detalle faltan ' + faltan.join(', ')
      : 'SE PUEDE APAGAR: llegan todos los campos que usa la app, a un quinto del precio'
  };
}

// Se puede tapar el agujero con la API oficial?
// La corrida barata pierde ventas, reputacion y stock, pero conserva el ml_id.
// La API de MercadoLibre devuelve el item completo por id y es gratis, asi que
// si de ahi salen las ventas, el atajo cierra: corrida barata para los IDs mas
// hidratacion gratis para lo que falta. Esta comprobacion no gasta nada: lee
// el dataset que ya se pago y consulta la API oficial.
export async function seTapaConLaApi(termino, token) {
  const q = String(termino || '').trim().slice(0, 60);
  if (!q) return { error: 'falta el termino' };

  const fila = await filaCache('sin-detalle::' + q.toLowerCase());
  const crudas = (fila && Array.isArray(fila.resultados)) ? fila.resultados : [];
  if (!crudas.length) return { error: 'no hay una corrida barata guardada para ese termino' };

  const ids = crudas.map(f => f && (f.ml_id || f.item_id))
    .filter(x => /^MLA\d{9,11}$/.test(String(x))).slice(0, 8);
  if (!ids.length) return { error: 'la corrida barata no dejo ids usables' };

  const { hidratarItems, fetchJson, MELI_API } = await import('./_meli.js');
  const items = await hidratarItems(ids, token, Date.now() + 8000);

  // Si no vino nada, hay que ver POR QUE. hidratarItems descarta lo que no
  // tenga titulo y precio, asi que "cero items" puede ser un 403, un id que no
  // existe, o una fila que si vino pero sin esos campos. Se consulta en crudo y
  // se reporta lo que dijo MercadoLibre, en vez de suponerlo.
  if (!items.length) {
    const crudo = await fetchJson(MELI_API + '/items?ids=' + ids.slice(0, 3).join(',') +
      '&attributes=id,title,price,sold_quantity,available_quantity,seller_id,status', token, 6000);
    const filas = Array.isArray(crudo.json) ? crudo.json : [];
    return {
      error: 'la API oficial no devolvio ninguno de esos items',
      ids_pedidos: ids.length,
      ids_muestra: ids.slice(0, 3),
      respuesta_status: crudo.status,
      // Que contesto de verdad para cada id: el codigo por item y sus campos.
      crudo: filas.slice(0, 3).map(f => ({
        code: f && f.code,
        campos: (f && f.body) ? Object.keys(f.body) : null,
        body: (f && f.body) ? JSON.parse(JSON.stringify(f.body).slice(0, 300)) : (f ? String(JSON.stringify(f)).slice(0, 200) : null)
      })),
      sin_filas: filas.length ? null : String(JSON.stringify(crudo.json || {})).slice(0, 300)
    };
  }

  // Que campos trae la API oficial, contando solo los que vienen con valor.
  const conValor = c => items.filter(i => i && i[c] !== null && i[c] !== undefined && i[c] !== '' && i[c] !== 0).length;
  const cobertura = {
    sold_quantity: conValor('sold_quantity'),
    available_quantity: conValor('available_quantity'),
    price: conValor('price'),
    seller_id: conValor('seller_id')
  };

  const faltaba = ['sold_quantity', 'available_quantity'];
  const tapados = faltaba.filter(c => cobertura[c] > 0);
  const sigueFaltando = faltaba.filter(c => cobertura[c] === 0);

  return {
    ids_pedidos: ids.length,
    items_devueltos: items.length,
    cobertura,
    tapa: tapados,
    sigue_faltando: sigueFaltando,
    // La reputacion no viene en el item: sale de /users/{id}, otra consulta
    // gratis. Se avisa en vez de darlo por hecho.
    nota_reputacion: 'vendor_reputation no viene en el item; sale de /users/{seller_id}, que tambien es gratis',
    veredicto: sigueFaltando.length
      ? 'La API oficial no tapa: sigue faltando ' + sigueFaltando.join(', ')
      : 'La API oficial tapa el agujero: corrida barata + hidratacion gratis da lo mismo a un quinto del precio'
  };
}
