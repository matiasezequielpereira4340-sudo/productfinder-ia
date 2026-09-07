import { anthropicHeaders } from './_meli.js';
import { haySesion, tokenDe, pedirSesion } from './_sesion.js';
// ProductFinder IA - Chat endpoint
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://productfinder-ia.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed'});

  // Este endpoint consume tokens de Anthropic con la key de la casa. Antes no
  // pedia nada: cualquiera con la URL podia dejarla seca en un rato.
  if (!haySesion(tokenDe(req))) {
    return pedirSesion(res, 'Para hablar con el asesor IA hace falta iniciar sesion.');
  }

  const { message } = req.body;
  if (!message) return res.status(400).json({error: 'Message required'});

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({error: 'API key not configured', response: 'Servicio no disponible.'});

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders(),
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        system: 'Sos una herramienta de consulta rapida dentro de la app de Matias (Innovasmart), que asesora importaciones China-Argentina. No te presentes como asesor ni como consultor: sos una herramienta. Para casos puntuales, deriva a hablar con Matias por WhatsApp. Respondés en español argentino de forma concisa y practica. Te especializas en logistica, aranceles, productos rentables y estrategias de venta en Mercado Libre y e-commerce. Maximo 3 parrafos por respuesta.',
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
