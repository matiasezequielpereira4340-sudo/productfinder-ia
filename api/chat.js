// ProductFinder IA - Chat endpoint
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  const { message } = req.body;
  if (!message) return res.status(400).json({error: 'Message required'});

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'API key not configured', response: 'Servicio no disponible.'});

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
        system: 'Sos un asesor especialista en importacion desde China hacia Argentina con 15 anos de experiencia. Respondés en español argentino de forma concisa y practica. Te especializas en logistica, aranceles, productos rentables y estrategias de venta en Mercado Libre y e-commerce. Maximo 3 parrafos por respuesta.',
        messages: [{role: 'user', content: message}]
      })
    });

    const data = await apiRes.json();
    if (!apiRes.ok) throw new Error(data.error?.message || 'API error');
    const response = data.content?.[0]?.text || 'No pude generar una respuesta.';
    return res.status(200).json({response});
  } catch(err) {
    return res.status(500).json({error: err.message, response: 'Error al conectar con el asesor IA. Intentá de nuevo.'});
  }
}
