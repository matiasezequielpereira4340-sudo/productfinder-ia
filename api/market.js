// Market Reader IA - Backend API
// Handles /api/market for steps: demanda, competencia, final, productUrl
// Usa MeLi search publica + Anthropic (claude-haiku-4-5) para datos estructurados

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { step, product, prompt: customPrompt, url } = req.body || {};
  if (!step) return res.status(400).json({ error: 'step requerido' });

  if (step === 'productUrl') {
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url requerida' });
    let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
    try { return res.status(200).json(await readProductUrl(cleanUrl)); }
    catch (e) { return res.status(400).json({ error: 'No se pudo leer el link', detalle: String(e && e.message || e) }); }
  }
  if (step === 'demanda') {
    try { return res.status(200).json(await stepDemanda(product)); }
    catch (e) { return res.status(500).json({ error: 'Fallo demanda', detalle: String(e && e.message || e) }); }
  }
  if (step === 'competencia') {
    try { return res.status(200).json(await stepCompetencia(product)); }
    catch (e) { return res.status(500).json({ error: 'Fallo competencia', detalle: String(e && e.message || e) }); }
  }
  if (step === 'final') {
    try { return res.status(200).json(await stepFinal(customPrompt)); }
    catch (e) { return res.status(500).json({ error: 'Fallo final', detalle: String(e && e.message || e) }); }
  }
  return res.status(400).json({ error: 'step invalido' });
}

async function stepDemanda(product) {
  if (!product) throw new Error('product requerido');
  const meli = await safeMeliSearch(product);
  const trends = await safeGoogleTrends(product);
  const totalMeli = meli && meli.total != null ? meli.total : 'sin dato';
  const catName = meli && meli.categoryName ? meli.categoryName : 'sin dato';
  const trendsStr = trends && trends.values ? trends.values.join(',') : 'sin dato';
  const prompt = 'Sos analista de e-commerce Argentina. Para el producto "' + product + '" genera JSON de DEMANDA AR. Datos reales: Total publicaciones MeLi AR=' + totalMeli + '; Top categoria=' + catName + '; Google Trends 12m (0-100)=' + trendsStr + '. Responde SOLO JSON sin markdown: {"tendencia":"subiendo|estable|bajando","nivelDemanda":"alto|medio|bajo","demandaScore":0-100,"temporalidad":"string corto","descripcion":"1-2 oraciones rioplatense","tags":["t1","t2","t3"],"monthlyData":[{"mes":"Ene","valor":0-100},{"mes":"Feb","valor":0-100},{"mes":"Mar","valor":0-100},{"mes":"Abr","valor":0-100},{"mes":"May","valor":0-100},{"mes":"Jun","valor":0-100},{"mes":"Jul","valor":0-100},{"mes":"Ago","valor":0-100},{"mes":"Sep","valor":0-100},{"mes":"Oct","valor":0-100},{"mes":"Nov","valor":0-100},{"mes":"Dic","valor":0-100}]}';
  const j = await askClaudeJson(prompt);
  if (trends && trends.monthlyData && trends.monthlyData.length === 12) {
    j.monthlyData = trends.monthlyData;
    const first3 = (trends.values[0]+trends.values[1]+trends.values[2])/3;
    const last3 = (trends.values[9]+trends.values[10]+trends.values[11])/3;
    if (last3 > first3*1.15) j.tendencia = 'subiendo';
    else if (last3 < first3*0.85) j.tendencia = 'bajando';
    else j.tendencia = 'estable';
    const avg = trends.values.reduce((a,b)=>a+b,0)/12;
    j.demandaScore = Math.round(Math.min(100, Math.max(0, avg)));
  }
    j.monthlyData = buildRollingMonths(j.monthlyData);
    j.rangoFechas = j.monthlyData[0].label + ' - ' + j.monthlyData[11].label;
  return j;
}

