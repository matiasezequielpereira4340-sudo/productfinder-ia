export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { capital, experiencia, canal, nicho, riesgo } = req.body;

  const prompt = 'Sos un experto en importacion desde China hacia Argentina con 15 anios de experiencia. Analizas perfiles de importadores y recomiendas productos especificos.\n\nPERFIL DEL USUARIO:\n- Capital disponible: ' + capital + '\n- Experiencia importando: ' + experiencia + '\n- Canal de venta: ' + canal + '\n- Nicho preferido: ' + nicho + '\n- Tolerancia al riesgo: ' + riesgo + '\n\nResponde SOLO con un objeto JSON valido, sin markdown, sin texto extra. El formato exacto:\n{\n  "productos": [\n    {\n      "nombre": "Nombre del producto",\n      "descripcion": "2 oraciones explicando por que es ideal para este perfil y como se vende en Argentina",\n      "margen": "X%",\n      "margenTipo": "positive",\n      "demanda": "Alta",\n      "demandaTipo": "positive",\n      "riesgo": "Bajo",\n      "riesgoTipo": "positive",\n      "score": 85,\n      "scoreTipo": "high",\n      "topPick": true,\n      "tags": ["tag1", "tag2", "tag3"]\n    }\n  ],\n  "resumen": "3-4 oraciones de analisis estrategico personalizado para este perfil.",\n  "subtitulo": "Frase corta personalizada segun el perfil"\n}\n\nDevuelve exactamente 3 productos ordenados por score descendente. El primero tiene topPick true, los demas false. El score es de 0 a 100. margenTipo/demandaTipo/riesgoTipo pueden ser positive, warning o negative. scoreTipo puede ser high, mid o low. Los tags deben ser cortos (max 3 palabras). Se especifico con nombres de productos reales. Adapta todo al mercado argentino 2025-2026.';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    
    if (!data.content || !data.content[0]) {
      return res.status(500).json({ error: 'No response from AI' });
    }

    const raw = data.content.map(function(i){ return i.text || ''; }).join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar el analisis: ' + err.message });
  }
}
