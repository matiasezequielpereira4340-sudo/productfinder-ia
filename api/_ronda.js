// api/_ronda.js
// Ronda semanal de un rubro: elige candidatos del pool, los analiza con la API
// oficial de MeLi (con variantes de busqueda si no traen datos), reemplaza los
// que no tienen datos por otros del pool hasta llegar al objetivo y cierra la
// ronda con historial. Puede llevar varias tandas (cada una corta a los 50 s):
// lo que va quedando se guarda en una fila "<nicho>~wip" de buscador_cache y la
// tanda siguiente sigue desde ahi. La fila del rubro solo se pisa cuando la
// ronda termina, asi el visitante nunca ve una ronda a medias.
//
// No es un endpoint (api/ ya tiene 12 funciones, el tope del plan Hobby).

import { poolDe, poolElegible, ordenarCandidatos, historialDesdeFila, cerrarRonda, analizarConVariantes, descubrir,
  sumarDescubiertos, OBJETIVO_RONDA, FIJOS_POR_RONDA, elegirFijos, normalizar } from './_pool.js';

const SUPA_URL = () => process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co';
const SUPA_KEY = () => process.env.SUPABASE_SERVICE_KEY || '';
const WIP = '~wip';
const WIP_VIGENCIA_MS = 2 * 86400e3; // una ronda a medias de mas de 2 dias se descarta

// Los previews comparten Supabase con produccion. Para que probar "Forzar
// actualizacion" en un preview no le cambie la seleccion a los usuarios
// reales, fuera de produccion se escribe en filas "preview:<nicho>" (y se lee
// primero de ahi; si no hay, de la de produccion).
export function prefijoEntorno() {
  const env = process.env.VERCEL_ENV;
  return env && env !== 'production' ? 'preview:' : '';
}

function cab(extra) { return Object.assign({ apikey: SUPA_KEY(), Authorization: 'Bearer ' + SUPA_KEY() }, extra || {}); }

export async function leerFila(clave) {
  if (!SUPA_KEY()) return null;
  try {
    const r = await fetch(SUPA_URL() + '/rest/v1/buscador_cache?nicho=eq.' + encodeURIComponent(clave) + '&select=mercado,created_at&limit=1', { headers: cab() });
    if (!r.ok) return null;
    const f = (await r.json())[0];
    return f && f.mercado && typeof f.mercado === 'object' ? { mercado: f.mercado, creadoEn: f.created_at, created_at: f.created_at } : null;
  } catch (e) { return null; }
}