async function stepCompetencia(product) {
  if (!product) throw new Error('product requerido');
  const meli = await safeMeliSearch(product);
  if (meli && meli.results && meli.results.length > 0) {
    const prices = meli.results.map(x => x.price).filter(p => typeof p === 'number' && p > 0).sort((a,b)=>a-b);
    const min = prices[0] || 0;
    const max = prices[prices.length-1] || 0;
    const avg = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
    const sellers = new Set(meli.results.map(x => x.seller && x.seller.id).filter(Boolean));
    const total = meli.total || meli.results.length;
    let saturacion = 'moderado';
    if (total < 200) saturacion = 'libre';
    else if (total > 10000) saturacion = 'muy saturado';
    else if (total > 2000) saturacion = 'saturado';
    const competitors = meli.results.slice(0,5).map((x,i)=>({rank:i+1, name:(x.seller && x.seller.nickname) || ('Vendedor '+(i+1)), price:x.price||0, soldQty:x.sold_quantity||0, reputation:(x.seller && x.seller.seller_reputation && x.seller.seller_reputation.level_id) || 'N/A', repClass:'comp-rep-ok'}));
    return { fuente:'mercadolibre-search', sellersEstimados: sellers.size || meli.results.length, precioMinARS:min, precioMaxARS:max, precioPromedioARS:avg, totalResults:total, categoryName:meli.categoryName||'', saturacion, competenciaScore: Math.min(100, Math.round(total/100)), competitors };
  }
  // IMPORTANTE: si no hay datos reales de MeLi (API 403 o scraping fallido) NO inventamos numeros via IA.
  return { fuente: 'no-disponible', sellersEstimados: null, precioMinARS: null, precioMaxARS: null, precioPromedioARS: null, totalResults: null, categoryName: '', saturacion: null, competenciaScore: null, competitors: [], aviso: 'Datos de Mercado Libre no disponibles ahora (la API publica requiere autenticacion). Mostramos solo lo verificable.' };
}

async function stepFinal(customPrompt) {
  if (!customPrompt) throw new Error('prompt requerido');
  return await askClaudeJson(customPrompt);
}

async function askClaudeJson(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Anthropic ' + r.status + ': ' + JSON.stringify(j));
  const texto = (j.content && j.content[0] && j.content[0].text) || '';
  let cleaned = texto.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Respuesta no JSON: ' + cleaned.substring(0,200));
  }
}

