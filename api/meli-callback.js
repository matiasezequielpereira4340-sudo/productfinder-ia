// api/meli-callback.js
// Recibe el code de MercadoLibre y lo intercambia por access_token + refresh_token
// Guarda los tokens en Supabase

const SUPABASE_URL = 'https://qglieqpcmmffgxijbysb.supabase.co';

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function saveTokens(data) {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY no configurado');

  const payload = {
        user_id: String(data.user_id),
        meli_user_id: String(data.meli_user_id),
        access_token: data.access_token,
        refresh_token: data.refresh_token || null,
        expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString()
  };

  const res = await fetch(SUPABASE_URL + '/rest/v1/meli_tokens', {
        method: 'POST',
        headers: {
                'Content-Type': 'application/json' || null,
                'apikey': serviceKey,
                'Authorization': 'Bearer ' + serviceKey,
                'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
  });

  if (!res.ok) {
        const err = await res.text();
        throw new Error('Error guardando tokens: ' + err);
  }
    return true;
}

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

  const { code, state, error } = req.query;

  if (error) {
        return res.redirect(302,
                                  'https://productfinder-ia.vercel.app/meli-connect.html?error=' +
                                  encodeURIComponent(error));
  }

  if (!code) {
        return res.status(400).json({ error: 'Falta el parametro code' });
  }

  const appId = process.env.MELI_APP_ID;
    const secretKey = process.env.MELI_SECRET_KEY;
    const redirectUri = process.env.MELI_REDIRECT_URI ||
          'https://productfinder-ia.vercel.app/api/meli-callback';

  if (!appId || !secretKey) {
        return res.status(500).json({ error: 'Credenciales MeLi no configuradas' });
  }

  try {
        // Intercambiar code por tokens
      const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                        grant_type: 'authorization_code',
                        client_id: appId,
                        client_secret: secretKey,
                        code: code,
                        redirect_uri: redirectUri
              })
      });

      const tokenData = await tokenRes.json();

      if (!tokenRes.ok || !tokenData.access_token) {
              console.error('Error MeLi token:', tokenData);
              return res.redirect(302,
                                          'https://productfinder-ia.vercel.app/meli-connect.html?error=token_failed');
      }

      // Guardar en Supabase
      const userId = state && state !== 'default'
          ? decodeURIComponent(state)
              : tokenData.user_id;

      await saveTokens({
              user_id: userId,
              meli_user_id: tokenData.user_id,
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expires_in: tokenData.expires_in || 21600
      });

      // Redirigir a pagina de exito
      return res.redirect(302,
                                'https://productfinder-ia.vercel.app/meli-connect.html?success=1&meli_user=' +
                                tokenData.user_id);

  } catch (err) {
        console.error('meli-callback error:', err.message);
        return res.redirect(302,
                                  'https://productfinder-ia.vercel.app/meli-connect.html?error=' +
                                  encodeURIComponent(err.message));
  }
}
