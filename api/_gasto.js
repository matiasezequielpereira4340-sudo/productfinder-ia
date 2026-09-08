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

// ------------------------------------------------------------
// El tope que manda es el MENSUAL, no el diario.
// ------------------------------------------------------------
// Apify factura y bloquea por CICLO MENSUAL, asi que un tope diario no protege
// nada: el techo real de la cuenta es el credito del mes.
//
// Cuenta free: USD 5 por mes. Una busqueda de MercadoLibre medida cuesta
// USD 0,232 (48 items enriquecidos, promedio de 5 corridas reales). O sea unas
// 21 busquedas nuevas POR MES.
//
// El default es 18 y no 21 a proposito: deja margen para el costo de arranque
// y para las corridas que fallan y cobran igual (medido: 4 de Google Trends
// terminaron FAILED con 0 items y consumieron credito).
//
// El tope diario sigue existiendo como cinturon contra un pico en un solo dia,
// pero baja de 30 a 3: 30 por dia eran USD 6,90 diarios, unos USD 207 al mes,
// cuarenta veces el presupuesto. Un tope por encima del techo real de la cuenta
// no es un tope.
export function topeMensual() {
  const n = parseInt(process.env.APIFY_MAX_RUNS_MES || '18', 10);
  return Number.isFinite(n) && n >= 0 ? n : 18;
}

export function topeDiario() {
  const n = parseInt(process.env.APIFY_MAX_RUNS_DIA || '3', 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

// Cuando arranca y termina el ciclo de facturacion de Apify.
//
// El ciclo casi nunca empieza el dia 1: depende de cuando se creo la cuenta.
// Apify lo expone en /v2/users/me, y leerlo es gratis. Si no lo expone, o no
// hay token, se cae al mes calendario argentino y se DICE que es una
// suposicion, para no dar por cierta una fecha de reinicio que no es.
let _ciclo = null;
export async function cicloApify() {
  if (_ciclo && Date.now() < _ciclo.leidoHasta) return _ciclo.datos;
  const salida = mesCalendarioAr();
  const token = process.env.APIFY_TOKEN;
  if (token) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      try {
        const r = await fetch('https://api.apify.com/v2/users/me?token=' + encodeURIComponent(token),
          { signal: ctrl.signal });
        if (r.ok) {
          const j = await r.json().catch(() => null);
          const d = (j && j.data) || {};
          // El nombre exacto del campo no esta documentado de forma estable, asi
          // que se busca cualquiera que hable de ciclo/periodo con fecha. Si no
          // aparece ninguno, se sigue con el mes calendario en vez de inventar.
          const plano = {};
          const aplanar = (o, pre) => {
            for (const k of Object.keys(o || {})) {
              const v = o[k];
              if (v && typeof v === 'object' && !Array.isArray(v)) aplanar(v, pre + k + '.');
              else plano[pre + k] = v;
            }
          };
          aplanar(d, '');
          let desde = null, hasta = null;
          for (const k of Object.keys(plano)) {
            const val = plano[k];
            if (typeof val !== 'string' || !/\d{4}-\d{2}-\d{2}/.test(val)) continue;
            if (/cycle.*start|start.*cycle|period.*start|current.*period.*start/i.test(k)) desde = val;
            if (/cycle.*end|end.*cycle|period.*end|current.*period.*end/i.test(k)) hasta = val;
          }
          if (desde) {
            salida.desde = new Date(desde).toISOString();
            salida.hasta = hasta ? new Date(hasta).toISOString() : null;
            salida.fuente = 'apify';
            salida.nota = null;
          } else {
            salida.camposVistos = Object.keys(plano).filter(k => /cycle|period|usage|plan/i.test(k)).slice(0, 25);
          }
        }
      } finally { clearTimeout(t); }
    } catch (_) { /* se sigue con el mes calendario */ }
  }
  _ciclo = { datos: salida, leidoHasta: Date.now() + 6 * 3600 * 1000 };
  return salida;
}

