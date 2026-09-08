// api/_gasto.js
// ------------------------------------------------------------
// Freno de gasto del proveedor pago (Apify).
//
// Por que existe: las tres vias gratuitas de MercadoLibre estan caidas
// (medido en produccion: /sites/MLA/search 403, /highlights 403,
// /products/{id}/items 404, y el listado publico devuelve el muro anti-bot).
// O sea que hoy CASI TODA busqueda nueva termina arrancando una corrida paga.
// Hasta este archivo no habia ningun tope: el codigo que gasta estaba en
// produccion sin freno.
//
// Dos decisiones que valen la pena explicar:
//
// 1) El contador vive en Supabase, NO en memoria. Vercel levanta y mata
//    procesos todo el tiempo: un contador en memoria se reinicia en cada cold
//    start y el tope no existiria. Ademas puede haber varios lambdas a la vez.
//
// 2) Se RESERVA antes de arrancar, no se anota despues. Si se contara despues,
//    dos requests simultaneos leerian "29 usadas" y arrancarian las dos. La
//    reserva es una fila insertada ANTES de gastar: el contador ya subio
//    cuando la corrida arranca. Si la corrida no arranca, la reserva se anula
//    y deja de contar.
//
// 3) Si no se puede consultar el contador, NO se gasta. Un freno que se abre
//    cuando falla no es un freno.
// ------------------------------------------------------------

const TZ = 'America/Argentina/Buenos_Aires';

function supa() {
  const url = (process.env.SUPABASE_URL || 'https://qglieqpcmmffgxijbysb.supabase.co').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  return { url, key, ok: !!key };
}

function headers(key, extra) {
  return Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  }, extra || {});
}

// Dia calendario argentino, no UTC. Con UTC el corte caeria a las 21:00 hora
// de Buenos Aires y el tope se reiniciaria en el medio de la tarde.
export function diaAr(fecha) {
  const d = fecha || new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

// El corrimiento horario se pregunta, no se hardcodea. Argentina esta fija en
// -03:00 desde 2009, pero si algun dia vuelve el horario de verano esto sigue
// dando bien en vez de errar por una hora.
function offsetAr(fecha) {
  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, timeZoneName: 'longOffset'
    }).formatToParts(fecha || new Date());
    const tz = (partes.find(p => p.type === 'timeZoneName') || {}).value || '';
    const m = tz.match(/GMT([+-]\d{2}:\d{2})/);
    if (m) return m[1];
  } catch (_) {}
  return '-03:00';
}

// Cuando se reinicia el tope: la medianoche argentina siguiente.
export function proximoReinicio(fecha) {
  const hoy = diaAr(fecha);
  const [a, m, d] = hoy.split('-').map(Number);
  const manana = new Date(Date.UTC(a, m - 1, d + 1));
  const y = manana.getUTCFullYear();
  const mm = String(manana.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(manana.getUTCDate()).padStart(2, '0');
  return new Date(y + '-' + mm + '-' + dd + 'T00:00:00' + offsetAr(fecha)).toISOString();
}

export function topeDiario() {
  const n = parseInt(process.env.APIFY_MAX_RUNS_DIA || '30', 10);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

// Precios del actor devcake~mercadolibre-scraper: USD 0.004 por item con
// pagina de detalle (enrichDetailPage) contra USD 0.001 por el resultado
// pelado.
//
// Y un costo de ARRANQUE, que la ficha del actor no dice y que se descubrio
// midiendo. Cinco corridas reales de 48 items enriquecidos, cobradas por Apify:
//
//   sliders discos ejercicio core   USD 0.22805
//   fortalecedor mano grip          USD 0.23605
//   rinonera running deportiva      USD 0.22405
//   rodillo masajeador muscular     USD 0.24005
//   cinta kinesiologica deportiva   USD 0.23205
//                                   promedio 0.23205
//
// 48 x 0.004 = 0.192. La diferencia, 0.040, es fija por corrida: es lo que
// cuesta levantar el actor, corra 1 item o 48. Sin ese termino la estimacion
// subestimaba un 17% cada corrida, y el error crece cuanto mas chicas son.
const COSTO_ITEM_ENRIQUECIDO = Number(process.env.APIFY_COSTO_ITEM_ENRIQUECIDO || 0.004);
const COSTO_ITEM_PELADO = Number(process.env.APIFY_COSTO_ITEM_PELADO || 0.001);
const COSTO_ARRANQUE = Number(process.env.APIFY_COSTO_ARRANQUE || 0.04);

export function costoEstimado(items, enriquecido) {
  const n = Math.max(0, parseInt(items, 10) || 0);
  const unit = enriquecido ? COSTO_ITEM_ENRIQUECIDO : COSTO_ITEM_PELADO;
  // Una corrida sin items igual se pago: el arranque no se descuenta.
  return Number((COSTO_ARRANQUE + n * unit).toFixed(4));
}

// Cuantas corridas se gastaron hoy. Devuelve { ok, usadas }.
// ok:false significa "no pude contar", que aguas arriba tiene que frenar el
// gasto, no dejarlo pasar.
export async function corridasDeHoy(fecha) {
  const { url, key, ok } = supa();
  if (!ok) return { ok: false, usadas: null, error: 'falta SUPABASE_SERVICE_KEY' };
  const dia = diaAr(fecha);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch(url + '/rest/v1/apify_gasto?select=id&dia=eq.' + dia +
                            '&estado=neq.anulada',
        { method: 'HEAD', signal: ctrl.signal,
          headers: headers(key, { Prefer: 'count=exact', Range: '0-0' }) });
      if (!r.ok) {
        const detalle = 'HTTP ' + r.status;
        console.error('[gasto] no pude contar las corridas de hoy: ' + detalle);
        return { ok: false, usadas: null, error: detalle };
      }
      // PostgREST devuelve el total en Content-Range: "0-0/123".
      const cr = r.headers.get('content-range') || '';
      const total = parseInt(String(cr).split('/')[1], 10);
      if (!Number.isFinite(total)) {
        console.error('[gasto] Supabase no devolvio el conteo (content-range: "' + cr + '")');
        return { ok: false, usadas: null, error: 'sin conteo' };
      }
      return { ok: true, usadas: total, dia };
    } finally { clearTimeout(t); }
  } catch (e) {
    const detalle = String((e && e.message) || e).slice(0, 160);
    console.error('[gasto] error contando las corridas de hoy: ' + detalle);
    return { ok: false, usadas: null, error: detalle };
  }
}

