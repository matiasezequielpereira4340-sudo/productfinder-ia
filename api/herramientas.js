// api/herramientas.js
// ============================================================
// MeLi Connect - Endpoint unificado de herramientas.
// Combina dos funcionalidades en una sola Serverless Function
// para respetar el limite del plan Hobby de Vercel (max 12).
//
// Ruteo por el campo 'accion' del body (POST):
//   accion: 'flex-full'  -> Calculadora Flex vs Full (Funcionalidad 3)
//   (default / cualquier otro) -> Analizador de publicaciones (Funcionalidad 2)
// ============================================================

export default async function handler(req, res) {
  var accion = (req.body && req.body.accion) ? String(req.body.accion) : '';
  if (accion === 'comisiones') {
    return handleComisiones(req, res);
  }
  if (accion === 'ejemplo') {
    return handleEjemplo(req, res);
  }
  if (accion === 'flex-full') {
    return handleFlexFull(req, res);
  }
  return handleAnalisis(req, res);
}

// ------------------------------------------------------------
// Funcionalidad 2: Analizador de publicaciones
// ------------------------------------------------------------
// api/analyze-listing.js
// ============================================================
// MeLi Connect - Analizador de Publicaciones (Funcionalidad 2)
// Pegas el link de una publicacion de MercadoLibre y el modulo
// te dice, EN CRIOLLO, que esta bien, que esta mal, POR QUE
// importa (impacto en ventas) y que corregir en cada seccion.
// 100% API oficial de MeLi (items publicos + buscador). NO scrapea HTML.
//
// Guarda cada corrida en Supabase (tabla listing_analyses) para:
//   - cachear y no pegarle de mas a los rate limits de MeLi
//   - re-correr el analisis a los 30 dias y mostrar la evolucion
//     (motivo de vuelta a la app / lead magnet del embudo).
//
// FUERA DE ALCANCE v1: visitas y tasa de conversion (solo las ve
// el dueno de la publicacion via OAuth -> fase 2).
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const CACHE_HOURS = 12;   // no repetir llamadas a MeLi para el mismo item antes de esto
const RECHECK_DAYS = 30;  // a los N dias mostramos "mejoraste?"

async function handleAnalisis(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
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
      if (!itemId) return res.status(400).json({ error: 'No pude reconocer el ID de la publicación en ese link. Copia y pega el link completo de la publicación (el que dice MLA-...).' });

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
    return res.status(500).json({ error: 'Fallo el análisis', detalle: String((e && e.message) || e) });
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
    return { error: 'No encontre esa publicación. Puede que el link este mal, o que la publicación este pausada o finalizada.', itemId };
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

  const resumen = buildResumen(secciones, scoreTotal);

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
    resumen,
    secciones,
    comparacion: top.comparacion,
    topCategoria: top.items,
    evolucion,
    cta,
    disclaimer: 'Este informe usa solo datos publicos de MercadoLibre. Las visitas y la tasa de conversion de tu publicación solo las ve el dueno conectando su cuenta (proximamente en MeLi Connect).',
    analyzedAt: new Date().toISOString()
  };
}

