// Market Reader IA - Backend API
// Handles /api/market for steps: demanda, competencia, final, productUrl

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { step, product, prompt: customPrompt, url } = req.body || {};
  if (!step) return res.status(400).json({ error: 'step requerido' });

  // === Rama: productUrl (lector de link de producto, sin Anthropic) ===
  if (step === 'productUrl') {
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url requerida' });
    let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
    try {
      const data = await readProductUrl(cleanUrl);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(400).json({ error: 'No se pudo leer el link', detalle: String(e && e.message || e) });
    }
  }

  // === Resto de steps (demanda, competencia, final) usan Anthropic ===
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });

  const prompts = {
    demanda: `Sos un analista experto en e-commerce. El usuario quiere analizar la DEMANDA del producto: "${product}".\nDevolveme un analisis breve (max 8 lineas) con: nivel de demanda estimado (alto/medio/bajo), publico objetivo principal, estacionalidad, y 2 oportunidades claras. No uses asteriscos ni markdown. Texto plano.`,
    competencia: `Sos un analista experto en e-commerce. El usuario quiere analizar la COMPETENCIA del producto: "${product}".\nDevolveme un analisis breve (max 8 lineas) con: nivel de competencia (alto/medio/bajo), 3 jugadores tipicos, rango de precios estimado en USD, y 2 diferenciales posibles. No uses asteriscos ni markdown. Texto plano.`,
    final: `Sos un analista experto en e-commerce. Hace un CIERRE EJECUTIVO para el producto "${product}" en max 6 lineas con: veredicto (recomendado / con reservas / no recomendado), 2 razones, y proximo paso concreto. No uses asteriscos ni markdown.`
  };

  const promptToUse = customPrompt || prompts[step];
  if (!promptToUse) return res.status(400).json({ error: 'step invalido' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-3-5-sonnet-20241022', max_tokens: 600, messages: [{ role: 'user', content: promptToUse }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: 'Anthropic error', detalle: j });
    const texto = (j.content && j.content[0] && j.content[0].text) || '';
    return res.status(200).json({ texto });
  } catch (e) {
    return res.status(500).json({ error: 'Fallo al consultar Anthropic', detalle: String(e && e.message || e) });
  }
}

// ===== Lector de link de producto (inlined desde lib/product-reader) =====
async function readProductUrl(url) {
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  if (host.includes('mercadolibre') || host.includes('mercadolivre')) return await readMercadoLibre(url);
  if (host.includes('alibaba')) return await readAlibaba(url);
  return await readOpenGraph(url);
}

async function readMercadoLibre(url) {
  let itemId = null;
  const directMatch = url.match(/MLA[-]?(\d{6,})/i);
  if (directMatch) {
    itemId = 'MLA' + directMatch[1];
  } else {
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
      const finalUrl = r.url || url;
      const m2 = finalUrl.match(/MLA[-]?(\d{6,})/i);
      if (m2) itemId = 'MLA' + m2[1];
      if (!itemId) {
        const html = await r.text();
        const m3 = html.match(/MLA(\d{6,})/);
        if (m3) itemId = 'MLA' + m3[1];
      }
    } catch (_) {}
  }
  // Intento 1: API publica de MercadoLibre
  if (itemId) {
    try {
      const apiRes = await fetch('https://api.mercadolibre.com/items/' + itemId);
      if (apiRes.ok) {
        const j = await apiRes.json();
        const titulo = j.title || '';
        const precio = j.price != null ? Number(j.price) : null;
        const moneda = j.currency_id || 'ARS';
        const imagen = (j.pictures && j.pictures[0] && j.pictures[0].secure_url) || j.thumbnail || '';
        const descripcion = j.subtitle || '';
        return { fuente: 'mercadolibre', itemId, titulo, precio, moneda, imagen, descripcion, url };
      }
    } catch (_) {}
  }
  // Intento 2: scraping del HTML publico (cuando la API responde 403/cerrado)
  try {
    const scraped = await scrapeMercadoLibreHtml(url);
    if (scraped && scraped.titulo) {
      return { fuente: 'mercadolibre-html', itemId, ...scraped, url };
    }
  } catch (_) {}
  throw new Error('No se pudo leer el producto de MercadoLibre (API y HTML fallaron)');
}

async function scrapeMercadoLibreHtml(url) {
  const r = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-AR,es;q=0.9'
    }
  });
  if (!r.ok) throw new Error('HTML status ' + r.status);
  const html = await r.text();
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                  pick(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
                  pick(/<title[^>]*>([^<|]+)/i);
  const ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc  = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                  pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const priceStr = pick(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i);
  const moneda   = pick(/<meta[^>]+itemprop=["']priceCurrency["'][^>]+content=["']([^"']+)["']/i) || 'ARS';
  const precio = priceStr ? Number(priceStr) : null;
  return {
    titulo: ogTitle ? decodeHtml(ogTitle).trim() : '',
    precio: (precio != null && !isNaN(precio)) ? precio : null,
    moneda,
    imagen: ogImage || '',
    descripcion: ogDesc ? decodeHtml(ogDesc).trim() : ''
  };
  function pick(re) { const m = html.match(re); return m ? m[1] : null; }
}

async function readAlibaba(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
  if (!r.ok) throw new Error('Alibaba respondio ' + r.status);
  const html = await r.text();
  const titulo = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                 pick(/<title[^>]*>([^<|]+)/i) || '';
  const imagen = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || '';
  const descripcion = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || '';
  let precioMin = null, precioMax = null, moneda = 'USD';
  const priceRangeMatch = html.match(/\$\s?([\d,.]+)\s*[-~]\s*\$?\s?([\d,.]+)/);
  if (priceRangeMatch) {
    precioMin = parseFloat(priceRangeMatch[1].replace(/,/g,''));
    precioMax = parseFloat(priceRangeMatch[2].replace(/,/g,''));
  }
  return {
    fuente: 'alibaba',
    titulo: decodeHtml(titulo).trim(),
    precio: precioMin,
    precioMax,
    moneda,
    imagen,
    descripcion: decodeHtml(descripcion).trim(),
    url
  };
  function pick(re) { const m = html.match(re); return m ? m[1] : null; }
}

async function readOpenGraph(url) {
  const data = await fetchOpenGraph(url);
  return { fuente: 'opengraph', ...data, url };
}

async function fetchOpenGraph(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
  if (!r.ok) throw new Error('Pagina respondio ' + r.status);
  const html = await r.text();
  const titulo = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                 pick(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
                 pick(/<title[^>]*>([^<|]+)/i) || '';
  const imagen = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                 pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) || '';
  const descripcion = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                      pick(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i) || '';
  return { titulo: decodeHtml(titulo).trim(), imagen, descripcion: decodeHtml(descripcion).trim() };
  function pick(re) { const m = html.match(re); return m ? m[1] : null; }
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