// Reserva un cupo ANTES de arrancar la corrida. Si devuelve ok:false, no hay
// que arrancar nada.
//
// motivo:
//   'tope'      -> se llego al limite diario
//   'sin-cuenta'-> no se puede consultar el contador (se frena por las dudas)
export async function reservarCorrida(datos) {
  const d = datos || {};
  const tope = topeDiario();
  const conteo = await corridasDeHoy();
  if (!conteo.ok) {
    return {
      ok: false, motivo: 'sin-cuenta', tope, usadas: null,
      error: conteo.error,
      reinicio: proximoReinicio()
    };
  }
  if (conteo.usadas >= tope) {
    return {
      ok: false, motivo: 'tope', tope, usadas: conteo.usadas,
      reinicio: proximoReinicio()
    };
  }

  const { url, key } = supa();
  const items = Math.max(0, parseInt(d.items, 10) || 0);
  const fila = {
    dia: diaAr(),
    ts: new Date().toISOString(),
    termino: String(d.termino || '').slice(0, 200),
    site: d.site || 'MLA',
    enriquecido: !!d.enriquecido,
    items,
    costo_estimado: costoEstimado(items, d.enriquecido),
    estado: 'reservada',
    origen: String(d.origen || '').slice(0, 40) || null
  };
  try {
    const r = await fetch(url + '/rest/v1/apify_gasto', {
      method: 'POST',
      headers: headers(key, { Prefer: 'return=representation' }),
      body: JSON.stringify(fila)
    });
    if (!r.ok) {
      const cuerpo = await r.text().catch(() => '');
      const detalle = 'HTTP ' + r.status + ' ' + cuerpo.slice(0, 200);
      console.error('[gasto] no pude reservar el cupo para "' + fila.termino + '": ' + detalle);
      return { ok: false, motivo: 'sin-cuenta', tope, usadas: conteo.usadas, error: detalle, reinicio: proximoReinicio() };
    }
    const filas = await r.json().catch(() => []);
    const id = Array.isArray(filas) && filas[0] ? filas[0].id : null;
    if (id == null) {
      console.error('[gasto] la reserva para "' + fila.termino + '" no devolvio id');
      return { ok: false, motivo: 'sin-cuenta', tope, usadas: conteo.usadas, error: 'reserva sin id', reinicio: proximoReinicio() };
    }
    return { ok: true, id, tope, usadas: conteo.usadas + 1, restantes: tope - conteo.usadas - 1, costoEstimado: fila.costo_estimado };
  } catch (e) {
    const detalle = String((e && e.message) || e).slice(0, 160);
    console.error('[gasto] error reservando cupo para "' + fila.termino + '": ' + detalle);
    return { ok: false, motivo: 'sin-cuenta', tope, usadas: conteo.usadas, error: detalle, reinicio: proximoReinicio() };
  }
}