// Resumen ejecutivo: veredicto en criollo + las prioridades a corregir
// (las 3 secciones con peor puntaje, ordenadas por impacto).
function buildResumen(secciones, scoreTotal) {
  let veredicto;
  if (scoreTotal >= 80) veredicto = 'Tu publicación está muy bien armada. Hay solo detalles finos para pulir.';
  else if (scoreTotal >= 60) veredicto = 'Tu publicación está aceptable, pero le faltan cosas que hoy te están costando ventas. Con unos ajustes rendiria mucho más.';
  else if (scoreTotal >= 40) veredicto = 'Tu publicación tiene varios puntos flojos importantes. MercadoLibre la está mostrando menos de lo que podria, y eso se traduce en menos ventas.';
  else veredicto = 'Tu publicación tiene problemas de base que la están enterrando en los resultados de busqueda. La buena noticia: casi todo se corrige gratis y en un rato.';

  const orden = Object.keys(secciones)
    .map(k => ({ k, s: secciones[k] }))
    .filter(x => x.s.score < 75 && x.s.puntosFlojos && x.s.puntosFlojos.length)
    .sort((a, b) => a.s.score - b.s.score)
    .slice(0, 3);

  const LBL = { titulo: 'Titulo', fotos: 'Fotos', descripcion: 'Descripcion', atributos: 'Ficha técnica', envio: 'Envio', precio: 'Precio', condicion: 'Condicion', reputacion: 'Reputacion' };
  const prioridades = orden.map(x => ({
    seccion: LBL[x.k] || x.k,
    score: x.s.score,
    accion: x.s.recomendacion
  }));

  return { veredicto, prioridades };
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
// 3) Evaluadores por seccion
//    Cada uno devuelve:
//      score, puntosFuertes, puntosFlojos, recomendacion (que hacer),
//      porQue (por que importa / impacto en ventas, en criollo)
// ------------------------------------------------------------
function seccion(score, fuertes, flojos, recomendacion, porQue, extra) {
  return Object.assign({
    score: Math.max(0, Math.min(100, Math.round(score))),
    puntosFuertes: fuertes,
    puntosFlojos: flojos,
    recomendacion: recomendacion,
    porQue: porQue
  }, extra || {});
}
function fmtARS(n) { return n == null ? '-' : ('ARS ' + Math.round(n).toLocaleString('es-AR')); }

function evalTitulo(item, top) {
  const t = item.title || '';
  const len = t.length;
  const avg = (top.comparacion && top.comparacion.avgTitleLen) || 55;
  const gritos = /[!?]{2,}/.test(t) || (/[A-Z]{5,}/.test(t) && t === t.toUpperCase());
  const tieneDato = /\d/.test(t);
  const f = [], x = []; let s = 100;

  if (len < 40) { x.push('El título es corto (' + len + ' caracteres). Las publicaciones que más venden en tu categoría usan en promedio ' + avg + '.'); s -= 25; }
  else f.push('Longitud competitiva (' + len + ' caracteres; el promedio del top es ' + avg + ').');

  if (gritos) { x.push('Usa MAYUSCULAS sostenidas o signos repetidos ("!!!"). MercadoLibre lo interpreta como spam y lo baja en el buscador.'); s -= 20; }
  else f.push('No abusa de mayusculas ni signos: respeta las buenas practicas de SEO de MeLi.');

  if (!tieneDato) { x.push('No se detecta marca, modelo ni un dato numerico (talle, capacidad, cantidad). Justo lo que la gente escribe cuando busca algo puntual.'); s -= 15; }
  else f.push('Incluye datos concretos (número/modelo) que ayudan a que aparezcas en busquedas especificas.');

  const rec = len < avg
    ? 'Sumale marca + modelo + un atributo clave (color, talle, cantidad) hasta acercarte a los ' + avg + ' caracteres del top. Importante: pone las palabras que la gente busca en las PRIMERAS 3-4 palabras del título.'
    : 'La longitud está bien. Revisa que las primeras palabras sean el nombre generico que la gente busca (ej: "auriculares bluetooth"), no la marca.';
  const porQue = 'El título es lo primero que lee el buscador de MercadoLibre para decidir en que busquedas te muestra. Si le faltan palabras clave, simplemente no aparecas cuando alguien busca tu producto, por más bueno que sea. Es la variable de SEO que más mueve la aguja.';
  return seccion(s, f, x, rec, porQue, { valor: t, longitud: len });
}

function evalFotos(item) {
  const pics = item.pictures || [];
  const count = pics.length;
  const f = [], x = []; let s = 100;

  if (count < 3) { x.push('Solo tiene ' + count + ' foto(s). MercadoLibre recomienda entre 6 y 10.'); s -= 35; }
  else if (count < 6) { x.push('Tiene ' + count + ' fotos. Sumando 2-3 más (detalle, uso real, packaging) baja las dudas del comprador.'); s -= 15; }
  else f.push('Buena cantidad de fotos (' + count + '): cubris varios angulos.');

  const res = pics.map(p => { const m = (p.max_size || p.size || '').match(/(\d+)x(\d+)/); return m ? Math.min(+m[1], +m[2]) : null; }).filter(Boolean);
  const baja = res.filter(r => r < 800).length;
  if (res.length && baja) { x.push(baja + ' de ' + res.length + ' fotos están por debajo de 800px de lado menor. Se ven pixeladas al hacer zoom.'); s -= 15; }
  else if (res.length) f.push('Las fotos superan los 800px: permiten hacer zoom sin que se pixele.');

  const rec = count < 6
    ? 'Llega a 6-8 fotos con este orden: 1) portada con FONDO BLANCO liso, 2) el producto en uso o con algo al lado para dar escala, 3) detalle de materiales/terminaciones, 4) el packaging. Evita fondos con muebles o telas de tu casa.'
    : 'Verifica que la PRIMERA foto (la portada) tenga fondo blanco liso. Es la que se ve en la grilla de resultados y define si te hacen clic o siguen de largo.';
  const porQue = 'La primera foto es lo que decide si el comprador te hace clic o pasa al de al lado, y el resto de las fotos son las que responden "es lo que busco?" sin que te tengan que preguntar. Pocas fotos o de mala calidad generan desconfianza, más consultas antes de comprar y más devoluciones despues.';
  return seccion(s, f, x, rec, porQue, { cantidad: count });
}

function evalDescripcion(descData) {
  const texto = (descData && (descData.plain_text || descData.text)) || '';
  const len = texto.trim().length;
  const f = [], x = []; let s = 100;

  if (len === 0) { x.push('La publicación no tiene descripción cargada.'); s -= 50; }
  else if (len < 300) { x.push('La descripción es muy corta (' + len + ' caracteres). No alcanza para responder las dudas tipicas: medidas, que incluye, garantía.'); s -= 25; }
  else f.push('Tiene una descripción con buen desarrollo (' + len + ' caracteres).');

  const estructura = /\n|-\s|\u2022/.test(texto);
  if (len > 0 && !estructura) { x.push('Es un bloque de texto corrido, sin separar por temas. En el celular se hace intragable.'); s -= 10; }
  else if (estructura) f.push('Usa saltos de línea o listas: se lee fácil desde el celular.');

  const rec = len < 300
    ? 'Arma la descripción en bloques cortos y separados: 1) que es y para que sirve, 2) que incluye exactamente la compra, 3) medidas y especificaciones, 4) garantía y politica de cambios. Nada de un solo párrafo corrido.'
    : 'Sumale al final una sección de "Preguntas frecuentes" con las 2-3 dudas que más te consultan por chat. Cada duda resuelta antes es una venta que no se cae.';
  const porQue = 'La descripción es tu vendedor silencioso: trabaja cuando vos no estás para contestar. Una buena descripción resuelve las dudas antes de que el comprador tenga que preguntar (y muchos, si tienen que preguntar, directamente no compran). Además, el texto también lo lee el buscador.';
  return seccion(s, f, x, rec, porQue, { longitud: len });
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
    if (reqCompletos < req.length) { x.push('Faltan ' + (req.length - reqCompletos) + ' de ' + req.length + ' atributos OBLIGATORIOS de la ficha técnica de tu categoría.'); s -= 40; }
    else f.push('Completaste los ' + req.length + ' atributos obligatorios de la ficha técnica.');
  }
  if (disponibles) {
    const pct = Math.round((completados / disponibles) * 100);
    if (pct < 60) { x.push('Solo completaste el ' + pct + '% de los atributos disponibles (' + completados + ' de ' + disponibles + ').'); s -= 20; }
    else f.push('Completaste el ' + pct + '% de los atributos disponibles de la categoría.');
  }
  if (!disponibles) f.push('No se pudo leer la ficha técnica de la categoría (igual conviene completar todo lo que MeLi sugiera).');

  const rec = 'Entra a Editar publicación, sección "Ficha técnica", y completa TODOS los atributos que MeLi te ofrece, incluso los que no son obligatorios (color, material, medidas, etc.).';
  const porQue = 'Cada atributo que completas es un filtro más del costado izquierdo del buscador donde tu producto puede aparecer. La gente filtra por color, talle, marca, etc.; si no cargaste ese dato, quedas afuera de ese filtro directamente. Además, MeLi premia con mejor posicion a las fichas completas.';
  return seccion(s, f, x, rec, porQue, { completados, disponibles });
}