async function safeMeliSearch(product) {
  // 1) Intento API publica oficial (puede devolver 403 si MeLi exige auth)
  try {
    const q = encodeURIComponent(product);
    const r = await fetch('https://api.mercadolibre.com/sites/MLA/search?q=' + q + '&limit=20', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
    if (r.ok) {
      const j = await r.json();
      const catFilter = (j.available_filters || []).find(f => f.id === 'category');
      const categoryName = catFilter && catFilter.values && catFilter.values[0] ? catFilter.values[0].name : '';
      return { fuente: 'meli-api', total: (j.paging && j.paging.total) || 0, results: j.results || [], categoryName };
    }
  } catch (_) {}
  // 2) Fallback: scraping HTML publico de listado.mercadolibre.com.ar (sin auth)
  try { return await scrapeMeliSearchHtml(product); } catch (_) { return null; }
}

async function scrapeMeliSearchHtml(product) {
  const slug = String(product).trim().toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-');
  const url = 'https://listado.mercadolibre.com.ar/' + encodeURIComponent(slug);
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-AR,es;q=0.9' } });
  if (!r.ok) return null;
  const html = await r.text();
  // Total de resultados
  let total = 0;
  const totalMatches = [
    html.match(/(\d[\d.,]*)\s*resultados/i),
    html.match(/quantity[\\"']{1,3}\s*:\s*(\d+)/i),
    html.match(/"total"\s*:\s*(\d+)/i)
  ];
  for (const m of totalMatches) { if (m) { total = parseInt(String(m[1]).replace(/[^0-9]/g,''),10) || 0; if (total) break; } }
  // Categoria principal: tomar el primer breadcrumb o titulo de filtro
  let categoryName = '';
  const catMatch = html.match(/<h1[^>]*>([^<]{3,80})<\/h1>/i);
  if (catMatch) categoryName = decodeHtml(catMatch[1]).trim();
  if (!categoryName) {
    const og = html.match(/<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']+)[\"']/i);
    if (og) categoryName = decodeHtml(og[1]).trim().replace(/\s*\|.*$/,'');
  }
  // Extraer items: titulo, precio, vendedor, cantidad vendida
  const results = [];
  const itemRegex = /<a[^>]+class="[^"]*poly-component__title[^"]*"[^>]*>([^<]{3,200})<\/a>([\s\S]{0,2500}?)<\/li>/gi;
  let m;
  while ((m = itemRegex.exec(html)) !== null && results.length < 20) {
    const titulo = decodeHtml(m[1]).trim();
    const block = m[2] || '';
    const priceMatch = block.match(/andes-money-amount__fraction[^>]*>([\d.]+)<\/span>/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/\./g,''),10) : null;
    const sellerMatch = block.match(/poly-component__seller[^>]*>(?:Por\s*)?([^<]{2,80})<\//i);
    const sellerName = sellerMatch ? decodeHtml(sellerMatch[1]).trim() : '';
    const soldMatch = block.match(/(\d[\d.,]*)\s*vendidos?/i);
    const sold = soldMatch ? parseInt(String(soldMatch[1]).replace(/[^0-9]/g,''),10) : 0;
    if (titulo && price) {
      results.push({ title: titulo, price, sold_quantity: sold, seller: { id: sellerName || null, nickname: sellerName } });
    }
  }
  if (!results.length && !total) return null;
  return { fuente: 'meli-html', total: total || results.length, results, categoryName };
}

async function safeGoogleTrends(product) {
  try {
    const exploreReq = JSON.stringify({comparisonItem:[{keyword:product,geo:'AR',time:'today 12-m'}],category:0,property:''});
    const r1 = await fetch('https://trends.google.com/trends/api/explore?hl=es-AR&tz=180&req=' + encodeURIComponent(exploreReq), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r1.ok) return null;
    const txt1 = await r1.text();
    const clean1 = txt1.replace(/^\)\]\}',?\n?/, '');
    const j1 = JSON.parse(clean1);
    const tw = (j1.widgets || []).find(w => w.id === 'TIMESERIES');
    if (!tw) return null;
    const r2 = await fetch('https://trends.google.com/trends/api/widgetdata/multiline?hl=es-AR&tz=180&req=' + encodeURIComponent(JSON.stringify(tw.request)) + '&token=' + encodeURIComponent(tw.token), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r2.ok) return null;
    const txt2 = await r2.text();
    const clean2 = txt2.replace(/^\)\]\}',?\n?/, '');
    const j2 = JSON.parse(clean2);
    const points = (j2.default && j2.default.timelineData) || [];
    if (!points.length) return null;
    const monthly = {};
    points.forEach(p => {
      const d = new Date(parseInt(p.time)*1000);
      const k = d.getFullYear() + '-' + (d.getMonth()+1);
      if (!monthly[k]) monthly[k] = [];
      monthly[k].push(p.value[0]);
    });
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const keys = Object.keys(monthly).sort();
    const last12 = keys.slice(-12);
    const monthlyData = last12.map(k => {
      const m = parseInt(k.split('-')[1])-1;
      const arr = monthly[k];
      const avg = Math.round(arr.reduce((a,b)=>a+b,0)/arr.length);
      return { mes: meses[m], valor: avg };
    });
    const values = monthlyData.map(x => x.valor);
    return { values, monthlyData };
  } catch { return null; }
}

async function readProductUrl(url) {
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  if (host.includes('mercadolibre') || host.includes('mercadolivre')) return await readMercadoLibre(url);
  if (host.includes('alibaba')) return await readAlibaba(url);
  return await readOpenGraph(url);
}

