// api/meli-refresh.js
// Renueva el access_token de MeLi usando el refresh_token guardado en Supabase.
// Se llama automaticamente antes de cada request a la API de MeLi.
// Tambien se puede llamar como endpoint: POST /api/meli-refresh { user_id }

const SUPABASE_URL = 'https://qglieqpcmmffgxijbysb.supabase.co';

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// -----------------------------------------------
// Helpers Supabase
// -----------------------------------------------

async function getTokenFromDB(userId) {
    const key = process.env.SUPABASE_SERVICE_KEY;
    const res = await fetch(
          `${SUPABASE_URL}/rest/v1/meli_tokens?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
        );
    const rows = await res.json();
    return rows[0] || null;
}

async function updateTokenInDB(userId, accessToken, refreshToken, expiresIn) {
    const key = process.env.SUPABASE_SERVICE_KEY;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    await fetch(
          `${SUPABASE_URL}/rest/v1/meli_tokens?user_id=eq.${encodeURIComponent(userId)}`,
      {
              method: 'PATCH',
              headers: {
                        apikey: key,
                        Authorization: `Bearer ${key}`,
                        'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                        access_token: accessToken,
                        refresh_token: refreshToken,
                        expires_at: expiresAt,
                        updated_at: new Date().toISOString()
              })
      }
        );
}

// -----------------------------------------------
// Funcion principal exportable (usada por otros endpoints)
// -----------------------------------------------

export async function getValidToken(userId) {
    const record = await getTokenFromDB(userId);
    if (!record) throw new Error(`No hay token para user_id: ${userId}`);

  // Si el token vence en menos de 5 minutos, renovar
  const expiresAt = new Date(record.expires_at).getTime();
    const needsRefresh = Date.now() > expiresAt - 5 * 60 * 1000;

  if (!needsRefresh) {
        return record.access_token;
  }

  // Renovar con refresh_token
  const appId = process.env.MELI_APP_ID;
    const secretKey = process.env.MELI_SECRET_KEY;

  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: appId,
                client_secret: secretKey,
                refresh_token: record.refresh_token
        })
  });

  const data = await res.json();
    if (!res.ok || !data.access_token) {
          throw new Error(`Error renovando token: ${JSON.stringify(data)}`);
    }

  await updateTokenInDB(
        userId,
        data.access_token,
        data.refresh_token,
        data.expires_in || 21600
      );

  return data.access_token;
}

// -----------------------------------------------
// Handler HTTP (llamada directa al endpoint)
// -----------------------------------------------

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id requerido' });

  try {
        const accessToken = await getValidToken(user_id);
        return res.status(200).json({ success: true, access_token: accessToken });
  } catch (err) {
        console.error('meli-refresh error:', err.message);
        return res.status(500).json({ error: err.message });
  }
}
