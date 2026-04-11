// api/meli-stock.js
// Trae stock real por producto del vendedor.
// Muestra stock en deposito propio y en Full (MeLi warehouse) por separado.
// Endpoint: GET /api/meli-stock?user_id=X

import { getValidToken } from './meli-refresh.js';

const MELI_API = 'https://api.mercadolibre.com';

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
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

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

  const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id requerido' });

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