function evalEnvio(item) {
  const sh = item.shipping || {};
  const f = [], x = []; let s = 100; let modalidad = 'Sin Mercado Envios / a cargo del comprador';

  if (sh.logistic_type === 'fulfillment') { modalidad = 'Mercado Full'; f.push('Publicado con Mercado Full: MeLi guarda tu stock y hace el envio. Es la modalidad que más empuja el posicionamiento.'); }
  else if (sh.logistic_type === 'self_service') { modalidad = 'Mercado Flex'; f.push('Usa Mercado Flex (vos entregas el mismo día con tu logística): buen empujon de visibilidad y de conversion.'); }
  else if (sh.logistic_type === 'drop_off' || sh.logistic_type === 'xd_drop_off') { modalidad = 'Mercado Envios (por agencia/colecta)'; f.push('Usa Mercado Envios: quedas dentro de los filtros de envio de MeLi.'); }
  else { x.push('No se detecta Mercado Envios activo. Quedas afuera de los filtros de "Llega gratis" y "Llega mañana" que usa la mayoria de los compradores.'); s -= 30; }

  if (!sh.free_shipping) { x.push('No ofrece envio gratis. En casi todas las categorías, el envio gratis es el filtro que más usan los compradores.'); s -= 25; }
  else f.push('Ofrece envio gratis: cumplis con el filtro más usado por los compradores.');

  const rec = !sh.free_shipping
    ? 'Antes de activar envio gratis, corre la Calculadora Flex vs Full de MeLi Connect para ver si te conviene absorber el costo del envio subiendolo al precio. En la mayoria de las categorías, el envio gratis multiplica la visibilidad.'
    : 'Si el producto es chico y liviano y ya rota, evalua pasar a Mercado Full: mejora el posicionamiento y te saca la logística de encima.';
  const porQue = 'El envio es, junto al precio, lo que más define la compra en MercadoLibre. Sin Mercado Envios no aparecas en los filtros de "llega gratis/rápido", y esos filtros son justamente donde la gente decide. Es de las palancas que más rápido suben las ventas.';
  return seccion(s, f, x, rec, porQue, { modalidadActual: modalidad });
}

