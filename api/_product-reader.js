// Product URL Reader - Lee datos reales de un link de producto
// Soporta: MercadoLibre Argentina (API oficial) y Alibaba (OpenGraph)
// Filosofia: NUNCA inventa datos. Si no se puede leer, lo informa.

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
          return res.status(400).json({ error: 'URL requerida' });
    }

  let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;

  try {
        const source = detectSource(cleanUrl);

      if (source === 'mercadolibre') {
              const data = await readMercadoLibre(cleanUrl);
              return res.status(200).json(data);
      }

      if (source === 'alibaba') {
              const data = await readAlibaba(cleanUrl);
              return res.status(200).json(data);
      }

      // Generico: intentar OpenGraph
      const data = await readOpenGraph(cleanUrl, 'otro');
        return res.status(200).json(data);

  } catch (err) {
        return res.status(500).json({
                error: 'No se pudo leer el link',
                message: err.message,
                hint: 'Verifica que el link sea valido y publico. Si es de Alibaba, podes cargar el FOB y MOQ manualmente.'
        });
  }
}

function detectSource(url) {
    const u = url.toLowerCase();
    if (u.includes('mercadolibre.com.ar') || u.includes('mercadolibre.com') || u.includes('/mla-') || /mla[-]?\d{6,}/.test(u)) {
          return 'mercadolibre';
    }
    if (u.includes('alibaba.com') || u.includes('1688.com') || u.includes('aliexpress.com')) {
          return 'alibaba';
    }
    return 'otro';
}

// ============ MERCADOLIBRE ============
async function readMercadoLibre(url) {
    // Extraer ID del item (formatos: MLA-123456789, MLA123456789, /p/MLA...)
  let itemId = null;

  const directMatch = url.match(/MLA[-]?(\d{6,})/i);
    if (directMatch) {
          itemId = 'MLA' + directMatch[1];
    } else {
          // Resolver redirect siguiendo la URL (publicaciones tipo articulo.mercadolibre.com.ar/MLA-xxx-yyy)
      try {
              const resp = await fetch(url, {
                        method: 'GET',
                        redirect: 'follow',
                        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderIA/1.0)' }
              });
              const finalUrl = resp.url || url;
              const m = finalUrl.match(/MLA[-]?(\d{6,})/i);
              if (m) itemId = 'MLA' + m[1];

            if (!itemId) {
                      // Buscar en el HTML
                const html = await resp.text();
                      const m2 = html.match(/MLA(\d{6,})/);
                      if (m2) itemId = 'MLA' + m2[1];
            }
      } catch (e) {
              // ignore
      }
    }

  if (!itemId) {
        return {
                fuente: 'mercadolibre',
                realData: false,
                error: 'No se pudo extraer el ID del producto de MercadoLibre desde el link.',
                hint: 'Asegurate de pegar el link completo de la publicacion (suele contener MLA-XXXXXXXX).'
        };
  }

  // Llamar a API publica de MeLi (no requiere auth para items publicos)
  const itemRes = await fetch(`https://api.mercadolibre.com/items/${itemId}`);
    if (!itemRes.ok) {
          return {
                  fuente: 'mercadolibre',
                  realData: false,
                  error: `MercadoLibre respondio ${itemRes.status} para ${itemId}.`,
                  hint: 'Puede que la publicacion este pausada o haya sido eliminada.'
          };
    }
    const item = await itemRes.json();

  // Descripcion (endpoint separado)
  let descripcion = '';
    try {
          const descRes = await fetch(`https://api.mercadolibre.com/items/${itemId}/description`);
          if (descRes.ok) {
                  const desc = await descRes.json();
                  descripcion = desc.plain_text || desc.text || '';
          }
    } catch (e) { /* descripcion opcional */ }

  // Categoria nombre
  let categoriaNombre = item.category_id || '';
    try {
          if (item.category_id) {
                  const catRes = await fetch(`https://api.mercadolibre.com/categories/${item.category_id}`);
                  if (catRes.ok) {
                            const cat = await catRes.json();
                            categoriaNombre = cat.name || categoriaNombre;
                  }
          }
    } catch (e) { /* opcional */ }

  return {
        fuente: 'mercadolibre',
        realData: true,
        itemId,
        titulo: item.title || '',
        precio: item.price ?? null,
        moneda: item.currency_id || 'ARS',
        imagen: item.thumbnail ? item.thumbnail.replace(/^http:/, 'https:') : (item.pictures?.[0]?.url || ''),
        imagenes: (item.pictures || []).map(p => (p.url || '').replace(/^http:/, 'https:')).filter(Boolean),
        condicion: item.condition || '',
        vendidos: item.sold_quantity ?? null,
        disponibles: item.available_quantity ?? null,
        envioGratis: !!(item.shipping && item.shipping.free_shipping),
        permalink: item.permalink || url,
        categoriaId: item.category_id || '',
        categoria: categoriaNombre,
        atributos: (item.attributes || []).slice(0, 12).map(a => ({ nombre: a.name, valor: a.value_name })),
        descripcion: (descripcion || '').slice(0, 1500),
        // Campos pensados para principiantes
        explicacion: {
                vendidos: 'Cantidad de unidades vendidas por esta publicacion segun MercadoLibre.',
                condicion: 'Nuevo o usado, segun lo declaro el vendedor.',
                envioGratis: 'Indica si la publicacion ofrece envio gratis (puede afectar tu precio final).'
        }
  };
}