export async function guardarFila(clave, mercado) {
  if (!SUPA_KEY()) return false;
  try {
    const r = await fetch(SUPA_URL() + '/rest/v1/buscador_cache?on_conflict=nicho', {
      method: 'POST', headers: cab({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ nicho: clave, mercado, created_at: new Date().toISOString() })
    });
    if (!r.ok) console.error('[buscador_cache] HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200));
    return r.ok;
  } catch (e) { return false; }
}

// Fila del rubro para mostrar: primero la del entorno (preview:), despues la de produccion.
export async function leerFilaRubro(nicho) {
  const p = prefijoEntorno();
  if (p) { const f = await leerFila(p + nicho); if (f) return f; }
  return leerFila(nicho);
}

export async function leerWip(nicho) {
  const f = await leerFila(prefijoEntorno() + nicho + WIP);
  if (!f || !f.mercado || f.mercado.__terminado || !f.mercado.__ronda) return null;
  if (Date.now() - new Date(f.mercado.__ronda.fecha).getTime() > WIP_VIGENCIA_MS) return null;
  return f;
}

function idRonda(ahora) {
  const d = new Date(ahora);
  return d.toISOString().slice(0, 10) + '-' + d.getTime().toString(36).slice(-5);
}

// ------------------------------------------------------------
// Procesar un rubro (una tanda)
// ------------------------------------------------------------
// o = { nichoKey, base (CATALOGO[k].productos), usdArs, forzar, motivo, analizar, ahora }
// Devuelve { terminado, conDatos, objetivo, mercado, ... }. Con terminado=false
// la tanda siguiente sigue la misma ronda.
export async function procesarNicho(cli, o) {
  const ahora = o.ahora || Date.now();
  const k = o.nichoKey;
  const objetivo = o.objetivo || OBJETIVO_RONDA();
  const prefijo = prefijoEntorno();
  let wip = o.forzar ? null : await leerWip(k);
  let estado;
  let descubrimiento = null;
  if (wip) {
    estado = wip.mercado;
  } else {
    // Ronda nueva: historial de la fila actual, descubrimiento y orden.
    const fila = await leerFilaRubro(k);
    const historial = historialDesdeFila(fila, o.base);
    const previos = fila && fila.mercado && Array.isArray(fila.mercado.__descubiertos) ? fila.mercado.__descubiertos : [];
    const pool0 = poolDe(k, o.base, previos);
    try { descubrimiento = await descubrir(cli, k, pool0, { ahora }); } catch (e) { descubrimiento = { nuevos: [], error: e.message }; }
    const descubiertos = sumarDescubiertos(previos, descubrimiento.nuevos);
    // Solo productos con categoria de MeLi asignada (ver tieneCategoria).
    const pool = poolElegible(k, o.base, descubiertos);
    const ronda = { id: idRonda(ahora), fecha: new Date(ahora).toISOString(), motivo: o.motivo || (o.forzar ? 'forzada' : 'semanal') };
    // Fijos: los mejores de la ronda anterior con medicion de vendidos hecha o
    // en curso, para que lleguen a la 2.a medicion. El resto rota.
    const prevSel = fila && fila.mercado && Array.isArray(fila.mercado.__seleccion) ? fila.mercado.__seleccion : [];
    let fijos = [];
    if (prevSel.length && o.historialDe && FIJOS_POR_RONDA()) {
      try { fijos = elegirFijos(prevSel, await o.historialDe(prevSel.map(p => p.q)), FIJOS_POR_RONDA()); } catch (e) { fijos = []; }
    }
    const orden = ordenarCandidatos(pool, historial, { ahora, semilla: ronda.id, nichoKey: k, usdArs: o.usdArs, fijos });
    estado = {
      __ronda: ronda, __historialPrevio: historial, __descubiertos: descubiertos,
      __descubrimiento: { nuevos: descubrimiento.nuevos.map(p => p.q), fuentes: descubrimiento.fuentes || null, categorias: descubrimiento.categorias || null, error: descubrimiento.error || null },
      __orden: orden, __hechos: [], __conDatos: [], __descartados: [], __poolTotal: pool.length, __fijos: fijos.map(f => f.q),
      __anterior: historial.rondas[0] ? historial.rondas[0].qs : []
    };
  }

  // Analizar candidatos en lotes de 4 hasta llegar al objetivo o quedarse sin
  // pool o sin tiempo.
  const hechos = new Set(estado.__hechos);
  const pendientes = () => estado.__orden.filter(p => !hechos.has(p.q));
  let cortado = false;
  while (estado.__conDatos.length < objetivo && pendientes().length && !cortado) {
    if (cli.vencido && cli.vencido()) { cortado = true; break; }
    const faltan = objetivo - estado.__conDatos.length;
    const lote = pendientes().slice(0, Math.min(4, Math.max(1, faltan)));
    const rs = await Promise.all(lote.map(p => analizarConVariantes(cli, p, o.analizar, { nichoKey: k, usdArs: o.usdArs })));
    rs.forEach((r, i) => {
      const p = lote[i];
      if (r.cortado && !r.consulta) { cortado = true; return; }   // cortado por tiempo: se reintenta en la tanda siguiente
      hechos.add(p.q);
      if (r.consulta) {
        estado[p.q] = r.mercado;
        if (estado.__conDatos.length < objetivo) estado.__conDatos.push(p);
      } else {
        estado.__descartados.push({ nombre: p.nombre, q: p.q, origen: p.origen, intentos: r.intentos,
          motivo: !r.mercado ? 'MercadoLibre no devolvió productos de catálogo' : 'menos de 3 ofertas comparables (' + ((r.mercado.results || []).length) + ' ofertas)' });
      }
    });
  }
  estado.__hechos = Array.from(hechos);
  const terminado = !cortado && (estado.__conDatos.length >= objetivo || !pendientes().length);

  if (!terminado) {
    await guardarFila(prefijo + k + WIP, estado);
    return { terminado: false, conDatos: estado.__conDatos.length, objetivo, ronda: estado.__ronda, descartados: estado.__descartados.length,
      candidatosRevisados: estado.__hechos.length, poolTotal: estado.__poolTotal, descubrimiento: estado.__descubrimiento, mercado: vistaDe(estado) };
  }

  // Ronda terminada: fila final del rubro.
  const seleccion = estado.__conDatos;
  const qs = seleccion.map(p => p.q);
  const historial = cerrarRonda(estado.__historialPrevio, estado.__ronda, qs);
  const vistosAntes = new Set(estado.__historialPrevio.vistos || []);
  const final = {
    __v: o.version, __formato: 2, __ronda: estado.__ronda, __objetivo: objetivo,
    __seleccion: seleccion, __nuevos: qs.filter(q => !vistosAntes.has(q)), __anterior: estado.__anterior,
    __descartados: estado.__descartados, __candidatosRevisados: estado.__hechos.length, __poolTotal: estado.__poolTotal,
    __historial: historial, __descubiertos: estado.__descubiertos, __descubrimiento: estado.__descubrimiento,
    __fijos: (estado.__fijos || []).filter(q => qs.indexOf(q) > -1)
  };
  seleccion.forEach(p => { final[p.q] = estado[p.q]; });
  let guardado = false;
  if (seleccion.length) guardado = await guardarFila(prefijo + k, final);
  await guardarFila(prefijo + k + WIP, { __terminado: true, __ronda: estado.__ronda });
  return { terminado: true, guardado, conDatos: seleccion.length, objetivo, ronda: estado.__ronda, nuevos: final.__nuevos.length,
    descartados: estado.__descartados.length, candidatosRevisados: estado.__hechos.length, poolTotal: estado.__poolTotal,
    descubrimiento: estado.__descubrimiento, mercado: final };
}

// Una ronda a medias vista como fila final (para mostrar lo que ya hay si un
// visitante con MeLi conectado la disparo y no llego a terminar).
function vistaDe(estado) {
  const v = { __formato: 2, __parcial: true, __ronda: estado.__ronda, __seleccion: estado.__conDatos.slice(),
    __nuevos: estado.__conDatos.map(p => p.q).filter(q => !new Set(estado.__historialPrevio.vistos || []).has(q)),
    __anterior: estado.__anterior, __descartados: estado.__descartados, __candidatosRevisados: estado.__hechos.length, __poolTotal: estado.__poolTotal };
  estado.__conDatos.forEach(p => { v[p.q] = estado[p.q]; });
  return v;
}

export { normalizar };
