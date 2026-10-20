// api/_rotacion.js
// Rotacion REAL (vendidos) para el Buscador de oportunidades, con Apify.
//
// Reglas (decision del dueño, 20/10/2026):
//   - Solo dentro del proceso nocturno, nunca en una consulta de visitante.
//   - Solo para el top 3 de cada nicho que se actualiza esa noche, rankeado por
//     demanda + saturacion (datos gratis de la API oficial).
//   - Tope de gasto mensual en USD: APIFY_MONTHLY_BUDGET_USD (default 5, el
//     plan Free). Al llegar, no se piden mas vendidos y la tarjeta lo dice.
//
// MEDIDO (dataset pagado el 15/10/2026, 48 filas enriquecidas):
//   - Sin enrichDetailPage los vendidos vienen 0/48: hace falta enriquecer.
//   - Los vendidos vienen en RANGOS ("+100 vendidos", "+5 mil vendidos"), no
//     exactos, y sin fecha de publicacion. reviews_count si es exacto.
//   - Costo real de esa corrida (busqueda de 48 items): USD 0,240.
// Por eso no se busca por termino (48 items minimo): se piden por productIds
// solo las publicaciones que ya se conocen gratis por la API oficial (5 por
// producto), y los productos de toda la noche van en UNA corrida (un solo
// costo de arranque).
//
// Rotacion = ventas por mes. Con una medicion solo hay vendidos acumulados (el
// piso de cada rango). Con dos, la variacion: los rangos casi no se mueven en
// una semana, pero las reseñas son exactas, asi que las ventas del periodo se
// estiman como  delta reseñas x (vendidos / reseñas de esa publicacion), o el
// salto de rango si lo hubo, lo que sea mayor.

import { aVendidos } from './_buscador.js';

export const PRESUPUESTO_USD = () => Math.max(0, Number(process.env.APIFY_MONTHLY_BUDGET_USD || 5));
export const ITEMS_POR_PRODUCTO = () => Math.max(1, Math.min(10, Number(process.env.BUSCADOR_ROTACION_ITEMS || 5)));
export const PRODUCTOS_POR_NICHO = 3;
const REMEDIR_DIAS = 6;                 // no volver a medir un producto antes de esto
const COSTO_ITEM = () => Number(process.env.APIFY_COSTO_ITEM_ENRIQUECIDO || 0.004);
const COSTO_ARRANQUE = () => Number(process.env.APIFY_COSTO_ARRANQUE || 0.04);
const ORIGEN = 'buscador:rotacion';

function supa() {
  const url = process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co';
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  return { url, key, ok: !!key };
}
function cab(key, extra) { return Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, extra || {}); }
async function sb(ruta, init) {
  const { url, key, ok } = supa();
  if (!ok) throw new Error('sin SUPABASE_SERVICE_KEY');
  const r = await fetch(url + '/rest/v1/' + ruta, Object.assign({}, init, { headers: cab(key, (init && init.headers) || {}) }));
  if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 160));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Valores para un filtro in.(...) de PostgREST, entre comillas y codificados.
