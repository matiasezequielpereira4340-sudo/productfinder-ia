// ProductFinder IA - API Handler
// Handles /api/auth, /api/analyze, /api/chat

export default async function handler(req, res) {
  const url = req.url || '';
  const path = url.split('?')[0];

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // AUTH ENDPOINT
  if (path.endsWith('/auth')) {
    if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
    const { username, password } = req.body;
    const validUser = process.env.APP_USER || 'matypereira';
    const validPass = process.env.APP_PASS || 'maty123';
    if (username === validUser && password === validPass) {
      return res.status(200).json({success: true, user: username});
    }
    return res.status(401).json({success: false, error: 'Credenciales incorrectas'});
  }

  // CHAT ENDPOINT
  if (path.endsWith('/chat')) {
    if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});
    const { message, context } = req.body;
    if (!message) return res.status(400).json({error: 'Message required'});

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({error: 'API key not configured'});

    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 512,
          system: 'Sos un asesor especialista en importacion desde China hacia Argentina con 15 anos de experiencia. Respondés en español argentino de forma concisa y practica. Te especializas en logistica, aranceles, productos rentables, estrategias de venta en Mercado Libre y e-commerce. Maximo 3 parrafos por respuesta.',
          messages: [{role: 'user', content: message}]
        })
      });

      const data = await apiRes.json();
      if (!apiRes.ok) throw new Error(data.error?.message || 'API error');
      const response = data.content?.[0]?.text || 'No pude generar una respuesta.';
      return res.status(200).json({response});
    } catch(err) {
      return res.status(500).json({error: err.message, response: 'Error al conectar con el asesor IA. Por favor intentá de nuevo.'});
    }
  }

  // ANALYZE ENDPOINT (default)
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const { capital, experiencia, canal, nicho, riesgo } = req.body;
  if (!capital || !experiencia || !canal || !nicho || !riesgo) {
    return res.status(400).json({error: 'Todos los campos son requeridos', debug: {capital, experiencia, canal, nicho, riesgo}});
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'ANTHROPIC_API_KEY no configurada'});

  const prompt = `Sos un experto en importacion desde China hacia Argentina con 15 años de experiencia. Analizas perfiles de importadores y recomendas productos especificos.

PERFIL DEL IMPORTADOR:
- Capital disponible: ${capital}
- Experiencia: ${experiencia}
- Canal de venta: ${canal}
- Nicho: ${nicho}
- Tolerancia al riesgo: ${riesgo}

Recomienda exactamente 3 productos especificos para importar. Devuelve SOLO un JSON valido (sin markdown, sin texto extra) con este formato exacto:
{
  "products": [
    {
      "nombre": "Nombre del producto",
      "score": 85,
      "margen": 45,
      "demanda": "Alta",
      "riesgo": "Medio",
      "origen": "China",
      "descripcion": "Descripcion breve del producto y por que es buena oportunidad",
      "topPick": true
    }
  ]
}

Reglas:
- score: numero 0-100 (viabilidad general)
- margen: numero entero (% de ganancia estimado)
- demanda: Alta, Media o Baja
- riesgo: Bajo, Medio o Alto
- Solo un producto debe tener topPick: true (el mejor)
- Los otros dos tienen topPick: false
- Productos especificos y reales, no categorias generales`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [{role: 'user', content: prompt}]
      })
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      return res.status(500).json({
        error: 'Error de API Anthropic',
        debug: {status: apiRes.status, data}
      });
    }

    let rawText = data.content?.[0]?.text || '';

    // Clean up markdown if present
    rawText = rawText.replace(/```json/gi, '').replace(/```/gi, '').trim();

    // Find JSON object
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      rawText = rawText.substring(jsonStart, jsonEnd + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch(parseErr) {
      return res.status(500).json({
        error: 'Error al parsear JSON de la IA',
        raw: rawText.substring(0, 500),
        parseError: parseErr.message
      });
    }

    if (!parsed.products || !Array.isArray(parsed.products)) {
      return res.status(500).json({error: 'Formato de respuesta invalido', raw: rawText.substring(0, 200)});
    }

    // Post-process fields
    parsed.products = parsed.products.map((p, i) => ({
      nombre: p.nombre || p.name || ('Producto ' + (i+1)),
      score: parseInt(p.score) || 70,
      margen: parseInt(p.margen) || 30,
      demanda: p.demanda || 'Media',
      riesgo: p.riesgo || p.nivel_riesgo || 'Medio',
      origen: p.origen || 'China',
      descripcion: p.descripcion || '',
      topPick: i === 0 ? true : false
    }));

    return res.status(200).json(parsed);

  } catch(err) {
    return res.status(500).json({
      error: 'Error interno del servidor',
      message: err.message
    });
  }
}