function evalPrecio(item, top) {
  const p = item.price;
  const avg = top.comparacion && top.comparacion.avgPrice;
  const f = [], x = []; let s = 100;
  if (avg) {
    const dif = Math.round(((p - avg) / avg) * 100);
    if (dif > 20) { x.push('Tu precio está ' + dif + '% por ENCIMA del promedio del top de tu categoría (' + fmtARS(avg) + ').'); s -= 25; }
    else if (dif < -20) { x.push('Tu precio está muy por DEBAJO del promedio (' + fmtARS(avg) + '). Ojo: puede que estes regalando margen, o generar desconfianza por "demasiado barato".'); s -= 10; }
    else f.push('Tu precio está alineado con el promedio de la competencia (' + fmtARS(avg) + ').');
  } else { x.push('No pude comparar contra la competencia (hay pocas publicaciones de referencia en la categoría).'); }
  const rec = avg
    ? 'No bajes el precio a ciegas. Corre tu margen real en MargenClear y la Calculadora Flex vs Full: muchas veces conviene ofrecer envio gratis en vez de tocar el precio de lista.'
    : 'Segui manualmente el precio de 3 competidores directos durante 2 semanas para tener una referencia real antes de mover el tuyo.';
  const porQue = 'El precio no se mira solo: el comprador lo compara con las otras publicaciones que ve al lado tuyo. Estar muy por encima te saca de juego, y estar muy por debajo te come el margen que te llevo importar el producto. La idea es competir sin regalar plata.';
  return seccion(s, f, x, rec, porQue, { precio: p, promedioCategoria: avg });
}

function evalCondicion(item) {
  const c = item.condition;
  const f = [], x = []; let s = 100;
  if (c !== 'new') { x.push('La publicación figura como "' + (c || 'sin dato') + '". Si tu producto es importado nuevo, deberia decir "Nuevo".'); s -= 20; }
  else f.push('La condición está cargada correctamente como "Nuevo".');
  const rec = c !== 'new' ? 'Corrige la condición a "Nuevo" en la edicion de la publicación si el producto lo es. Es un cambio de 10 segundos.' : 'Sin acciones pendientes en este punto.';
  const porQue = 'La condición es un filtro de busqueda (la gente filtra "Nuevo") y además define la confianza. Si vendés producto nuevo importado y quedo marcado como usado, te estás auto-excluyendo de las busquedas de la mayoria de los compradores.';
  return seccion(s, f, x, rec, porQue, { condicion: c });
}

