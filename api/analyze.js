export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { capital, experiencia, canal, nicho, riesgo } = req.body;

  const prompt = 'Sos un experto en importacion desde China hacia Argentina con 15 anios de experiencia. Analizas perfiles de importadores y recomiendas productos especificos.\n\nPERFIL DEL USUARIO:\n- Capital disponible: ' + capital + '\n- Experiencia importando: ' + experiencia + '\n- Canal de venta: ' + canal + '\n- Nicho preferido: ' + nicho + '\n- Tolerancia al riesgo: ' + riesgo + '\n\nResponde SOLO con un objeto JSON valido, sin markdown, sin texto extra. Solo el JSON puro comenzando con { y terminando con }.\n\nFormato:{"productos":[{"nombre":"Nombre especifico","descripcion":"2 oraciones","margen":"X%-X%","margenTipo":"positive","demanda":"Alta","demandaTipo":"positive","riesgo":"Bajo","riesgoTipo":"positive","score":85,"scoreTipo":"high","topPick":true,"tags":["tag1","tag2"]}],"resumen":"3-4 oraciones de analisis","subtitulo":"Frase corta"}\n\nExactamente 3 productos por score descendente. Primero topPick true, los demas false. score 0-100. scoreTipo: high>=80 mid 60-79 low<60. Tipos: positive warning negative. Tags max 3 palabras. Nombres reales especificos. Mercado argentino 2025-2026.';

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await apiRes.json();

    if (data.error) {
      return res.status(500).json({ error: 'API error: ' + data.error.message });
    }

    if (!data.content || !data.content[0] || !data.content[0].text) {
      return res.status(500).json({ error: 'Empty response', debug: JSON.stringify(data).substring(0, 300) });
    }

    let raw = data.content[0].text.trim();
    raw = raw.replace(/^```jsons*/i, '').replace(/^```s*/i, '').replace(/s*```$/i, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'No JSON in response', raw: raw.substring(0, 200) });
    }
    const parsed = JSON.parse(raw.substring(start, end + 1));
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
