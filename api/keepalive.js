// api/keepalive.js
// Endpoint para mantener vivo el proyecto Supabase (free tier auto-pausa tras 7 dias inactivo)
// Lo invoca un cron de Vercel definido en vercel.json

const SUPABASE_URL = 'https://qglieqpcmmffgxijbysb.supabase.co';

export default async function handler(req, res) {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) {
          return res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_KEY no configurado' });
    }

  try {
        // Pegada minima a la API REST de Supabase para registrar actividad
      // Pide solo el primer registro (HEAD-like) sin transferir data util
      const r = await fetch(SUPABASE_URL + '/rest/v1/meli_tokens?select=user_id&limit=1', {
              method: 'GET',
              headers: {
                        'apikey': serviceKey,
                        'Authorization': 'Bearer ' + serviceKey,
                        'Range': '0-0'
              }
      });

      return res.status(200).json({
              ok: true,
              ts: new Date().toISOString(),
              supabase_status: r.status
      });
  } catch (err) {
        console.error('keepalive error:', err.message);
        return res.status(500).json({ ok: false, error: err.message });
  }
}