function evalReputacion(sellerData) {
  const rep = sellerData && sellerData.seller_reputation;
  const porQue = 'La reputación es la confianza en números. Ante dos publicaciones parecidas, la gente le compra al que tiene mejor color de reputación y la medalla de Mercado Lider. Además, MeLi le da mejor posicion a los vendedores con buena reputación.';
  if (!rep) return seccion(60, [], ['No se pudo obtener la reputación del vendedor.'], 'Revisa tu nivel de reputación desde el panel de tu cuenta de MercadoLibre.', porQue, {});
  const f = [], x = []; let s = 100;
  const nivel = rep.level_id || 'sin nivel';
  const power = rep.power_seller_status;
  const neg = rep.transactions && rep.transactions.ratings && rep.transactions.ratings.negative;

  if (power) f.push('Sos Mercado Lider (' + power + '): suma confianza y mejora tu posicionamiento.');
  else x.push('Todavia no tenés el status de Mercado Lider. Se gana con ventas sostenidas, buena atención y pocos reclamos.');

  if (typeof nivel === 'string' && nivel.indexOf('5') !== -1) f.push('Tu color de reputación es el máximo (verde oscuro).');
  else if (nivel === 'sin nivel') { x.push('Tu reputación todavia no tiene nivel suficiente (cuenta nueva o con pocas ventas).'); s -= 20; }

  if (neg && neg > 0.02) { x.push('Tu tasa de calificaciones negativas (' + Math.round(neg * 100) + '%) supera el 2% que recomienda MeLi.'); s -= 25; }

  const rec = !power
    ? 'Enfocate en dos cosas: despachar rápido (mismo día o al día siguiente) y responder las preguntas en menos de un par de horas. Son las variables que más pesan para subir de nivel y llegar a Mercado Lider.'
    : 'Manten el nivel: segui respondiendo rápido y cuidando los tiempos de entrega.';
  return seccion(s, f, x, rec, porQue, { nivel });
}

