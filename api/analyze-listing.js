// api/analyze-listing.js
// ============================================================
// MeLi Connect - Analizador de Publicaciones (Funcionalidad 2)
// Pegas el link de una publicacion de MercadoLibre y el modulo
// te dice que esta bien, que esta flojo y que recomendacion
// concreta aplicar en cada seccion. 100% API oficial de MeLi
// (items publicos + buscador de categoria). NO scrapea HTML.
//
// Guarda cada corrida en Supabase (tabla listing_analyses) para:
//   - cachear y no pegarle de mas a los rate limits de MeLi
//   - re-correr el analisis a los 30 dias y mostrar la evolucion
//     (ese es el motivo de vuelta a la app / lead magnet del embudo)
//
// FUERA DE ALCANCE v1: visitas y tasa de conversion (solo las ve
// el dueno de la publicacion via OAuth -> fase 2).
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const CACHE_HOURS = 12;   // no repetir llamadas a MeLi para el mismo item antes de esto
const RECHECK_DAYS = 30;  // a los N dias mostramos "mejoraste?"

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { item_id, history } = req.query || {};
      if (!item_id) return res.status(400).json({ error: 'item_id requerido' });
      if (history) return res.status(200).json({ ok: true, item_id, history: await getHistory(item_id) });
      return res.status(400).json({ error: 'Falta ?history=1' });
    }

    if (req.method === 'POST') {
      const { url, userId, forceRefresh } = req.body || {};
      if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url requerida' });

      const itemId = await extractItemId(url.trim());
      if (!itemId) return res.status(400).json({ error: 'No pude reconocer el ID de la publicacion en ese link. Pega el link completo de la publicacion de MercadoLibre.' });

      if (!forceRefresh) {
        const cached = await getCachedAnalysis(itemId, CACHE_HOURS);
        if (cached) return res.status(200).json({ ok: true, cached: true, ...cached });
      }

      const report = await buildReport(itemId, url.trim(), userId);
      if (report.error) return res.status(422).json(report);

      await saveAnalysis(report);
      return res.status(200).json({ ok: true, cached: false, ...report });
    }

    return res.status(405).json({ error: 'Metodo no soportado' });
  } catch (e) {
    return res.status(500).json({ error: 'Fallo el analisis', detalle: String((e && e.message) || e) });
  }
}