async function parchear(id, cambios) {
  if (id == null) return false;
  const { url, key, ok } = supa();
  if (!ok) return false;
  try {
    const r = await fetch(url + '/rest/v1/apify_gasto?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: headers(key, { Prefer: 'return=minimal' }),
      body: JSON.stringify(cambios)
    });
    if (!r.ok) {
      const cuerpo = await r.text().catch(() => '');
      console.error('[gasto] no pude actualizar la fila ' + id + ': HTTP ' + r.status + ' ' + cuerpo.slice(0, 160));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[gasto] error actualizando la fila ' + id + ': ' + String((e && e.message) || e).slice(0, 160));
    return false;
  }
}

// La corrida arranco: se le pega el run_id a la reserva. Sin esto la fila
// queda contando el cupo pero sin decir a que corrida corresponde.
export async function anotarArranque(id, corrida) {
  return parchear(id, {
    estado: 'arrancada',
    run_id: (corrida && corrida.runId) || null,
    dataset_id: (corrida && corrida.datasetId) || null
  });
}

// La corrida no arranco (o se aborto): la reserva deja de contar contra el
// tope. Si esto no existiera, un error de Apify consumiria cupo del dia.
export async function anularReserva(id, motivo) {
  return parchear(id, { estado: 'anulada', motivo: String(motivo || '').slice(0, 200) });
}

// Para el endpoint de auditoria: en que se fue la plata, por termino.
export async function resumenGasto(n) {
  const tope = topeDiario();
  const conteo = await corridasDeHoy();
  const limite = Math.min(200, Math.max(1, parseInt(n, 10) || 50));
  const salida = {
    dia: diaAr(),
    zona: TZ,
    tope,
    usadas: conteo.ok ? conteo.usadas : null,
    restantes: conteo.ok ? Math.max(0, tope - conteo.usadas) : null,
    contadorOk: conteo.ok,
    contadorError: conteo.ok ? null : conteo.error,
    reinicio: proximoReinicio(),
    precios: { arranque_usd: COSTO_ARRANQUE,
               item_enriquecido_usd: COSTO_ITEM_ENRIQUECIDO,
               item_pelado_usd: COSTO_ITEM_PELADO },
    nota: 'costo_estimado = arranque + items x precio por item. Calibrado contra 5 corridas reales ' +
          'de 48 items enriquecidos (0.224 a 0.240, promedio 0.232). Sigue siendo una estimacion, ' +
          'no la factura: el costo real de una corrida esta en ?pendientes=1 -> corrida.costo_usd.'
  };
  const { url, key, ok } = supa();
  if (!ok) { salida.error = 'falta SUPABASE_SERVICE_KEY'; salida.corridas = []; return salida; }
  try {
    const r = await fetch(url + '/rest/v1/apify_gasto?select=*&order=ts.desc&limit=' + limite,
      { headers: headers(key) });
    if (!r.ok) {
      const cuerpo = await r.text().catch(() => '');
      salida.error = 'HTTP ' + r.status + ' ' + cuerpo.slice(0, 200);
      salida.corridas = [];
      return salida;
    }
    const filas = await r.json().catch(() => []);
    salida.corridas = Array.isArray(filas) ? filas : [];
    // Resumen por termino: la pregunta real es "en que termino se me fue la
    // plata", no "cuantas corridas hubo".
    const porTermino = {};
    let totalUsd = 0;
    for (const f of salida.corridas) {
      if (f.estado === 'anulada') continue;
      const k = f.termino || '(sin termino)';
      if (!porTermino[k]) porTermino[k] = { corridas: 0, usd: 0, enriquecidas: 0 };
      porTermino[k].corridas++;
      porTermino[k].usd = Number((porTermino[k].usd + (Number(f.costo_estimado) || 0)).toFixed(4));
      if (f.enriquecido) porTermino[k].enriquecidas++;
      totalUsd += Number(f.costo_estimado) || 0;
    }
    salida.porTermino = porTermino;
    salida.totalUsdEnLaMuestra = Number(totalUsd.toFixed(4));
    return salida;
  } catch (e) {
    salida.error = String((e && e.message) || e).slice(0, 200);
    salida.corridas = [];
    return salida;
  }
}
