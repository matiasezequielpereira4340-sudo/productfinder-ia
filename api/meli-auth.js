// api/meli-auth.js
// Genera la URL de autorizacion OAuth de MercadoLibre

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

  const appId = process.env.MELI_APP_ID;
    const redirectUri = process.env.MELI_REDIRECT_URI ||
          'https://productfinder-ia.vercel.app/api/meli-callback';

  if (!appId) {
        return res.status(500).json({ error: 'MELI_APP_ID no configurado' });
  }

  const state = req.query.user_id
      ? encodeURIComponent(req.query.user_id)
        : 'default';

  const authUrl =
        'https://auth.mercadolibre.com.ar/authorization?' +
        'response_type=code' +
        '&client_id=' + appId +
        '&redirect_uri=' + encodeURIComponent(redirectUri) +
        '&state=' + state;

  if (req.query.redirect === 'true') {
        return res.redirect(302, authUrl);
  }

  return res.status(200).json({
        auth_url: authUrl,
        message: 'Redirigir al usuario a auth_url para autorizar la app'
  });
}