// ------------------------------------------------------------
// 1) Identificar el item a partir del link pegado
// ------------------------------------------------------------
async function extractItemId(rawUrl) {
  let clean = rawUrl;
  if (!/^https?:\/\//i.test(clean)) clean = 'https://' + clean;

  const direct = clean.match(/MLA[-]?(\d{6,})/i);
  if (direct) return 'MLA' + direct[1];

  // Links cortos (app / social) no traen el ID: seguimos el redirect
  // OFICIAL de MeLi y leemos SOLO la URL final (no parseamos HTML).
  try {
    const r = await fetch(clean, { method: 'GET', redirect: 'follow' });
    const finalUrl = r.url || clean;
    const m = finalUrl.match(/MLA[-]?(\d{6,})/i);
    if (m) return 'MLA' + m[1];
  } catch (_) { /* seguimos */ }

  return null;
}

// ------------------------------------------------------------
// 2) Traer datos oficiales (API publica, sin OAuth)
// ------------------------------------------------------------
async function fetchJSON(url) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

async function buildReport(itemId, inputUrl, userId) {
  const item = await fetchJSON('https://api.mercadolibre.com/items/' + itemId);
  if (!item || item.error || item.status === 404) {
    return { error: 'No encontre esa publicacion (link invalido, pausada o vencida).', itemId };
  }

  const [descData, sellerData, catAttrs] = await Promise.all([
    fetchJSON('https://api.mercadolibre.com/items/' + itemId + '/description'),
    item.seller_id ? fetchJSON('https://api.mercadolibre.com/users/' + item.seller_id) : Promise.resolve(null),
    item.category_id ? fetchJSON('https://api.mercadolibre.com/categories/' + item.category_id + '/attributes') : Promise.resolve(null)
  ]);

  const top = await fetchTopListings(item.category_id, itemId);

  const secciones = {
    titulo: evalTitulo(item, top),
    fotos: evalFotos(item),
    descripcion: evalDescripcion(descData),
    atributos: evalAtributos(item, catAttrs),
    envio: evalEnvio(item),
    precio: evalPrecio(item, top),
    condicion: evalCondicion(item),
    reputacion: evalReputacion(sellerData)
  };

  const scoreTotal = Math.round(
    Object.values(secciones).reduce((acc, s) => acc + s.score, 0) / Object.keys(secciones).length
  );

  const previa = await getPreviousAnalysis(itemId, RECHECK_DAYS);
  const evolucion = previa ? {
    fechaAnterior: previa.analyzed_at,
    scoreAnterior: previa.score_total,
    diferencia: scoreTotal - previa.score_total
  } : null;

  const rotacionBaja = isRotacionBaja(item);
  const cta = buildFunnelCTA(scoreTotal, rotacionBaja);

  return {
    itemId,
    inputUrl,
    userId: userId || null,
    titulo: item.title,
    permalink: item.permalink,
    thumbnail: (item.pictures && item.pictures[0] && item.pictures[0].secure_url) || item.thumbnail || '',
    precio: item.price,
    moneda: item.currency_id,
    categoryId: item.category_id,
    vendidos: item.sold_quantity || 0,
    scoreTotal,
    secciones,
    comparacion: top.comparacion,
    topCategoria: top.items,
    evolucion,
    cta,
    disclaimer: 'Este informe usa solo datos publicos de MercadoLibre. Las visitas y la tasa de conversion solo las ve el dueno de la publicacion conectando su cuenta (proximamente en MeLi Connect).',
    analyzedAt: new Date().toISOString()
  };
}

async function fetchTopListings(categoryId, ownItemId) {
  if (!categoryId) return { items: [], comparacion: null };
  const j = await fetchJSON('https://api.mercadolibre.com/sites/MLA/search?category=' + encodeURIComponent(categoryId) + '&limit=6');
  if (!j || !Array.isArray(j.results)) return { items: [], comparacion: null };

  const items = j.results.filter(r => r.id !== ownItemId).slice(0, 5);
  if (!items.length) return { items: [], comparacion: null };

  const avgTitleLen = Math.round(items.reduce((a, r) => a + ((r.title || '').length), 0) / items.length);
  const prices = items.map(r => r.price).filter(p => typeof p === 'number' && p > 0);
  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
  const freeShip = items.filter(r => r.shipping && r.shipping.free_shipping).length;
  const full = items.filter(r => r.shipping && r.shipping.logistic_type === 'fulfillment').length;

  return {
    items: items.map(r => ({
      titulo: r.title,
      precio: r.price,
      vendidos: r.sold_quantity || 0,
      envioGratis: !!(r.shipping && r.shipping.free_shipping),
      full: !!(r.shipping && r.shipping.logistic_type === 'fulfillment')
    })),
    comparacion: {
      avgTitleLen,
      avgPrice,
      pctEnvioGratis: Math.round((freeShip / items.length) * 100),
      pctFull: Math.round((full / items.length) * 100),
      muestra: items.length
    }
  };
}

// ------------------------------------------------------------
// 3) Evaluadores por seccion (con recomendaciones CONCRETAS)
// ------------------------------------------------------------
function seccion(score, fuertes, flojos, recomendacion, extra) {
  return Object.assign({ score: Math.max(0, Math.min(100, Math.round(score))), puntosFuertes: fuertes, puntosFlojos: flojos, recomendacion }, extra || {});
}
function fmtARS(n) { return 'ARS ' + Math.round(n).toLocaleString('es-AR'); }

function evalTitulo(item, top) {
  const t = item.title || '';
  const len = t.length;
  const avg = (top.comparacion && top.comparacion.avgTitleLen) || 55;
  const gritos = /[!?]{2,}/.test(t) || (/[A-Z]{5,}/.test(t) && t === t.toUpperCase());
  const tieneDato = /\d/.test(t);
  const f = [], x = []; let s = 100;

  if (len < 40) { x.push('Titulo corto (' + len + ' caracteres). El top de tu categoria usa en promedio ' + avg + '.'); s -= 25; }
  else f.push('Longitud competitiva (' + len + ' caracteres, promedio del top: ' + avg + ').');

  if (gritos) { x.push('Usa mayusculas sostenidas o signos repetidos ("!!!"): MeLi lo penaliza en el buscador.'); s -= 20; }
  else f.push('Sin abuso de mayusculas ni signos, respeta las buenas practicas de SEO de MeLi.');

  if (!tieneDato) { x.push('No se detecta marca, modelo ni un dato numerico (talle, capacidad, cantidad) en el titulo.'); s -= 15; }
  else f.push('Incluye datos concretos (numero/modelo) que ayudan al match de busqueda.');

  const rec = len < avg
    ? 'Sumale marca + modelo + un atributo diferencial (color, talle, cantidad) hasta acercarte a los ' + avg + ' caracteres del top. Poné las palabras que la gente busca en las PRIMERAS 3-4 posiciones.'
    : 'La longitud esta bien; revisa que las primeras palabras sean el nombre generico que la gente busca (no la marca).';
  return seccion(s, f, x, rec, { valor: t, longitud: len });
}

function evalFotos(item) {
  const pics = item.pictures || [];
  const count = pics.length;
  const f = [], x = []; let s = 100;

  if (count < 3) { x.push('Solo ' + count + ' foto(s). MeLi recomienda 6-10 para bajar dudas y devoluciones.'); s -= 35; }
  else if (count < 6) { x.push('Tiene ' + count + ' fotos; sumando 2-3 mas (detalle, uso, packaging) sube la conversion.'); s -= 15; }
  else f.push('Buena cantidad de fotos (' + count + '), cubre varios angulos.');

  const res = pics.map(p => { const m = (p.max_size || p.size || '').match(/(\d+)x(\d+)/); return m ? Math.min(+m[1], +m[2]) : null; }).filter(Boolean);
  const baja = res.filter(r => r < 800).length;
  if (res.length && baja) { x.push(baja + ' de ' + res.length + ' fotos estan por debajo de 800px de lado menor; para zoom sin pixelar conviene 1200px+.'); s -= 15; }
  else if (res.length) f.push('Las fotos superan 800px, permiten zoom sin pixelarse.');

  const rec = count < 6
    ? 'Llega a 6-8 fotos: portada con FONDO BLANCO liso, foto de escala/uso real, detalle de materiales y, si aplica, el packaging. Evita fondos con muebles o telas de tu casa.'
    : 'Verifica que la PRIMERA foto tenga fondo blanco liso: es el filtro visual mas importante en el listado de resultados.';
  return seccion(s, f, x, rec, { cantidad: count });
}

function evalDescripcion(descData) {
  const texto = (descData && (descData.plain_text || descData.text)) || '';
  const len = texto.trim().length;
  const f = [], x = []; let s = 100;

  if (len === 0) { x.push('La publicacion no tiene descripcion cargada.'); s -= 50; }
  else if (len < 300) { x.push('Descripcion muy corta (' + len + ' caracteres): no alcanza para resolver dudas (medidas, garantia, que incluye).'); s -= 25; }
  else f.push('Descripcion con buen desarrollo (' + len + ' caracteres).');

  const estructura = /\n|-\s|\u2022/.test(texto);
  if (len > 0 && !estructura) { x.push('Es un bloque de texto corrido, sin separar por secciones.'); s -= 10; }
  else if (estructura) f.push('Usa saltos de linea o listas, facil de leer desde el celular.');

  const rec = len < 300
    ? 'Arma la descripcion en bloques cortos: 1) que es y para que sirve, 2) que incluye la compra, 3) medidas/especificaciones, 4) garantia y cambios. Nada de texto corrido.'
    : 'Sumale una seccion de "Preguntas frecuentes" con las 2-3 dudas que mas te consultan por chat: reduce las preguntas previas a la compra.';
  return seccion(s, f, x, rec, { longitud: len });
}

function evalAtributos(item, catAttrs) {
  const propios = item.attributes || [];
  const lleno = a => !!(a.value_name || a.value_id || (a.values && a.values.length));
  const completados = propios.filter(lleno).length;
  const disponibles = Array.isArray(catAttrs) ? catAttrs.length : null;
  const req = Array.isArray(catAttrs) ? catAttrs.filter(a => a.tags && a.tags.required) : null;
  const reqCompletos = req ? req.filter(a => propios.some(ia => ia.id === a.id && lleno(ia))).length : null;
  const f = [], x = []; let s = 100;

  if (req && req.length) {
    if (reqCompletos < req.length) { x.push('Faltan ' + (req.length - reqCompletos) + ' de ' + req.length + ' atributos OBLIGATORIOS de la ficha tecnica de tu categoria.'); s -= 40; }
    else f.push('Completaste los ' + req.length + ' atributos obligatorios de la ficha tecnica.');
  }
  if (disponibles) {
    const pct = Math.round((completados / disponibles) * 100);
    if (pct < 60) { x.push('Solo el ' + pct + '% de los atributos completados (' + completados + '/' + disponibles + '). Cada atributo es un filtro mas donde te encuentran.'); s -= 20; }
    else f.push('Completaste el ' + pct + '% de los atributos disponibles.');
  }
  if (!disponibles) f.push('No se pudo leer la ficha tecnica de la categoria (igual conviene completar todo lo que MeLi sugiera).');

  return seccion(s, f, x, 'Entra a Editar publicacion > Ficha tecnica y completa TODOS los atributos que MeLi sugiere, aunque no sean obligatorios: cada atributo habilita un filtro de busqueda donde podes aparecer.', { completados, disponibles });
}

function evalEnvio(item) {
  const sh = item.shipping || {};
  const f = [], x = []; let s = 100; let modalidad = 'Sin Mercado Envios / a cargo del comprador';

  if (sh.logistic_type === 'fulfillment') { modalidad = 'Mercado Full'; f.push('Publicado con Mercado Full: mejor exposicion y envios rapidos, MeLi lo prioriza.'); }
  else if (sh.logistic_type === 'self_service') { modalidad = 'Mercado Flex'; f.push('Usa Mercado Flex (envios el mismo dia con tu logistica): buen empujon de visibilidad.'); }
  else if (sh.logistic_type === 'drop_off' || sh.logistic_type === 'xd_drop_off') { modalidad = 'Mercado Envios (colecta/agencia)'; f.push('Usa Mercado Envios, habilita el filtro de envio de MeLi.'); }
  else { x.push('No se detecta Mercado Envios: quedas afuera de los filtros de "llega gratis/rapido" que usa la mayoria de los compradores.'); s -= 30; }

  if (!sh.free_shipping) { x.push('No ofrece envio gratis, el filtro mas usado por los compradores en casi todas las categorias.'); s -= 25; }
  else f.push('Ofrece envio gratis, cumple con el filtro mas usado.');

  const rec = !sh.free_shipping
    ? 'Antes de activar envio gratis, corre la Calculadora Flex vs Full para ver si te conviene absorber el costo subiendolo al precio: el envio gratis suele multiplicar la visibilidad.'
    : 'Si el producto es chico/liviano y rota, evalua pasar a Mercado Full: mejora el posicionamiento y te saca la logistica de encima.';
  return seccion(s, f, x, rec, { modalidadActual: modalidad });
}

function evalPrecio(item, top) {
  const p = item.price;
  const avg = top.comparacion && top.comparacion.avgPrice;
  const f = [], x = []; let s = 100;
  if (avg) {
    const dif = Math.round(((p - avg) / avg) * 100);
    if (dif > 20) { x.push('Tu precio esta ' + dif + '% por ENCIMA del promedio del top de tu categoria (' + fmtARS(avg) + ').'); s -= 25; }
    else if (dif < -20) { x.push('Tu precio esta muy por DEBAJO del promedio (' + fmtARS(avg) + '): revisa que no regales margen o generes desconfianza.'); s -= 10; }
    else f.push('Precio alineado con el promedio de la competencia (' + fmtARS(avg) + ').');
  } else { x.push('No pude comparar contra la competencia (pocas publicaciones de referencia en la categoria).'); }
  const rec = avg
    ? 'No bajes precio a ciegas: corre tu margen real en MargenClear y la Calculadora Flex vs Full. A veces conviene absorber el envio en vez de tocar el precio de lista.'
    : 'Segui manualmente el precio de 3 competidores directos por 2 semanas para tener una referencia real.';
  return seccion(s, f, x, rec, { precio: p, promedioCategoria: avg });
}

function evalCondicion(item) {
  const c = item.condition;
  const f = [], x = []; let s = 100;
  if (c !== 'new') { x.push('Figura como "' + (c || 'sin dato') + '". Si es importado nuevo, la condicion deberia decir "Nuevo": afecta confianza y filtros.'); s -= 20; }
  else f.push('Condicion cargada como "Nuevo".');
  return seccion(s, f, x, c !== 'new' ? 'Corrige la condicion a "Nuevo" en la edicion de la publicacion si el producto lo es.' : 'Sin acciones pendientes en este punto.', { condicion: c });
}

function evalReputacion(sellerData) {
  const rep = sellerData && sellerData.seller_reputation;
  if (!rep) return seccion(60, [], ['No se pudo obtener la reputacion del vendedor.'], 'Revisa tu nivel de reputacion desde tu cuenta de MercadoLibre.', {});
  const f = [], x = []; let s = 100;
  const nivel = rep.level_id || 'sin nivel';
  const power = rep.power_seller_status;
  const neg = rep.transactions && rep.transactions.ratings && rep.transactions.ratings.negative;

  if (power) f.push('Sos Mercado Lider (' + power + '): suma confianza y mejora el posicionamiento.');
  else x.push('Todavia no tenes status de Mercado Lider (se gana con ventas sostenidas y buena atencion).');

  if (typeof nivel === 'string' && nivel.indexOf('5') !== -1) f.push('Color de reputacion maximo (verde oscuro).');
  else if (nivel === 'sin nivel') { x.push('Reputacion sin nivel suficiente todavia (cuenta nueva o con pocas ventas).'); s -= 20; }

  if (neg && neg > 0.02) { x.push('Tu tasa de calificaciones negativas (' + Math.round(neg * 100) + '%) supera el 2% recomendado.'); s -= 25; }

  const rec = !power
    ? 'Sostene tiempos de entrega y respuesta rapida: son las dos variables que mas pesan para llegar a Mercado Lider.'
    : 'Manten el nivel respondiendo preguntas en menos de un par de horas.';
  return seccion(s, f, x, rec, { nivel });
}

// ------------------------------------------------------------
// 4) Embudo: el CTA aparece EN EL informe cuando corresponde
// ------------------------------------------------------------
function isRotacionBaja(item) {
  if (!item.date_created) return false;
  const dias = Math.max(1, Math.round((Date.now() - new Date(item.date_created).getTime()) / 86400000));
  const ventasMes = (item.sold_quantity || 0) / (dias / 30);
  return ventasMes < 3;
}

function buildFunnelCTA(scoreTotal, rotacionBaja) {
  if (scoreTotal >= 75 && !rotacionBaja) return null;
  return {
    mostrar: true,
    titulo: rotacionBaja ? 'El producto casi no rota' : 'Antes de gastar en Ads, ordena la publicacion',
    mensaje: rotacionBaja
      ? 'Vende menos de 3 unidades por mes. Si aplicas las mejoras de arriba y aun asi no repunta, puede ser que el producto ya se saturo: quiza sea momento de traer stock nuevo con mas demanda.'
      : 'Tu publicacion tiene puntos flojos que le restan visibilidad. Aplicar estas mejoras suele costar $0 y sube ventas mas rapido que pautar.',
    acciones: [
      { texto: 'Quiero asesoria para importar mi proximo producto', tipo: 'asesoria_importacion' },
      { texto: 'Hablar con el despachante de aduana', tipo: 'contacto_despachante' }
    ]
  };
}

// ------------------------------------------------------------
// 5) Persistencia en Supabase (cache + historial)
// ------------------------------------------------------------
function supaHeaders() {
  return { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };
}

async function getCachedAnalysis(itemId, hours) {
  if (!SUPABASE_KEY) return null;
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const url = SUPABASE_URL + '/rest/v1/listing_analyses?item_id=eq.' + encodeURIComponent(itemId) + '&analyzed_at=gte.' + encodeURIComponent(since) + '&order=analyzed_at.desc&limit=1&select=report';
  try {
    const r = await fetch(url, { headers: supaHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    return (Array.isArray(rows) && rows.length) ? rows[0].report : null;
  } catch (_) { return null; }
}

async function getPreviousAnalysis(itemId, daysAgo) {
  if (!SUPABASE_KEY) return null;
  const before = new Date(Date.now() - (daysAgo - 3) * 86400000).toISOString();
  const url = SUPABASE_URL + '/rest/v1/listing_analyses?item_id=eq.' + encodeURIComponent(itemId) + '&analyzed_at=lte.' + encodeURIComponent(before) + '&order=analyzed_at.desc&limit=1&select=analyzed_at,score_total';
  try {
    const r = await fetch(url, { headers: supaHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    return (Array.isArray(rows) && rows.length) ? rows[0] : null;
  } catch (_) { return null; }
}

async function getHistory(itemId) {
  if (!SUPABASE_KEY) return [];
  const url = SUPABASE_URL + '/rest/v1/listing_analyses?item_id=eq.' + encodeURIComponent(itemId) + '&order=analyzed_at.desc&limit=12&select=analyzed_at,score_total';
  try {
    const r = await fetch(url, { headers: supaHeaders() });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}

async function saveAnalysis(report) {
  if (!SUPABASE_KEY) return;
  const payload = {
    item_id: report.itemId,
    input_url: report.inputUrl,
    user_id: report.userId,
    category_id: report.categoryId,
    score_total: report.scoreTotal,
    report: report,
    analyzed_at: report.analyzedAt || new Date().toISOString()
  };
  try {
    await fetch(SUPABASE_URL + '/rest/v1/listing_analyses', {
      method: 'POST',
      headers: Object.assign(supaHeaders(), { Prefer: 'return=minimal' }),
      body: JSON.stringify(payload)
    });
  } catch (_) { /* el analisis igual se devuelve al usuario */ }
}
