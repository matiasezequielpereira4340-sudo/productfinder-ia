// api/meli-check.js
// Verifica si un user_id ya tiene tokens de MeLi guardados en Supabase.
// Usado por el login para decidir a donde redirigir al usuario.
// GET /api/meli-check?user_id=X
// Responde: { connected: true/false }

const SUPABASE_URL = 'https://qglieqpcmmffgxijbysb.supabase.co';

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

  const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id requerido' });

  try {
        const key = process.env.SUPABASE_SERVICE_KEY;
        const r = await fetch(
                `${SUPABASE_URL}/rest/v1/meli_tokens?user_id=eq.${encodeURIComponent(user_id)}&select=user_id,expires_at&limit=1`,
          { headers: { apikey: key, Authorization: `Bearer ${key}` } }
              );
        const rows = await r.json();
        const record = rows[0];

      if (!record) {
              return res.status(200).json({ connected: false });
      }

      // Verificar que el token no este expirado
      const expired = Date.now() > new Date(record.expires_at).getTime();

      return res.status(200).json({
              connected: true,
              token_expired: expired,
              // Si expiro hay que reconectar (el refresh puede haberlo renovado pero por las dudas)
              needs_reconnect: expired
      });

  } catch (err) {
        return res.status(500).json({ error: err.message });
  }
}
