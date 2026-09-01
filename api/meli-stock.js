// api/meli-stock.js
// Todo lo del vendedor sobre sus propios productos: stock y costos.
//
//   GET    /api/meli-stock?user_id=X                  -> stock real por producto
//   GET    /api/meli-stock?user_id=X&recurso=costos   -> costos + tipo de cambio
//   POST   /api/meli-stock  { user_id, meli_item_id, costo_usd, costo_embalaje_ars }
//   POST   /api/meli-stock  { user_id, tipo_cambio_usd }
//   DELETE /api/meli-stock?user_id=X&meli_item_id=Y
//
// Los costos viven aca y no en su propio archivo porque el plan de Vercel
// permite 12 funciones y el proyecto ya las tiene: un /api/costos.js separado
// hacia fallar el deploy entero. Van juntos igual: los dos son "mis productos"
// y el dashboard los muestra en la misma pestaña.

import { getValidToken } from './meli-refresh.js';
import { supa, resolveUserId, tipoDeCambio } from './_meli.js';

const MELI_API = 'https://api.mercadolibre.com';

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function getMeliUserId(token) {
    const res = await fetch(`${MELI_API}/users/me`, {
          headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    return data.id;
}

async function getItemsActivos(token, meliUserId) {
    // Trae los items activos del vendedor (max 100)
  const res = await fetch(
        `${MELI_API}/users/${meliUserId}/items/search?status=active&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } }
      );
    const data = await res.json();
    return data.results || [];
}

async function getStockItem(token, itemId) {
    // Intenta obtener stock via user-products (requiere permisos de vendedor)
  try {
        const res = await fetch(
                `${MELI_API}/user-products/${itemId}/stock`,
          { headers: { Authorization: `Bearer ${token}` } }
              );
        if (res.ok) {
                const data = await res.json();
                // Separar stock propio vs Full
          const stockPropio = data.selling_address?.available_quantity || 0;
                const stockFull = data.locations?.find(l => l.type === 'meli_facility')
                  ?.detail?.available_quantity || 0;
                return { stock_propio: stockPropio, stock_full: stockFull, fuente: 'user-products' };
        }
  } catch {}

  // Fallback: leer desde el item directamente
  try {
        const res = await fetch(
                `${MELI_API}/items/${itemId}?attributes=available_quantity,sold_quantity,title,price,listing_type_id`,
          { headers: { Authorization: `Bearer ${token}` } }
              );
        const data = await res.json();
        return {
                stock_propio: data.available_quantity || 0,
                stock_full: 0,
                fuente: 'item'
        };
  } catch {
        return { stock_propio: 0, stock_full: 0, fuente: 'error' };
  }
}

async function getItemDetalle(token, itemId) {
    const res = await fetch(
          `${MELI_API}/items/${itemId}?attributes=id,title,price,available_quantity,sold_quantity,listing_type_id,permalink`,
      { headers: { Authorization: `Bearer ${token}` } }
        );
    return await res.json();
}

// ------------------------------------------------------------
// Costos propios: es lo que hace que el margen sea real. Sin el costo de
// compra, la app solo puede descontar la comision de MeLi y el envio, y
// muestra casi todo el precio de venta como ganancia.
// ------------------------------------------------------------
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

async function manejarCostos(req, res, userId) {
  const entrada = req.method === 'POST' ? (req.body || {}) : (req.query || {});

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
    // Tipo de cambio propio del vendedor.
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
    const costoUsd = entrada.costo_usd === '' || entrada.costo_usd === undefined || entrada.costo_usd === null
      ? null : parseFloat(entrada.costo_usd);
    const embalaje = entrada.costo_embalaje_ars === '' || entrada.costo_embalaje_ars === undefined || entrada.costo_embalaje_ars === null
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
}

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

  const user_id = (req.method === 'POST' ? (req.body || {}).user_id : req.query.user_id);

  if (!user_id) return res.status(400).json({ error: 'user_id requerido' });


  // Mismo user_id canonico que usan las ventas: si no coinciden, se cargan

  // costos que despues nadie encuentra.

  const userId = await resolveUserId(user_id).catch(() => String(user_id));


  // Todo lo que no sea leer el stock es el bloque de costos.

  if (req.method !== 'GET' || (req.query && req.query.recurso === 'costos')) {

    try { return await manejarCostos(req, res, userId); }

    catch (err) { return res.status(500).json({ error: String((err && err.message) || err).slice(0, 300) }); }

  }

  try {
        // 1. Token valido
      const token = await getValidToken(user_id);

      // 2. ID del vendedor en MeLi
      const meliUserId = await getMeliUserId(token);

      // 3. Lista de items activos
      const itemIds = await getItemsActivos(token, meliUserId);
        if (!itemIds.length) {
                return res.status(200).json({
                          success: true,
                          total_items: 0,
                          stock_total_propio: 0,
                          stock_total_full: 0,
                          productos: []
                });
        }

      // 4. Para cada item, traer detalle + stock
      // Procesamos en batches de 5 para no saturar la API
      const productos = [];
        let stockTotalPropio = 0;
        let stockTotalFull = 0;
        let alertasSinStock = 0;

      for (let i = 0; i < Math.min(itemIds.length, 50); i++) {
              const itemId = itemIds[i];
              const [detalle, stockInfo] = await Promise.all([
                        getItemDetalle(token, itemId),
                        getStockItem(token, itemId)
                      ]);

          const stockTotal = stockInfo.stock_propio + stockInfo.stock_full;
              if (stockTotal === 0) alertasSinStock++;

          stockTotalPropio += stockInfo.stock_propio;
              stockTotalFull += stockInfo.stock_full;

          productos.push({
                    item_id: itemId,
                    titulo: detalle.title || 'Sin titulo',
                    precio: detalle.price || 0,
                    stock_propio: stockInfo.stock_propio,
                    stock_full: stockInfo.stock_full,
                    stock_total: stockTotal,
                    vendidos_historico: detalle.sold_quantity || 0,
                    tipo_publicacion: detalle.listing_type_id || '',
                    url_meli: detalle.permalink || '',
                    alerta_sin_stock: stockTotal === 0,
                    alerta_stock_bajo: stockTotal > 0 && stockTotal <= 3
          });
      }

      // Ordenar por stock total (primero los que tienen menos)
      productos.sort((a, b) => a.stock_total - b.stock_total);

      return res.status(200).json({
              success: true,
              total_items: productos.length,
              stock_total_propio: stockTotalPropio,
              stock_total_full: stockTotalFull,
              alertas_sin_stock: alertasSinStock,
              alertas_stock_bajo: productos.filter(p => p.alerta_stock_bajo).length,
              productos
      });

  } catch (err) {
        console.error('meli-stock error:', err.message);
        return res.status(500).json({ error: err.message });
  }
}