// ------------------------------------------------------------
// 4) Embudo: el CTA aparece DENTRO del informe cuando corresponde
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
    titulo: rotacionBaja ? 'El producto casi no rota' : 'Antes de gastar en Ads, ordena la publicación',
    mensaje: rotacionBaja
      ? 'Esta publicación vende menos de 3 unidades por mes. Si aplicas las mejoras de arriba y aun así no repunta, capaz el problema no es la publicación sino que el producto ya se saturo. Ahi conviene pensar en traer stock nuevo con más demanda.'
      : 'Tu publicación tiene puntos flojos que le están restando visibilidad. Corregirlos suele costar $0 y sube las ventas más rápido (y más barato) que pagar publicidad.',
    acciones: [
      { texto: 'Quiero asesoria para importar mi próximo producto', tipo: 'asesoria_importacion' },
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

// ------------------------------------------------------------
// ------------------------------------------------------------
// Comisiones reales de MercadoLibre
// ------------------------------------------------------------
// MargenClear tenia la tabla escrita a mano: { clasica: 13.5, premium: 16 }.
// MercadoLibre publica la comision real en /sites/MLA/listing_prices, que
// devuelve, para un precio dado, el cargo de cada tipo de publicacion.
//
// El endpoint necesita token, asi que se consulta desde el servidor. Si no
// hay token o MeLi cambia el formato, se devuelve ok:false y el front sigue
// usando los valores manuales, avisando que son manuales. Nunca se inventa
// un porcentaje y se lo presenta como dato de MercadoLibre.
async function handleComisiones(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const precio = Math.max(1000, Math.min(5000000, Number((req.body && req.body.precio) || 100000)));
  const categoria = (req.body && req.body.categoria) ? String(req.body.categoria).slice(0, 20) : null;

  try {
    const { getUserToken } = await import('./_meli.js');
    let tok = null;
    try { const t = await getUserToken(null); tok = t && t.token; } catch (e) {}

    let url = 'https://api.mercadolibre.com/sites/MLA/listing_prices?price=' + precio;
    if (categoria) url += '&category_id=' + encodeURIComponent(categoria);

    const r = await fetch(url, { headers: tok ? { Authorization: 'Bearer ' + tok, Accept: 'application/json' } : { Accept: 'application/json' } });
    if (!r.ok) {
      return res.status(200).json({ ok: false, motivo: 'MercadoLibre no respondio (' + r.status + ')' });
    }
    const datos = await r.json();
    const lista = Array.isArray(datos) ? datos : [datos];

    // El formato documentado trae sale_fee_details.percentage_fee. Si algun
    // dia cambia, se deriva del monto: sale_fee_amount / precio * 100.
    const tipos = {};
    for (const t of lista) {
      if (!t || !t.listing_type_id) continue;
      const det = t.sale_fee_details || {};
      let pct = Number(det.percentage_fee);
      if (!isFinite(pct) || pct <= 0) {
        const monto = Number(t.sale_fee_amount);
        if (isFinite(monto) && monto > 0) pct = (monto / precio) * 100;
      }
      if (!isFinite(pct) || pct <= 0) continue;
      tipos[t.listing_type_id] = {
        nombre: t.listing_type_name || t.listing_type_id,
        porcentaje: Math.round(pct * 100) / 100,
        cargoFijo: Number(det.fixed_fee) || 0
      };
    }

    if (!Object.keys(tipos).length) {
      return res.status(200).json({ ok: false, motivo: 'MercadoLibre no devolvio comisiones para ese precio' });
    }

    return res.status(200).json({
      ok: true,
      precioConsultado: precio,
      categoria: categoria,
      // Los nombres que usa MargenClear, mapeados a los de MercadoLibre.
      clasica: tipos.gold_special || null,
      premium: tipos.gold_pro || null,
      gratuita: tipos.free || { nombre: 'Gratuita', porcentaje: 0, cargoFijo: 0 },
      todos: tipos,
      conToken: !!tok
    });
  } catch (e) {
    return res.status(200).json({ ok: false, motivo: 'No pudimos consultar las comisiones ahora' });
  }
}

// ------------------------------------------------------------
// Publicacion de ejemplo
// ------------------------------------------------------------
// El Analizador pedia un link y no ofrecia nada mas: quien todavia no
// publico nada se quedaba mirando un input vacio y 300px de pantalla negra.
// Ahora puede probar la herramienta con una publicacion real.
//
// A proposito NO hay una URL fija escrita en el codigo: esa publicacion se
// da de baja en algun momento y el boton queda roto sin que nadie se entere.
// Se busca una viva en el momento, con la misma API publica que ya usa el
// resto de este archivo.
async function handleEjemplo(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sinSuerte = {
    ok: false,
    error: 'No pudimos traer una publicaci\u00f3n de ejemplo ahora mismo. Peg\u00e1 el link de cualquier publicaci\u00f3n de MercadoLibre y funciona igual.'
  };
  try {
    const termino = (req.body && req.body.termino) ? String(req.body.termino).slice(0, 60) : 'auriculares bluetooth';
    const j = await fetchJSON('https://api.mercadolibre.com/sites/MLA/search?q=' + encodeURIComponent(termino) + '&limit=5');
    const cand = (j && Array.isArray(j.results) ? j.results : []).find(function (x) { return x && (x.permalink || x.id); });
    if (!cand) return res.status(200).json(sinSuerte);
    return res.status(200).json({
      ok: true,
      url: cand.permalink || ('https://articulo.mercadolibre.com.ar/' + String(cand.id).replace(/^MLA/, 'MLA-')),
      titulo: cand.title || '',
      nota: 'Es una publicaci\u00f3n real de otro vendedor, tra\u00edda de MercadoLibre reci\u00e9n.'
    });
  } catch (e) {
    return res.status(200).json(sinSuerte);
  }
}

// Funcionalidad 3: Calculadora Flex vs Full
// ------------------------------------------------------------
// api/flex-full.js
// ============================================================
// MeLi Connect - Calculadora Flex vs Full (Funcionalidad 3)
// Logica de REGLAS (no usa IA). Recibe datos del producto y
// devuelve que modalidad de envio conviene y POR QUE, con el
// costo estimado de cada una, explicado para principiantes.
//
// IMPORTANTE sobre los costos: los valores de tarifas de Mercado
// Envios y de almacenamiento en Full cambian seguido. Aca se usan
// PARAMETROS configurables (abajo) como estimacion educativa. El
// front aclara que son estimados y que hay que validar la tarifa
// real en el simulador oficial de MercadoLibre antes de decidir.
// ============================================================

// --- Umbrales de la recomendacion ---
// Aca antes habia montos en pesos escritos a mano: $350 de gestion de Full,
// $900 de despacho propio en Flex y $90/$220/$650 de almacenamiento. Eran
// numeros inventados que la pantalla mostraba grandes y en negrita, con la
// aclaracion en gris chico al final. Con la inflacion argentina envejecian en
// meses y no habia forma de mantenerlos al dia.
//
// La herramienta ahora NO dice cuanto cuesta cada modalidad: dice cual te
// conviene y por que, que es lo que realmente se puede afirmar sin tarifas
// oficiales en vivo. El costo exacto sale del simulador de MercadoLibre, y a
// eso se manda al usuario.
const P = {
  rotacionAltaMes: 30,
  rotacionMediaMes: 8
};

function handleFlexFull(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });

  try {
    const b = req.body || {};
    const pesoKg = num(b.pesoKg);
    const largo = num(b.largoCm), ancho = num(b.anchoCm), alto = num(b.altoCm);
    const rotacion = num(b.rotacionMes);        // unidades por mes estimadas
    const margen = num(b.margenUnidad);         // ganancia por unidad en ARS (opcional)
    const toleranciaAlmacenamiento = b.toleranciaAlmacenamiento || 'media'; // baja | media | alta

    if (pesoKg == null || rotacion == null) {
      return res.status(400).json({ error: 'Necesito al menos el peso (kg) y la rotación estimada (unidades por mes).' });
    }

    const tamano = clasificarTamano(pesoKg, largo, ancho, alto);
    const result = calcular({ pesoKg, tamano, rotacion, margen, toleranciaAlmacenamiento });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: 'Fallo el cálculo', detalle: String((e && e.message) || e) });
  }
}