function mesCalendarioAr() {
  const hoy = diaAr();                       // YYYY-MM-DD en Buenos Aires
  const [a, m] = hoy.split('-').map(Number);
  const off = offsetAr();
  const dosDig = (x) => String(x).padStart(2, '0');
  const inicio = a + '-' + dosDig(m) + '-01T00:00:00' + off;
  const sigA = m === 12 ? a + 1 : a, sigM = m === 12 ? 1 : m + 1;
  const fin = sigA + '-' + dosDig(sigM) + '-01T00:00:00' + off;
  return {
    desde: new Date(inicio).toISOString(),
    hasta: new Date(fin).toISOString(),
    fuente: 'mes-calendario-ar',
    nota: 'SUPUESTO: el ciclo de Apify casi nunca arranca el dia 1. Esta fecha es el mes calendario argentino, no la fecha real de reinicio de la cuenta.'
  };
}

// Cuantas corridas se gastaron en el ciclo en curso.
export async function corridasDelCiclo() {
  const { url, key, ok } = supa();
  if (!ok) return { ok: false, usadas: null, error: 'falta SUPABASE_SERVICE_KEY' };
  const ciclo = await cicloApify();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch(url + '/rest/v1/apify_gasto?select=id' +
                            '&ts=gte.' + encodeURIComponent(ciclo.desde) +
                            '&estado=neq.anulada',
        { method: 'HEAD', signal: ctrl.signal,
          headers: headers(key, { Prefer: 'count=exact', Range: '0-0' }) });
      if (!r.ok) {
        console.error('[gasto] no pude contar las corridas del ciclo: HTTP ' + r.status);
        return { ok: false, usadas: null, error: 'HTTP ' + r.status, ciclo };
      }
      const total = parseInt(String(r.headers.get('content-range') || '').split('/')[1], 10);
      if (!Number.isFinite(total)) return { ok: false, usadas: null, error: 'sin conteo', ciclo };
      return { ok: true, usadas: total, ciclo };
    } finally { clearTimeout(t); }
  } catch (e) {
    const detalle = String((e && e.message) || e).slice(0, 160);
    console.error('[gasto] error contando el ciclo: ' + detalle);
    return { ok: false, usadas: null, error: detalle, ciclo };
  }
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
  const topeMes = topeMensual();
  const tope = topeDiario();

  // 1. EL TOPE QUE MANDA: el del ciclo. Apify bloquea por mes, no por dia.
  const mes = await corridasDelCiclo();
  if (!mes.ok) {
    return { ok: false, motivo: 'sin-cuenta', tope, topeMes, usadas: null, usadasMes: null,
             error: mes.error, ciclo: mes.ciclo, reinicio: proximoReinicio() };
  }
  if (mes.usadas >= topeMes) {
    return { ok: false, motivo: 'tope-mes', topeMes, usadasMes: mes.usadas,
             restantesMes: 0, ciclo: mes.ciclo,
             reinicioCiclo: mes.ciclo && mes.ciclo.hasta, tope, reinicio: proximoReinicio() };
  }

  // 2. Cinturon diario: evita quemar el mes entero en una tarde.
  const conteo = await corridasDeHoy();
  if (!conteo.ok) {
    return {
      ok: false, motivo: 'sin-cuenta', tope, topeMes, usadas: null, usadasMes: mes.usadas,
      error: conteo.error,
      reinicio: proximoReinicio()
    };
  }
  if (conteo.usadas >= tope) {
    return {
      ok: false, motivo: 'tope', tope, usadas: conteo.usadas,
      topeMes, usadasMes: mes.usadas, restantesMes: topeMes - mes.usadas,
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
    return { ok: true, id, tope, usadas: conteo.usadas + 1, restantes: tope - conteo.usadas - 1,
             topeMes, usadasMes: mes.usadas + 1, restantesMes: topeMes - mes.usadas - 1,
             ciclo: mes.ciclo, costoEstimado: fila.costo_estimado };
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
  const mes = await corridasDelCiclo();
  const topeMes = topeMensual();
  const salida = {
    // Lo del CICLO va primero: es el techo real de la cuenta.
    ciclo: {
      tope: topeMes,
      usadas: mes.ok ? mes.usadas : null,
      restantes: mes.ok ? Math.max(0, topeMes - mes.usadas) : null,
      desde: mes.ciclo && mes.ciclo.desde,
      reinicio: mes.ciclo && mes.ciclo.hasta,
      fuenteDeLaFecha: mes.ciclo && mes.ciclo.fuente,
      nota: mes.ciclo && mes.ciclo.nota,
      camposVistosEnApify: mes.ciclo && mes.ciclo.camposVistos
    },
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
