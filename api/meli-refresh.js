// api/meli-refresh.js
// Renueva el access_token de MeLi con el refresh_token guardado en Supabase.
//
//   getValidToken(userId)            -> lo usan meli-ventas, meli-stock y market
//   POST /api/meli-refresh {user_id} -> renueva una cuenta
//   GET  /api/meli-refresh?all=1     -> renueva todas (lo llama el cron diario)
//
// El refresh_token de MercadoLibre caduca si no se usa: el cron diario lo
// mantiene vivo para que la conexion no se caiga sola.

import { cors, getTokenRow, listTokenRows, refreshWithToken, saveTokenRow } from './_meli.js';

// Compatibilidad: el resto del codigo espera que tire si no hay token.
export async function getValidToken(userId) {
  const row = await getTokenRow(userId);
  if (!row) throw new Error('No hay token para user_id: ' + userId);

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt && Date.now() < expiresAt - 5 * 60 * 1000) return row.access_token;

  const data = await refreshWithToken(row.refresh_token);
  await saveTokenRow({
    user_id: row.user_id || userId,
    meli_user_id: row.meli_user_id || data.user_id,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in || 21600
  });
  return data.access_token;
}

async function refrescarTodos() {
  const filas = await listTokenRows(200);
  const salida = [];
  for (const f of filas) {
    try {
      await getValidToken(f.user_id);
      salida.push({ user_id: f.user_id, ok: true });
    } catch (e) {
      salida.push({ user_id: f.user_id, ok: false, error: String((e && e.message) || e).slice(0, 200) });
    }
  }
  return salida;
}

export default async function handler(req, res) {
  cors(res, 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    if (!(req.query && req.query.all)) {
      return res.status(400).json({ error: 'Usa POST con user_id, o GET ?all=1' });
    }
    try {
      const cuentas = await refrescarTodos();
      return res.status(200).json({
        success: true,
        total: cuentas.length,
        renovadas: cuentas.filter(c => c.ok).length,
        cuentas
      });
    } catch (err) {
      return res.status(500).json({ error: String((err && err.message) || err) });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id requerido' });

  try {
    await getValidToken(user_id);
    // El access_token no se devuelve: es una credencial y el front no la necesita.
    return res.status(200).json({ success: true, user_id });
  } catch (err) {
    console.error('meli-refresh error:', err && err.message);
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
}
