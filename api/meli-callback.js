// api/meli-callback.js
// Recibe el code de MercadoLibre, lo canjea por access_token + refresh_token
// y lo guarda en Supabase con el usuario de la app como clave.
// Vuelve siempre a meli-connect.html con un resultado legible.

import { cors, meliRedirectUri, appOrigin, exchangeCode, saveTokenRow } from './_meli.js';

function volver(res, origen, params) {
  const qs = new URLSearchParams(params).toString();
  return res.redirect(302, origen + '/meli-connect.html?' + qs);
}

export default async function handler(req, res) {
  cors(res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const origen = appOrigin(req);
  const { code, state, error, error_description } = req.query || {};

  if (error) {
    return volver(res, origen, { error, detalle: String(error_description || '').slice(0, 200) });
  }
  if (!code) {
    return volver(res, origen, { error: 'sin_code' });
  }

  // Misma redirect_uri que se uso para pedir el code: MeLi rechaza el canje si
  // difiere aunque sea en un caracter.
  const redirectUri = meliRedirectUri(req);

  let tokenData;
  try {
    tokenData = await exchangeCode(code, redirectUri);
  } catch (err) {
    console.error('meli-callback canje:', err && err.message);
    return volver(res, origen, {
      error: 'token_failed',
      detalle: String((err && err.message) || err).slice(0, 200)
    });
  }

  // El state es el usuario de la app. Si viene vacio caemos al id de MeLi, pero
  // avisamos: con esa clave el dashboard no va a encontrar la conexion.
  const userId = state && state !== 'default' && state !== 'invitado'
    ? decodeURIComponent(String(state))
    : String(tokenData.user_id);
  const sinUsuario = !state || state === 'default' || state === 'invitado';

  try {
    await saveTokenRow({
      user_id: userId,
      meli_user_id: tokenData.user_id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in || 21600
    });
  } catch (err) {
    console.error('meli-callback guardado:', err && err.message);
    return volver(res, origen, {
      error: 'db_error',
      detalle: String((err && err.message) || err).slice(0, 200)
    });
  }

  const params = { success: '1', meli_user: String(tokenData.user_id), app_user: userId };
  if (!tokenData.refresh_token) params.aviso = 'sin_refresh';
  if (sinUsuario) params.aviso = 'sin_usuario';
  return volver(res, origen, params);
}
