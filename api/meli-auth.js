// api/meli-auth.js
// Genera la URL de autorizacion OAuth de MercadoLibre.
// GET /api/meli-auth?user_id=<usuario de la app>  -> { auth_url }
// GET /api/meli-auth?user_id=X&redirect=true      -> 302 directo a MeLi
// GET /api/meli-auth?diag=1                       -> que falta configurar

import { cors, meliCreds, meliRedirectUri, MELI_AUTH } from './_meli.js';

export default async function handler(req, res) {
  cors(res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { clientId, ok, faltan } = meliCreds();
  const redirectUri = meliRedirectUri(req);

  if (req.query && req.query.diag) {
    return res.status(200).json({
      credenciales_ok: ok,
      faltan,
      redirect_uri: redirectUri,
      aviso: 'Esta redirect_uri tiene que estar cargada tal cual en el panel de la app de MercadoLibre.'
    });
  }

  if (!ok) {
    return res.status(500).json({
      error: 'Faltan credenciales de la app de MercadoLibre en el servidor',
      faltan
    });
  }

  // El state es el usuario de la app: es la clave con la que se guarda el token
  // y con la que despues lo buscan el dashboard y el recomendador. Si viene
  // vacio guardariamos la cuenta con el id numerico de MeLi y ningun endpoint
  // volveria a encontrarla: la cuenta quedaba "conectada" pero invisible.
  const userId = req.query && req.query.user_id ? String(req.query.user_id).trim() : '';
  if (!userId || userId === 'default' || userId === 'invitado') {
    return res.status(400).json({
      error: 'Ingresa a tu cuenta antes de conectar MercadoLibre',
      code: 'sin_usuario'
    });
  }

  // offline_access es lo que hace que MeLi devuelva refresh_token: sin el, la
  // conexion se cae sola a las 6 horas. Se puede vaciar con MELI_SCOPES=''
  // si alguna vez la app queda registrada con otros permisos.
  const scopes = process.env.MELI_SCOPES !== undefined
    ? String(process.env.MELI_SCOPES)
    : 'offline_access read';

  const authUrl = MELI_AUTH +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(clientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    (scopes ? '&scope=' + encodeURIComponent(scopes) : '') +
    '&state=' + encodeURIComponent(userId);

  if (req.query.redirect === 'true') return res.redirect(302, authUrl);

  return res.status(200).json({
    auth_url: authUrl,
    redirect_uri: redirectUri,
    message: 'Redirigir al usuario a auth_url para autorizar la app'
  });
}