async function readMercadoLibre(url) {
  let itemId = null;
  const directMatch = url.match(/MLA[-]?(\d{6,})/i);
  if (directMatch) itemId = 'MLA' + directMatch[1];
  else {
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
  if (itemId) {
    try {
      const apiRes = await fetch('https://api.mercadolibre.com/items/' + itemId);
      if (apiRes.ok) {
        const j = await apiRes.json();
        return { fuente: 'mercadolibre', itemId, titulo: j.title || '', precio: j.price != null ? Number(j.price) : null, moneda: j.currency_id || 'ARS', imagen: (j.pictures && j.pictures[0] && j.pictures[0].secure_url) || j.thumbnail || '', descripcion: j.subtitle || '', url };
      }
    } catch (_) {}
  }
  try {
    const scraped = await scrapeMercadoLibreHtml(url);
    if (scraped && scraped.titulo) return { fuente: 'mercadolibre-html', itemId, ...scraped, url };
  } catch (_) {}
  return { fuente: 'mercadolibre-min', itemId, titulo: 'Producto MeLi ' + (itemId||''), precio: null, moneda: 'ARS', imagen: '', descripcion: '', url };
}

async function scrapeMercadoLibreHtml(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-AR,es;q=0.9' } });
  if (!r.ok) throw new Error('HTML status ' + r.status);
  const html = await r.text();
  const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<|]+)/i);
  const ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc  = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const priceStr = pick(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i);
  const moneda   = pick(/<meta[^>]+itemprop=["']priceCurrency["'][^>]+content=["']([^"']+)["']/i) || 'ARS';
  const precio = priceStr ? Number(priceStr) : null;
  return { titulo: ogTitle ? decodeHtml(ogTitle).trim() : '', precio: (precio != null && !isNaN(precio)) ? precio : null, moneda, imagen: ogImage || '', descripcion: ogDesc ? decodeHtml(ogDesc).trim() : '' };
}

async function readAlibaba(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
  if (!r.ok) throw new Error('Alibaba respondio ' + r.status);
  const html = await r.text();
  const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const titulo = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<|]+)/i) || '';
  const imagen = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || '';
  const descripcion = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || '';
  let precioMin = null, precioMax = null;
  const priceRangeMatch = html.match(/\$\s?([\d,.]+)\s*[-~]\s*\$?\s?([\d,.]+)/);
  if (priceRangeMatch) { precioMin = parseFloat(priceRangeMatch[1].replace(/,/g,'')); precioMax = parseFloat(priceRangeMatch[2].replace(/,/g,'')); }
  return { fuente: 'alibaba', titulo: decodeHtml(titulo).trim(), precio: precioMin, precioMax, moneda: 'USD', imagen, descripcion: decodeHtml(descripcion).trim(), url };
}

async function readOpenGraph(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderBot/1.0)' } });
  if (!r.ok) throw new Error('Pagina respondio ' + r.status);
  const html = await r.text();
  const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const titulo = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<|]+)/i) || '';
  const imagen = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) || '';
  const descripcion = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i) || '';
  return { fuente: 'opengraph', titulo: decodeHtml(titulo).trim(), imagen, descripcion: decodeHtml(descripcion).trim(), url };
}

function decodeHtml(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
}

// ============================================================
// HELPER: Rolling 12-month window (Google Trends style)
// Toma la respuesta de Claude o Trends y reordena los meses
// para que terminen siempre en el mes actual (ventana movil).
// Ej: Mayo 2026 -> Jun 25, Jul 25, ..., May 26.
// Cada vez que pasa un mes, la ventana se desplaza sola.
// ============================================================
const MES_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function buildRollingMonths(sourceMonthly) {
    const now = new Date();
    // Index del valor por nombre de mes en el array fuente (asumimos Ene-Dic calendario).
  const byMes = {};
    if (Array.isArray(sourceMonthly)) {
          sourceMonthly.forEach(item => {
                  if (item && item.mes && typeof item.valor === 'number') {
                            byMes[item.mes] = item.valor;
                  }
          });
    }
    const out = [];
    for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mes = MES_LABELS[d.getMonth()];
          const year = d.getFullYear();
          const yy = String(year).slice(2);
          let valor = byMes[mes];
          if (typeof valor !== 'number') {
                  // Fallback: curva estacional suave si no hay dato
            valor = Math.round(65 + Math.sin((d.getMonth()/12)*Math.PI*2) * 15 + Math.random()*5);
          }
          out.push({
                  mes,
                  label: `${mes} ${year}`,
                  year,
                  monthIndex: d.getMonth(),
                  valor: Math.max(0, Math.min(100, Math.round(valor)))
          });
    }
    return out;
}
