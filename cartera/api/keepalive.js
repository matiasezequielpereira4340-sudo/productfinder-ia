// Cron diario (ver vercel.json): hace una consulta liviana a Supabase para que
// el proyecto gratis no se pause por inactividad. No lee ni toca datos de nadie.
const CFG = require('../config.js');

module.exports = async (req, res) => {
  try {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/ping', {
      method: 'POST',
      headers: { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + CFG.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const txt = await r.text();
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, respuesta: txt.slice(0, 200), hora: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
};
