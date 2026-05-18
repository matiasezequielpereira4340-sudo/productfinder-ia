// api/meli/callback.js
// Endpoint que recibe el ?code=... del flujo OAuth de Mercado Libre,
// lo intercambia por access_token + refresh_token y los muestra en pantalla.
// Solo funciona si MELI_BOOTSTRAP=1 esta en las env vars de Vercel.
// Despues de obtener el refresh_token, poner MELI_BOOTSTRAP=0 (o borrarla) para desactivar este endpoint.

module.exports = async (req, res) => {
  try {
    if (process.env.MELI_BOOTSTRAP !== '1') {
      res.status(403).send('Bootstrap deshabilitado. Para activarlo, seteo MELI_BOOTSTRAP=1 en Vercel y redeploy.');
      return;
    }

    const code = (req.query && req.query.code) || '';
    if (!code) {
      const clientId = process.env.MELI_CLIENT_ID || '';
      const redirect = 'https://productfinder-ia.vercel.app/api/meli/callback';
      const authUrl = 'https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=' + encodeURIComponent(clientId) + '&redirect_uri=' + encodeURIComponent(redirect);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send('<html><body style="font-family:system-ui;padding:24px"><h2>Mercado Libre OAuth bootstrap</h2><p>No recibi parametro <code>code</code>. Hace click para autorizar:</p><p><a href="' + authUrl + '">Autorizar ProducFinder en Mercado Libre</a></p></body></html>');
      return;
    }

    const clientId = process.env.MELI_CLIENT_ID;
    const clientSecret = process.env.MELI_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.status(500).send('Faltan MELI_CLIENT_ID o MELI_CLIENT_SECRET en las env vars.');
      return;
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    body.set('code', code);
    body.set('redirect_uri', 'https://productfinder-ia.vercel.app/api/meli/callback');

    const r = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body.toString()
    });
    const txt = await r.text();
    let data = null;
    try { data = JSON.parse(txt); } catch (e) { data = null; }

    if (!r.ok || !data || !data.access_token) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(500).send('<html><body style="font-family:system-ui;padding:24px"><h2>Error intercambiando code</h2><p>HTTP ' + r.status + '</p><pre>' + (txt || '').replace(/</g, '&lt;') + '</pre></body></html>');
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send('<html><body style="font-family:system-ui;padding:24px;max-width:760px"><h2>Tokens obtenidos</h2><p><b>Copia el refresh_token y pegalo en Vercel como <code>MELI_REFRESH_TOKEN</code>.</b> Despues borra o pone MELI_BOOTSTRAP=0 y redeploy.</p><table style="border-collapse:collapse"><tr><td style="padding:6px;border:1px solid #ddd"><b>access_token</b></td><td style="padding:6px;border:1px solid #ddd"><code>' + data.access_token + '</code></td></tr><tr><td style="padding:6px;border:1px solid #ddd"><b>refresh_token</b></td><td style="padding:6px;border:1px solid #ddd"><code>' + (data.refresh_token || '(no enviado - revisar scope offline_access)') + '</code></td></tr><tr><td style="padding:6px;border:1px solid #ddd">expires_in</td><td style="padding:6px;border:1px solid #ddd">' + (data.expires_in || '') + ' seg</td></tr><tr><td style="padding:6px;border:1px solid #ddd">user_id</td><td style="padding:6px;border:1px solid #ddd">' + (data.user_id || '') + '</td></tr><tr><td style="padding:6px;border:1px solid #ddd">scope</td><td style="padding:6px;border:1px solid #ddd">' + (data.scope || '') + '</td></tr></table></body></html>');
  } catch (e) {
    res.status(500).send('Error: ' + (e && e.message ? e.message : String(e)));
  }
};
