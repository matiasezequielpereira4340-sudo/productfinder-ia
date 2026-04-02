// Market Reader IA - Backend API
// Handles /api/market for steps: demanda, competencia, final

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });

  const { step, product, prompt: customPrompt } = req.body;
  if (!step) return res.status(400).json({ error: 'step requerido' });

  let system, userMsg, maxTokens;

  if (step === 'demanda') {
    if (!product) return res.status(400).json({ error: 'product requerido' });
    maxTokens = 800;
    system = 'Sos un experto en mercado argentino. Respondé SOLO con JSON válido sin markdown ni texto extra. Claves exactas: {"tendencia":"subiendo|estable|bajando","descripcion":"string max 90 chars","demandaScore":number 0-100,"temporalidad":"todo el año|estacional|nicho","tags":["tag1","tag2","tag3"],"nivelDemanda":"bajo|medio|alto|muy alto"}';
    userMsg = `Analizá la demanda real del mercado argentino 2026 para: "${product}". Considerá popularidad, búsquedas, tendencias en redes y comportamiento del consumidor argentino. JSON:`;

  } else if (step === 'competencia') {
    if (!product) return res.status(400).json({ error: 'product requerido' });
    maxTokens = 800;
    system = 'Sos un experto en Mercado Libre Argentina (MLA). Respondé SOLO con JSON válido sin markdown ni texto extra. Claves exactas: {"sellersEstimados":number,"precioMinARS":number,"precioMaxARS":number,"precioPromedioARS":number,"competenciaScore":number 0-100,"descripcion":"string max 100 chars","oportunidad":"string max 80 chars","saturacion":"libre|moderado|saturado|muy saturado"}';
    userMsg = `Estimá el nivel de competencia y precios actuales en Mercado Libre Argentina (MLA) para: "${product}". Usá tu conocimiento del mercado MLA 2025-2026. JSON:`;

  } else if (step === 'final') {
    if (!customPrompt) return res.status(400).json({ error: 'prompt requerido para step final' });
    maxTokens = 1000;
    system = 'Sos un analista experto en importaciones China-Argentina. Respondé SOLO con JSON válido sin markdown ni texto extra.';
    userMsg = customPrompt;

  } else {
    return res.status(400).json({ error: 'step inválido. Usar: demanda | competencia | final' });
  }

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
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.status(500).json({ error: 'Error de API Anthropic', debug: { status: apiRes.status, data } });
    }

    let rawText = data.content?.[0]?.text || '{}';
    rawText = rawText.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      rawText = rawText.substring(jsonStart, jsonEnd + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Error al parsear JSON', raw: rawText.substring(0, 300), parseError: parseErr.message });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: 'Error interno', message: err.message });
  }
}
