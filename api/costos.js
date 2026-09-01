// api/costos.js
// Costos propios de cada producto: es lo que falta para que el margen del
// dashboard sea real. Sin el costo de compra, la app solo puede descontar la
// comision de MercadoLibre y el envio, y muestra casi todo el precio de venta
// como ganancia (85% donde el margen verdadero puede ser 30%).
//
//   GET    /api/costos?user_id=X              -> costos cargados + tipo de cambio
//   POST   /api/costos                        -> guarda el costo de un producto
//          { user_id, meli_item_id, titulo, costo_usd, costo_embalaje_ars, notas }
//   POST   /api/costos                        -> o guarda el tipo de cambio
//          { user_id, tipo_cambio_usd }
//   DELETE /api/costos?user_id=X&meli_item_id=Y

import { cors, supa, resolveUserId } from './_meli.js';

async function supaFetch(path, init) {
  const { url, key, ok } = supa();
  if (!ok) throw new Error('SUPABASE_SERVICE_KEY no configurada');
  const r = await fetch(url + path, {
    ...(init || {}),
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...((init && init.headers) || {})
    }
  });
  const txt = await r.text();
  let body = null;
  try { body = txt ? JSON.parse(txt) : null; } catch (_) { body = txt; }
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (body && body.message ? body.message : String(txt).slice(0, 200)));
  return body;
}

// El dolar del dia, para no calcular margenes con una cotizacion de hace meses.
// Si el usuario cargo su propio tipo de cambio, ese manda.
export async function tipoDeCambio(userId) {
  try {
    const filas = await supaFetch('/rest/v1/clientes?user_id=eq.' + encodeURIComponent(userId) +
      '&select=tipo_cambio_usd&limit=1');
    const propio = filas && filas[0] && parseFloat(filas[0].tipo_cambio_usd);
    if (propio && propio > 0) return { valor: propio, fuente: 'propio' };
  } catch (_) {}
  try {
    const r = await fetch('https://dolarapi.com/v1/dolares/tarjeta');
    if (r.ok) {
      const j = await r.json();
      if (j && j.venta > 0) return { valor: j.venta, fuente: 'dolar tarjeta del dia' };
    }
  } catch (_) {}
  return { valor: parseFloat(process.env.USD_ARS) || 1500, fuente: 'valor por defecto' };
}

export default async function handler(req, res) {
  cors(res, 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const entrada = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  if (!entrada.user_id) return res.status(400).json({ error: 'user_id requerido' });

  // Mismo user_id canonico que usan las ventas: si no, se cargan costos que
  // despues nadie encuentra.
  let userId;
  try { userId = await resolveUserId(entrada.user_id); }
  catch (_) { userId = String(entrada.user_id); }

  try {
    if (req.method === 'GET') {
      const costos = await supaFetch('/rest/v1/productos_costos?user_id=eq.' +
        encodeURIComponent(userId) + '&select=*&order=updated_at.desc');
      const tc = await tipoDeCambio(userId);
      return res.status(200).json({
        success: true,
        user_id: userId,
        tipo_cambio_usd: tc.valor,
        tipo_cambio_fuente: tc.fuente,
        costos: costos || []
      });
    }

    if (req.method === 'POST') {
      // Guardar el tipo de cambio propio del vendedor.
      if (entrada.tipo_cambio_usd !== undefined && !entrada.meli_item_id) {
        const valor = parseFloat(entrada.tipo_cambio_usd);
        if (!(valor > 0)) return res.status(400).json({ error: 'tipo_cambio_usd invalido' });
        await supaFetch('/rest/v1/clientes?on_conflict=user_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            user_id: userId,
            nombre: userId,          // la columna es obligatoria
            tipo_cambio_usd: valor,
            updated_at: new Date().toISOString()
          })
        });
        return res.status(200).json({ success: true, tipo_cambio_usd: valor });
      }

      if (!entrada.meli_item_id) return res.status(400).json({ error: 'meli_item_id requerido' });
      const costoUsd = entrada.costo_usd === '' || entrada.costo_usd === undefined
        ? null : parseFloat(entrada.costo_usd);
      const embalaje = entrada.costo_embalaje_ars === '' || entrada.costo_embalaje_ars === undefined
        ? null : parseFloat(entrada.costo_embalaje_ars);
      if (costoUsd !== null && !(costoUsd >= 0)) return res.status(400).json({ error: 'costo_usd invalido' });
      if (embalaje !== null && !(embalaje >= 0)) return res.status(400).json({ error: 'costo_embalaje_ars invalido' });

      await supaFetch('/rest/v1/productos_costos?on_conflict=user_id,meli_item_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          meli_item_id: String(entrada.meli_item_id),
          titulo: entrada.titulo || null,
          costo_usd: costoUsd,
          costo_embalaje_ars: embalaje,
          notas: entrada.notas || null,
          updated_at: new Date().toISOString()
        })
      });
      return res.status(200).json({ success: true, meli_item_id: entrada.meli_item_id });
    }

    if (req.method === 'DELETE') {
      if (!entrada.meli_item_id) return res.status(400).json({ error: 'meli_item_id requerido' });
      await supaFetch('/rest/v1/productos_costos?user_id=eq.' + encodeURIComponent(userId) +
        '&meli_item_id=eq.' + encodeURIComponent(String(entrada.meli_item_id)), { method: 'DELETE' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Metodo no permitido' });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err).slice(0, 300) });
  }
}
