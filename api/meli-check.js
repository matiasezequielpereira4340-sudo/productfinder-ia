// api/meli-check.js
// Estado de la conexion de un usuario con MercadoLibre.
//   GET /api/meli-check?user_id=X          -> { connected, needs_reconnect }
//   GET /api/meli-check?user_id=X&diag=1   -> ademas: que esta mal y donde
//
// El diagnostico no expone tokens ni claves: solo dice si cada variable esta
// cargada y si MercadoLibre acepta el token.

import { cors, meliCreds, supa, getTokenRow, getUserToken, fetchJson, resolveUserId, MELI_API } from './_meli.js';

export default async function handler(req, res) {
  cors(res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { user_id, diag } = req.query || {};
  if (!user_id) return res.status(400).json({ error: 'user_id requerido' });

  const creds = meliCreds();
  const db = supa();

  // Sin service key no hay forma de saber si esta conectado: antes esto se
  // reportaba como "no conectado" y mandaba a reconectar en loop.
  if (!db.ok) {
    return res.status(200).json({
      connected: false,
      needs_reconnect: false,
      error: 'SUPABASE_SERVICE_KEY no configurada en el servidor',
      code: 'sin_supabase'
    });
  }

  let row = null;
  try {
    row = await getTokenRow(user_id);
  } catch (err) {
    return res.status(200).json({
      connected: false,
      needs_reconnect: false,
      error: String((err && err.message) || err).slice(0, 300),
      code: 'error_supabase'
    });
  }

  const expirado = row && row.expires_at ? Date.now() > new Date(row.expires_at).getTime() : true;
  // Un token vencido con refresh_token NO obliga a reconectar: se renueva solo.
  const puedeRenovar = !!(row && row.refresh_token);
  const salida = {
    connected: !!row,
    token_expired: !!row && expirado,
    needs_reconnect: !!row && expirado && !puedeRenovar
  };

  if (!diag) return res.status(200).json(salida);

  const canonico = await resolveUserId(user_id).catch(() => String(user_id));
  salida.diagnostico = {
    user_id: String(user_id),
    user_id_de_la_conexion: canonico,
    credenciales_meli: creds.ok ? 'ok' : 'faltan: ' + creds.faltan.join(', '),
    supabase_service_key: db.ok ? 'ok' : 'falta',
    anthropic_api_key: process.env.ANTHROPIC_API_KEY ? 'ok' : 'falta',
    fila_en_meli_tokens: !!row,
    meli_user_id: row ? row.meli_user_id || null : null,
    tiene_refresh_token: puedeRenovar,
    vence: row ? row.expires_at : null
  };

  if (row) {
    const t = await getUserToken(user_id);
    salida.diagnostico.token_utilizable = !!t.token;
    salida.diagnostico.motivo = t.motivo;
    if (t.error) salida.diagnostico.detalle = t.error;
    if (t.token) {
      const me = await fetchJson(MELI_API + '/users/me', t.token, 5000);
      salida.diagnostico.meli_users_me = me.ok ? 'ok (' + ((me.json && me.json.nickname) || 'sin nickname') + ')' : 'HTTP ' + me.status;
    }
  } else {
    salida.diagnostico.siguiente_paso = 'Entra a /meli-connect.html logueado como "' + user_id + '" y autoriza la app.';
  }

  return res.status(200).json(salida);
}