function num(v) { const n = Number(v); return isFinite(n) && v !== '' && v != null ? n : null; }

// Clasifica el producto en chico / mediano / grande usando peso y
// peso volumetrico (los correos cobran por lo que sea mayor).
function clasificarTamano(pesoKg, largo, ancho, alto) {
  let volumetrico = 0;
  if (largo && ancho && alto) volumetrico = (largo * ancho * alto) / 5000; // formula tipica de peso volumetrico
  const pesoFacturable = Math.max(pesoKg || 0, volumetrico);
  if (pesoFacturable <= 1) return 'chico';
  if (pesoFacturable <= 5) return 'mediano';
  return 'grande';
}

function calcular(inp) {
  const { pesoKg, tamano, rotacion, margen, toleranciaAlmacenamiento } = inp;

  // Cuanto tiempo queda una unidad guardada antes de venderse: es lo que
  // decide si Full conviene o no. No se convierte a pesos porque la tarifa
  // real la publica MercadoLibre y cambia seguido.
  const mesesEnDeposito = rotacion >= P.rotacionAltaMes ? 0.5 : (rotacion >= P.rotacionMediaMes ? 1.2 : 2.5);
  const toleranciaTexto = toleranciaAlmacenamiento === 'baja'
    ? 'Dijiste que te molesta pagar depósito, así que el peso del almacenamiento cuenta doble en está recomendacion.'
    : (toleranciaAlmacenamiento === 'alta'
        ? 'Dijiste que no te molesta pagar depósito con tal de no ocuparte de la logística.'
        : 'Tomamos una tolerancia media al costo de almacenamiento.');

  // --- Puntaje de recomendacion ---
  // Full gana cuando la rotacion es alta y el producto es chico/mediano.
  // Flex gana cuando la rotacion es baja/media o el producto es grande/pesado.
  let recomendacion, motivo;
  const razones = [];

  if (rotacion >= P.rotacionAltaMes && tamano !== 'grande') {
    recomendacion = 'Mercado Full';
    razones.push('Tu rotación es alta (' + rotacion + ' u/mes): el stock no se queda quieto, así que el costo de almacenamiento por unidad es bajo.');
    razones.push('El producto es ' + tamano + ', un tamaño cómodo para Full.');
    razones.push('Full mejora el posicionamiento y te saca la logística de encima, clave cuando vendés volumen.');
  } else if (rotacion < P.rotacionMediaMes || tamano === 'grande') {
    recomendacion = 'Mercado Flex';
    if (rotacion < P.rotacionMediaMes) razones.push('Tu rotación es baja (' + rotacion + ' u/mes): en Full el stock quedaria guardado mucho tiempo y el almacenamiento te comeria el margen.');
    if (tamano === 'grande') razones.push('El producto es grande/pesado: almacenarlo en Full es caro.');
    razones.push('Con Flex no pagás depósito y controlás vos los tiempos de entrega.');
  } else {
    recomendacion = mesesEnDeposito <= 1.2 ? 'Mercado Full' : 'Mercado Flex';
    razones.push('Tu caso está en la mitad: rotación media (' + rotacion + ' u/mes) y tamaño ' + tamano + '.');
    razones.push('Con esa rotación, cada unidad queda alrededor de ' + mesesEnDeposito + ' mes en depósito. Se inclina para ' + recomendacion + ', pero la diferencia es chica: la única forma de estar seguro es correr las dos y medir.');
  }
  motivo = razones.join(' ');

  return {
    tamano,
    recomendacion,
    motivo,
    razones,
    // Comparacion cualitativa: que te cobra cada modalidad, sin inventar
    // cuanto. El monto exacto lo da el simulador oficial.
    comparacion: {
      full: {
        titulo: 'Mercado Full',
        queTePaga: 'Vos mandás el stock una vez. MeLi guarda, empaqueta y despacha.',
        queTeCobra: [
          'Una tarifa por cada venta preparada y despachada.',
          'Almacenamiento por el tiempo que el stock queda guardado (~' + mesesEnDeposito + ' mes con tu rotación).'
        ],
        aFavor: 'Mejor posicionamiento en el buscador y cero logística de tu lado.',
        enContra: 'Si rota lento, el almacenamiento se come el margen.'
      },
      flex: {
        titulo: 'Mercado Flex',
        queTePaga: 'El stock queda en tu casa o depósito y entregas vos el mismo día.',
        queTeCobra: [
          'No pagás depósito a MeLi.',
          'Pagás con tu tiempo, nafta e insumos en cada entrega.'
        ],
        aFavor: 'Sin costo de almacenamiento y controlás los tiempos.',
        enContra: 'No escala: cada venta es una entrega que tenés que hacer.'
      }
    },
    tolerancia: toleranciaTexto,
    aclaracion: 'Esta herramienta te dice que modalidad conviene según el peso, el tamaño y la rotación de tu producto. NO estima cuanto sale cada una: las tarifas de Mercado Envios y de almacenamiento en Full las fija MercadoLibre y cambian seguido, así que el número exacto lo tenés que sacar del simulador oficial para tu producto y tu categoría.',
    requisitos: buildRequisitos()
  };
}

// Aclaracion sobre requisitos de reputacion para cuentas nuevas.
function buildRequisitos() {
  return {
    titulo: 'Ojo si tu cuenta es nueva',
    texto: 'Flex y Full no están disponibles apenas abris la cuenta. MercadoLibre los habilita cuando ya tenés algo de trayectoria: cierta cantidad de ventas concretadas y una reputación sana (buen color, pocos reclamos, envios a tiempo). Es decir: primero vendés unas cuantas veces con Mercado Envios normal, y a medida que sumas ventas y reputación se te van habilitando Flex y despues Full.',
    nota: 'La cantidad exacta de ventas y los requisitos los define (y actualiza) MercadoLibre, y pueden variar por categoría y zona. Si todavia no te aparece la opción de Flex o Full al publicar, es por esto: segui vendiendo y cuidando la reputación, y se habilita solo.'
  };
}