function listaIn(valores) {
  return valores.map(v => encodeURIComponent('"' + String(v).replace(/"/g, '') + '"')).join(',');
}

export function costoEstimadoCorrida(nItems) { return Number((COSTO_ARRANQUE() + nItems * COSTO_ITEM()).toFixed(4)); }

// ------------------------------------------------------------
// Presupuesto
// ------------------------------------------------------------
// Fuente de verdad: lo que Apify dice que se consumio en el ciclo
// (/users/me/limits, gratis). Si no responde, la suma estimada de apify_gasto
// del mes. Se suma lo reservado y todavia no reflejado.
export async function estadoPresupuesto() {
  const bus = await import('./_buscador.js');
  const tope = PRESUPUESTO_USD();
  let real = null, fuente = null;
  try {
    const c = await bus.estadoCuentaApify();
    if (c && typeof c.uso_mensual_usd === 'number') { real = c.uso_mensual_usd; fuente = 'apify'; }
  } catch (e) {}
  let enCurso = 0;
  try {
    // Corridas de rotacion arrancadas que Apify puede no haber facturado todavia.
    const filas = await sb('apify_gasto?select=costo_estimado&origen=eq.' + encodeURIComponent(ORIGEN) +
      '&estado=eq.arrancada&ts=gte.' + encodeURIComponent(new Date(Date.now() - 2 * 3600e3).toISOString()));
    enCurso = (filas || []).reduce((a, f) => a + Number(f.costo_estimado || 0), 0);
  } catch (e) {}
  if (real == null) {
    try {
      const desde = new Date(); desde.setUTCDate(1); desde.setUTCHours(3, 0, 0, 0);
      const filas = await sb('apify_gasto?select=costo_estimado&estado=neq.anulada&ts=gte.' + encodeURIComponent(desde.toISOString()));
      real = (filas || []).reduce((a, f) => a + Number(f.costo_estimado || 0), 0);
      fuente = 'apify_gasto (estimado)';
    } catch (e) { return { ok: false, tope, error: 'no pude leer el gasto: no se gasta' }; }
  }
  const usado = Math.round((real + enCurso) * 10000) / 10000;
  return { ok: true, tope, usado, restante: Math.max(0, Math.round((tope - usado) * 10000) / 10000), fuente };
}

// ------------------------------------------------------------
// Candidatos: top 3 del nicho por demanda + saturacion
// ------------------------------------------------------------
// ranking: [{ q, puntaje, itemIds }]  (lo arma _precalculo con datos gratis)
export async function encolar(nicho, ranking) {
  const top = ranking.filter(x => x.itemIds && x.itemIds.length).slice(0, PRODUCTOS_POR_NICHO);
  if (!top.length) return { encolados: 0 };
  // No re-medir lo medido (o en curso) en los ultimos REMEDIR_DIAS dias.
  const desde = new Date(Date.now() - REMEDIR_DIAS * 86400e3).toISOString();
  let recientes = [];
  try {
    recientes = await sb('buscador_vendidos?select=query,estado&creado=gte.' + encodeURIComponent(desde) +
      '&estado=in.(en_cola,arrancada,cosechada)&query=in.(' + listaIn(top.map(t => t.q)) + ')');
  } catch (e) { return { encolados: 0, error: e.message }; }
  const ya = new Set((recientes || []).map(r => r.query));
  const nuevos = top.filter(t => !ya.has(t.q)).map(t => ({
    query: t.q, nicho, estado: 'en_cola', item_ids: t.itemIds.slice(0, ITEMS_POR_PRODUCTO()),
    motivo: 'top ' + PRODUCTOS_POR_NICHO + ' por demanda+saturación (' + t.puntaje + ')'
  }));
  if (nuevos.length) await sb('buscador_vendidos', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(nuevos) });
  return { encolados: nuevos.length, yaMedidos: top.length - nuevos.length };
}

// ------------------------------------------------------------
// Arranque: una corrida para toda la cola (un solo costo de arranque)
// ------------------------------------------------------------
// repartir: si es true (cron), no se gasta mas que lo que le toca a esta noche
// del presupuesto restante del ciclo; asi quedan mediciones para todo el mes
// (y para la segunda medicion, que es la que da la variacion).
export async function arrancarCola(opts) {
  const o = opts || {};
  const cola = await sb('buscador_vendidos?select=id,query,nicho,item_ids&estado=eq.en_cola&order=creado.asc&limit=200');
  if (!cola || !cola.length) return { arrancada: false, motivo: 'cola vacia' };
  const pres = await estadoPresupuesto();
  if (!pres.ok) return { arrancada: false, motivo: pres.error };
  let disponible = pres.restante;
  if (o.repartir) {
    const hoy = new Date();
    const finMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 1));
    const diasRestantes = Math.max(1, Math.ceil((finMes - hoy) / 86400e3));
    disponible = Math.min(disponible, Math.max(pres.restante / diasRestantes, costoEstimadoCorrida(ITEMS_POR_PRODUCTO())));
  }
  // Cuantos productos entran.
  const elegidos = [];
  let items = 0;
  for (const f of cola) {
    const n = (f.item_ids || []).length;
    if (costoEstimadoCorrida(items + n) > disponible) break;
    elegidos.push(f); items += n;
  }
  const sinLugar = cola.filter(f => elegidos.indexOf(f) < 0);
  // Lo que no entra en el tope mensual queda marcado: la tarjeta dice
  // "pendiente (tope mensual alcanzado)". Lo que no entra solo por el reparto
  // de esta noche sigue en cola para la proxima.
  const topeMensual = pres.restante < costoEstimadoCorrida(ITEMS_POR_PRODUCTO());
  if (sinLugar.length && topeMensual) {
    await sb('buscador_vendidos?id=in.(' + sinLugar.map(f => f.id).join(',') + ')', {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: 'sin_presupuesto', motivo: 'tope mensual de USD ' + pres.tope + ' alcanzado (usado ' + pres.usado + ')' })
    });
  }
  if (!elegidos.length) return { arrancada: false, motivo: topeMensual ? 'tope mensual alcanzado' : 'reparto de esta noche agotado', presupuesto: pres, enCola: cola.length };

  const ids = Array.from(new Set(elegidos.flatMap(f => f.item_ids || [])));
  const costo = costoEstimadoCorrida(ids.length);
  // Se anota en apify_gasto (la misma cuenta que el Market Reader) ANTES de
  // arrancar. No pasa por los topes de corridas por dia/mes del Market Reader:
  // este camino tiene su propio tope en USD.
  const { dia } = await import('./_gasto.js').then(g => ({ dia: g.diaAr() }));
  const reserva = await sb('apify_gasto', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    dia, ts: new Date().toISOString(), termino: 'rotacion: ' + elegidos.length + ' productos', site: 'MLA',
    enriquecido: true, items: ids.length, costo_estimado: costo, estado: 'reservada', origen: ORIGEN
  }) });
  const gastoId = reserva && reserva[0] && reserva[0].id;
  const bus = await import('./_buscador.js');
  let corrida;
  try {
    corrida = await bus.arrancarCorrida('rotacion', { input: {
      productIds: ids.join(','), maxItems: Math.max(48, ids.length), enrichDetailPage: true, country: 'AR'
    } });
  } catch (e) {
    if (gastoId) await sb('apify_gasto?id=eq.' + gastoId, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'anulada', motivo: String(e.message).slice(0, 180) }) });
    return { arrancada: false, motivo: 'Apify no arranco: ' + String(e.message).slice(0, 160) };
  }
  if (gastoId) await sb('apify_gasto?id=eq.' + gastoId, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'arrancada', run_id: corrida.runId, dataset_id: corrida.datasetId }) });
  await sb('buscador_vendidos?id=in.(' + elegidos.map(f => f.id).join(',') + ')', {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'arrancada', run_id: corrida.runId, dataset_id: corrida.datasetId, gasto_id: gastoId || null })
  });
  return { arrancada: true, runId: corrida.runId, productos: elegidos.length, items: ids.length, costoEstimadoUsd: costo, presupuesto: pres, quedanEnCola: sinLugar.length };
}