// ============ ALIBABA ============
async function readAlibaba(url) {
    // Opcion A: solo OpenGraph. FOB y MOQ se cargan manualmente desde el front.
  const og = await fetchOpenGraph(url);

  return {
        fuente: 'alibaba',
        realData: !!og.titulo, // real si al menos pudimos leer titulo
        titulo: og.titulo || '',
        imagen: og.imagen || '',
        descripcion: og.descripcion || '',
        permalink: url,
        aviso: 'Alibaba no expone precio FOB ni MOQ en sus metadatos publicos. Cargalos manualmente desde la pagina del producto para un calculo certero.',
        camposManuales: {
                fobUSD: { requerido: true, ayuda: 'Precio FOB en USD por unidad. Lo ves en la pagina de Alibaba al lado del producto (ej: "US $2.50 - $3.00").' },
                moq: { requerido: true, ayuda: 'MOQ = Cantidad minima de compra (Minimum Order Quantity). Ej: "MOQ: 100 piezas".' },
                pesoKg: { requerido: false, ayuda: 'Peso por unidad en kg (sirve para estimar costo de flete).' }
        },
        explicacion: {
                FOB: 'FOB (Free On Board) = precio del producto puesto en el puerto de origen, sin flete internacional ni impuestos.',
                MOQ: 'MOQ = Minimum Order Quantity. Es la cantidad minima que el proveedor acepta vender.',
                por_que_manual: 'Alibaba renderiza el precio con JavaScript y no lo publica en sus meta tags. Para no darte un dato inventado, te pedimos que lo cargues vos mirando la pagina.'
        }
  };
}

// ============ OPENGRAPH GENERICO ============
async function readOpenGraph(url, fuente) {
    const og = await fetchOpenGraph(url);
    return {
          fuente,
          realData: !!og.titulo,
          titulo: og.titulo || '',
          imagen: og.imagen || '',
          descripcion: og.descripcion || '',
          permalink: url,
          aviso: og.titulo
            ? 'Datos extraidos de los meta tags publicos de la pagina. Pueden no incluir precio ni stock.'
                  : 'No se encontraron metadatos legibles. Cargá los datos manualmente o probá con un link de MercadoLibre/Alibaba.'
    };
}

async function fetchOpenGraph(url) {
    const resp = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          headers: {
                  'User-Agent': 'Mozilla/5.0 (compatible; ProductFinderIA/1.0; +https://productfinder-ia.vercel.app)',
                  'Accept': 'text/html,application/xhtml+xml'
          }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} al leer la pagina`);
    const html = await resp.text();

  const pick = (re) => {
        const m = html.match(re);
        return m ? decodeHtml(m[1].trim()) : '';
  };

  const titulo =
        pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
        pick(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
        pick(/<title[^>]*>([^<]+)<\/title>/i);

  const imagen =
        pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);

  const descripcion =
        pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
        pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
        pick(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i);

  return { titulo, imagen, descripcion };
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
    .replace(/&nbsp;/g, ' ');
}
