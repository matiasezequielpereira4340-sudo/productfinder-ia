// Cotizacion del dolar, una sola fuente para toda la app.
//
// Antes cada pantalla tenia su propio numero: el Market Reader arrancaba con
// 1250 hardcodeado en el HTML y el analizador pedia /dolares/tarjeta. Con el
// oficial en ~1530 eso daba 59% de diferencia entre dos pantallas de la misma
// app, y del lado del Market Reader subvaluaba el costo (margen inflado).
//
// Todo pasa por aca: se consulta dolarapi.com desde el server (asi no depende
// de que habiliten CORS en el navegador), se cachea 30 minutos en memoria del
// proceso y se devuelven las cinco cotizaciones. El default de la app es MEP:
// es el que paga de verdad quien importa pagando con dolares propios.

const TTL_MS = 30 * 60 * 1000;
export const DOLAR_TIPO_DEFAULT = 'mep';

// Tipos que expone la app, en el orden en que se muestran en el selector.
export const DOLAR_TIPOS = ['mayorista', 'oficial', 'mep', 'ccl', 'tarjeta'];

// Como se llama cada tipo en dolarapi.com (campo "casa").
const CASA = {
  oficial: 'oficial',
  mayorista: 'mayorista',
  mep: 'bolsa',
  ccl: 'contadoconliqui',
  tarjeta: 'tarjeta'
};

let _cache = { datos: null, expiraEn: 0 };

// Devuelve { ok, oficial, mayorista, mep, ccl, tarjeta, fecha, fuente, error }.
// Los valores son numeros (precio de venta redondeado) o null si esa casa no
// vino en la respuesta. Nunca inventa un numero: si dolarapi no responde y no
// hay nada cacheado, devuelve ok:false y el front avisa.
export async function cotizacionDolar(opts) {
  const o = opts || {};
  if (!o.sinCache && _cache.datos && Date.now() < _cache.expiraEn) {
    return { ..._cache.datos, deCache: true };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), o.timeoutMs || 6000);
    let r;
    try {
      r = await fetch('https://dolarapi.com/v1/dolares', {
        signal: ctrl.signal, headers: { Accept: 'application/json' }
      });
    } finally { clearTimeout(t); }

    if (!r.ok) {
      console.warn('[dolar] dolarapi respondio HTTP ' + r.status);
      return _vencidoOError('dolarapi respondio HTTP ' + r.status);
    }
    const filas = await r.json();
    if (!Array.isArray(filas) || !filas.length) {
      console.warn('[dolar] dolarapi devolvio un cuerpo vacio o inesperado');
      return _vencidoOError('dolarapi devolvio un cuerpo inesperado');
    }

    const porCasa = {};
    for (const f of filas) {
      if (f && f.casa) porCasa[String(f.casa).toLowerCase()] = f;
    }
    const datos = { ok: true, fuente: 'dolarapi.com', fecha: null, error: null };
    let fechaMax = null;
    for (const tipo of DOLAR_TIPOS) {
      const f = porCasa[CASA[tipo]];
      const v = f && (f.venta != null ? f.venta : f.compra);
      datos[tipo] = (typeof v === 'number' && v > 0) ? Math.round(v) : null;
      if (f && f.fechaActualizacion && (!fechaMax || f.fechaActualizacion > fechaMax)) {
        fechaMax = f.fechaActualizacion;
      }
    }
    datos.fecha = fechaMax;
    // Si ninguna casa trajo numero, la respuesta no sirve: no se cachea.
    if (!DOLAR_TIPOS.some(t => datos[t] != null)) {
      console.warn('[dolar] dolarapi no trajo ninguna cotizacion utilizable');
      return _vencidoOError('dolarapi no trajo ninguna cotizacion');
    }
    _cache = { datos, expiraEn: Date.now() + TTL_MS };
    return { ...datos, deCache: false };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 160);
    console.warn('[dolar] fallo la consulta a dolarapi: ' + msg);
    return _vencidoOError(msg);
  }
}

// Si el pedido falla pero hay algo cacheado (aunque este vencido), se devuelve
// eso avisando que esta viejo. Es preferible a quedarse sin numero.
function _vencidoOError(motivo) {
  if (_cache.datos) return { ..._cache.datos, deCache: true, vencido: true, error: motivo };
  const vacio = { ok: false, fuente: 'dolarapi.com', fecha: null, error: motivo };
  DOLAR_TIPOS.forEach(t => { vacio[t] = null; });
  return vacio;
}

// El numero que usa el calculo. Toma el tipo pedido y, si esa casa no vino,
// baja por la lista hasta encontrar una que si. Devuelve null si no hay
// ninguna: el que llama decide que hacer, nunca se completa con un default
// inventado.
export async function tipoDeCambio(tipo) {
  const c = await cotizacionDolar();
  const pedido = DOLAR_TIPOS.includes(tipo) ? tipo : DOLAR_TIPO_DEFAULT;
  const orden = [pedido, ...DOLAR_TIPOS.filter(t => t !== pedido)];
  for (const t of orden) {
    if (c[t] != null) return { valor: c[t], tipo: t, fecha: c.fecha, exacto: t === pedido, cotizacion: c };
  }
  return { valor: null, tipo: pedido, fecha: null, exacto: false, cotizacion: c };
}