// ------------------------------------------------------------
// Cosecha: corridas terminadas -> vendidos por producto
// ------------------------------------------------------------
function filaDeItem(f) {
  const id = String(f.item_id || f.ml_id || '').toUpperCase();
  const texto = f.sold_quantity_text || f.soldQuantityText || null;
  return {
    id,
    vendidos: texto ? aVendidos(texto) : (typeof f.sold_quantity === 'number' ? f.sold_quantity : null),
    vendidos_texto: texto,
    reviews: typeof f.reviews_count === 'number' ? f.reviews_count : null,
    rating: typeof f.reviews_rating === 'number' ? f.reviews_rating : null,
    precio: typeof f.price === 'number' ? f.price : null,
    titulo: String(f.name || f.title || '').slice(0, 120)
  };
}

export async function cosechar() {
  const filas = await sb('buscador_vendidos?select=id,query,item_ids,run_id,dataset_id,gasto_id,creado&estado=eq.arrancada&limit=300');
  if (!filas || !filas.length) return { cosechadas: 0, pendientes: 0 };
  const bus = await import('./_buscador.js');
  const porRun = {};
  filas.forEach(f => { (porRun[f.run_id] = porRun[f.run_id] || []).push(f); });
  let cosechadas = 0, pendientes = 0, fallidas = 0;
  const costos = [];
  for (const runId of Object.keys(porRun)) {
    const grupo = porRun[runId];
    const est = await bus.estadoCorrida(runId);
    if (est.estado === 'RUNNING' || est.estado === 'READY') { pendientes += grupo.length; continue; }
    if (est.estado !== 'SUCCEEDED') {
      // Despues de 2 dias sin terminar bien, se da por fallida (se reintenta otra noche).
      const viejo = Date.now() - new Date(grupo[0].creado).getTime() > 2 * 86400e3;
      if (/^(FAILED|ABORTED|TIMED-OUT)/.test(est.estado) || viejo) {
        await sb('buscador_vendidos?run_id=eq.' + encodeURIComponent(runId) + '&estado=eq.arrancada', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'fallida', motivo: 'Apify ' + est.estado }) });
        fallidas += grupo.length;
      } else pendientes += grupo.length;
      continue;
    }
    const crudas = await bus.itemsDeCorrida(est.datasetId || grupo[0].dataset_id, { limite: 500 });
    const porId = {};
    crudas.map(filaDeItem).forEach(it => { if (it.id) porId[it.id] = it; });
    // Costo REAL de la corrida (Apify), prorrateado por producto.
    let costoReal = null;
    try { const d = await bus.detalleDeCorrida(runId, est.datasetId); costoReal = d && d.corrida && d.corrida.costo_usd; } catch (e) {}
    const porProducto = costoReal != null ? Math.round(costoReal / grupo.length * 10000) / 10000 : null;
    costos.push({ runId, costoRealUsd: costoReal, productos: grupo.length, itemsPedidos: grupo.reduce((a, g) => a + (g.item_ids || []).length, 0), itemsDevueltos: crudas.length });
    for (const g of grupo) {
      const items = (g.item_ids || []).map(id => porId[String(id).toUpperCase()]).filter(Boolean);
      const vend = items.filter(i => typeof i.vendidos === 'number');
      const rev = items.filter(i => typeof i.reviews === 'number');
      await sb('buscador_vendidos?id=eq.' + g.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
        estado: items.length ? 'cosechada' : 'fallida',
        motivo: items.length ? null : 'Apify no devolvio ninguna de las publicaciones pedidas',
        items, vendidos_total: vend.length ? vend.reduce((a, i) => a + i.vendidos, 0) : null,
        reviews_total: rev.length ? rev.reduce((a, i) => a + i.reviews, 0) : null,
        costo_usd: porProducto, medido_en: new Date().toISOString()
      }) });
      if (items.length) cosechadas++; else fallidas++;
    }
    if (grupo[0].gasto_id && costoReal != null) {
      await sb('apify_gasto?id=eq.' + grupo[0].gasto_id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'cosechada', motivo: 'costo real USD ' + costoReal }) }).catch(() => {});
    }
  }
  return { cosechadas, pendientes, fallidas, costos };
}

// ------------------------------------------------------------
// Lectura para la tarjeta
// ------------------------------------------------------------
// Ultimas filas por query (las dos ultimas cosechadas y el estado mas nuevo).
export async function historialDe(queries) {
  const out = {};
  if (!queries.length || !supa().ok) return out;
  try {
    const filas = await sb('buscador_vendidos?select=query,estado,items,vendidos_total,reviews_total,medido_en,creado,motivo,costo_usd' +
      '&query=in.(' + listaIn(queries) + ')&order=creado.desc&limit=500');
    for (const f of filas || []) {
      const h = out[f.query] = out[f.query] || { ultimo: null, cosechadas: [] };
      if (!h.ultimo) h.ultimo = { estado: f.estado, motivo: f.motivo, creado: f.creado };
      if (f.estado === 'cosechada' && h.cosechadas.length < 2) h.cosechadas.push(f);
    }
  } catch (e) {}
  return out;
}
